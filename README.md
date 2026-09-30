# 🎹 Piano Practice

A kid-friendly piano practice web app (in the spirit of Simply Piano) where a
grown-up can type in **any** song. Works offline, no build step, no accounts.

- Real sheet music (abcjs, vendored in `js/vendor/`), big and clear, with
  coloured **Do Re Mi** names under the notes and **finger numbers** above them.
- A pink line walks over the music at the chosen speed (**🎵 Play along**, the default)
  or **waits** at each note (**✋ Wait for me**). Right notes turn green; wrong notes blink
  orange (no harsh sounds).
- **Parts** (play-along): the song is split into parts of whole bars (~6 notes). After
  4 missed notes in a part (grown-ups setting) it gently says *"Let's try that part again,
  a little slower 🐢"*, rewinds to the start of the part, slows one 10 % step (≥ 30 %),
  counts 3-2-1 and replays it. Half the notes right = on to the next part; after 3
  replays it moves on anyway with praise. Little stars per note show the part's progress.
- Listens through the **microphone** (acoustic or digital piano), or a **USB MIDI
  keyboard** on desktop Chrome, or taps on the **on-screen keyboard**.
- After 3 wrong tries: the right key glows, a hint explains where it is
  ("Use finger 2 (index) on Fa# (Fa sostenido) — it's the BLACK key just to the right of Fa…").
- **👂 Listen**: the app plays the song itself (piano-like tone, current speed,
  both hands), moves the pink line, lights each key in the right octave and shows
  the note name. Nothing is scored, the mic is ignored meanwhile, ⏹ stops it, and
  afterwards a big **🎹 Now you try!** button starts practice.
- **3-2-1 Go!** countdown (big animated numbers, soft tick, one per second) every
  time practice starts or resumes; nothing is scored meanwhile; ⏸ / 🏠 / 👂 cancel it
  (grown-ups can switch it or its tick off).
- **🐢 / 🐰 speed buttons** (10 % steps, 30 %–120 %), usable mid-song and
  remembered per song on the device.
- Slows down automatically when it gets hard, speeds up again after good parts
  (but never above the speed picked with 🐢/🐰).
- Wait-for-me never gets stuck: after 8 s without sound (setting) it shows the hint
  (halfway) and then moves on gently.
- **Timing** (grown-ups setting: relaxed / normal / strict, default relaxed):
  how early or late a right note may come; early/late right notes simply count as right.
- ✋ Wait-for-me / 🎵 Play-along modes, loop bars, metronome, celebration screen.

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

## Timing, speed and Listen (details)

**Timing windows** (`TIMING` in `js/practice.js`). Each window is in beats, with a
minimum in milliseconds (whichever is larger), so it grows for slow songs / slow
speeds and still covers the microphone's small delay in fast songs:

| Timing | Play-along: early | Play-along: late | Wait mode: next note early |
|---|---|---|---|
| **Relaxed** (default) | 0.9 beat / ≥ 550 ms | 1.25 beat / ≥ 800 ms | 1.5 beat / ≥ 800 ms |
| Normal | 0.6 beat / ≥ 350 ms | 0.8 beat / ≥ 500 ms | 1.0 beat / ≥ 550 ms |
| Strict | 0.35 beat / ≥ 200 ms | 0.5 beat / ≥ 300 ms | 0.75 beat / ≥ 400 ms |

The late window is never shorter than "until ¼ beat before the note ends", so long
notes stay generous. Example, Mary (90 bpm) at 100 %: relaxed accepts a note from
600 ms early to 833 ms late (the old rule was 267 ms early / 400 ms late, and only
67 ms late for an eighth note); at 50 % speed: 1200 ms / 1667 ms.
In Play-along the right note inside its window always counts (even when the line is
already on the next note); a right note that comes too late is ignored, never
flashed as wrong. Wait mode waits anyway; its window is only for a next note played
while the line is still moving.

**Speed.** 🐢/🐰 set the speed in 10 % steps (30–120 %) and store it per song
(`localStorage` key `pianoPractice.speeds.v1`). A manually chosen speed becomes the
*ceiling* for the automatic speed-up: automatic slow-down still helps when it gets
hard, and after a streak the speed climbs back up only to the chosen speed (100 % if
the buttons were never used). Choosing a speed also resets the mistake counter, so
the app never slows down right after a tap.

**Listen** (`js/listen.js`). Schedules `PP.audio.pianoNote` 0.2 s ahead on the
AudioContext clock (follows speed changes live), plays both staves of a grand staff,
chords, ties and real lengths; rests are silent. The practised hand's keys light
pink (always the right octave when the keyboard fits the song), the other hand's
blue when that exact key is on screen. Taps/MIDI are not scored and the practice
run is reset.

*Microphone and iPad audio:* Listen switches the microphone really **off** (stops the
getUserMedia stream) and sets `navigator.audioSession.type = 'playback'` (Safari 17+);
practice switches it back on (`'play-and-record'` session, set before `getUserMedia`). Reason: on iOS an open microphone
keeps the page in the phone-call style "play-and-record" audio route, where Web Audio
output can become very quiet or silent — in the first version Listen only *ignored*
the mic, so after a practice run (mic on) Listen could be silent on the iPad, while
the first Listen before tapping Start worked. The AudioContext is unlocked in the tap;
if it is closed, "interrupted", or its clock has stopped moving (watchdog in
`audio.checkClock`), a fresh context is created in that tap (a running mic is
reconnected to it). Listen then waits (max 0.8 s) until the context runs.

