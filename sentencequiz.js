/* "Use it in a sentence" quiz, three times a week (Mon, Wed, Fri).
   Works in the browser (window.SentenceQuiz) and in Node (module.exports).

   QUIZ DAYS
   A quiz opens on each day in QUIZ_DAYS and stays open until Luke finishes it.
   0 = Sunday, 1 = Monday, 2 = Tuesday, 3 = Wednesday, 4 = Thursday, 5 = Friday, 6 = Saturday.
   QUIZ_DAYS = [1, 3, 5] means Monday, Wednesday and Friday. Days are dated in America/New_York,
   same as the words log. The quiz id (quiz_id) is the date of the quiz day it belongs to.
   If an older quiz is still unfinished when the next quiz day arrives, the newer one replaces it
   (only the quiz for the most recent quiz day is ever open).

   SENTENCE FIELD (on each object in words.json)
   "sentence": "The garden grew an _____ crop of tomatoes, far more than the family could eat."
   - The blank is exactly five underscores: _____
   - It stands in for the vocabulary word (word), in that word's part of speech.
   - Write one natural, kid-appropriate sentence. The context should point at the meaning.
   - Do not also write the vocabulary word (or any other word from words.json) in the sentence.
   - Capitalization and extra spaces are ignored when Luke types the answer.
   - If sentence is missing or has no _____ blank, the quiz falls back to the definition:
     Which word means "…"? _____

   WHAT COUNTS AS A TOUGH WORD (QUIZ WINDOW)
   The window runs from the previous quiz day through today (e.g. Wednesday's quiz looks back to Monday,
   Monday's looks back to the Friday before).
   Each flashcard answer is stored in localStorage under ATTEMPT_KEY:
   { word, ok, ms, attempt, ts, kind: "card" }.
   attempt is 1 the first time a card is shown in a session, and 2 when a miss comes back.
   A word is tough if, inside the quiz window, it was missed at least once, came back for
   another try (attempt >= 2), or took at least SLOW_MS milliseconds.
   Words are ranked worst first (misses, then extra tries, then slow answers).
   The quiz is 10 to 15 items. Tough words fill it first; if there are fewer than 10,
   it tops up with other words practiced in the window, then recent words (the current set,
   then the previous set, least-known first), then words added in the window.
   Progress saved before this tracking existed still counts: a word whose last result
   was wrong, and whose lastSeen falls in the window, is treated as one miss.

   A miss on the sentence quiz is recorded with the normal SRS.record(..., false)
   so the word drops to box 0 and shows up in Review. A correct sentence answer
   does not move the flashcard box.
*/
(function (root) {
  var QUIZ_DAYS = [1, 3, 5]; // Monday, Wednesday, Friday
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

  function loadState(storage) {
    var s = loadJson(storage, STATE_KEY, null);
    if (!s || typeof s !== 'object') return { completedQuizId: '', pending: null };
    return { completedQuizId: s.completedQuizId || s.completedWeekId || '', pending: s.pending || null };
  }
  function saveState(storage, state) { saveJson(storage, STATE_KEY, state); }

  function markCompleted(storage, quizId, pending) {
    var s = loadState(storage);
    s.completedQuizId = quizId;
    s.pending = pending || null;
    saveState(storage, s);
    return s;
  }
  function clearPending(storage) {
    var s = loadState(storage);
    s.pending = null;
    saveState(storage, s);
    return s;
  }
  function pending(storage) { return loadState(storage).pending; }

  function reset(storage) {
    try { storage.removeItem(ATTEMPT_KEY); } catch (e) {}
    try { storage.removeItem(STATE_KEY); } catch (e) {}
  }

  // Open unless the quiz for the most recent quiz day is already finished.
  // An unfinished older quiz is simply replaced by the newer quiz id.
  function isAvailable(state, date, days) {
    var id = quizIdFor(date || new Date(), days);
    var done = state && (state.completedQuizId || state.completedWeekId);
    return !state || done !== id;
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
    var start = prevQuizId(quizId, days);
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
    QUIZ_DAYS: QUIZ_DAYS, MIN_ITEMS: MIN_ITEMS, MAX_ITEMS: MAX_ITEMS, SLOW_MS: SLOW_MS, BLANK: BLANK,
    ATTEMPT_KEY: ATTEMPT_KEY, STATE_KEY: STATE_KEY, DAY_NAMES: DAY_NAMES,
    dayName: dayName, weekIdFor: weekIdFor, quizIdFor: quizIdFor, prevQuizId: prevQuizId, nextQuizDay: nextQuizDay,
    STARS_URL: STARS_URL, quizEvent: quizEvent, postQuizEvent: postQuizEvent, addDays: addDays, etYmd: etYmd,
    logAttempt: logAttempt, loadAttempts: loadAttempts, loadState: loadState,
    markCompleted: markCompleted, clearPending: clearPending, pending: pending, reset: reset,
    isAvailable: isAvailable, normalizeAnswer: normalizeAnswer, answersMatch: answersMatch,
    hasBlank: hasBlank, clueFor: clueFor, fillBlank: fillBlank, buildQuiz: buildQuiz,
    noteQuizResult: noteQuizResult, scoreOf: scoreOf
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SentenceQuiz = api;
})(this);
