// Headless checks: node test.js
const assert = require('assert');
const fs = require('fs');
const SRS = require('./srs.js');
const words = JSON.parse(fs.readFileSync(__dirname + '/words.json', 'utf8'));

// words.json schema
const seen = new Set();
for (const w of words) {
  assert(/^[A-Z][A-Z \-']*$/.test(w.word), 'stem must be capitalized: ' + w.word);
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
for (const w of words) {
  const lowered = w.sentence.toLowerCase();
  for (const other of words) {
    const re = new RegExp('\\b' + other.word.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
    assert(!re.test(lowered), other.word + ' leaks into the sentence for ' + w.word);
  }
}
console.log('words.json OK:', words.length, 'words,', words.filter(w => w.level === 'middle').length, 'reach');

// Today's batch picks the newest date
const extra = words.concat([{ word: 'ZEST', level: 'lower', choices: ['a','b','c','d'], answer: 'a', definition: 'x', example: 'y', addedDate: '2099-01-01' }]);
assert.strictEqual(SRS.todaysWords(extra, '2099-06-01').length, 1);
assert.strictEqual(SRS.todaysWords(extra, '2026-10-18').length, 20);
assert.strictEqual(SRS.todaysWords(words, '2026-10-18').length, 20);

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
SRS.save(mem, p); assert.deepStrictEqual(SRS.load(mem), p); SRS.reset(mem); assert.deepStrictEqual(SRS.load(mem), {});
console.log('All SRS tests passed');

// Weekly sentence quiz
const SQ = require('./sentencequiz.js');
assert.strictEqual(SQ.QUIZ_DAY, 0, 'Sunday is the default quiz day');
assert.strictEqual(SQ.dayName(), 'Sunday');
const thu = new Date('2026-10-29T16:00:00Z'); // Thursday noon ET
assert.strictEqual(SQ.weekIdFor(thu), '2026-10-25');
assert.strictEqual(SQ.weekIdFor(new Date('2026-10-25T03:30:00Z')), '2026-10-18', 'still Saturday evening in ET');
assert.strictEqual(SQ.weekIdFor(new Date('2026-10-25T04:30:00Z')), '2026-10-25', 'Sunday has started in ET');
assert.strictEqual(SQ.weekIdFor(thu, 4), '2026-10-29', 'quiz day can be moved');
assert.strictEqual(SQ.isAvailable({ completedWeekId: '' }, thu), true);
assert.strictEqual(SQ.isAvailable({ completedWeekId: '2026-10-25' }, thu), false);
assert.strictEqual(SQ.isAvailable({ completedWeekId: '2026-10-18' }, thu), true);
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
// Inside the Oct 25 quiz window (Oct 18 through Oct 29). Worst should be TIMID.
push('TIMID', false, 5000, 1, '2026-10-20');
push('TIMID', false, 5000, 2, '2026-10-20');
push('TIMID', false, SQ.SLOW_MS + 1000, 1, '2026-10-22');
push('VAST', false, 3000, 1, '2026-10-21');
push('VAST', false, 3000, 1, '2026-10-22');
push('CANDID', false, 2000, 1, '2026-10-21');
push('CANDID', true, 2000, 2, '2026-10-21');
push('FRAGILE', false, 9000, 1, '2026-10-23');
push('PERIL', true, SQ.SLOW_MS + 500, 1, '2026-10-24');
push('ANCIENT', true, SQ.SLOW_MS, 1, '2026-10-19');
push('CAUTIOUS', true, 1500, 1, '2026-10-26'); // fast and right: filler only
push('DRENCHED', true, 4000, 1, '2026-10-27');
push('TIMID', false, 1000, 1, '2026-10-10'); // before the window: ignored
const built = SQ.buildQuiz(words, attempts, thu, {});
assert.ok(built.items.length >= SQ.MIN_ITEMS && built.items.length <= SQ.MAX_ITEMS, '10 to 15 items');
assert.deepStrictEqual(built.items.slice(0, 8).map(w => w.word), ['TIMID', 'VAST', 'CANDID', 'FRAGILE', 'PERIL', 'ANCIENT', 'DRENCHED', 'CAUTIOUS']);
assert.strictEqual(built.items.length, SQ.MIN_ITEMS, 'six tough words get topped up to 10');
assert.strictEqual(built.weekId, '2026-10-25');
assert.strictEqual(built.windowStart, '2026-10-18');

// Fewer than 10 tough words: top up with other practiced words, then words added that week.
const few = [
  { word: 'TIMID', ok: false, ms: 1000, attempt: 1, ts: at('2026-10-21'), kind: 'card' },
  { word: 'VAST', ok: true, ms: 8000, attempt: 1, ts: at('2026-10-21'), kind: 'card' }
];
const topped = SQ.buildQuiz(words, few, thu, {});
assert.strictEqual(topped.items[0].word, 'TIMID');
assert.strictEqual(topped.items[1].word, 'VAST');
assert.strictEqual(topped.items.length, SQ.MIN_ITEMS);
assert.ok(topped.items.slice(2).every(w => w.addedDate >= '2026-10-18' && w.addedDate <= '2026-10-29'));

// 16 tough words cap at 15, ranked worst first, with no easy fillers mixed in.
const many = [];
const pool = words.slice(0, 16);
pool.forEach((w, i) => {
  for (let n = 0; n < (16 - i); n++) many.push({ word: w.word, ok: false, ms: 1000, attempt: 1, ts: at('2026-10-21'), kind: 'card' });
});
many.push({ word: 'EXASPERATE', ok: true, ms: 500, attempt: 1, ts: at('2026-10-21'), kind: 'card' });
const capped = SQ.buildQuiz(words, many, thu, {});
assert.strictEqual(capped.items.length, SQ.MAX_ITEMS);
assert.deepStrictEqual(capped.items.map(w => w.word), pool.slice(0, 15).map(w => w.word));

// Legacy progress (no attempt log yet): a miss whose lastSeen is in the window still counts.
const legacy = {};
SRS.record(legacy, 'RELUCTANT', false, at('2026-10-22'));
SRS.record(legacy, 'BRISK', true, at('2026-10-22'));
SRS.record(legacy, 'HASTY', false, at('2026-10-01')); // outside the window
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
SQ.logAttempt(store2, { word: 'TIMID', ok: false, ms: 1000, attempt: 1, ts: at('2026-10-21'), kind: 'card' });
SQ.logAttempt(store2, { word: 'OLD', ok: false, ms: 1000, attempt: 1, ts: Date.now() - 40 * 86400000, kind: 'card' }, Date.now());
assert.deepStrictEqual(SQ.loadAttempts(store2).map(a => a.word), ['TIMID'], 'attempts older than 3 weeks are dropped');
SQ.markCompleted(store2, '2026-10-25', { score: '1/1', missed: 'TIMID' });
assert.strictEqual(SQ.isAvailable(SQ.loadState(store2), thu), false);
assert.strictEqual(SQ.pending(store2).missed, 'TIMID');
SQ.clearPending(store2);
assert.strictEqual(SQ.pending(store2), null);
assert.strictEqual(SQ.loadState(store2).completedWeekId, '2026-10-25');
SQ.reset(store2);
assert.deepStrictEqual(SQ.loadAttempts(store2), []);
assert.strictEqual(SQ.loadState(store2).completedWeekId, '');
console.log('Sentence quiz tests passed');

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