**Countdown.** `runCountdown()` in `js/app.js`: 3 → 2 → 1 → Go! at 1 s steps, then the
engine starts with a one-beat lead-in (also in play-along). The engine stays idle (or
paused, when resuming) until Go, so mic/MIDI/taps are ignored. Settings `countdown`
and `countdownSound` (both on by default).

## Play-along parts and never getting stuck (details)

**Why the line froze (Sept 2026 report).** "Now you try" started practice in the
then-default *Wait for me* mode, which waited at a note until the microphone heard
it, with no way out (⏸/▶ only paused and resumed the same wait). On the iPad the
microphone could also be silent right after Listen: Listen set
`navigator.audioSession.type = 'playback'` and practice restored `'auto'` just
before `getUserMedia`; WebKit ends/blocks capture when the session isn't
play-and-record, and starting the mic can blip the AudioContext to
"interrupted", which the app treated as "pause". Fixes:
- `audio._startMic` sets the session to `'play-and-record'` before `getUserMedia`.
- A context "interrupted/suspended" blip within 4 s of starting the mic only resumes
  the context (no pause).
- Mic watchdog (`micWatch` in `js/app.js`): a frozen analyser (identical samples for
  1.5 s) or pure digital silence for 4 s during practice → resume the context and
  restart the mic (at most every 15 s), toast "🎤 Listening again".
- Play along is the new default. Saved settings from older versions (no `schema`)
  that say `mode: 'wait'` are switched to play-along once (`schema: 2`); choosing
  Wait for me afterwards is kept.

**Parts** (`_buildSections` in `js/practice.js`): whole bars are grouped until a part
has ≥ 5 notes (or 4 bars); a last part with < 3 notes joins the previous one. Lazy
Song → 2 parts of 2 bars / 6 notes; Mary → parts of 2 bars.
- Every note of a part is scored once: right (in its timing window) or missed.
- `missLimit` (default 4) misses in a part → `_retrySection`: clear the part (and
  everything after it), speed one 10 % step down (floor 30 %), line back to one beat
  before the part, engine paused; the app shows the 🐢 message (2.2 s), a short
  3-2-1 (0.7 s steps, if the countdown is on) and resumes.
- When all notes of a part are decided: ≥ half right → pass (`onSectionPass`, "You
  did it! 🎉" after a replay); if ≤ 1 miss the speed goes one step up, capped at the
  🐢/🐰 ceiling. Otherwise replay, until `sectionRetries` (default 3) replays → move on
  (`onSectionMoveOn`, "Great trying! Let's keep going 🌟").
- With no input at all the song still reaches the end.

**Wait-for-me escape** (`_waitEscape`): quiet time counts from the moment the line
stops at a note; any sound the tracker hears (`engine.activity()`) restarts it, pause
time doesn't count. Hint at half of `waitSkip` (≥ 2.5 s for ≥ 5 s settings), skip at
`waitSkip` s (default 8; also after 2.5 × that in total even if there is noise; 0 = off).
A skipped note is marked like a missed one, "Let's keep going! 🎵".

## Code map

| File | What it does |
|---|---|
| `index.html`, `css/app.css` | screens and styles (iPad landscape first) |
| `js/pitch.js` | YIN pitch detector + note tracker (stability, onset/debounce, octave-slip guard). Pure JS, also runs in Node |
| `js/music.js` | note names (solfège/letters), hint texts, simple-format parser → ABC, MusicXML import |
| `js/songs.js` | built-in songs, settings defaults, localStorage, backup |
| `js/audio.js` | AudioContext (iOS unlock), microphone (all voice filters OFF), soft sounds, piano tone for Listen, Web MIDI |
| `js/score.js` | renders with abcjs, maps notes to screen positions, cursor, colours, labels |
| `js/keyboard.js` | on-screen keyboard |
| `js/hand.js` | hand diagram SVG with the finger highlighted |
| `js/practice.js` | practice engine: play-along (parts, replays) / wait (escape), timing windows, hints, adaptive + manual speed, loop |
| `js/listen.js` | Listen mode: plays the song, moves the cursor, lights keys, no scoring |
| `js/editor.js` | grown-ups' song editor with live preview |
| `js/app.js` | screens, settings, input routing, feedback, end screen |

## Tests

```
python3 -m http.server 8765 &          # from this folder
node tests/format-test.js              # song format unit tests
node tests/pitch-test.js               # pitch detector on synthetic piano tones
node tests/make-wavs.js && node tests/mic-e2e.js   # full mic pipeline in Chrome (fake mic)
node tests/e2e.js                      # UI end-to-end in headless Chrome (incl. timing, 🐢/🐰, 👂 Listen on every song, countdown, play-along parts, wait escape, layout)
node tests/webkit-ipad.js              # Safari engine (WebKit) with the iPad Pro 11 profile
```
(The browser tests need `playwright-core` — `cd tools && npm i` — and Chrome at `/usr/bin/google-chrome`.)

abcjs is © Paul Rosen and Gregory Dyke, MIT licence (`js/vendor/abcjs-LICENSE.md`).
