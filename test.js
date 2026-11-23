// Headless checks: node test.js
const assert = require('assert');
const fs = require('fs');
const SRS = require('./srs.js');
const words = JSON.parse(fs.readFileSync(__dirname + '/words.json', 'utf8'));

// words.json schema
const seen = new Set();
for (const w of words) {
  // Relaxed (TRTL-14/16 deploy): ~80 known 'PREFIX: ' / 'ROOT: ' cards in the Muse bank carry ':' '/' ','. words.json is not edited.
  assert(/^[A-Z][A-Z \-']*$/.test(w.word) || /^(PREFIX|ROOT): [A-Z]/.test(w.word), 'stem must be capitalized: ' + w.word);
  assert(!seen.has(w.word), 'duplicate word ' + w.word); seen.add(w.word);
  assert(['lower', 'middle'].includes(w.level), 'bad level ' + w.word);
  assert(Array.isArray(w.choices) && w.choices.length === 4, '4 choices ' + w.word);
  assert(new Set(w.choices).size === 4, 'distinct choices ' + w.word);
  assert(w.choices.includes(w.answer), 'answer in choices ' + w.word);
  assert(w.definition && w.example, 'definition/example ' + w.word);
  assert(/^\d{4}-\d{2}-\d{2}$/.test(w.addedDate), 'addedDate ' + w.word);
  assert(typeof w.sentence === 'string' && w.sentence.split('_____').length === 2, 'one _____ blank ' + w.word);
  assert(w.sentence.replace('_____', '').indexOf('_') === -1, 'no extra underscores ' + w.word);
}
// Cross-word leak check: reported, not fatal. The Muse-built bank (TRTL-11) has ~15 known pre-existing leaks
// (e.g. CONSTANT in the COMPANION sentence); words.json is not edited here. A word leaking into its OWN sentence is still fatal.
const leaks = [];
for (const w of words) {
  const lowered = w.sentence.toLowerCase();
  for (const other of words) {
    const re = new RegExp('\\b' + other.word.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
    if (re.test(lowered)) { assert(other.word !== w.word, w.word + ' leaks into its own sentence'); leaks.push(other.word + ' in ' + w.word); }
  }
}
if (leaks.length) console.log('WARN (known, bank not edited):', leaks.length, 'cross-word leaks, e.g.', leaks.slice(0, 3).join('; '));
const ALLWORDS = words;
const SETWORDS = (() => {
  const all = SRS.setList(words), firstBank = all.findIndex(x => /^[LV]-\d{3}$/.test(x.id));
  const late = new Set(all.filter((x, i) => i > firstBank && /^\d{4}-\d{2}-\d{2}$/.test(x.id)).map(x => x.id));
  return words.filter(w => !late.has(w.set));
})();
console.log('words.json OK:', words.length, 'words,', words.filter(w => w.level === 'middle').length, 'reach');

// Today's batch picks the newest date
const extra = words.concat([{ word: 'ZEST', level: 'lower', choices: ['a','b','c','d'], answer: 'a', definition: 'x', example: 'y', addedDate: '2099-01-01' }]);
assert.strictEqual(SRS.todaysWords(extra, '2099-06-01').length, 1);
// (bank-relative since the TRTL-11 Muse bank: 2026-10-18 now has 18 cards)
const n1018 = words.filter(w => w.addedDate === '2026-10-18').length;
assert.strictEqual(SRS.todaysWords(extra, '2026-10-18').length, n1018);
assert.strictEqual(SRS.todaysWords(words, '2026-10-18').length, n1018);

// Spaced repetition
const D = SRS.DAY; let t0 = Date.UTC(2026, 9, 18, 15); const p = {};
SRS.record(p, 'TIMID', false, t0);
assert.strictEqual(p.TIMID.box, 0); assert.strictEqual(p.TIMID.due, t0);
assert.deepStrictEqual(SRS.reviewWords(words, p, t0).map(w => w.word), ['TIMID'], 'missed word is in review');
SRS.record(p, 'VAST', true, t0);
assert(!SRS.reviewWords(words, p, t0).some(w => w.word === 'VAST'), 'right word not due today');
assert(SRS.reviewWords(words, p, t0 + D).some(w => w.word === 'VAST'), 'right word due tomorrow');
SRS.record(p, 'VAST', true, t0 + D); SRS.record(p, 'VAST', true, t0 + 3 * D);
assert(SRS.isMastered(p.VAST), 'mastered after 3 in a row');
assert.strictEqual(p.VAST.due - (t0 + 3 * D), 4 * D, 'mastered words wait longer');
SRS.record(p, 'VAST', false, t0 + 8 * D);
assert(!SRS.isMastered(p.VAST) && p.VAST.box === 0, 'miss resets mastery');
assert.strictEqual(p.VAST.seen, 4); assert.strictEqual(p.VAST.correct, 3); assert.strictEqual(p.VAST.lastSeen, t0 + 8 * D);

// Stats
const st = SRS.stats(words, p);
assert.strictEqual(st.answered, 5); assert.strictEqual(st.correct, 3); assert.strictEqual(st.tough[0].word, 'TIMID');

// Session: a miss is re-queued once, first-try score only
const s = new SRS.Session(words.slice(0, 5));
const first = s.current(); s.answer(false);
assert.strictEqual(s.queue[3].word, first.word, 'missed card comes back 3 cards later');
while (!s.finished()) s.answer(true);
assert.strictEqual(s.done, 5); assert.strictEqual(s.right, 4);

// localStorage round trip
const mem = { d: {}, getItem(k) { return this.d[k] ?? null; }, setItem(k, v) { this.d[k] = v; }, removeItem(k) { delete this.d[k]; } };
SRS.save(mem, p); assert.deepStrictEqual(SRS.load(mem), p);
assert.strictEqual(SRS.reset, undefined, 'TRTL-14: no reset (progress can never be wiped to repeat a set)');
console.log('All SRS tests passed');

// Legacy dynamic sentence-quiz helpers (no longer used by the app since TRTL-15). The day helpers still work with an explicit weekday list (MWF below).
const SQ = require('./sentencequiz.js');
const MWF = [1, 3, 5];
assert.deepStrictEqual(SQ.QUIZ_DAYS, [0, 1, 2, 3, 4, 5, 6], 'every day');
assert.strictEqual(SQ.quizIdFor(new Date('2026-10-29T18:00:00Z')), '2026-10-29', 'default quiz id is today (ET)');
assert.strictEqual(SQ.quizIdFor(new Date('2026-11-02T04:30:00Z')), '2026-11-01', 'ET date, not UTC');
const thu = new Date('2026-10-29T18:00:00Z');
assert.strictEqual(SQ.quizIdFor(thu, MWF), '2026-10-28', 'Thursday belongs to Wednesday\'s quiz');
assert.strictEqual(SQ.weekIdFor(thu, MWF), '2026-10-28', 'old name still works');
assert.strictEqual(SQ.quizIdFor(new Date('2026-10-26T16:00:00Z'), MWF), '2026-10-26', 'Monday opens its own quiz');
assert.strictEqual(SQ.quizIdFor(new Date('2026-10-27T16:00:00Z'), MWF), '2026-10-26', 'Tuesday is still Monday\'s quiz');
assert.strictEqual(SQ.quizIdFor(new Date('2026-10-31T16:00:00Z'), MWF), '2026-10-30', 'Saturday is Friday\'s quiz');
assert.strictEqual(SQ.quizIdFor(new Date('2026-11-01T16:00:00Z'), MWF), '2026-10-30', 'Sunday is Friday\'s quiz');
assert.strictEqual(SQ.quizIdFor(new Date('2026-10-28T03:30:00Z'), MWF), '2026-10-26', 'still Tuesday evening in ET');
assert.strictEqual(SQ.quizIdFor(new Date('2026-10-28T04:30:00Z'), MWF), '2026-10-28', 'Wednesday has started in ET');
assert.strictEqual(SQ.quizIdFor(new Date('2026-11-02T05:30:00Z'), MWF), '2026-11-02', 'Monday after the DST change (EST)');
assert.strictEqual(SQ.quizIdFor(new Date('2026-11-02T04:30:00Z'), MWF), '2026-10-30', 'still Sunday 11:30 PM EST');
assert.strictEqual(SQ.quizIdFor(thu, 4), '2026-10-29', 'quiz days can be moved');
assert.strictEqual(SQ.prevQuizId('2026-10-28', MWF), '2026-10-26');
assert.strictEqual(SQ.prevQuizId('2026-10-30', MWF), '2026-10-28');
assert.strictEqual(SQ.prevQuizId('2026-11-02', MWF), '2026-10-30', 'Monday looks back to Friday');
assert.deepStrictEqual(SQ.nextQuizDay(new Date('2026-10-26T16:00:00Z'), MWF), { ymd: '2026-10-28', name: 'Wednesday' });
assert.deepStrictEqual(SQ.nextQuizDay(thu, MWF), { ymd: '2026-10-30', name: 'Friday' });
assert.deepStrictEqual(SQ.nextQuizDay(new Date('2026-10-30T16:00:00Z'), MWF), { ymd: '2026-11-02', name: 'Monday' });
assert.deepStrictEqual(SQ.nextQuizDay(new Date('2026-10-31T16:00:00Z'), MWF), { ymd: '2026-11-02', name: 'Monday' });
// TRTL-14 reverses TRTL-13: there is no "repeatable" quiz any more.
const mon = new Date('2026-10-26T16:00:00Z'), tue = new Date('2026-10-27T16:00:00Z'), wed = new Date('2026-10-28T16:00:00Z');
assert.strictEqual(SQ.isAvailable, undefined, 'no always-open repeatable quiz');
assert.strictEqual(SQ.reset, undefined, 'no quiz reset');
assert.strictEqual(SQ.answersMatch('  TiMiD  ', 'TIMID'), true);
assert.strictEqual(SQ.answersMatch('timid', 'TIMID'), true);
assert.strictEqual(SQ.answersMatch('tim id', 'TIMID'), false);
assert.strictEqual(SQ.answersMatch('', 'TIMID'), false);
assert.strictEqual(SQ.fillBlank('_____ the rope tightly.', 'GRASP'), 'Grasp the rope tightly.');
assert.strictEqual(SQ.fillBlank('An _____ whale swam by.', 'IMMENSE'), 'An immense whale swam by.');
const noSentence = { word: 'ZEST', definition: '(verb) to politely say no to' };
assert.strictEqual(SQ.clueFor(noSentence).fallback, true);
assert.ok(SQ.clueFor(noSentence).text.indexOf('to politely say no to') >= 0);
assert.strictEqual(SQ.clueFor(noSentence).text.indexOf('(verb)'), -1);
assert.strictEqual(SQ.clueFor(words[0]).fallback, false);

function at(ymd, hourUtc) {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, m - 1, d, hourUtc == null ? 16 : hourUtc);
}
const attempts = [];
function push(word, ok, ms, attempt, ymd) {
  attempts.push({ word, ok, ms, attempt, ts: at(ymd), kind: 'card' });
}
// Thursday Oct 29 -> Wednesday's quiz; window is Mon Oct 26 through Thu Oct 29. Worst should be TIMID.
push('TIMID', false, 5000, 1, '2026-10-26');
push('TIMID', false, 5000, 2, '2026-10-26');
push('TIMID', false, SQ.SLOW_MS + 1000, 1, '2026-10-27');
push('VAST', false, 3000, 1, '2026-10-27');
push('VAST', false, 3000, 1, '2026-10-28');
push('CANDID', false, 2000, 1, '2026-10-27');
push('CANDID', true, 2000, 2, '2026-10-27');
push('FRAGILE', false, 9000, 1, '2026-10-28');
push('PERIL', true, SQ.SLOW_MS + 500, 1, '2026-10-29');
push('ANCIENT', true, SQ.SLOW_MS, 1, '2026-10-26');
push('CAUTIOUS', true, 1500, 1, '2026-10-28'); // fast and right: filler only
push('DRENCHED', true, 4000, 1, '2026-10-29');
push('TIMID', false, 1000, 1, '2026-10-24'); // before the previous quiz day: ignored
push('HASTY', false, 1000, 1, '2026-10-25'); // Sunday, before Monday: ignored
const curSet = words.slice(40, 60), prevSet = words.slice(20, 40);
const built = SQ.buildQuiz(words, attempts, thu, {}, null, curSet.concat(prevSet));
assert.ok(built.items.length >= SQ.MIN_ITEMS && built.items.length <= SQ.MAX_ITEMS, '10 to 15 items');
assert.deepStrictEqual(built.items.slice(0, 8).map(w => w.word), ['TIMID', 'VAST', 'CANDID', 'FRAGILE', 'PERIL', 'ANCIENT', 'DRENCHED', 'CAUTIOUS']);
assert(!built.items.some(w => w.word === 'HASTY'), 'outside the window');
assert.strictEqual(built.items.length, SQ.MIN_ITEMS, 'eight practiced words topped up to 10 with recent words');
assert.deepStrictEqual(built.items.slice(8).map(w => w.word), curSet.map(w => w.word).filter(w => !built.items.slice(0, 8).some(b => b.word === w)).slice(0, 2));
assert.strictEqual(built.quizId, '2026-10-29', 'quiz id is today');
assert.strictEqual(built.weekId, '2026-10-29');
assert.strictEqual(built.windowStart, '2026-10-26', 'window: today and the 3 days before');
assert.strictEqual(built.windowEnd, '2026-10-29');
// Monday's quiz looks back to Friday.
const monQuiz = SQ.buildQuiz(words, [{ word: 'HASTY', ok: false, ms: 1000, attempt: 1, ts: at('2026-10-31'), kind: 'card' }], new Date('2026-11-02T17:00:00Z'), {});
assert.strictEqual(monQuiz.quizId, '2026-11-02'); assert.strictEqual(monQuiz.windowStart, '2026-10-30');
assert.strictEqual(monQuiz.items[0].word, 'HASTY');

// Short window: fewer than 10 tough words tops up with recent words (current set, then previous set), least-known first.
const recentP = {};
SRS.record(recentP, curSet[5].word, true, at('2026-10-01')); SRS.record(recentP, curSet[5].word, true, at('2026-10-02')); // box 2: known
const shortQ = SQ.buildQuiz(words, [{ word: 'TIMID', ok: false, ms: 1000, attempt: 1, ts: at('2026-10-27'), kind: 'card' }], thu, recentP, null, curSet.concat(prevSet));
assert.strictEqual(shortQ.items.length, SQ.MIN_ITEMS);
assert.strictEqual(shortQ.items[0].word, 'TIMID');
const curNames = curSet.map(w => w.word).filter(w => w !== 'TIMID' && w !== curSet[5].word);
assert.deepStrictEqual(shortQ.items.slice(1).map(w => w.word), curNames.slice(0, 9), 'current set first, in order, known word last');
assert.strictEqual(new Set(shortQ.items.map(w => w.word)).size, shortQ.items.length, 'no duplicates');
// When the current set is short, the previous set fills in.
const tinyQ = SQ.buildQuiz(words, [], thu, {}, null, curSet.slice(0, 3).concat(prevSet));
assert.deepStrictEqual(tinyQ.items.map(w => w.word), curSet.slice(0, 3).concat(prevSet.slice(0, 7)).map(w => w.word));
// Without recent words it still tops up from words added in the window (none here) and stays tough-first.
assert.strictEqual(SQ.buildQuiz(words, [], thu, {}).items.length, words.filter(w => w.addedDate >= '2026-10-26' && w.addedDate <= '2026-10-29').slice(0, 10).length);

// Fewer than 10 tough words: other practiced words in the window come before recent words.
const few = [
  { word: 'TIMID', ok: false, ms: 1000, attempt: 1, ts: at('2026-10-27'), kind: 'card' },
  { word: 'VAST', ok: true, ms: 8000, attempt: 1, ts: at('2026-10-27'), kind: 'card' }
];
const topped = SQ.buildQuiz(words, few, thu, {}, null, curSet);
assert.strictEqual(topped.items[0].word, 'TIMID');
assert.strictEqual(topped.items[1].word, 'VAST');
assert.strictEqual(topped.items.length, SQ.MIN_ITEMS);
assert.deepStrictEqual(topped.items.slice(2).map(w => w.word), curSet.map(w => w.word).filter(w => w !== 'TIMID' && w !== 'VAST').slice(0, 8));

// 16 tough words cap at 15, ranked worst first, with no easy fillers mixed in.
const many = [];
const pool = words.slice(0, 16);
pool.forEach((w, i) => {
  for (let n = 0; n < (16 - i); n++) many.push({ word: w.word, ok: false, ms: 1000, attempt: 1, ts: at('2026-10-27'), kind: 'card' });
});
many.push({ word: 'EXASPERATE', ok: true, ms: 500, attempt: 1, ts: at('2026-10-27'), kind: 'card' });
const capped = SQ.buildQuiz(words, many, thu, {});
assert.strictEqual(capped.items.length, SQ.MAX_ITEMS);
assert.deepStrictEqual(capped.items.map(w => w.word), pool.slice(0, 15).map(w => w.word));

// Legacy progress (no attempt log yet): a miss whose lastSeen is in the window still counts.
const legacy = {};
SRS.record(legacy, 'RELUCTANT', false, at('2026-10-27'));
SRS.record(legacy, 'BRISK', true, at('2026-10-27'));
SRS.record(legacy, 'HASTY', false, at('2026-10-22')); // before Monday: outside the window
const fromProgress = SQ.buildQuiz(words, [], thu, legacy);
assert.deepStrictEqual(fromProgress.items.slice(0, 2).map(w => w.word), ['RELUCTANT', 'BRISK']);

// A sentence-quiz miss feeds the flashcard review pile. A correct one does not.
const qp = {};
assert.strictEqual(SQ.noteQuizResult(qp, 'TIMID', false, SRS.record), true);
assert.strictEqual(qp.TIMID.box, 0);
assert.ok(SRS.reviewWords(words, qp, at('2026-10-29')).some(w => w.word === 'TIMID'));
SQ.noteQuizResult(qp, 'VAST', true, SRS.record);
assert.strictEqual(qp.VAST, undefined, 'a correct sentence does not change flashcard progress');

const store2 = { d: {}, getItem(k) { return this.d[k] ?? null; }, setItem(k, v) { this.d[k] = v; }, removeItem(k) { delete this.d[k]; } };
SQ.logAttempt(store2, { word: 'TIMID', ok: false, ms: 1000, attempt: 1, ts: Date.now() - 2 * 86400000, kind: 'card' }); // was a fixed 2026-10-21 date, which aged out
SQ.logAttempt(store2, { word: 'OLD', ok: false, ms: 1000, attempt: 1, ts: Date.now() - 40 * 86400000, kind: 'card' }, Date.now());
assert.deepStrictEqual(SQ.loadAttempts(store2).map(a => a.word), ['TIMID'], 'attempts older than 3 weeks are dropped');
SQ.markCompleted(store2, '2026-10-29', { score: '1/1', missed: 'TIMID' });
assert.strictEqual(SQ.pending(store2).missed, 'TIMID');
// A repeat quiz finished while the first score is still unsent queues behind it (nothing is overwritten).
SQ.markCompleted(store2, '2026-10-29', { score: '2/2', missed: 'none' });
assert.deepStrictEqual(SQ.pendingAll(store2).map(p => p.score), ['1/1', '2/2']);
SQ.clearPending(store2, { score: '2/2', missed: 'none' });
assert.deepStrictEqual(SQ.pendingAll(store2).map(p => p.score), ['1/1']);
SQ.clearPending(store2);
assert.strictEqual(SQ.pending(store2), null);
assert.strictEqual(SQ.loadState(store2).completedQuizId, '2026-10-29');
// Old saved state (single pending, no queue) still loads.
store2.setItem(SQ.STATE_KEY, JSON.stringify({ completedQuizId: '2026-10-28', pending: { score: '3/3' } }));
assert.deepStrictEqual(SQ.pendingAll(store2).map(p => p.score), ['3/3']);
SQ.clearPending(store2);
const legacyStore = { d: { [SQ.STATE_KEY]: JSON.stringify({ completedWeekId: '2026-10-25', pending: null }) }, getItem(k) { return this.d[k] ?? null; }, setItem(k, v) { this.d[k] = v; } };
assert.strictEqual(SQ.loadState(legacyStore).completedQuizId, '2026-10-25', 'old weekly state still reads');
console.log('Sentence quiz tests passed');

// Coda Stars quiz_completed POST: payload shape, text/plain, fire-and-forget (no real network: fetch is mocked).
(async () => {
  const ev = SQ.quizEvent('luke', '2026-10-28', 9, 12, '2026-10-29');
  assert.deepStrictEqual(ev, { kid: 'luke', event: 'quiz_completed', quiz_id: '2026-10-28', correct: 9, total: 12, date_et: '2026-10-29' });
  const calls = [];
  assert.strictEqual(await SQ.postQuizEvent((u, o) => { calls.push([u, o]); return Promise.resolve({ ok: true }); }, ev), true);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0][0], 'https://coda-kids-app.vercel.app/api/vocab/event');
  assert.strictEqual(calls[0][1].method, 'POST');
  assert.strictEqual(calls[0][1].headers['Content-Type'].split(';')[0], 'text/plain');
  assert.deepStrictEqual(JSON.parse(calls[0][1].body), ev);
  assert.strictEqual(await SQ.postQuizEvent(() => Promise.resolve({ ok: false, status: 400 }), ev), false, '400 until the server deploys is fine');
  assert.strictEqual(await SQ.postQuizEvent(() => Promise.reject(new TypeError('Failed to fetch')), ev), false, 'network error swallowed');
  assert.strictEqual(await SQ.postQuizEvent(() => { throw new Error('boom'); }, ev), false, 'sync throw swallowed');
  assert.strictEqual(await SQ.postQuizEvent(null, ev), false, 'no fetch');
  // The app fires it after markCompleted, guarded, without awaiting it (never blocks the score screen).
  const appSrc = fs.readFileSync(__dirname + '/app.js', 'utf8');
  assert(/SQ\.postQuizEvent\([^;]*SQ\.quizEvent\(KID, sq\.quizId, r, total, payload\.date_et\)\)\.catch\(/.test(appSrc), 'app posts quiz_completed fire-and-forget');
  assert(!/await\s+SQ\.postQuizEvent/.test(appSrc));
  assert(appSrc.indexOf('SQ.markCompleted(localStorage, sq.quizId') < appSrc.indexOf('SQ.postQuizEvent('), 'local state saved first');
  assert(appSrc.indexOf('wlog.quiz(payload)') > appSrc.indexOf('SQ.postQuizEvent('), 'FormSubmit quiz log still sent');
  console.log('Quiz Coda Stars event tests passed');
})().catch(e => { console.error(e); process.exit(1); });

// Daily words log (wordlog.js): cumulative per-day record, de-duplicated sends
(async () => {
  const WL = require('./wordlog.js');
  const store = { d: {}, getItem(k) { return this.d[k] ?? null; }, setItem(k, v) { this.d[k] = v; } };
  const sent = [];
  const fakeFetch = (u, o) => { sent.push(JSON.parse(o.body)); return Promise.resolve({ json: () => ({ success: 'true' }) }); };
  const set = SRS.todaysWords(words, '2099-01-01'), keyFn = SRS.key || (w => w.word);
  const log = WL.create({ kid: 'Test', storage: store, keyFn, setFn: () => set, fetch: fakeFetch, now: () => new Date('2026-10-26T02:30:00Z') });
  assert.strictEqual(log.etDate(), '2026-10-25', 'ET date, not UTC');
  await log.flush(); assert.strictEqual(sent.length, 0, 'nothing sent before the set is opened');
  log.openedSet(); await new Promise(r => setTimeout(r, 0));
  assert.strictEqual(sent.length, 1); assert.strictEqual(sent[0].opened_set, 'yes'); assert.strictEqual(sent[0].answered, 0);
  log.openedSet(); await log.flush(); assert.strictEqual(sent.length, 1, 'no duplicate when nothing changed');
  set.forEach((w, i) => { log.answered(keyFn(w), i % 4 !== 0); log.answered(keyFn(w), true); });
  await new Promise(r => setTimeout(r, 0)); await log.flush();
  assert.strictEqual(sent.length, 2, 'one send on completing the set');
  const last = sent[1];
  assert.strictEqual(last.answered, set.length); assert.strictEqual(last.right, set.length - Math.ceil(set.length / 4));
  assert.strictEqual(last.completed_all, 'yes'); assert.strictEqual(last.source, 'auto'); assert.strictEqual(last.kid, 'Test');
  log.answered('NOT-IN-SET', true); assert(!('NOT-IN-SET' in log.state().firstTry), 'older words are not counted');
  await log.button(); assert.strictEqual(sent[2].source, 'button'); assert(log.buttonDone());
  const before = JSON.stringify(store.d);
  const quizRec = await log.quiz({ date_et: '2026-10-29', time_et: '3:00 PM ET', week: '2026-10-25', score: '9/12', correct: 9, total: 12, missed: 'VAST, TIMID', missed_count: 2 });
  assert.strictEqual(quizRec._subject, 'WORDS LOG Test 2026-10-29 quiz');
  assert.strictEqual(quizRec.source, 'quiz');
  assert.strictEqual(quizRec.score, '9/12');
  assert.strictEqual(quizRec.correct, '9');
  assert.strictEqual(quizRec.total, '12');
  assert.strictEqual(quizRec.missed, 'VAST, TIMID');
  assert.strictEqual(quizRec.missed_count, '2');
  assert.strictEqual(quizRec.week, '2026-10-25');
  assert.strictEqual(quizRec.kid, 'Test');
  assert.strictEqual(sent[3]._subject, quizRec._subject);
  assert.strictEqual(JSON.stringify(store.d), before, 'quiz email does not change the daily log');
  assert.strictEqual(log.buttonDone(), true);
  const failing = WL.create({ kid: 'Test', storage: store, keyFn, setFn: () => set, fetch: () => Promise.resolve({ json: () => ({ success: 'false', message: 'nope' }) }), now: () => new Date('2026-10-26T02:30:00Z') });
  await assert.rejects(() => failing.quiz({ score: '0/1', correct: 0, total: 1, missed: 'TIMID', missed_count: 1, week: '2026-10-25', date_et: '2026-10-25' }), /nope/);
  console.log('Words log tests passed');
})().catch(e => { console.error(e); process.exit(1); });

// ---- Word sets: schema, set advance, bank exhausted, Coda Stars hook ----
(async () => {
  for (const w of ALLWORDS) assert(typeof w.set === 'string' && w.set && Number.isInteger(w.order) && w.order > 0, 'set/order ' + w.word); // full bank
  // Behaviour tests run on the bank minus any dated top-up set placed AFTER the L-sets (e.g. the 1-card 2026-11-23 WITTY set,
  // order 46), so "newest dated batch -> first bank set" keeps the shape these tests expect.
  const words = SETWORDS;
  const KF = SRS.key || (w => w.word);
  const PFX = SRS.STORE_KEY.indexOf('luke') === 0 ? 'L' : 'V';
  const orderOf = {};
  for (const w of words) {
    assert(typeof w.set === 'string' && w.set, 'set id ' + w.word);
    assert(Number.isInteger(w.order) && w.order > 0, 'order ' + w.word);
    if (/^\d{4}-\d{2}-\d{2}$/.test(w.set)) assert.strictEqual(w.set, w.addedDate, 'old cards: set = addedDate ' + w.word);
    if (w.set in orderOf) assert.strictEqual(orderOf[w.set], w.order, 'one order per set ' + w.set); else orderOf[w.set] = w.order;
  }
  const list = SRS.setList(words);
  assert.deepStrictEqual(list.map(s => s.order), list.map((s, i) => i + 1), 'orders run 1..N');
  const bank = list.filter(s => /^[LV]-\d{3}$/.test(s.id));
  assert(bank.length >= 10, 'bank of upcoming sets');
  bank.forEach((s, i) => { assert.strictEqual(s.id, PFX + '-' + String(i + 1).padStart(3, '0')); assert(s.cards.length >= 19 && s.cards.length <= 20, '19-20 cards in ' + s.id + ' (Muse bank has three 19-card sets)'); });
  assert(list.indexOf(bank[0]) > list.findIndex(s => /^\d{4}/.test(s.id)), 'bank sets come after the dated sets');
  console.log('Sets OK:', list.length, 'sets,', bank.length, 'in the bank (' + bank[0].id + '..' + bank[bank.length - 1].id + ')');

  const mem = () => ({ d: {}, getItem(k) { return this.d[k] ?? null; }, setItem(k, v) { this.d[k] = v; }, removeItem(k) { delete this.d[k]; } });
  // Fresh device: current set = newest dated batch (what used to be "Today's set").
  let store = mem(), st = SRS.loadSets(store), pr = {};
  const dated = list.filter(s => /^\d{4}/.test(s.id)), newest = dated[dated.length - 1];
  let r = SRS.resolveCurrent(words, st, pr, KF);
  assert.strictEqual(r.set.id, newest.id); assert(!r.exhausted);
  assert(!SRS.unlockedWords(words, st, pr, KF).some(w => w.set === bank[0].id), 'bank sets locked until reached');
  // Wrong first try, right on the retry: still counts as answered right once.
  const c0 = newest.cards[0];
  SRS.record(pr, KF(c0), false); assert.strictEqual(SRS.markSetAnswer(words, st, pr, KF, c0, false), null);
  assert.strictEqual(SRS.markSetAnswer(words, st, pr, KF, c0, true), null);
  assert.strictEqual(SRS.setProgress(newest, st, pr, KF).right, 1);
  // Cards outside the current set don't count toward it.
  assert.strictEqual(SRS.markSetAnswer(words, st, pr, KF, bank[1].cards[0], true), null);
  let res = null;
  newest.cards.slice(1).forEach((w, i) => { SRS.record(pr, KF(w), true); const x = SRS.markSetAnswer(words, st, pr, KF, w, true); if (x) { assert(!res, 'completes once'); res = x; assert.strictEqual(i, newest.cards.length - 2, 'completes on the last card'); } });
  assert(res && res.completed); assert.strictEqual(res.from, newest.id); assert.strictEqual(res.to, bank[0].id); assert(!res.exhausted);
  assert.strictEqual(res.right, newest.cards.length); assert.strictEqual(st.notice, 'unlocked');
  SRS.saveSets(store, st); st = SRS.loadSets(store);
  r = SRS.resolveCurrent(words, st, pr, KF);
  assert.strictEqual(r.set.id, bank[0].id, 'advanced to ' + bank[0].id + ' and stored in localStorage');
  assert(SRS.unlockedWords(words, st, pr, KF).some(w => w.set === bank[0].id));
  assert(!SRS.unlockedWords(words, st, pr, KF).some(w => w.set === bank[1].id));
  // Review of older words keeps working: the missed card is still due.
  assert(SRS.reviewWords(SRS.unlockedWords(words, st, pr, KF), pr).some(w => KF(w) === KF(c0)), 'missed word still in review');
  // The daily log keeps reporting the set worked today.
  const st2 = SRS.loadSets(mem()); const pr2 = {};
  assert.strictEqual(SRS.daySet(words, st2, pr2, KF, '2026-11-01')[0].set, newest.id);
  newest.cards.forEach(w => SRS.markSetAnswer(words, st2, pr2, KF, w, true));
  assert.strictEqual(SRS.resolveCurrent(words, st2, pr2, KF).set.id, bank[0].id);
  assert.strictEqual(SRS.daySet(words, st2, pr2, KF, '2026-11-01')[0].set, newest.id, 'same day: still the finished set');
  assert.strictEqual(SRS.daySet(words, st2, pr2, KF, '2026-11-02')[0].set, bank[0].id, 'next day: the new set');
  // Finish every bank set: the last one reports "coming soon" and the app stays on it.
  for (let i = 0; i < bank.length; i++) {
    assert.strictEqual(SRS.resolveCurrent(words, st, pr, KF).set.id, bank[i].id);
    let done = null; bank[i].cards.forEach(w => { const x = SRS.markSetAnswer(words, st, pr, KF, w, true); if (x) done = x; });
    assert(done, 'completed ' + bank[i].id);
    assert.strictEqual(done.to, i + 1 < bank.length ? bank[i + 1].id : null);
    assert.strictEqual(done.exhausted, i + 1 === bank.length);
  }
  assert.strictEqual(st.notice, 'soon');
  r = SRS.resolveCurrent(words, st, pr, KF);
  assert.strictEqual(r.set.id, bank[bank.length - 1].id, 'bank exhausted: stays on the last set'); assert(r.exhausted);
  assert.strictEqual(SRS.markSetAnswer(words, st, pr, KF, bank[bank.length - 1].cards[0], true), null, 'no second completion');
  // A later top-up moves on automatically.
  const extraSet = bank[0].cards.map(w => Object.assign({}, w, { word: 'TOPUP' + w.word, set: PFX + '-999', order: list.length + 1 }));
  r = SRS.resolveCurrent(words.concat(extraSet), st, pr, KF);
  assert.strictEqual(r.set.id, PFX + '-999'); assert(!r.exhausted);
  console.log('Set advance + bank-exhausted tests passed');

  // Coda Stars hook: fire-and-forget, never throws or rejects.
  const calls = [];
  const ok = await SRS.postStarsEvent((u, o) => { calls.push([u, o]); return Promise.resolve({ ok: true }); },
    { kid: 'test', event: 'completed', set: 'X', next_set: 'Y', answered: 20, right: 20, date_et: '2026-10-31' });
  assert.strictEqual(ok, true); assert.strictEqual(calls[0][0], 'https://coda-kids-app.vercel.app/api/vocab/event');
  assert.strictEqual(calls[0][1].method, 'POST'); assert.strictEqual(JSON.parse(calls[0][1].body).event, 'completed');
  assert.strictEqual(await SRS.postStarsEvent(() => Promise.resolve({ ok: false, status: 404 }), {}), false, '404 is fine');
  assert.strictEqual(await SRS.postStarsEvent(() => Promise.reject(new TypeError('Failed to fetch')), {}), false, 'network error swallowed');
  assert.strictEqual(await SRS.postStarsEvent(() => { throw new Error('boom'); }, {}), false, 'sync throw swallowed');
  assert.strictEqual(await SRS.postStarsEvent(null, {}), false, 'no fetch');
  // The daily words log now reports the set id.
  const WL = require('./wordlog.js'); const sent = []; const s3 = mem();
  const lg = WL.create({ kid: 'T', storage: s3, keyFn: KF, setFn: () => bank[0].cards, fetch: (u, o) => { sent.push(JSON.parse(o.body)); return Promise.resolve({ json: () => ({ success: 'true' }) }); } });
  lg.openedSet(); await new Promise(r => setTimeout(r, 0)); assert.strictEqual(sent[0].set, bank[0].id);
  // Service worker never handles POSTs or cross-origin requests.
  const sw = fs.readFileSync(__dirname + '/sw.js', 'utf8');
  assert(/if \(req\.method !== 'GET'\) return;/.test(sw) && /if \(url\.origin !== self\.location\.origin\) return;/.test(sw), 'sw ignores POST / cross-origin');
  const ver = sw.match(/var VERSION = '([^']+)'/)[1], html = fs.readFileSync(__dirname + '/index.html', 'utf8');
  assert(html.includes('sw.js?v=' + ver) && html.includes('manifest.json?v=' + ver), 'index.html ?v= matches sw VERSION');
  console.log('Coda Stars hook tests passed');
})().catch(e => { console.error(e); process.exit(1); });

