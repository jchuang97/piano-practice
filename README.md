# 🎹 Piano Practice

A kid-friendly piano practice web app (in the spirit of Simply Piano) where a
grown-up can type in **any** song. Works offline, no build step, no accounts.

- Real sheet music (abcjs, vendored in `js/vendor/`), big and clear, with
  coloured **Do Re Mi** names under the notes and **finger numbers** above them.
- A pink line walks over the music at the song's tempo and **waits** at each note
  until it is played. Right notes turn green; wrong notes blink orange (no harsh sounds).
- Listens through the **microphone** (acoustic or digital piano), or a **USB MIDI
  keyboard** on desktop Chrome, or taps on the **on-screen keyboard**.
- After 3 wrong tries: the right key glows, a hint explains where it is
  ("Use finger 2 (index) on Fa# (Fa sostenido) — it's the BLACK key just to the right of Fa…").
- Slows down automatically when it gets hard, speeds up again after a streak.
- Wait-for-me / Play-along modes, loop bars, metronome, celebration screen.

## Run it

It is a folder of static files. Any of these works:

| Where | How | Microphone? |
|---|---|---|
| This computer | `python3 serve.py` → open http://localhost:8000 | ✅ (localhost counts as secure) |
| Tablet on the same Wi-Fi | `python3 serve.py --https` → open the printed `https://…:8443` address on the tablet and accept the certificate warning once | ✅ |
| Any web host with **https** (GitHub Pages, Netlify, Cloudflare Pages, your own server) | upload the folder (or `piano-practice.zip` contents) | ✅ |
| Double-clicking `index.html` | works for on-screen keys; microphone depends on the browser | ⚠️ |

Browsers only allow the microphone on `https://` pages or `http://localhost`.

**iPad:** open the https address in Safari, tap **▶ Start**, allow the microphone.
Tip: Share → *Add to Home Screen* makes it open full-screen like an app.

## Writing songs (Simple format)

```
title: Lazy Song
tempo: 60
time: 3/4
look: open
Si4/5 Fa#4/2 Mi4/1 | Si4/5 Fa#4/2 Mi4/1 |
Si4/5 Fa#4/2 Mi4/1 | Si4/5 Re#4/1 Mi4/2 |
```

- **Note** = name + octave number: `Do4 Re4 Mi4 Fa4 Sol4 La4 Si4`, then `Do5`.
  `Do4` is middle C. Letter names also work: `C4 D4 E4 F4 G4 A4 B4`.
- **Sharp / flat:** `#` = sostenido (`Fa#4`), `b` = bemol (`Sib4`, `Bb4`).
- **Length** (optional, default quarter): `w` whole (4 beats), `h` half (2),
  `q` quarter (1), `e` eighth (½), `s` sixteenth; a dot makes it dotted: `h.`.
  Write it after the note: `Do4 h` or `Do4h`.
- **Finger** (optional): `/` + 1–5 after the note: `Si4/5` or `Si4/5 q`
  (1 thumb, 2 index, 3 middle, 4 ring, 5 pinky). Left hand: `Do3/5L`.
- `|` = bar line, `R` = rest (`R h`). Commas/new lines optional. `//` = comment.
- Optional top lines: `title:`, `tempo:` (beats per minute), `time:` (4/4, 3/4, 6/8…),
  `key:` (e.g. `G`; still write the sharps: `Fa#4`), `clef: bass`,
  `look: open` (round notes without stems, like a hand-written teacher's sheet),
  and a line starting with `LH:` for a left-hand part (grand staff).

**ABC notation** is also accepted (choose "ABC" in the editor); finger numbers are `!1!`…`!5!`.
MusicXML files (uncompressed `.musicxml`/`.xml`) can be imported into the simple format.

Songs live in the browser's storage on that device: use **Download all songs (backup)**
in ⚙️ → Songs, and **Load a backup file** to restore or move them.

## Code map

| File | What it does |
|---|---|
| `index.html`, `css/app.css` | screens and styles (iPad landscape first) |
| `js/pitch.js` | YIN pitch detector + note tracker (stability, onset/debounce, octave-slip guard). Pure JS, also runs in Node |
| `js/music.js` | note names (solfège/letters), hint texts, simple-format parser → ABC, MusicXML import |
| `js/songs.js` | built-in songs, settings defaults, localStorage, backup |
| `js/audio.js` | AudioContext (iOS unlock), microphone (all voice filters OFF), soft sounds, Web MIDI |
| `js/score.js` | renders with abcjs, maps notes to screen positions, cursor, colours, labels |
| `js/keyboard.js` | on-screen keyboard |
| `js/hand.js` | hand diagram SVG with the finger highlighted |
| `js/practice.js` | practice engine: wait / play-along, hints, adaptive tempo, loop |
| `js/editor.js` | grown-ups' song editor with live preview |
| `js/app.js` | screens, settings, input routing, feedback, end screen |

## Tests

```
python3 -m http.server 8765 &          # from this folder
node tests/format-test.js              # song format unit tests
node tests/pitch-test.js               # pitch detector on synthetic piano tones
node tests/make-wavs.js && node tests/mic-e2e.js   # full mic pipeline in Chrome (fake mic)
node tests/e2e.js                      # UI end-to-end in headless Chrome
```
(The browser tests need `playwright-core` — `cd tools && npm i` — and Chrome at `/usr/bin/google-chrome`.)

abcjs is © Paul Rosen and Gregory Dyke, MIT licence (`js/vendor/abcjs-LICENSE.md`).
