# Luke's Word Power: ISEE synonym flashcards

Static site (no backend). Files: index.html, style.css, app.js (UI), srs.js (spaced repetition), sentencequiz.js (sentence quiz, Mon/Wed/Fri), words.json (word list).
Progress is stored in the browser's localStorage under `luke-isee-progress-v1`, per device and per site URL.

- Test: `node test.js`
- Local preview: `python3 -m http.server 8765` then open http://127.0.0.1:8765/
- Add a set: `python3 add_words.py new_words.json` (validates, skips duplicates, sets addedDate=today, set=next L-0NN, order=next)
- Publish: `./deploy.sh` (tests, then pushes to github.com/eddiecoda/luke-words; GitHub Pages serves https://eddiecoda.github.io/luke-words/)

Word sets: every card has `set` (string id) and `order` (number). The original daily batches use their addedDate as the set id; the bank of
upcoming sets is L-001, L-002, ... "Current set" (stored in localStorage `luke-isee-sets-v1`) starts at the newest dated batch and moves to the
next unfinished set in order as soon as every card in it has been answered right at least once (any mode, retries count). The app then shows
"Set done! New words unlocked". Later bank sets stay hidden from Mix/Review/Stats until reached. When the bank runs out it stays on the last set and
shows "New words coming soon"; add more sets with add_words.py (each run = the next L-0NN set) and it moves on automatically.

Coda Stars hook: on `opened` (first time a set is opened that ET day) and `completed`, the app POSTs JSON (sent as text/plain to avoid a CORS
preflight) to https://coda-kids-app.vercel.app/api/vocab/event: {kid: 'luke', event, set, next_set, answered, right, date_et}. Fire-and-forget:
errors are swallowed and never block the UI.

A miss sends a word to box 0, so it's due again right away and also comes back 3 cards later in the same session.
Each right answer moves it up a box: due again in 1, 2, 4, 8, then 16 days. Right 3 times in a row counts as mastered.

Daily words log (wordlog.js): each device sends one cumulative record per day (ET) to FormSubmit, which emails codafamily@mail.grokbot.com
with subject `WORDS LOG <Kid> <YYYY-MM-DD> auto|button`. Auto records go out when the current set is opened, when every card in it has a first
answer today / a session finishes, and when the page is hidden, only if the numbers changed. The "I did my words today" button sends source=button.
Fields: kid, date_et, time_et, source, set (id of the set worked today, e.g. 2026-10-24 or L-001), set_size, opened_set, answered, right (first try of the day), completed_all, button_tapped_today.

Sentence quiz (sentencequiz.js), 3 times a week: a quiz opens on each day in `QUIZ_DAYS` (`[1, 3, 5]` = Monday, Wednesday, Friday, America/New_York; change that one constant) and stays on the home screen with a Ready badge until Luke finishes it. Its id (`quiz_id`) is the date of the quiz day it belongs to. If an older quiz is still unfinished when the next quiz day arrives, the newer quiz replaces it. When he's done, the home screen says which day the next one opens ("The next one opens Wednesday."). It is 10–15 fill-in-the-blank sentences, worst words first. The tough-word window is since the previous quiz day (Wednesday's quiz looks back to Monday; Monday's to the Friday before). A word in that window counts as tough if he missed it, needed another try in the same session, or took at least `SLOW_MS` (20 seconds). If there are fewer than 10 tough words, it tops up with other words he saw in the window, then recent words (his current set, then the previous set, least-known first), then words added in the window. He taps a word from the quiz's word bank or types it (case and extra spaces don't matter). A miss is sent through the normal flashcard recorder, so the word goes to box 0 and comes back in Review. When he finishes, FormSubmit sends subject `WORDS LOG <Kid> <YYYY-MM-DD> quiz` with fields kid, date_et, time_et, source (`quiz`), week (the quiz id, i.e. the quiz day's date), score (`8/12`), correct, total, missed (comma-separated words, or `none`), missed_count. That send does not change the daily auto/button log. It also fires a Coda Stars POST (text/plain body, JSON) to https://coda-kids-app.vercel.app/api/vocab/event: `{kid: 'luke', event: 'quiz_completed', quiz_id: 'YYYY-MM-DD', correct, total, date_et}`. Fire-and-forget: every error (network, 400 while the server side deploys, etc.) is swallowed and never blocks the UI.

Each word in words.json should include a context sentence. The blank is exactly five underscores (`_____`) and stands in for `word`. Don't also write that word, or any other listed word, in the sentence. Example:

```json
"sentence": "The garden grew an _____ crop of tomatoes, far more than the family could eat."
```

If `sentence` is missing or has no blank, the quiz uses the definition as the clue instead (`Which word means "…"? _____`). `node test.js` still expects every current word to have a sentence, so a new day's list should include one before it ships.

Installable PWA: manifest.json (PNG icons 192/512 + maskable 512, scope/start_url = the repo subpath), apple-touch-icon.png (180), and sw.js
(network-first for index.html and words.json; never touches POSTs or cross-origin requests such as formsubmit.co). Bump VERSION in sw.js and the ?v= in index.html when changing it.
Icons were rendered from icon.svg with headless Chrome.