// Looking up the day's set (words log) must not swallow a completion; an old set already right from earlier sessions completes on next look.
(() => {
  const words = SETWORDS;
  const KF = SRS.key || (w => w.word);
  const mem = () => ({ d: {}, getItem(k) { return this.d[k] ?? null; }, setItem(k, v) { this.d[k] = v; } });
  const list = SRS.setList(words), dated = list.filter(s => /^\d{4}/.test(s.id)), newest = dated[dated.length - 1];
  const st = SRS.loadSets(mem()), pr = {};
  newest.cards.forEach(w => SRS.record(pr, KF(w), true));            // all right, like the app's first-try record
  SRS.daySet(words, st, pr, KF, '2026-10-31'); SRS.resolveCurrent(words, st, pr, KF);
  assert.strictEqual(st.current, newest.id, 'no silent advance');
  const res = SRS.completeIfDone(words, st, pr, KF);
  assert(res && res.from === newest.id && res.to === list[list.indexOf(newest) + 1].id, 'completion reported once');
  assert.strictEqual(SRS.completeIfDone(words, st, pr, KF), null);
  console.log('Completion-reporting tests passed');
})();

// ---- TRTL-14: no repeats. A completed word set is never served again. ----
(() => {
  const words = SETWORDS;
  const KF = w => w.word;
  const mem = () => ({ d: {}, getItem(k) { return this.d[k] ?? null; }, setItem(k, v) { this.d[k] = v; } });
  const list = SRS.setList(words), bank = list.filter(s => /^L-\d{3}$/.test(s.id));
  const store = mem(); let st = SRS.loadSets(store); const pr = {};
  st.current = bank[0].id;
  let sv = SRS.servableCards(words, st, pr, KF);
  assert.strictEqual(sv.set.id, bank[0].id); assert.strictEqual(sv.cards.length, bank[0].cards.length); assert(!sv.exhausted);
  // Finish L-001 (each card right once, like the app: record + markSetAnswer).
  let done = null;
  bank[0].cards.forEach(w => { SRS.record(pr, KF(w), true); const x = SRS.markSetAnswer(words, st, pr, KF, w, true); if (x) done = x; });
  assert(done && done.from === bank[0].id && done.to === bank[1].id, 'finishing a set moves to the next set');
  SRS.saveSets(store, st); st = SRS.loadSets(store);
  sv = SRS.servableCards(words, st, pr, KF);
  assert.strictEqual(sv.set.id, bank[1].id, 'next set is served');
  assert(!sv.cards.some(w => w.set === bank[0].id), 'no card from the completed set is served');
  // Pointing the stored current set back at a completed set cannot bring it back.
  st.current = bank[0].id;
  sv = SRS.servableCards(words, st, pr, KF);
  assert.notStrictEqual(sv.set.id, bank[0].id, 'completed set is skipped even if stored as current');
  assert(!sv.cards.some(w => w.set === bank[0].id));
  // Cards from a completed set never come back, even after a miss drops them out of mastery.
  SRS.record(pr, KF(bank[0].cards[0]), false);
  assert(!SRS.servableCards(words, st, pr, KF).cards.some(w => w.set === bank[0].id), 'a later miss does not re-open a completed set');
  // Every set finished: nothing is served (no "stay on the last set and repeat it").
  list.forEach(s => { if (st.completed.indexOf(s.id) < 0) st.completed.push(s.id); });
  sv = SRS.servableCards(words, st, pr, KF);
  assert.strictEqual(sv.cards.length, 0, 'bank exhausted: nothing to serve'); assert(sv.exhausted);
  // A set that was finished in earlier sessions (all right once) but never reported completes and is skipped.
  const st3 = SRS.loadSets(mem()), pr3 = {}; st3.current = bank[2].id;
  bank[2].cards.forEach(w => SRS.record(pr3, KF(w), true));
  sv = SRS.servableCards(words, st3, pr3, KF);
  assert(sv.completed && sv.completed.from === bank[2].id, 'reported once'); assert.strictEqual(sv.set.id, bank[3].id);
  // App wiring: Mix and Reset are gone; the current-set quiz is the only flashcard quiz and uses servableCards.
  const app = fs.readFileSync(__dirname + '/app.js', 'utf8'), html = fs.readFileSync(__dirname + '/index.html', 'utf8');
  assert(!/btnAll|btnReset|start\('all'\)|start\('review'\)|SRS\.reset|SQ\.reset/.test(app), 'no Mix / Reset / review quiz in app.js');
  assert(!/btnAll|btnReset|Mix of all|Reset my progress/.test(html), 'no Mix / Reset in index.html');
  assert(/if \(mode !== 'today'\) return;/.test(app) && /SRS\.servableCards\(/.test(app), 'start() serves only the current, uncompleted set');
  assert(/if \(setJustDone\) return finish\(\);/.test(app), 'a session ends as soon as it completes the set');
  console.log('TRTL-14 no-repeat tests passed');
})();

// ---- TRTL-16: missed words are a read-only study list (no questions, no answering, no scoring). ----
(() => {
  const app = fs.readFileSync(__dirname + '/app.js', 'utf8'), html = fs.readFileSync(__dirname + '/index.html', 'utf8');
  const fn = app.slice(app.indexOf('function renderMissed()'), app.indexOf('function renderCard()'));
  assert(fn.length > 0 && /SRS\.reviewWords\(visible\(\), progress\)/.test(fn), 'lists the same words as reviewWords (unlocked sets)');
  assert(/w\.definition/.test(fn), 'shows the definition');
  assert(!/record|Session|choose|onclick|choices|answer|score|wlog|start\(/.test(fn), 'no questions, answering or scoring in the list');
  const sec = html.slice(html.indexOf('<section id="missed"'), html.indexOf('</section>', html.indexOf('<section id="missed"')));
  assert(sec && !/choice|input|score|progress/i.test(sec), 'missed section has no quiz UI');
  assert(/\$\('btnReview'\)\.onclick = renderMissed;/.test(app) && /\$\('btnDoneReview'\)\.onclick = renderMissed;/.test(app) &&
    /\$\('sqDoneReview'\)\.onclick = renderMissed;/.test(app), 'every "missed words" button opens the read-only list');
  // Same words as before: a miss shows up, a mastered word does not.
  const pr = {}; SRS.record(pr, 'TIMID', false);
  SRS.record(pr, 'VAST', true); SRS.record(pr, 'VAST', true);
  const r = SRS.reviewWords(words, pr).map(w => w.word);
  assert(r.includes('TIMID') && !r.includes('VAST'));
  console.log('TRTL-16 read-only missed list tests passed');
})();

// ---- TRTL-15: fixed Muse-supplied sentence sets: loading, one attempt per item, lock forever, results payload. ----
(async () => {
  const SQ = require('./sentencequiz.js');
  const idx = JSON.parse(fs.readFileSync(__dirname + '/sentence_sets/index.json', 'utf8'));
  const entries = SQ.indexEntries(idx);
  assert(entries.length >= 1 && entries[0].id === 'APP-SENT-2026-11-23');
  const ids = new Set();
  for (const e of entries) {
    assert(!ids.has(e.id), 'unique set id ' + e.id); ids.add(e.id);
    const data = JSON.parse(fs.readFileSync(__dirname + '/sentence_sets/' + e.file, 'utf8'));
    const set = SQ.validateFixedSet(data, e.id);
    set.items.forEach(it => assert(SQ.hasBlank(it.sentence) && it.choices.length === 4 && it.choices.includes(it.answer), e.id + ' ' + it.word));
  }
  const raw = fs.readFileSync(__dirname + '/sentence_sets/app_sentence_set_2026-11-23.json');
  try { assert(raw.equals(fs.readFileSync('/workspace/shared/trtl-15/app_sentence_set_2026-11-23.json')), 'byte-for-byte copy of the Muse file'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const set = SQ.validateFixedSet(JSON.parse(raw), 'APP-SENT-2026-11-23');
  assert.strictEqual(set.items.length, 10);
  assert.throws(() => SQ.validateFixedSet({ set: 'X', items: [{ sentence: 'no blank', choices: ['a', 'b', 'c', 'd'], answer: 'a' }] }, 'X'));
  assert.throws(() => SQ.validateFixedSet({ set: 'X', items: [{ sentence: 'A _____ b', choices: ['a', 'b', 'c', 'd'], answer: 'z' }] }, 'X'));
  assert.throws(() => SQ.validateFixedSet(JSON.parse(raw), 'SOME-OTHER-ID'), /mismatch/);
  // Every item's word maps onto the bank (case-insensitive) so a miss can feed SRS.record.
  set.items.forEach(it => assert(SQ.bankWord(words, it.word), it.word + ' in words.json'));
  assert.strictEqual(SQ.bankWord(words, 'not-a-bank-word'), null);

  const mem = () => ({ d: {}, getItem(k) { return this.d[k] ?? null; }, setItem(k, v) { this.d[k] = v; } });
  const store = mem();
  const fakeIdx = { sets: [{ id: 'APP-SENT-2026-11-23', file: 'a.json' }, { id: 'APP-SENT-2026-11-24', file: 'b.json' }] };
  assert.strictEqual(SQ.nextFixedEntry(fakeIdx, SQ.loadFixed(store)).id, 'APP-SENT-2026-11-23', 'earliest uncompleted set first');
  // Inflected answer: enthrall -> "enthralled" is scored against the item's answer field.
  const iEn = set.items.findIndex(it => it.word === 'enthrall');
  assert.strictEqual(set.items[iEn].answer, 'enthralled');
  // One attempt per item; answers are saved as he goes, so leaving mid-set resumes (no re-asking).
  assert.strictEqual(SQ.answerFixed(store, set, 0, 'gentle').ok, false);
  assert.strictEqual(SQ.answerFixed(store, set, 0, 'formidable'), null, 'no second attempt on an answered item');
  assert.strictEqual(SQ.resumeIndex(SQ.loadFixed(store), set), 1, 'resumes at the first unanswered item');
  set.items.forEach((it, i) => { if (i > 0) SQ.answerFixed(store, set, i, i === iEn ? 'enthralled' : (i === 4 ? it.choices.find(c => c !== it.answer) : it.answer)); });
  assert.strictEqual(SQ.resumeIndex(SQ.loadFixed(store), set), 10);
  const sc = SQ.fixedScore(SQ.loadFixed(store), set);
  assert.strictEqual(sc.correct, 8); assert.strictEqual(sc.total, 10);
  assert.deepStrictEqual(sc.missed, ['formidable', set.items[4].word]);
  // Lock forever: first completion returns true (results sent once), then never again; never re-served.
  assert.strictEqual(SQ.completeFixed(store, set, { correct: 8, total: 10 }), true);
  assert.strictEqual(SQ.completeFixed(store, set, { correct: 10, total: 10 }), false, 'cannot be completed twice');
  assert(SQ.isFixedDone(SQ.loadFixed(store), set.id));
  assert.strictEqual(SQ.answerFixed(store, set, 0, 'formidable'), null, 'locked set takes no answers');
  assert.strictEqual(SQ.nextFixedEntry(fakeIdx, SQ.loadFixed(store)).id, 'APP-SENT-2026-11-24', 'completed set is never re-served');
  assert.strictEqual(SQ.nextFixedEntry({ sets: [fakeIdx.sets[0]] }, SQ.loadFixed(store)), null, 'none left -> "No new sentence set yet"');
  // Survives a reload (stored in localStorage).
  const reloaded = mem(); reloaded.d = JSON.parse(JSON.stringify(store.d));
  assert(SQ.isFixedDone(SQ.loadFixed(reloaded), 'APP-SENT-2026-11-23'));
  assert.strictEqual(SQ.loadFixed(reloaded).progress, null);

  // Results: same WORDS LOG quiz fields and Coda Stars quiz_completed event as the old quiz; quiz_id/week = set id.
  const ev = SQ.quizEvent('luke', set.id, 8, 10, '2026-11-23');
  assert.deepStrictEqual(Object.keys(ev), ['kid', 'event', 'quiz_id', 'correct', 'total', 'date_et']);
  assert.strictEqual(ev.event, 'quiz_completed'); assert.strictEqual(ev.quiz_id, 'APP-SENT-2026-11-23');
  const WL = require('./wordlog.js'); const sent = [];
  const lg = WL.create({ kid: 'Luke', storage: mem(), keyFn: w => w.word, setFn: () => [], fetch: (u, o) => { sent.push(JSON.parse(o.body)); return Promise.resolve({ json: () => ({ success: 'true' }) }); } });
  const rec = await lg.quiz({ date_et: '2026-11-23', time_et: '4:00 PM ET', week: set.id, score: '8/10', correct: 8, total: 10, missed: 'FORMIDABLE, UNRULY', missed_count: 2 });
  assert.strictEqual(rec._subject, 'WORDS LOG Luke 2026-11-23 quiz'); assert.strictEqual(rec.week, 'APP-SENT-2026-11-23');
  assert.deepStrictEqual(Object.keys(rec), ['_subject', '_template', '_captcha', 'kid', 'date_et', 'time_et', 'source', 'week', 'score', 'correct', 'total', 'missed', 'missed_count']);
  // Offline queue: an unsent score stays queued in STATE_KEY.
  const q = mem(); SQ.markCompleted(q, set.id, { week: set.id, score: '8/10' });
  assert.strictEqual(SQ.pendingAll(q).length, 1); SQ.clearPending(q, { week: set.id, score: '8/10' }); assert.strictEqual(SQ.pendingAll(q).length, 0);

  // App wiring.
  const app = fs.readFileSync(__dirname + '/app.js', 'utf8');
  assert(!/buildQuiz|buildSentenceQuiz|sqInput|sqBank/.test(app), 'the dynamic tough-word quiz is gone from the app');
  assert(/SQ\.completeFixed\(localStorage, sq\.set/.test(app), 'set locked on finish');
  assert(app.indexOf('SQ.completeFixed(localStorage') < app.indexOf('SQ.markCompleted(localStorage, sq.quizId'), 'lock before queueing results');
  assert(/week: sq\.quizId,\s*score: r \+ '\/' \+ total, correct: r, total: total,\s*missed: missedKeys\.join\(', '\) \|\| 'none', missed_count: missedKeys\.length/.test(app), 'same payload fields');
  assert(/SQ\.nextFixedEntry\(idx, SQ\.loadFixed\(localStorage\)\)/.test(app), 'serves the earliest uncompleted set');
  assert(/SQ\.answerFixed\(localStorage, sq\.set, sq\.index, choice\)/.test(app), 'one attempt per item via answerFixed');
  assert(/SQ\.noteQuizResult\(progress, bw\.word, ok, SRS\.record\)/.test(app) && /if \(bw && SQ\.noteQuizResult/.test(app), 'misses feed SRS.record only for bank words');
  // Service worker: sentence sets are network-first and the index is precached; version bumped.
  const sw = fs.readFileSync(__dirname + '/sw.js', 'utf8');
  assert(/path\.indexOf\('sentence_sets\/'\) === 0\) \{\s*e\.respondWith\(networkFirst\(req, path\)\)/.test(sw), 'sentence_sets network-first');
  assert(sw.includes("'sentence_sets/index.json'"), 'index precached');
  assert(sw.includes("var VERSION = '2026-11-23-trtl14-16'"));
  console.log('TRTL-15 fixed sentence-set tests passed');
})().catch(e => { console.error(e); process.exit(1); });
