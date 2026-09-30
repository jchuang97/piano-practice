/*
 * songs.js — built-in songs, and saving songs/settings in localStorage.
 */
(function (root) {
  'use strict';
  const PP = root.PP = root.PP || {};

  // Built-in songs. The first one is the lesson from the teacher.
  const BUILTIN = [
    {
      id: 'lazy-song', builtin: true, format: 'simple', title: 'Lazy Song',
      text: `title: Lazy Song
tempo: 60
time: 3/4
look: open
// The teacher's lesson: round notes, one beat each.
// /5 /2 /1 = finger numbers (1 = thumb, 5 = pinky), right hand.
Si4/5 Fa#4/2 Mi4/1 | Si4/5 Fa#4/2 Mi4/1 |
Si4/5 Fa#4/2 Mi4/1 |
// last bar: the hand moves down one key
Si4/5 Re#4/1 Mi4/2 |`,
    },
    {
      id: 'mary', builtin: true, format: 'simple', title: 'Mary Had a Little Lamb',
      text: `title: Mary Had a Little Lamb
tempo: 90
time: 4/4
// C position: Do=1 Re=2 Mi=3 Fa=4 Sol=5
Mi4/3 q, Re4/2 q, Do4/1 q, Re4/2 q | Mi4/3 q, Mi4/3 q, Mi4/3 h |
Re4/2 q, Re4/2 q, Re4/2 h | Mi4/3 q, Sol4/5 q, Sol4/5 h |
Mi4/3 q, Re4/2 q, Do4/1 q, Re4/2 q | Mi4/3 q, Mi4/3 q, Mi4/3 q, Mi4/3 q |
Re4/2 q, Re4/2 q, Mi4/3 q, Re4/2 q | Do4/1 w |`,
    },
    {
      id: 'hot-cross-buns', builtin: true, format: 'simple', title: 'Hot Cross Buns',
      text: `title: Hot Cross Buns
tempo: 90
time: 4/4
// (this one uses letter names: C = Do, D = Re, E = Mi)
E4/3 q, D4/2 q, C4/1 h | E4/3 q, D4/2 q, C4/1 h |
C4/1 e, C4/1 e, C4/1 e, C4/1 e, D4/2 e, D4/2 e, D4/2 e, D4/2 e | E4/3 q, D4/2 q, C4/1 h |`,
    },
    {
      id: 'twinkle', builtin: true, format: 'simple', title: 'Twinkle Twinkle Little Star',
      text: `title: Twinkle Twinkle Little Star
tempo: 90
time: 4/4
Do4/1 q, Do4/1 q, Sol4/4 q, Sol4/4 q | La4/5 q, La4/5 q, Sol4/4 h |
Fa4/4 q, Fa4/4 q, Mi4/3 q, Mi4/3 q | Re4/2 q, Re4/2 q, Do4/1 h |
Sol4/5 q, Sol4/5 q, Fa4/4 q, Fa4/4 q | Mi4/3 q, Mi4/3 q, Re4/2 h |
Sol4/5 q, Sol4/5 q, Fa4/4 q, Fa4/4 q | Mi4/3 q, Mi4/3 q, Re4/2 h |
Do4/1 q, Do4/1 q, Sol4/4 q, Sol4/4 q | La4/5 q, La4/5 q, Sol4/4 h |
Fa4/4 q, Fa4/4 q, Mi4/3 q, Mi4/3 q | Re4/2 q, Re4/2 q, Do4/1 h |`,
    },
    {
      id: 'ode-to-joy', builtin: true, format: 'abc', title: 'Ode to Joy (ABC example)',
      text: `X:1
T:Ode to Joy
M:4/4
L:1/4
Q:1/4=90
K:C
% !1!..!5! before a note = finger number
!3!E !3!E !4!F !5!G | !5!G !4!F !3!E !2!D | !1!C !1!C !2!D !3!E | !3!E3/2 !2!D/ !2!D2 |
!3!E !3!E !4!F !5!G | !5!G !4!F !3!E !2!D | !1!C !1!C !2!D !3!E | !2!D3/2 !1!C/ !1!C2 |]`,
    },
  ];

  const SONGS_KEY = 'pianoPractice.songs.v1';
  const SETTINGS_KEY = 'pianoPractice.settings.v1';
  const SPEEDS_KEY = 'pianoPractice.speeds.v1';    // { songId: percent } chosen with 🐢/🐰

  const DEFAULT_SETTINGS = {
    nameStyle: 'solfege',     // 'solfege' (Do Re Mi) or 'letters' (C D E)
    schema: 2,                // settings version (2: play-along became the default)
    mode: 'playalong',        // 'playalong' (line keeps moving, parts are replayed) or 'wait'
    missLimit: 4,             // play-along: replay the part after this many missed notes
    sectionRetries: 3,        // ... at most this many times, then move on with praise
    waitSkip: 8,              // wait mode: skip a note after this many seconds of silence (0 = never)
    input: 'auto',            // 'auto' | 'mic' | 'midi' | 'screen'
    anyOctave: true,          // accept the right note name in any octave
    namesInHeads: false,      // note names inside note heads
    namesBelow: true,         // coloured note names under the notes
    showFingers: true,        // finger numbers on the music + hand picture
    keyLabels: true,          // names on the on-screen keys
    timing: 'relaxed',        // how early/late a note may be: 'relaxed' | 'normal' | 'strict'
    hintAfter: 3,             // wrong tries before a hint
    adaptive: true,           // slow down after many mistakes
    slowWrong: 4,             // more than this many wrong ...
    slowWindow: 8,            // ... within the last K notes
    slowStep: 15,             // percent
    slowFloor: 40,            // percent of the song tempo
    speedUp: true,            // speed back up after a streak
    speedUpStreak: 8,
    countdown: true,          // 3-2-1-Go before practice starts
    countdownSound: true,     // soft tick with each number
    metronome: false,
    keySound: true,           // on-screen keys make a sound
    successSound: true,       // soft "ding" on correct notes
    micGate: 0.012,           // mic sensitivity (lower = more sensitive)
    stableMs: 100,            // how long a pitch must be steady
    kbAuto: true,             // keyboard range fits the song
    kbStart: 48,              // C3 (when not auto)
    kbOctaves: 3,
    hand: 'rh',               // which staff to practise on a grand staff
    size: 'xlarge',           // notation size
  };

  function load(key, fallback) {
    try { const v = JSON.parse(localStorage.getItem(key)); return v === null || v === undefined ? fallback : v; }
    catch (e) { return fallback; }
  }
  function save(key, v) {
    try { localStorage.setItem(key, JSON.stringify(v)); return true; }
    catch (e) { console.warn('Could not save', e); return false; }
  }

  PP.store = {
    BUILTIN, DEFAULT_SETTINGS,
    /** All songs; the first run seeds the built-in songs. */
    getSongs() {
      let songs = load(SONGS_KEY, null);
      if (!Array.isArray(songs)) { songs = BUILTIN.map(s => Object.assign({}, s)); save(SONGS_KEY, songs); }
      return songs;
    },
    saveSongs(songs) { return save(SONGS_KEY, songs); },
    upsertSong(song) {
      const songs = this.getSongs();
      const i = songs.findIndex(s => s.id === song.id);
      if (i >= 0) songs[i] = song; else songs.push(song);
      this.saveSongs(songs);
      return song;
    },
    deleteSong(id) { this.saveSongs(this.getSongs().filter(s => s.id !== id)); },
    restoreBuiltins() {
      const songs = this.getSongs();
      BUILTIN.forEach((b, idx) => {
        const i = songs.findIndex(s => s.id === b.id);
        if (i >= 0) songs[i] = Object.assign({}, b); else songs.splice(Math.min(idx, songs.length), 0, Object.assign({}, b));
      });
      this.saveSongs(songs);
    },
    newId() { return 'song-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6); },
    getSettings() {
      const saved = load(SETTINGS_KEY, {});
      // v2 (sept 2026): play-along is the new default. Settings saved by older
      // versions stored mode 'wait' only because it was the default then.
      if (!(saved.schema >= 2) && Object.keys(saved).length) {
        if (saved.mode === 'wait') saved.mode = 'playalong';
        saved.schema = 2;
        save(SETTINGS_KEY, saved);
      }
      return Object.assign({}, DEFAULT_SETTINGS, saved);
    },
    saveSettings(s) { return save(SETTINGS_KEY, s); },
    /** Speed (percent) picked with the turtle/rabbit buttons for a song, or null. */
    getSongSpeed(id) { const v = load(SPEEDS_KEY, {})[id]; return typeof v === 'number' && v >= 10 && v <= 200 ? v : null; },
    setSongSpeed(id, pct) { const all = load(SPEEDS_KEY, {}); if (pct === null) delete all[id]; else all[id] = pct; save(SPEEDS_KEY, all); },
    /** Everything in one JSON blob for backup. */
    exportAll() { return JSON.stringify({ app: 'piano-practice', version: 1, exported: new Date().toISOString(), songs: this.getSongs() }, null, 2); },
    /** Merge songs from a backup (same id => replaced). Returns number imported. */
    importAll(text) {
      const data = JSON.parse(text);
      const list = Array.isArray(data) ? data : data.songs;
      if (!Array.isArray(list)) throw new Error('This file has no songs in it.');
      const songs = this.getSongs();
      let n = 0;
      for (const s of list) {
        if (!s || typeof s.text !== 'string') continue;
        const song = { id: s.id || this.newId(), title: String(s.title || 'Imported song'), format: s.format === 'abc' ? 'abc' : 'simple', text: s.text };
        const i = songs.findIndex(x => x.id === song.id);
        if (i >= 0) songs[i] = song; else songs.push(song);
        n++;
      }
      this.saveSongs(songs);
      return n;
    },
  };
})(typeof self !== 'undefined' ? self : this);
