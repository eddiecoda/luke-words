(function () {
  var $ = function (id) { return document.getElementById(id); };
  var words = [], progress = SRS.load(localStorage), session = null, sessionMode = '', answered = false, cardStarted = 0;
  var sq = null, quizSending = false;
  var SQ = SentenceQuiz;
  var LETTERS = ['A', 'B', 'C', 'D'];
  var wlog = WordLog.create({ kid: 'Luke', storage: localStorage, keyFn: function (w) { return w.word; },
    setFn: function () { return SRS.todaysWords(words, todayStr()); } });

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function show(id) {
    ['home', 'quiz', 'done', 'stats', 'sentence', 'sentenceDone'].forEach(function (s) { $(s).classList.toggle('hidden', s !== id); });
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
    var t = SRS.todaysWords(words, todayStr()), r = SRS.reviewWords(words, progress), st = SRS.stats(words, progress);
    $('todayCount').textContent = t.length;
    $('reviewCount').textContent = r.length;
    $('allCount').textContent = words.length;
    $('btnReview').disabled = r.length === 0;
    var newest = t.length ? t[0].addedDate : '';
    $('homeSummary').innerHTML = words.length
      ? 'You have <b>' + words.length + '</b> words. <b>' + st.mastered + '</b> mastered so far' +
        (st.answered ? ', <b>' + Math.round(st.accuracy * 100) + '%</b> accuracy.' : '. Start with Today\'s 20!') +
        (newest ? '<br><span class="small">Newest words added ' + esc(newest) + '</span>' : '')
      : 'No words found.';
    updateSentenceCard();
  }

  function updateSentenceCard() {
    var ready = SQ.isAvailable(SQ.loadState(localStorage), new Date());
    var day = SQ.dayName();
    var built = words.length ? SQ.buildQuiz(words, SQ.loadAttempts(localStorage), new Date(), progress) : null;
    $('sentenceBadge').textContent = ready ? 'Ready' : 'Done';
    $('sentenceBadge').className = ready ? 'badge-ready' : 'badge-done';
    $('btnSentence').disabled = !ready;
    $('btnSentence').textContent = ready
      ? (built && built.items.length ? 'Start quiz · ' + built.items.length + ' words' : 'Start quiz')
      : 'Finished this week';
    $('sentencePrompt').textContent = ready
      ? 'Fill in the blanks with the words that gave you trouble this week. The toughest ones come first, and it stays open until you finish it.'
      : 'You finished this week\'s quiz. The next one opens ' + day + '.';
  }

  function start(mode) {
    var list;
    if (mode === 'today') list = SRS.shuffle(SRS.todaysWords(words, todayStr()));
    else if (mode === 'review') list = SRS.reviewWords(words, progress).slice(0, 20);
    else {
      // Mix: words not mastered first (weighted toward low boxes), then a few mastered ones.
      var notM = words.filter(function (w) { return !SRS.isMastered(progress[w.word]); });
      var m = words.filter(function (w) { return SRS.isMastered(progress[w.word]); });
      list = SRS.shuffle(notM).concat(SRS.shuffle(m).slice(0, 3)).slice(0, 20);
      list = SRS.shuffle(list);
    }
    if (!list.length) return;
    if (mode === 'today') wlog.openedSet();
    sessionMode = mode;
    session = new SRS.Session(list);
    $('modeLabel').textContent = { today: "📅 Today's 20", review: '🔁 Review', all: '🎲 Mix' }[mode];
    show('quiz');
    renderCard();
  }

  function renderCard() {
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
    if (first) { SRS.record(progress, w.word, ok); SRS.save(localStorage, progress); wlog.answered(w.word, ok); }
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
    $('doneMsg').textContent = missed.length ? 'Missed words will show up in "Review missed words" until you get them.' : 'You got every word on the first try!';
    $('doneMissed').innerHTML = missed.length ? '<ul class="missedlist">' + missed.map(function (k) {
      var w = words.find(function (x) { return x.word === k; });
      return '<li><b>' + starName(w) + '</b> = ' + esc(w.answer) + '</li>'; }).join('') + '</ul>' : '';
    $('btnDoneReview').classList.toggle('hidden', SRS.reviewWords(words, progress).length === 0);
    show('done');
    wlog.flush();
  }

  function renderStats() {
    var st = SRS.stats(words, progress);
    $('stAcc').textContent = st.answered ? Math.round(st.accuracy * 100) + '%' : '–';
    $('stMastered').textContent = st.mastered + '/' + st.total;
    $('stPracticed').textContent = st.practiced;
    $('stAnswered').textContent = st.answered;
    $('toughList').innerHTML = st.tough.map(function (t) {
      var w = words.find(function (x) { return x.word === t.word; });
      return '<li><b>' + starName(w) + '</b> (' + esc(w.answer) + ') — right ' + t.correct + ' of ' + t.seen + '</li>'; }).join('');
    $('toughEmpty').classList.toggle('hidden', st.tough.length > 0);
    $('wordTable').innerHTML = words.slice().sort(function (a, b) { return b.addedDate.localeCompare(a.addedDate) || a.word.localeCompare(b.word); })
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
    var pending = SQ.pending(localStorage);
    if (!pending) return;
    quizSending = true;
    wlog.quiz(pending).then(function () { SQ.clearPending(localStorage); })
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
  $('btnReview').onclick = function () { start('review'); };
  $('btnAll').onclick = function () { start('all'); };
  $('btnStats').onclick = renderStats;
  $('quitQuiz').onclick = home; $('quitStats').onclick = home; $('btnDoneHome').onclick = home;
  $('btnDoneReview').onclick = function () { start('review'); };
  $('btnNext').onclick = renderCard;
  $('btnReset').onclick = function () {
    if (confirm('Erase all of Luke\'s progress on this device? This can\'t be undone.')) {
      SRS.reset(localStorage); SQ.reset(localStorage); progress = {}; home();
    }
  };

  function sentenceHtml(text) {
    return String(text).split(SQ.BLANK).map(function (part, i, arr) {
      return esc(part) + (i < arr.length - 1 ? '<span class="blank">' + esc(SQ.BLANK) + '</span>' : '');
    }).join('');
  }
  function filledHtml(sentence, word, ok) {
    var shown = SQ.fillBlank(sentence, word);
    var idx = sentence.indexOf(SQ.BLANK);
    if (idx < 0) return esc(shown);
    var pretty = SQ.fillBlank(sentence, word).slice(idx, idx + word.length);
    return esc(sentence.slice(0, idx)) + '<span class="fit ' + (ok ? 'ok' : 'bad') + '">' + esc(pretty) + '</span>' + esc(sentence.slice(idx + SQ.BLANK.length));
  }
  function startSentence() {
    if (!SQ.isAvailable(SQ.loadState(localStorage), new Date())) return;
    var built = SQ.buildQuiz(words, SQ.loadAttempts(localStorage), new Date(), progress);
    sq = { items: built.items, index: 0, correct: 0, missed: [], weekId: built.weekId, bank: SRS.shuffle(built.items.map(function (w) { return w.word; })), answered: false, done: false };
    show('sentence');
    if (!sq.items.length) {
      $('sqEmpty').classList.remove('hidden');
      $('sqCard').classList.add('hidden');
      $('sqProgress').textContent = '';
      $('sqBar').style.width = '0%';
      return;
    }
    $('sqEmpty').classList.add('hidden');
    $('sqCard').classList.remove('hidden');
    renderSentence();
  }
  function renderSentence() {
    var w = sq.items[sq.index];
    var clue = SQ.clueFor(w);
    sq.answered = false;
    $('sqProgress').textContent = 'Sentence ' + (sq.index + 1) + ' of ' + sq.items.length;
    $('sqBar').style.width = (sq.index / sq.items.length * 100) + '%';
    $('sqCard').dataset.word = w.word;
    $('sqFallback').classList.toggle('hidden', !clue.fallback);
    $('sqSentence').innerHTML = sentenceHtml(clue.text);
    $('sqSentence').dataset.clue = clue.text;
    $('sqInput').value = '';
    $('sqInput').disabled = false;
    $('sqSubmit').disabled = false;
    $('sqFeedback').classList.add('hidden');
    var bank = $('sqBank');
    bank.innerHTML = '';
    sq.bank.forEach(function (word) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = word;
      b.onclick = function () { gradeSentence(word, b); };
      bank.appendChild(b);
    });
  }
  function gradeSentence(raw) {
    if (!sq || sq.answered) return;
    if (!SQ.normalizeAnswer(raw)) {
      $('sqCard').classList.add('shake');
      setTimeout(function () { $('sqCard').classList.remove('shake'); }, 400);
      $('sqInput').focus({ preventScroll: true });
      return;
    }
    sq.answered = true;
    var w = sq.items[sq.index];
    var clue = SQ.clueFor(w);
    var ok = SQ.answersMatch(raw, w.word);
    if (ok) sq.correct++; else sq.missed.push(w.word);
    if (SQ.noteQuizResult(progress, w.word, ok, SRS.record)) SRS.save(localStorage, progress);
    SQ.logAttempt(localStorage, { word: w.word, ok: ok, ms: 0, attempt: 1, ts: Date.now(), kind: 'sentence' });
    $('sqInput').disabled = true;
    $('sqSubmit').disabled = true;
    Array.prototype.forEach.call($('sqBank').children, function (b) {
      b.disabled = true;
      if (b.textContent === w.word) b.classList.add('correct');
      else if (!ok && SQ.answersMatch(raw, b.textContent)) b.classList.add('wrong');
    });
    if (!ok) $('sqCard').classList.add('shake');
    setTimeout(function () { $('sqCard').classList.remove('shake'); }, 400);
    var cheers = ['Awesome! 🎉', 'Nailed it! 💪', 'Correct! ⭐', 'Yes! 🙌', 'Great job! 🚀'];
    $('sqVerdict').textContent = ok ? cheers[Math.floor(Math.random() * cheers.length)] : 'Not quite — the word is ' + w.word + '.';
    $('sqVerdict').className = 'verdict ' + (ok ? 'ok' : 'bad');
    $('sqFilled').innerHTML = filledHtml(clue.text, w.word, ok);
    $('sqMeaning').textContent = w.definition;
    $('sqNext').textContent = sq.index + 1 >= sq.items.length ? 'See my score' : 'Next →';
    $('sqFeedback').classList.remove('hidden');
    $('sqNext').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  function finishSentence() {
    if (!sq || sq.done) return;
    sq.done = true;
    var total = sq.items.length, r = sq.correct, pct = total ? r / total : 0;
    var payload = {
      date_et: wlog.etDate(), time_et: wlog.etTime(), week: sq.weekId,
      score: r + '/' + total, correct: r, total: total,
      missed: sq.missed.join(', ') || 'none', missed_count: sq.missed.length
    };
    SQ.markCompleted(localStorage, sq.weekId, payload);
    $('sqDoneScore').textContent = r + ' / ' + total;
    $('sqDoneEmoji').textContent = pct >= 0.9 ? '🏆' : pct >= 0.7 ? '🎉' : pct >= 0.5 ? '👍' : '💪';
    $('sqDoneTitle').textContent = pct >= 0.9 ? 'Superstar!' : pct >= 0.7 ? 'Nice work!' : pct >= 0.5 ? 'Good effort!' : 'Keep practicing!';
    $('sqDoneMsg').textContent = sq.missed.length
      ? 'Missed words will show up more often in Review.'
      : 'You filled every blank!';
    $('sqDoneMissed').innerHTML = sq.missed.length ? '<ul class="missedlist">' + sq.missed.map(function (k) {
      var w = words.find(function (x) { return x.word === k; });
      return '<li><b>' + starName(w) + '</b> — ' + esc(w.definition) + '</li>';
    }).join('') + '</ul>' : '';
    $('sqDoneReview').classList.toggle('hidden', !sq.missed.length || SRS.reviewWords(words, progress).length === 0);
    $('sqLogMsg').textContent = 'Sending the score…';
    $('sqLogMsg').classList.remove('err');
    show('sentenceDone');
    quizSending = true;
    wlog.quiz(payload).then(function () {
      SQ.clearPending(localStorage);
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
  $('sqDoneReview').onclick = function () { start('review'); };
  $('sqForm').onsubmit = function (e) { e.preventDefault(); gradeSentence($('sqInput').value); };
  $('sqNext').onclick = function () {
    if (!sq) return;
    sq.index++;
    if (sq.index >= sq.items.length) finishSentence();
    else renderSentence();
  };

  fetch('words.json?v=' + Date.now(), { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (data) { words = data; home(); })
    .catch(function () {
      $('homeSummary').textContent = 'Could not load words.json — check your connection and refresh.';
      $('sentencePrompt').textContent = 'Words did not load, so the quiz cannot start yet.';
      $('btnSentence').disabled = true;
    });
})();
