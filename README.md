# Luke's Word Power: ISEE synonym flashcards

Static site (no backend). Files: index.html, style.css, app.js (UI), srs.js (spaced repetition), words.json (word list).
Progress is stored in the browser's localStorage under `luke-isee-progress-v1`, per device and per site URL.

- Test: `node test.js`
- Local preview: `python3 -m http.server 8765` then open http://127.0.0.1:8765/
- Add a day's words: `python3 add_words.py new_words.json` (validates, skips duplicates, sets addedDate=today)
- Publish: `DEPLOY_DIR=/path/to/pages-repo ./deploy.sh`

The newest addedDate batch is "Today's 20". A miss sends a word to box 0, so it's due again right away and also comes back 3 cards later in the same session.
Each right answer moves it up a box: due again in 1, 2, 4, 8, then 16 days. Right 3 times in a row counts as mastered.
