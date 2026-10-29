# Luke's Word Power: ISEE synonym flashcards

Static site (no backend). Files: index.html, style.css, app.js (UI), srs.js (spaced repetition), sentencequiz.js (weekly sentence quiz), words.json (word list).
Progress is stored in the browser's localStorage under `luke-isee-progress-v1`, per device and per site URL.

- Test: `node test.js`
- Local preview: `python3 -m http.server 8765` then open http://127.0.0.1:8765/
- Add a day's words: `python3 add_words.py new_words.json` (validates, skips duplicates, sets addedDate=today)
- Publish: `./deploy.sh` (tests, then pushes to github.com/eddiecoda/luke-words; GitHub Pages serves https://eddiecoda.github.io/luke-words/)

The newest addedDate batch is "Today's 20". A miss sends a word to box 0, so it's due again right away and also comes back 3 cards later in the same session.
Each right answer moves it up a box: due again in 1, 2, 4, 8, then 16 days. Right 3 times in a row counts as mastered.

Daily words log (wordlog.js): each device sends one cumulative record per day (ET) to FormSubmit, which emails codafamily@mail.grokbot.com
with subject `WORDS LOG <Kid> <YYYY-MM-DD> auto|button`. Auto records go out when Today's set is opened, when every card in it has a first
answer today / a session finishes, and when the page is hidden, only if the numbers changed. The "I did my words today" button sends source=button.
Fields: kid, date_et, time_et, source, set (newest addedDate), set_size, opened_set, answered, right (first try of the day), completed_all, button_tapped_today.

Weekly sentence quiz (sentencequiz.js): opens on `QUIZ_DAY` (0 = Sunday; change that one constant) and stays on the home screen with a Ready badge until Luke finishes it. It is 10–15 fill-in-the-blank sentences, worst words first. A word from that week counts as tough if he missed it, needed another try in the same session, or took at least `SLOW_MS` (20 seconds). If there are fewer than 10 tough words, the rest are other words he saw that week, then words added that week. He taps a word from the quiz's word bank or types it (case and extra spaces don't matter). A miss is sent through the normal flashcard recorder, so the word goes to box 0 and comes back in Review. When he finishes, FormSubmit sends subject `WORDS LOG <Kid> <YYYY-MM-DD> quiz` with fields kid, date_et, time_et, source (`quiz`), week (the quiz day's date), score (`8/12`), correct, total, missed (comma-separated words, or `none`), missed_count. That send does not change the daily auto/button log.

Each word in words.json should include a context sentence. The blank is exactly five underscores (`_____`) and stands in for `word`. Don't also write that word, or any other listed word, in the sentence. Example:

```json
"sentence": "The garden grew an _____ crop of tomatoes, far more than the family could eat."
```

If `sentence` is missing or has no blank, the quiz uses the definition as the clue instead (`Which word means "…"? _____`). `node test.js` still expects every current word to have a sentence, so a new day's list should include one before it ships.

Installable PWA: manifest.json (PNG icons 192/512 + maskable 512, scope/start_url = the repo subpath), apple-touch-icon.png (180), and sw.js
(network-first for index.html and words.json; never touches POSTs or cross-origin requests such as formsubmit.co). Bump VERSION in sw.js and the ?v= in index.html when changing it.
Icons were rendered from icon.svg with headless Chrome.
