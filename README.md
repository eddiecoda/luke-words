# Luke's Word Power: ISEE synonym flashcards

Static site (no backend). Files: index.html, style.css, app.js (UI), srs.js (spaced repetition), words.json (word list).
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
