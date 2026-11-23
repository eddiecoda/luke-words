/* Sentence quiz. Works in the browser (window.SentenceQuiz) and in Node (module.exports).

   TRTL-14/15 (Nov 23 2026): FIXED, MUSE-SUPPLIED SENTENCE SETS. NO REPEATS.
   - Sets live in sentence_sets/ and are listed, in order, in sentence_sets/index.json:
       { "sets": [ { "id": "APP-SENT-2026-11-23", "file": "app_sentence_set_2026-11-23.json" } ] }
     To publish a new set: add the file and append an index entry. Nothing else changes.
   - Set file: { "set": "<id>", "items": [ { "word", "sentence" (one _____ blank), "choices" [4], "answer" } ] }.
     "answer" is one of the choices and may be an inflected form (enthrall -> "enthralled"); scoring uses "answer".
   - The app serves the earliest set in the index that is not completed on this device. One attempt per item;
     answers are saved as he goes (FIXED_KEY), so leaving mid-set resumes where he left off (no re-asking).
   - A finished set is locked forever in localStorage (FIXED_KEY) and never served again. When none remain,
     the app shows "No new sentence set yet".
   - On finishing, the WORDS LOG quiz email (wordlog.js quiz(), same fields as before; week = set id) and the
     Coda Stars quiz_completed event (quiz_id = set id) are sent; unsent emails stay queued in STATE_KEY.
   - A miss is fed to SRS.record(word, false) when item.word is in words.json (matched case-insensitively).

   The older dynamic "tough words" builder (buildQuiz and helpers below) is no longer used by the app (TRTL-15
   replaced it); it is kept only so its unit tests still run. TRTL-13's repeatable quiz is reversed by TRTL-14.
*/
(function (root) {
  var QUIZ_DAYS = [0, 1, 2, 3, 4, 5, 6]; // every day (TRTL-13: no Mon/Wed/Fri gating)
  var WINDOW_DAYS = 3; // tough-word window: today and the 3 days before it (ET)
  var MIN_ITEMS = 10;
  var MAX_ITEMS = 15;
  var SLOW_MS = 20000;
  var BLANK = '_____';
  var TZ = 'America/New_York';
  var ATTEMPT_KEY = 'luke-isee-attempts-v1';
  var STATE_KEY = 'luke-sentence-quiz-v1';
  var KEEP_DAYS = 21;
  var DAY_MS = 24 * 60 * 60 * 1000;
  var DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  function etYmd(ts) {
    var d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  }

  function etParts(date) {
    var fmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit' });
    var map = {};
    fmt.formatToParts(date).forEach(function (p) { map[p.type] = p.value; });
    return { ymd: map.year + '-' + map.month + '-' + map.day, wd: { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[map.weekday] };
  }

  function addDays(ymd, n) {
    var p = ymd.split('-');
    var dt = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n));
    return dt.getUTCFullYear() + '-' + String(dt.getUTCMonth() + 1).padStart(2, '0') + '-' + String(dt.getUTCDate()).padStart(2, '0');
  }

  function weekdayOf(ymd) {
    var p = ymd.split('-');
    return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay();
  }

  // Accepts an array of weekdays, a single weekday, or nothing (QUIZ_DAYS).
  function daysOf(days) {
    var list = days == null ? QUIZ_DAYS : (Array.isArray(days) ? days : [days]);
    list = list.filter(function (d) { return d >= 0 && d <= 6; });
    return list.length ? list : QUIZ_DAYS;
  }

  function dayName(day) {
    var d = day == null ? daysOf()[0] : day;
    return DAY_NAMES[d] || DAY_NAMES[0];
  }

  // The quiz id: the date (ET) of the most recent quiz day on or before `date`.
  function quizIdFor(date, days) {
    var list = daysOf(days);
    var p = etParts(date || new Date());
    for (var back = 0; back < 7; back++) {
      if (list.indexOf((p.wd - back + 7) % 7) >= 0) return addDays(p.ymd, -back);
    }
    return p.ymd;
  }
  var weekIdFor = quizIdFor; // old name

  // The quiz day before quizId (start of its tough-word window).
  function prevQuizId(quizId, days) {
    var list = daysOf(days), wd = weekdayOf(quizId);
    for (var back = 1; back <= 7; back++) {
      if (list.indexOf((wd - back + 7) % 7) >= 0) return addDays(quizId, -back);
    }
    return addDays(quizId, -7);
  }

  // The next quiz day strictly after `date` (ET): { ymd, name }.
  function nextQuizDay(date, days) {
    var list = daysOf(days);
    var p = etParts(date || new Date());
    for (var fwd = 1; fwd <= 7; fwd++) {
      var wd = (p.wd + fwd) % 7;
      if (list.indexOf(wd) >= 0) return { ymd: addDays(p.ymd, fwd), name: DAY_NAMES[wd] };
    }
    return { ymd: addDays(p.ymd, 7), name: DAY_NAMES[p.wd] };
  }

  // Coda Stars hook for a finished quiz. Fire-and-forget: every error is swallowed and it never blocks the UI.
  // text/plain keeps it a "simple" cross-origin request (no CORS preflight); the body is JSON.
  var STARS_URL = 'https://coda-kids-app.vercel.app/api/vocab/event';
  function quizEvent(kid, quizId, correct, total, dateEt) {
    return { kid: kid, event: 'quiz_completed', quiz_id: quizId, correct: correct | 0, total: total | 0, date_et: dateEt || etYmd(Date.now()) };
  }
  function postQuizEvent(fetchFn, payload) {
    try {
      if (!fetchFn) return Promise.resolve(false);
      return Promise.resolve(fetchFn(STARS_URL, { method: 'POST', mode: 'cors', keepalive: true, credentials: 'omit',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify(payload) }))
        .then(function (r) { return !!(r && r.ok); }, function () { return false; });
    } catch (e) { return Promise.resolve(false); }
  }

  function loadJson(storage, key, fallback) {
    try {
      var v = JSON.parse(storage.getItem(key));
      return v == null ? fallback : v;
    } catch (e) { return fallback; }
  }
  function saveJson(storage, key, value) {
    try { storage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }

  function loadAttempts(storage) {
    var all = loadJson(storage, ATTEMPT_KEY, []);
    return Array.isArray(all) ? all : [];
  }

  function logAttempt(storage, ev, now) {
    now = now || Date.now();
    if (!ev || !ev.word) return loadAttempts(storage);
    var all = loadAttempts(storage);
    all.push({
      word: ev.word,
      ok: !!ev.ok,
      ms: ev.ms > 0 ? Math.round(ev.ms) : 0,
      attempt: ev.attempt > 1 ? Math.round(ev.attempt) : 1,
      ts: ev.ts || now,
      kind: ev.kind === 'sentence' ? 'sentence' : 'card'
    });
    var cutoff = now - KEEP_DAYS * DAY_MS;
    all = all.filter(function (e) { return e && e.ts >= cutoff; });
    if (all.length > 3000) all = all.slice(all.length - 3000);
    saveJson(storage, ATTEMPT_KEY, all);
    return all;
  }

  // pending: the oldest quiz score not yet emailed; queue: every unsent score, oldest first
  // (quizzes can repeat, so a second finish while offline must not overwrite the first).
  function loadState(storage) {
    var s = loadJson(storage, STATE_KEY, null);
    if (!s || typeof s !== 'object') return { completedQuizId: '', pending: null, queue: [] };
    var q = Array.isArray(s.queue) ? s.queue.filter(Boolean) : (s.pending ? [s.pending] : []);
    return { completedQuizId: s.completedQuizId || s.completedWeekId || '', pending: q[0] || null, queue: q };
  }
  function saveState(storage, state) {
    saveJson(storage, STATE_KEY, { completedQuizId: state.completedQuizId, pending: state.queue[0] || null, queue: state.queue });
  }

  function markCompleted(storage, quizId, pending) {
    var s = loadState(storage);
    s.completedQuizId = quizId;
    if (pending) s.queue.push(pending);
    saveState(storage, s);
    return loadState(storage);
  }
  // Drop one sent score (the given one, else the oldest).
  function clearPending(storage, sent) {
    var s = loadState(storage);
    var key = sent ? JSON.stringify(sent) : null;
    var i = key ? s.queue.findIndex(function (p) { return JSON.stringify(p) === key; }) : 0;
    if (i < 0 && !key) i = 0;
    if (i >= 0) s.queue.splice(i, 1);
    saveState(storage, s);
    return loadState(storage);
  }
  function pending(storage) { return loadState(storage).pending; }
  function pendingAll(storage) { return loadState(storage).queue; }

  // ---- TRTL-15: fixed sentence sets ----
  var FIXED_KEY = 'luke-sentence-sets-v1';
  var SETS_DIR = 'sentence_sets/';
  function loadFixed(storage) {
    var s = loadJson(storage, FIXED_KEY, null);
    if (!s || typeof s !== 'object') s = {};
    return { completed: (s.completed && typeof s.completed === 'object') ? s.completed : {},
      progress: (s.progress && typeof s.progress === 'object' && s.progress.id) ? s.progress : null };
  }
  function saveFixed(storage, f) { saveJson(storage, FIXED_KEY, f); }
  function isFixedDone(f, id) { return !!(f && f.completed && f.completed[id]); }
  // index: parsed sentence_sets/index.json. Returns the earliest entry not completed, or null.
  function indexEntries(index) {
    var list = index && Array.isArray(index.sets) ? index.sets : (Array.isArray(index) ? index : []);
    return list.filter(function (e) { return e && typeof e.id === 'string' && e.id && typeof e.file === 'string' && e.file; });
  }
  function nextFixedEntry(index, f) {
    var list = indexEntries(index);
    for (var i = 0; i < list.length; i++) if (!isFixedDone(f, list[i].id)) return list[i];
    return null;
  }
  function validItem(it) {
    return !!it && typeof it.sentence === 'string' && hasBlank(it.sentence) && Array.isArray(it.choices) && it.choices.length === 4 &&
      typeof it.answer === 'string' && it.choices.indexOf(it.answer) >= 0;
  }
  // Checks a loaded set file against its index entry. Returns the set or throws.
  function validateFixedSet(data, id) {
    if (!data || !Array.isArray(data.items) || !data.items.length) throw new Error('sentence set has no items');
    if (id && data.set && data.set !== id) throw new Error('sentence set id mismatch: ' + data.set + ' vs ' + id);
    data.items.forEach(function (it, i) { if (!validItem(it)) throw new Error('bad sentence item ' + (i + 1)); });
    return { id: id || data.set, items: data.items };
  }
  // One attempt per item. Returns { ok, progress } or null if the item was already answered / the set is done.
  function answerFixed(storage, set, index, choice) {
    var f = loadFixed(storage);
    if (isFixedDone(f, set.id)) return null;
    var p = f.progress && f.progress.id === set.id ? f.progress : { id: set.id, answers: [] };
    if (index < 0 || index >= set.items.length || p.answers[index] != null) return null;
    var ok = choice === set.items[index].answer;
    p.answers[index] = { choice: String(choice), ok: ok };
    f.progress = p; saveFixed(storage, f);
    return { ok: ok, progress: p };
  }
  // Where to resume: the first unanswered item (items.length when all are answered).
  function resumeIndex(f, set) {
    var p = f && f.progress && f.progress.id === set.id ? f.progress : null;
    if (!p) return 0;
    for (var i = 0; i < set.items.length; i++) if (p.answers[i] == null) return i;
    return set.items.length;
  }
  function fixedScore(f, set) {
    var p = f && f.progress && f.progress.id === set.id ? f.progress : { answers: [] };
    var correct = 0, missed = [];
    set.items.forEach(function (it, i) { var a = p.answers[i]; if (a && a.ok) correct++; else missed.push(it.word || it.answer); });
    return { correct: correct, total: set.items.length, missed: missed };
  }
  // Lock the set forever. Returns false if it was already locked (so results are only sent once).
  function completeFixed(storage, set, result) {
    var f = loadFixed(storage);
    if (isFixedDone(f, set.id)) return false;
    f.completed[set.id] = result || { at: Date.now() };
    if (f.progress && f.progress.id === set.id) f.progress = null;
    saveFixed(storage, f);
    return true;
  }
  // Map a set item's word onto the words.json card (case-insensitive); null if it is not in the bank.
  function bankWord(words, w) {
    if (!w) return null;
    var k = String(w).trim().toUpperCase();
    for (var i = 0; i < (words || []).length; i++) if (String(words[i].word).toUpperCase() === k) return words[i];
    return null;
  }

  function normalizeAnswer(s) {
    return String(s == null ? '' : s).trim().replace(/\s+/g, ' ').toLowerCase();
  }
  function answersMatch(input, word) {
    var guess = normalizeAnswer(input);
    return !!guess && guess === normalizeAnswer(word);
  }

  function hasBlank(sentence) {
    if (typeof sentence !== 'string') return false;
    if (sentence.split(BLANK).length !== 2) return false;
    return sentence.replace(BLANK, '').indexOf('_') === -1;
  }

  function clueFor(word) {
    if (word && hasBlank(word.sentence)) return { text: word.sentence, fallback: false };
    var def = String(word && word.definition || '').replace(/^\([^)]*\)\s*/, '').trim();
    var text = def ? 'Which word means "' + def + '"? ' + BLANK : 'Which word fits here? ' + BLANK;
    return { text: text, fallback: true };
  }

  function fillBlank(sentence, word) {
    var shown = String(word || '').toLowerCase();
    var idx = sentence.indexOf(BLANK);
    var before = idx < 0 ? '' : sentence.slice(0, idx);
    if (!before.trim() || /[.!?]\s*$/.test(before)) shown = shown.charAt(0).toUpperCase() + shown.slice(1);
    return idx < 0 ? sentence : sentence.slice(0, idx) + shown + sentence.slice(idx + BLANK.length);
  }

  function blankStat() {
    return { word: '', misses: 0, extra: 0, slow: 0, attempts: 0, maxMs: 0 };
  }

  function scoreOf(a) { return a.misses * 10 + a.extra * 5 + a.slow * 3; }
  function isTough(a) { return a.misses > 0 || a.extra > 0 || a.slow > 0; }

  // recent: optional list of word objects (current set, then previous set) used to top up a short quiz.
  function buildQuiz(words, attempts, now, progress, days, recent) {
    now = now || new Date();
    var quizId = quizIdFor(now, days);
    var start = days == null ? addDays(quizId, -WINDOW_DAYS) : prevQuizId(quizId, days);
    var end = etYmd(now);
    var byWord = {};
    (attempts || []).forEach(function (ev) {
      if (!ev || !ev.word || !ev.ts) return;
      var d = etYmd(ev.ts);
      if (!d || d < start || d > end) return;
      var a = byWord[ev.word];
      if (!a) { a = blankStat(); a.word = ev.word; byWord[ev.word] = a; }
      a.attempts++;
      if (!ev.ok) a.misses++;
      if ((ev.ms || 0) > a.maxMs) a.maxMs = ev.ms;
      if (ev.kind !== 'sentence') {
        if ((ev.attempt || 1) >= 2) a.extra++;
        if ((ev.ms || 0) >= SLOW_MS) a.slow++;
      }
    });

    (words || []).forEach(function (w) {
      if (byWord[w.word] || !progress) return;
      var s = progress[w.word];
      if (!s || !s.seen || !s.lastSeen) return;
      var d = etYmd(s.lastSeen);
      if (!d || d < start || d > end) return;
      var a = blankStat();
      a.word = w.word;
      a.attempts = 1;
      if (s.lastResult === 'wrong') a.misses = 1;
      byWord[w.word] = a;
    });

    var known = {};
    (words || []).forEach(function (w) { known[w.word] = w; });

    function byWorst(a, b) {
      var sa = scoreOf(byWord[a]), sb = scoreOf(byWord[b]);
      if (sa !== sb) return sb - sa;
      if (byWord[a].misses !== byWord[b].misses) return byWord[b].misses - byWord[a].misses;
      if (byWord[a].maxMs !== byWord[b].maxMs) return byWord[b].maxMs - byWord[a].maxMs;
      return a.localeCompare(b);
    }

    var names = Object.keys(byWord).filter(function (k) { return known[k]; });
    var tough = names.filter(function (k) { return isTough(byWord[k]); }).sort(byWorst);
    var fillers = names.filter(function (k) { return !isTough(byWord[k]); }).sort(byWorst);
    var added = (words || []).filter(function (w) {
      return !byWord[w.word] && w.addedDate >= start && w.addedDate <= end;
    }).sort(function (a, b) { return b.addedDate.localeCompare(a.addedDate) || a.word.localeCompare(b.word); });

    // Recent words, least-known first (lower flashcard box), keeping current-set-before-previous-set order on ties.
    function boxOf(w) { var s = progress && progress[w.word]; return s && s.box != null ? s.box : -1; }
    var recentList = (recent || []).filter(function (w) { return w && known[w.word]; })
      .map(function (w, i) { return { w: known[w.word], i: i }; })
      .sort(function (a, b) { return boxOf(a.w) - boxOf(b.w) || a.i - b.i; })
      .map(function (x) { return x.w; });

    var picked = tough.slice(0, MAX_ITEMS).map(function (k) { return known[k]; });
    var have = {};
    picked.forEach(function (w) { have[w.word] = 1; });
    function add(w) { if (w && !have[w.word]) { have[w.word] = 1; picked.push(w); } }
    var i;
    for (i = 0; picked.length < MIN_ITEMS && i < fillers.length; i++) add(known[fillers[i]]);
    for (i = 0; picked.length < MIN_ITEMS && i < recentList.length; i++) add(recentList[i]);
    for (i = 0; picked.length < MIN_ITEMS && i < added.length; i++) add(added[i]);
    return { quizId: quizId, weekId: quizId, windowStart: start, windowEnd: end, items: picked, toughCount: Math.min(tough.length, MAX_ITEMS) };
  }

  // A missed sentence-quiz word is fed back through the flashcard recorder (SRS.record).
  // A correct sentence answer does not change the flashcard box.
  function noteQuizResult(progress, word, ok, record) {
    if (!ok && record) record(progress, word, false);
    return !ok;
  }

  var api = {
    QUIZ_DAYS: QUIZ_DAYS, WINDOW_DAYS: WINDOW_DAYS, MIN_ITEMS: MIN_ITEMS, MAX_ITEMS: MAX_ITEMS, SLOW_MS: SLOW_MS, BLANK: BLANK,
    ATTEMPT_KEY: ATTEMPT_KEY, STATE_KEY: STATE_KEY, DAY_NAMES: DAY_NAMES,
    dayName: dayName, weekIdFor: weekIdFor, quizIdFor: quizIdFor, prevQuizId: prevQuizId, nextQuizDay: nextQuizDay,
    STARS_URL: STARS_URL, quizEvent: quizEvent, postQuizEvent: postQuizEvent, addDays: addDays, etYmd: etYmd,
    logAttempt: logAttempt, loadAttempts: loadAttempts, loadState: loadState,
    markCompleted: markCompleted, clearPending: clearPending, pending: pending, pendingAll: pendingAll,
    normalizeAnswer: normalizeAnswer, answersMatch: answersMatch,
    FIXED_KEY: FIXED_KEY, SETS_DIR: SETS_DIR, loadFixed: loadFixed, isFixedDone: isFixedDone, indexEntries: indexEntries,
    nextFixedEntry: nextFixedEntry, validateFixedSet: validateFixedSet, answerFixed: answerFixed, resumeIndex: resumeIndex,
    fixedScore: fixedScore, completeFixed: completeFixed, bankWord: bankWord,
    hasBlank: hasBlank, clueFor: clueFor, fillBlank: fillBlank, buildQuiz: buildQuiz,
    noteQuizResult: noteQuizResult, scoreOf: scoreOf
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SentenceQuiz = api;
})(this);
