# Luke's Word Power: ISEE synonym flashcards

Static site (no backend). Files: index.html, style.css, app.js (UI), srs.js (spaced repetition + sets), sentencequiz.js (Muse sentence sets), sentence_sets/ (set files + index.json), words.json (word list).
Progress is stored in the browser's localStorage under `luke-isee-progress-v1`, per device and per site URL.

- Test: `node test.js`
- Local preview: `python3 -m http.server 8765` then open http://127.0.0.1:8765/
- Add a set: `python3 add_words.py new_words.json` (validates, skips duplicates, sets addedDate=today, set=next L-0NN, order=next)
- Publish: `./deploy.sh` (tests, then pushes to github.com/eddiecoda/luke-words; GitHub Pages serves https://eddiecoda.github.io/luke-words/)

Word sets: every card has `set` (string id) and `order` (number). The original daily batches use their addedDate as the set id; the bank of
upcoming sets is L-001, L-002, ... "Current set" (stored in localStorage `luke-isee-sets-v1`) starts at the newest dated batch and moves to the
next unfinished set in order as soon as every card in it has been answered right at least once IN THAT SET (retries count). The app then shows
"Set done! New words unlocked". Later bank sets stay hidden from the missed list/Stats until reached. When the bank runs out, nothing is served ("New words coming soon"); add more sets and it moves on automatically.

NO REPEATS (TRTL-14, Nov 23 2026): a completed word set is never served again. `SRS.servableCards` returns no cards when the current set is completed, a session ends as soon as it completes its set (the rest of that set's cards are not re-served), and there is no path back into a completed set. There is no Mix mode and no Reset button (`SRS.reset` was removed). On every set completion the existing WORDS LOG auto record (completed_all) and the Coda Stars `completed` event go out as before; Muse supplies the next sets.

PER-SET COMPLETION (TRTL-17, Nov 23 2026): answers are tracked per set in `luke-isee-sets-v1` as `setRight: {setId: {word: true|false}}`. A card counts toward a set only if answered right in that set; SRS stats (`progress`), mastery and the legacy flat `right` map never count. `SRS.servableCards` serves every card of the current set not yet right in that set, mastered or not (leaving midway resumes with only the remaining cards), and `SRS.daySet` (WORDS LOG) reports the whole set. So a Muse retest set made of known words (e.g. L-012, Nov 23: WITTY + retest-pool words + fresh words, moved from earlier sets; old L-012..L-039 became L-013..L-040) starts at 0/20 and is fully served.

Missed words (TRTL-16): "My missed words" is a READ-ONLY study list: each word that `SRS.reviewWords` returns (unlocked sets) with its definition. No questions, no answering, no scoring. Missed words are retested only in TRTL forms and inside new Muse-supplied sets.

Coda Stars hook: on `opened` (first time a set is opened that ET day) and `completed`, the app POSTs JSON (sent as text/plain to avoid a CORS
preflight) to https://coda-kids-app.vercel.app/api/vocab/event: {kid: 'luke', event, set, next_set, answered, right, date_et}. Fire-and-forget:
errors are swallowed and never block the UI.

A miss sends a word to box 0, so it's due again right away and also comes back 3 cards later in the same session.
Each right answer moves it up a box: due again in 1, 2, 4, 8, then 16 days. Right 2 times in a row counts as mastered (shown in Stats; mastered words leave the missed list).

Daily words log (wordlog.js): each device sends one cumulative record per day (ET) to FormSubmit, which emails codafamily@mail.grokbot.com
with subject `WORDS LOG <Kid> <YYYY-MM-DD> auto|button`. Auto records go out when the current set is opened, when every card in it has a first
answer today / a session finishes, and when the page is hidden, only if the numbers changed. The "I did my words today" button sends source=button.
Fields: kid, date_et, time_et, source, set (id of the set worked today, e.g. 2026-10-24 or L-001), set_size, opened_set, answered, right (first try of the day), completed_all, button_tapped_today.

Sentence sets (TRTL-15, replaces the dynamic tough-word quiz and TRTL-13's repeatable quiz): Muse supplies each set as a file in `sentence_sets/`, listed in order in `sentence_sets/index.json` (`{"sets":[{"id":"APP-SENT-2026-11-23","file":"app_sentence_set_2026-11-23.json"}]}`). **To publish a new set: add the file and append an index entry; nothing else changes** (`node test.js` validates every listed file). Format: TEST INNOVATORS VR style, one `_____` blank, 4 single-word choices; each item has word, sentence, choices[4], answer (scored against `answer`, which may be inflected, e.g. enthralled). The app serves the earliest set in the index not yet completed on the device; one try per sentence, answers saved as he goes (leaving mid-set resumes, no re-asking). A finished set is locked forever in localStorage `luke-sentence-sets-v1` and never served again; when none remain the card says "No new sentence set yet". A miss on an item whose word is in words.json goes through `SRS.record(word, false)`. On finishing, the same results as the old quiz go out: FormSubmit `WORDS LOG Luke <date> quiz` (kid, date_et, time_et, source=quiz, week = set id, score, correct, total, missed, missed_count) and Coda Stars `{kid:'luke', event:'quiz_completed', quiz_id:<set id>, correct, total, date_et}`. Unsent emails stay queued in `luke-sentence-quiz-v1` and retry later. The old dynamic builder (buildQuiz) is still in sentencequiz.js only for its unit tests; the app no longer uses it.

Tests: `node test.js`. Two checks were relaxed for the Muse-built bank (words.json is not edited by the app code): stems may be `PREFIX: …` / `ROOT: …` cards, and cross-word sentence leaks are reported as a WARN instead of failing.

Each word in words.json should include a context sentence. The blank is exactly five underscores (`_____`) and stands in for `word`. Don't also write that word, or any other listed word, in the sentence. Example:

```json
"sentence": "The garden grew an _____ crop of tomatoes, far more than the family could eat."
```

If `sentence` is missing or has no blank, the quiz uses the definition as the clue instead (`Which word means "…"? _____`). `node test.js` still expects every current word to have a sentence, so a new day's list should include one before it ships.

Installable PWA: manifest.json (PNG icons 192/512 + maskable 512, scope/start_url = the repo subpath), apple-touch-icon.png (180), and sw.js
(network-first for index.html, words.json, JS/CSS and sentence_sets/*; never touches POSTs or cross-origin requests such as formsubmit.co). Bump VERSION in sw.js and the ?v= in index.html when changing it.
Icons were rendered from icon.svg with headless Chrome.
