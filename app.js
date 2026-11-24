(function () {
  var $ = function (id) { return document.getElementById(id); };
  var words = [], progress = SRS.load(localStorage), session = null, sessionMode = '', answered = false, cardStarted = 0;
  var sq = null, quizSending = false;
  var sentIndex = null, sentSet = null, sentErr = ''; // TRTL-15: sentence_sets/index.json and the next unfinished set
  var SQ = SentenceQuiz;
  var sets = SRS.loadSets(localStorage), setJustDone = null;
  var LETTERS = ['A', 'B', 'C', 'D'];
  var KID = 'luke';
  var K = function (w) { return w.word; };
  var wlog = WordLog.create({ kid: 'Luke', storage: localStorage, keyFn: K,
    setFn: function () { var c = SRS.daySet(words, sets, progress, K, WordLog.etDate()); SRS.saveSets(localStorage, sets); return c; } });

  // Current set (stored in localStorage): moves to the next set once every card in it has been answered right once IN THAT SET
  // (TRTL-17: mastered words and right answers from other sets do not count; every card of the set is served).
  function cur() {
    var res = SRS.completeIfDone(words, sets, progress, K);
    if (res) starsEvent('completed', res.from, res.to, res);
    var r = SRS.resolveCurrent(words, sets, progress, K); SRS.saveSets(localStorage, sets); return r;
  }
  function visible() { return SRS.unlockedWords(words, sets, progress, K); }
  function starsEvent(event, setIdv, nextId, p) {
    SRS.postStarsEvent(typeof fetch !== 'undefined' ? fetch : null, { kid: KID, event: event, set: setIdv, next_set: nextId || null,
      answered: p.answered, right: p.right, date_et: WordLog.etDate() }).catch(function () {});
  }
  function openedSet(r) {
    var id = r.set.id, d = WordLog.etDate();
    if (sets.opened[id] === d) return;
    sets.opened[id] = d; SRS.saveSets(localStorage, sets);
    var nx = SRS.nextSet(r.sets, id, sets, progress, K);
    starsEvent('opened', id, nx && nx.id, SRS.setProgress(r.set, sets, progress, K));
  }
  function toast(msg) {
    var t = $('toast'); if (!t) return;
    t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toast.h); toast.h = setTimeout(function () { t.classList.add('hidden'); }, 3500);
  }
  function setDoneMsg(res) { return res.exhausted ? '🎉 Set done! New words coming soon.' : '🎉 Set done! New words unlocked.'; }

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function show(id) {
    ['home', 'quiz', 'done', 'stats', 'missed', 'sentence', 'sentenceDone'].forEach(function (s) { $(s).classList.toggle('hidden', s !== id); });
    window.scrollTo(0, 0);
  }
  function fmtDate(ts) {
    if (!ts) return '—';
    var d = new Date(ts), now = new Date();
    if (d.toDateString() === now.toDateString()) return 'today';
    var y = new Date(now); y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return 'yesterday';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function starName(w) { return (w.level === 'middle' ? '<span class="star">★</span> ' : '') + esc(w.word); }

  function refreshHome() {
    var c = cur(), vis = visible(), t = c.set ? c.set.cards : [], r = SRS.reviewWords(vis, progress), st = SRS.stats(vis, progress);
    var sp = c.set ? SRS.setProgress(c.set, sets, progress, K) : { right: 0, total: 0 };
    var serve = SRS.servableCards(words, sets, progress, K); SRS.saveSets(localStorage, sets);
    $('todayCount').textContent = serve.exhausted ? 'done' : sp.right + '/' + t.length;
    $('btnToday').disabled = !serve.cards.length; // TRTL-14: a completed set is never served again
    $('reviewCount').textContent = r.length;
    $('btnReview').disabled = r.length === 0;
    $('homeSummary').innerHTML = words.length
      ? 'You have <b>' + vis.length + '</b> words. <b>' + st.mastered + '</b> mastered so far' +
        (st.answered ? ', <b>' + Math.round(st.accuracy * 100) + '%</b> accuracy.' : '. Start with your current set!') +
        (c.set ? '<br><span class="small">Current set ' + esc(c.set.id) + ': ' + sp.right + ' of ' + t.length + ' right so far. Get every word right once to unlock new words.</span>' : '')
      : 'No words found.';
    var n = $('setNotice'), msg = '';
    if (sets.notice === 'unlocked') msg = '🎉 Set done! New words unlocked.';
    else if (c.exhausted) msg = '🎉 You finished every set! New words coming soon.';
    if (sets.notice) { sets.notice = ''; SRS.saveSets(localStorage, sets); }
    n.textContent = msg; n.classList.toggle('hidden', !msg);
    updateSentenceCard();
  }

  // ---- TRTL-15: Muse-supplied fixed sentence sets (sentence_sets/index.json). One time only (TRTL-14). ----
  function loadSentenceSet() {
    sentErr = '';
    return fetch(SQ.SETS_DIR + 'index.json?v=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('index ' + r.status); return r.json(); })
      .then(function (idx) {
        sentIndex = idx;
        var e = SQ.nextFixedEntry(idx, SQ.loadFixed(localStorage));
        if (!e) { sentSet = null; return null; }
        if (sentSet && sentSet.id === e.id) return sentSet;
        return fetch(SQ.SETS_DIR + e.file + '?v=' + Date.now(), { cache: 'no-store' })
          .then(function (r) { if (!r.ok) throw new Error('set ' + r.status); return r.json(); })
          .then(function (data) { sentSet = SQ.validateFixedSet(data, e.id); return sentSet; });
      })
      .catch(function () { sentSet = null; sentErr = 'Sentence set could not load. Check your connection and come back.'; return null; })
      .then(function (x) { updateSentenceCard(); return x; });
  }
  function updateSentenceCard() {
    var f = SQ.loadFixed(localStorage);
    var live = sentSet && !SQ.isFixedDone(f, sentSet.id) ? sentSet : null;
    var at = live ? SQ.resumeIndex(f, live) : 0;
    $('sentenceBadge').textContent = live ? (at > 0 ? 'In progress' : 'New') : 'Done ✓';
    $('sentenceBadge').className = live ? 'badge-ready' : 'badge-done';
    $('btnSentence').disabled = !live || !words.length;
    $('btnSentence').textContent = live ? (at > 0 ? 'Keep going · ' + at + '/' + live.items.length : 'Start · ' + live.items.length + ' sentences') : 'No new sentence set yet';
    $('sentencePrompt').textContent = sentErr ? sentErr : live
      ? 'Pick the word that fits each blank. One try per sentence. You can do this set once.'
      : (sentIndex ? 'No new sentence set yet. A new one is coming soon!' : 'Loading your sentence set…');
  }

  function start(mode) {
    // TRTL-14: only the current, not-yet-completed set is ever served. No Mix, no review quiz, no repeats.
    if (mode !== 'today') return;
    cur();
    var serve = SRS.servableCards(words, sets, progress, K); SRS.saveSets(localStorage, sets);
    var list = SRS.shuffle(serve.cards);
    if (!list.length) { home(); return; }
    var c = { set: serve.set, sets: SRS.setList(words) };
    wlog.openedSet(); openedSet(c);
    sessionMode = mode; setJustDone = null;
    session = new SRS.Session(list);
    $('modeLabel').textContent = '📅 Current set ' + (c.set ? c.set.id : '');
    show('quiz');
    renderCard();
  }

  // TRTL-16: read-only study list of missed words (same words as SRS.reviewWords). No questions, no scoring.
  function renderMissed() {
    var r = SRS.reviewWords(visible(), progress);
    $('missedWordList').innerHTML = r.map(function (w) {
      return '<li><b>' + starName(w) + '</b>' + esc(w.definition) + '</li>';
    }).join('');
    $('missedEmpty').classList.toggle('hidden', r.length > 0);
    show('missed');
  }

  function renderCard() {
    // TRTL-14: once this session finishes the set, stop; the finished set's cards are not served again.
    if (setJustDone) return finish();
    var w = session.current();
    if (!w) return finish();
    answered = false;
    cardStarted = Date.now();
    var total = Object.keys(session.firstTry).length + session.queue.filter(function (q, i, a) {
      return !(q.word in session.firstTry) && a.findIndex(function (x) { return x.word === q.word; }) === i; }).length;
    $('progressText').textContent = 'Card ' + Math.min(session.done + 1, total) + ' of ' + total + (w.word in session.firstTry ? ' · try again!' : '');
    $('progressBar').style.width = (session.done / total * 100) + '%';
    $('stem').textContent = w.word.toUpperCase();
    $('reachTag').classList.toggle('hidden', w.level !== 'middle');
    $('feedback').classList.add('hidden');
    var box = $('choices'); box.innerHTML = '';
    SRS.shuffle(w.choices).forEach(function (c, i) {
      var b = document.createElement('button');
      b.className = 'choice';
      b.innerHTML = '<span class="letter">' + LETTERS[i] + '</span><span>' + esc(c) + '</span>';
      b.onclick = function () { choose(b, c, w); };
      b.dataset.value = c;
      box.appendChild(b);
    });
  }

  function choose(btn, choice, w) {
    if (answered) return;
    answered = true;
    var ok = choice === w.answer;
    var first = !(w.word in session.firstTry);
    SQ.logAttempt(localStorage, { word: w.word, ok: ok, ms: Date.now() - cardStarted, attempt: first ? 1 : 2, ts: Date.now(), kind: 'card' });
    // Only the first attempt in a session counts toward his stats.
    if (first) { SRS.record(progress, w.word, ok); SRS.save(localStorage, progress); }
    var res = SRS.markSetAnswer(words, sets, progress, K, w, ok); SRS.saveSets(localStorage, sets);
    if (first) wlog.answered(w.word, ok);
    if (res) { setJustDone = res; toast(setDoneMsg(res)); starsEvent('completed', res.from, res.to, res); }
    session.answer(ok);
    Array.prototype.forEach.call($('choices').children, function (b) {
      b.disabled = true;
      if (b.dataset.value === w.answer) b.classList.add('correct');
    });
    if (!ok) { btn.classList.add('wrong'); $('quiz').querySelector('.qcard').classList.add('shake'); }
    else btn.classList.add('pop');
    setTimeout(function () { $('quiz').querySelector('.qcard').classList.remove('shake'); }, 400);
    var cheers = ['Awesome! 🎉', 'Nailed it! 💪', 'Correct! ⭐', 'Yes! 🙌', 'Great job! 🚀'];
    $('verdict').textContent = ok ? cheers[Math.floor(Math.random() * cheers.length)] : 'Not quite — it\'s "' + w.answer + '" 💡';
    $('verdict').className = 'verdict ' + (ok ? 'ok' : 'bad');
    $('definition').textContent = w.definition;
    $('example').textContent = w.example;
    var s = SRS.getStat(progress, w.word);
    $('wordStat').textContent = 'Right ' + s.correct + ' of ' + s.seen + ' times' +
      (SRS.isMastered(s) ? ' · ✅ mastered!' : s.streak ? ' · streak ' + s.streak + '/' + SRS.MASTERY_STREAK : '') +
      (!ok && first ? ' · this one will come back soon' : '');
    $('feedback').classList.remove('hidden');
    $('btnNext').focus({ preventScroll: true });
    $('feedback').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function finish() {
    var n = session.done, r = session.right, pct = n ? r / n : 0;
    $('doneScore').textContent = r + ' / ' + n;
    $('doneEmoji').textContent = pct >= 0.9 ? '🏆' : pct >= 0.7 ? '🎉' : pct >= 0.5 ? '👍' : '💪';
    $('doneTitle').textContent = pct >= 0.9 ? 'Superstar!' : pct >= 0.7 ? 'Nice work!' : pct >= 0.5 ? 'Good effort!' : 'Keep practicing!';
    var missed = Object.keys(session.firstTry).filter(function (k) { return !session.firstTry[k]; });
    $('doneMsg').textContent = missed.length ? 'Missed words are in "My missed words" to study.' : 'You got every word on the first try!';
    $('doneMissed').innerHTML = missed.length ? '<ul class="missedlist">' + missed.map(function (k) {
      var w = words.find(function (x) { return x.word === k; });
      return '<li><b>' + starName(w) + '</b> = ' + esc(w.answer) + '</li>'; }).join('') + '</ul>' : '';
    $('btnDoneReview').classList.toggle('hidden', SRS.reviewWords(visible(), progress).length === 0);
    $('doneSet').textContent = setJustDone ? setDoneMsg(setJustDone) : '';
    $('doneSet').classList.toggle('hidden', !setJustDone);
    if (setJustDone) { sets.notice = ''; SRS.saveSets(localStorage, sets); }
    show('done');
    wlog.flush();
  }

  function renderStats() {
    var vis = visible(), st = SRS.stats(vis, progress);
    $('stAcc').textContent = st.answered ? Math.round(st.accuracy * 100) + '%' : '–';
    $('stMastered').textContent = st.mastered + '/' + st.total;
    $('stPracticed').textContent = st.practiced;
    $('stAnswered').textContent = st.answered;
    $('toughList').innerHTML = st.tough.map(function (t) {
      var w = words.find(function (x) { return x.word === t.word; });
      return '<li><b>' + starName(w) + '</b> (' + esc(w.answer) + ') — right ' + t.correct + ' of ' + t.seen + '</li>'; }).join('');
    $('toughEmpty').classList.toggle('hidden', st.tough.length > 0);
    $('wordTable').innerHTML = vis.slice().sort(function (a, b) { return b.addedDate.localeCompare(a.addedDate) || a.word.localeCompare(b.word); })
      .map(function (w) {
        var s = progress[w.word];
        return '<tr><td>' + starName(w) + (SRS.isMastered(s) ? ' ✅' : '') + '</td><td>' + (s ? s.correct + '/' + s.seen : '—') +
          '</td><td>' + fmtDate(s && s.lastSeen) + '</td></tr>'; }).join('');
    show('stats');
  }

  function renderDidWords(msg, err) {
    var done = wlog.buttonDone();
    $('btnDidWords').disabled = done;
    $('btnDidWords').textContent = done ? '✅ Words done for today!' : '✅ I did my words today';
    var m = msg || (done ? 'Thanks! Logged for ' + wlog.etDate() + '.' : '');
    $('didWordsMsg').textContent = m;
    $('didWordsMsg').classList.toggle('hidden', !m);
    $('didWordsMsg').classList.toggle('err', !!err);
  }
  function retryQuizEmail() {
    if (quizSending) return;
    var queue = SQ.pendingAll(localStorage);
    if (!queue.length) return;
    quizSending = true;
    // Send every unsent quiz score, oldest first; stop at the first failure and retry later.
    queue.reduce(function (p, item) {
      return p.then(function () { return wlog.quiz(item).then(function () { SQ.clearPending(localStorage, item); }); });
    }, Promise.resolve())
      .catch(function () {})
      .then(function () { quizSending = false; });
  }
  function home() { refreshHome(); renderDidWords(); show('home'); retryQuizEmail(); }
  $('btnDidWords').onclick = function () {
    $('btnDidWords').disabled = true;
    $('didWordsMsg').classList.add('hidden');
    wlog.button().then(function () { renderDidWords('🎉 Thanks! Logged for ' + wlog.etDate() + '.'); })
      .catch(function () { renderDidWords("Couldn't send. Check the internet and tap again.", true); });
  };
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') { wlog.flush(); retryQuizEmail(); }
  });
  window.addEventListener('pagehide', function () { wlog.flush(); retryQuizEmail(); });

  $('btnToday').onclick = function () { start('today'); };
  $('btnReview').onclick = renderMissed;
  $('btnStats').onclick = renderStats;
  $('quitQuiz').onclick = home; $('quitStats').onclick = home; $('btnDoneHome').onclick = home;
  $('quitMissed').onclick = home; $('missedHome').onclick = home;
  $('btnDoneReview').onclick = renderMissed;
  $('btnNext').onclick = renderCard;

  function sentenceHtml(text) {
    return String(text).split(SQ.BLANK).map(function (part, i, arr) {
      return esc(part) + (i < arr.length - 1 ? '<span class="blank">' + esc(SQ.BLANK) + '</span>' : '');
    }).join('');
  }
  function filledHtml(sentence, word, ok) {
    var idx = sentence.indexOf(SQ.BLANK);
    if (idx < 0) return esc(sentence);
    var shown = SQ.fillBlank(sentence, word).slice(idx, idx + String(word).length);
    return esc(sentence.slice(0, idx)) + '<span class="fit ' + (ok ? 'ok' : 'bad') + '">' + esc(shown) + '</span>' + esc(sentence.slice(idx + SQ.BLANK.length));
  }
  function startSentence() {
    var f = SQ.loadFixed(localStorage);
    var set = sentSet && !SQ.isFixedDone(f, sentSet.id) ? sentSet : null;
    sq = set ? { set: set, items: set.items, quizId: set.id, index: SQ.resumeIndex(f, set), answered: false, done: false } : null;
    show('sentence');
    if (!sq) {
      $('sqEmpty').classList.remove('hidden');
      $('sqCard').classList.add('hidden');
      $('sqProgress').textContent = '';
      $('sqBar').style.width = '0%';
      return;
    }
    $('sqEmpty').classList.add('hidden');
    $('sqCard').classList.remove('hidden');
    if (sq.index >= sq.items.length) finishSentence(); else renderSentence();
  }
  function renderSentence() {
    var it = sq.items[sq.index];
    sq.answered = false;
    $('sqMode').textContent = 'Sentence set ' + sq.quizId;
    $('sqProgress').textContent = 'Sentence ' + (sq.index + 1) + ' of ' + sq.items.length;
    $('sqBar').style.width = (sq.index / sq.items.length * 100) + '%';
    $('sqSentence').innerHTML = sentenceHtml(it.sentence);
    $('sqFeedback').classList.add('hidden');
    var box = $('sqChoices'); box.innerHTML = '';
    SRS.shuffle(it.choices).forEach(function (c, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'choice';
      b.innerHTML = '<span class="letter">' + LETTERS[i] + '</span><span>' + esc(c) + '</span>';
      b.dataset.value = c;
      b.onclick = function () { gradeSentence(c, b); };
      box.appendChild(b);
    });
  }
  function gradeSentence(choice, btn) {
    if (!sq || sq.answered || sq.done) return;
    var it = sq.items[sq.index];
    var res = SQ.answerFixed(localStorage, sq.set, sq.index, choice); // one attempt per item, saved right away
    if (!res) { sq.index = SQ.resumeIndex(SQ.loadFixed(localStorage), sq.set); return sq.index >= sq.items.length ? finishSentence() : renderSentence(); }
    sq.answered = true;
    var ok = res.ok, bw = SQ.bankWord(words, it.word);
    if (bw && SQ.noteQuizResult(progress, bw.word, ok, SRS.record)) SRS.save(localStorage, progress);
    if (bw) SQ.logAttempt(localStorage, { word: bw.word, ok: ok, ms: 0, attempt: 1, ts: Date.now(), kind: 'sentence' });
    Array.prototype.forEach.call($('sqChoices').children, function (b) {
      b.disabled = true;
      if (b.dataset.value === it.answer) b.classList.add('correct');
    });
    if (!ok) { btn.classList.add('wrong'); $('sqCard').classList.add('shake'); } else btn.classList.add('pop');
    setTimeout(function () { $('sqCard').classList.remove('shake'); }, 400);
    var cheers = ['Awesome! 🎉', 'Nailed it! 💪', 'Correct! ⭐', 'Yes! 🙌', 'Great job! 🚀'];
    $('sqVerdict').textContent = ok ? cheers[Math.floor(Math.random() * cheers.length)] : 'Not quite — the word is "' + it.answer + '".';
    $('sqVerdict').className = 'verdict ' + (ok ? 'ok' : 'bad');
    $('sqFilled').innerHTML = filledHtml(it.sentence, it.answer, ok);
    $('sqMeaning').textContent = bw ? bw.definition : '';
    $('sqMeaningRow').classList.toggle('hidden', !bw);
    $('sqNext').textContent = sq.index + 1 >= sq.items.length ? 'See my score' : 'Next →';
    $('sqFeedback').classList.remove('hidden');
    $('sqNext').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  function finishSentence() {
    if (!sq || sq.done) return;
    sq.done = true;
    var sc = SQ.fixedScore(SQ.loadFixed(localStorage), sq.set);
    var total = sc.total, r = sc.correct, pct = total ? r / total : 0;
    var missedKeys = sc.missed.map(function (m) { var bw = SQ.bankWord(words, m); return bw ? bw.word : String(m).toUpperCase(); });
    var payload = {
      date_et: wlog.etDate(), time_et: wlog.etTime(), week: sq.quizId,
      score: r + '/' + total, correct: r, total: total,
      missed: missedKeys.join(', ') || 'none', missed_count: missedKeys.length
    };
    // Lock the set forever first (TRTL-14); results are only queued/sent the first time it locks.
    var first = SQ.completeFixed(localStorage, sq.set, { date_et: payload.date_et, correct: r, total: total });
    if (first) SQ.markCompleted(localStorage, sq.quizId, payload);
    // Coda Stars: fire-and-forget; errors are swallowed inside postQuizEvent and never block the UI.
    if (first) try {
      SQ.postQuizEvent(typeof fetch !== 'undefined' ? fetch : null, SQ.quizEvent(KID, sq.quizId, r, total, payload.date_et)).catch(function () {});
    } catch (e) {}
    $('sqDoneScore').textContent = r + ' / ' + total;
    $('sqDoneEmoji').textContent = pct >= 0.9 ? '🏆' : pct >= 0.7 ? '🎉' : pct >= 0.5 ? '👍' : '💪';
    $('sqDoneTitle').textContent = pct >= 0.9 ? 'Superstar!' : pct >= 0.7 ? 'Nice work!' : pct >= 0.5 ? 'Good effort!' : 'Keep practicing!';
    $('sqDoneMsg').textContent = sc.missed.length ? 'Missed words are in "My missed words" to study.' : 'You filled every blank!';
    $('sqDoneMissed').innerHTML = sc.missed.length ? '<ul class="missedlist">' + sc.missed.map(function (m) {
      var bw = SQ.bankWord(words, m);
      return '<li><b>' + (bw ? starName(bw) : esc(m)) + '</b>' + (bw ? ' — ' + esc(bw.definition) : '') + '</li>';
    }).join('') + '</ul>' : '';
    $('sqDoneReview').classList.toggle('hidden', SRS.reviewWords(visible(), progress).length === 0);
    $('sqLogMsg').classList.remove('err');
    show('sentenceDone');
    sentSet = null; loadSentenceSet(); // look for the next Muse-supplied set (never the one just finished)
    if (!first) { $('sqLogMsg').textContent = ''; return; }
    $('sqLogMsg').textContent = 'Sending the score…';
    quizSending = true;
    wlog.quiz(payload).then(function () {
      SQ.clearPending(localStorage, payload);
      $('sqLogMsg').textContent = 'Logged for ' + payload.date_et + '.';
    }).catch(function () {
      $('sqLogMsg').textContent = 'Score saved on this device. The email will send when you are back online.';
      $('sqLogMsg').classList.add('err');
    }).then(function () { quizSending = false; });
  }

  $('btnSentence').onclick = startSentence;
  $('quitSentence').onclick = home;
  $('sqEmptyHome').onclick = home;
  $('sqDoneHome').onclick = home;
  $('sqDoneReview').onclick = renderMissed;
  $('sqNext').onclick = function () {
    if (!sq) return;
    sq.index++;
    if (sq.index >= sq.items.length) finishSentence();
    else renderSentence();
  };

  fetch('words.json?v=' + Date.now(), { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (data) { words = data; home(); loadSentenceSet(); })
    .catch(function () {
      $('homeSummary').textContent = 'Could not load words.json — check your connection and refresh.';
      $('sentencePrompt').textContent = 'Words did not load, so the sentence set cannot start yet.';
      $('btnSentence').disabled = true;
    });
})();
