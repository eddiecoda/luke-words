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
  console.log('Words log tests passed');
})().catch(e => { console.error(e); process.exit(1); });
