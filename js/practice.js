/*
 * practice.js — the practice engine (no DOM of its own).
 *
 * Modes
 *  - 'wait'      : the cursor moves at the song tempo, STOPS at each note and
 *                  waits until the right key is played. (default)
 *  - 'playalong' : the cursor keeps moving; notes are scored hit / missed.
 *
 * Also: hints after N wrong tries, adaptive tempo (slow down after too many
 * mistakes, speed up after a streak), loop a range of bars, metronome ticks.
 *
 * Timing (settings.timing = 'relaxed' | 'normal' | 'strict', see TIMING):
 *  A right note counts if it comes between `early` before and `late` after the
 *  note's beat. Each window is given in beats (so it grows with slow songs /
 *  slow speeds) with a minimum in milliseconds (so fast songs and the
 *  microphone's small delay are covered too). Early or late notes inside the
 *  window are simply "right" - there is no early/late scolding.
 *
 * Sections (play-along): the song is cut into short parts of whole bars
 *  (about 6 notes, see _buildSections). Missed notes are counted per part.
 *  After settings.missLimit (default 4) misses in the current part, or when a
 *  part ends with less than half of its notes right, the engine rewinds to the
 *  start of that part, one speed step (10 %) slower (never under 30 %), pauses
 *  and emits onSectionRetry; the app shows a kind message + short countdown
 *  and resumes. After settings.sectionRetries (3) retries of the same part it
 *  moves on anyway (onSectionMoveOn). A part with at most 1 miss speeds up one
 *  step again, never above speedCeiling. (The mistake-window slow-down and the
 *  streak speed-up below are used in wait mode only.)
 *
 * Wait mode escape: after settings.waitSkip seconds (default 8) with no sound
 *  heard (activity() / input()), the hint is shown halfway and then the note
 *  is skipped gently (onSkip), so the line never stays frozen.
 *
 * Speed: `speed` is the effective multiplier. setManualSpeed(pct) is the
 *  turtle/rabbit buttons: it sets the speed AND becomes the ceiling for the
 *  automatic speed-up (auto slow-down can still go below it when things get
 *  hard, and the streak speed-up climbs back only up to the manual speed).
 *
 * The engine talks to the UI through `hooks` (all optional):
 *  onTarget(i) onCorrect(i, firstTry) onWrong(i, wrongCount, midi)
 *  onHint(i) onHintClear() onSpeed(pct, 'down'|'up') onBeat(accent)
 *  onMiss(i) onLoop() onDone(stats) onPhase(phase) onSkip(i)
 *  onSectionRetry(k, {pct, retry, max}) onSectionPass(k, {hits, n, retried}) onSectionMoveOn(k)
 */
(function (root) {
  'use strict';
  const PP = root.PP = root.PP || {};

  /** Timing windows. early/late: beats; *Ms: minimum in ms; waitEarly: wait mode.
   *  Old (before sept 2026) play-along window was 0.4 beat early and
   *  (note length - 0.4 beat) late, e.g. only 0.1 beat for an eighth note. */
  const TIMING = {
    strict:  { early: 0.35, earlyMs: 200, late: 0.5,  lateMs: 300, waitEarly: 0.75, waitEarlyMs: 400 },
    normal:  { early: 0.6,  earlyMs: 350, late: 0.8,  lateMs: 500, waitEarly: 1.0,  waitEarlyMs: 550 },
    relaxed: { early: 0.9,  earlyMs: 550, late: 1.25, lateMs: 800, waitEarly: 1.5,  waitEarlyMs: 800 },
  };
  const SPEED_MIN = 30, SPEED_MAX = 120, SPEED_STEP = 10;
  const SECTION_MIN_NOTES = 5;   // a part = whole bars, until it has >= 5 notes (~6)
  const SECTION_MAX_BARS = 4;

  class Practice {
    constructor(score, settings, hooks) {
      this.score = score; this.settings = settings; this.hooks = hooks || {};
      this.speed = 1; this.manualSpeed = null; this.loop = null;
      this.reset();
    }
    get events() { return this.score.events; }
    get bpm() { return (this.baseTempo || 80) * this.speed; }
    get speedPct() { return Math.round(this.speed * 100); }

    /** Prepare for a (new) song. */
    load(tempo, time) {
      this.baseTempo = tempo; this.time = time || [4, 4];
      this.speed = 1; this.manualSpeed = null; this.loop = null;
      this.reset();
    }
    reset() {
      this.phase = 'idle';           // idle | lead | moving | waiting | done
      this.paused = false;
      this.songBeat = 0;
      this.lastNow = null;
      this.wrongCount = 0;           // wrong tries on the current target
      this.window = [];              // wrong counts of recently finished notes
      this.windowBase = 0;
      this.streak = 0;
      this.consecMiss = 0;
      this.hintShown = false;
      this.done = new Set();         // indices of finished note events
      this.pre = new Set();          // notes played slightly early (wait mode)
      this.target = -1;
      this.lastTick = null;
      this.stats = { notes: 0, firstTry: 0, hints: 0, wrong: 0, missed: 0, bestStreak: 0, slowdowns: 0, loops: 0, retries: 0, skipped: 0 };
      this.sections = []; this.secOf = new Map(); this.secStats = [];
      this.waitStart = 0; this.lastActivity = 0; this._rewound = false;
      if (this.score && this.score.clearStates) this.score.clearStates();
    }

    // ------------------------------------------------------------------ timing
    get timing() { return TIMING[this.settings.timing] || TIMING.relaxed; }
    _msToBeats(ms) { return ms / 60000 * this.bpm; }
    /** How many beats before its start a note may be played (play-along). */
    earlyBeats() { const t = this.timing; return Math.max(t.early, this._msToBeats(t.earlyMs)); }
    /** How many beats after its start note i still counts (never less than the
     *  old rule "until just before the note ends", so long notes stay generous). */
    lateBeats(i) {
      const t = this.timing, e = this.events[i];
      return Math.max(t.late, this._msToBeats(t.lateMs), e ? e.beats - 0.25 : 0);
    }
    /** Wait mode: how early the next note may be played while the line moves. */
    waitEarlyBeats(n) {
      const t = this.timing;
      return Math.max(t.waitEarly, this._msToBeats(t.waitEarlyMs), this._prevBeats(n) * 0.75);
    }
    /** Window sizes in ms at the current speed (for the settings / tests). */
    windowMs(i) {
      const b2ms = b => Math.round(b * 60000 / this.bpm);
      return { early: b2ms(this.earlyBeats()), late: b2ms(this.lateBeats(i === undefined ? -1 : i)) };
    }

    // ------------------------------------------------------------------ speed
    /** Turtle / rabbit buttons. pct is clamped to 30..120 (quiet: no onSpeed). */
    setManualSpeed(pct, quiet) {
      pct = Math.max(SPEED_MIN, Math.min(SPEED_MAX, Math.round(pct)));
      this.speed = pct / 100;
      this.manualSpeed = this.speed;
      // a fresh start for the automatic speed: no instant slow-down / speed-up
      this.window = []; this.windowBase = this.wrongCount; this.streak = 0;
      if (!quiet) this._emit('onSpeed', this.speedPct, 'manual');
      return this.speedPct;
    }
    /** One step slower (-1) or faster (+1), snapping to multiples of 10 %. */
    stepSpeed(dir) {
      const pct = this.speedPct;
      const next = dir > 0 ? Math.floor(pct / SPEED_STEP + 1e-6) * SPEED_STEP + SPEED_STEP
                           : Math.ceil(pct / SPEED_STEP - 1e-6) * SPEED_STEP - SPEED_STEP;
      return this.setManualSpeed(next);
    }
    /** Highest speed the automatic speed-up may reach. */
    get speedCeiling() { return this.manualSpeed !== null ? this.manualSpeed : 1; }
    _snapStep(dir) {
      const pct = this.speedPct;
      return dir > 0 ? Math.floor(pct / SPEED_STEP + 1e-6) * SPEED_STEP + SPEED_STEP
                     : Math.ceil(pct / SPEED_STEP - 1e-6) * SPEED_STEP - SPEED_STEP;
    }

    // ------------------------------------------------------------------ sections
    /** Parts of whole bars with about 6 notes each (Lazy Song: 2 bars = 6 notes). */
    _buildSections() {
      const r = this._range(), ev = this.events, out = [];
      if (!ev.length) return out;
      const bars = [];
      for (let i = r.a; i <= r.b; i++) {
        if (!bars.length || bars[bars.length - 1].bar !== ev[i].bar) bars.push({ bar: ev[i].bar, idx: [] });
        bars[bars.length - 1].idx.push(i);
      }
      const count = (idx) => idx.filter(i => !ev[i].rest).length;
      let cur = null;
      for (const b of bars) {
        if (!cur) cur = { idx: [], bars: 0 };
        cur.idx.push(...b.idx); cur.bars++;
        if (count(cur.idx) >= SECTION_MIN_NOTES || cur.bars >= SECTION_MAX_BARS) { out.push(cur); cur = null; }
      }
      if (cur) { if (out.length && count(cur.idx) < 3) out[out.length - 1].idx.push(...cur.idx); else out.push(cur); }
      return out.map(sc => {
        const notes = sc.idx.filter(i => !ev[i].rest);
        return { a: sc.idx[0], b: sc.idx[sc.idx.length - 1], notes, startBeat: ev[sc.idx[0]].startBeat };
      }).filter(sc => sc.notes.length);
    }
    _initSections() {
      this.sections = this._buildSections();
      this.secOf = new Map();
      this.sections.forEach((sc, k) => sc.notes.forEach(i => this.secOf.set(i, k)));
      this.secStats = this.sections.map(() => ({ hits: 0, misses: 0, retries: 0, evaluated: false, gaveUp: false }));
    }
    get sectionsOn() { return this.settings.mode === 'playalong' && this.sections.length > 0; }
    /** Index of the part the line is in (or -1). */
    currentSection() {
      if (!this.sections.length) return -1;
      if (this.target >= 0 && this.secOf.has(this.target)) return this.secOf.get(this.target);
      let k = 0;
      this.sections.forEach((sc, j) => { if (sc.startBeat <= this.songBeat + 1e-9) k = j; });
      return k;
    }
    _sectionNote(i, hit) {
      if (!this.sectionsOn || !this.secOf.has(i)) return;
      const k = this.secOf.get(i), st = this.secStats[k];
      if (hit) st.hits++; else st.misses++;
      const max = this.settings.sectionRetries === undefined ? 3 : this.settings.sectionRetries;
      const limit = this.settings.missLimit || 4;
      if (!hit && !st.gaveUp && st.misses >= limit) {
        if (st.retries < max) { this._retrySection(k); return; }
        st.gaveUp = true;                     // tried enough: keep going, with praise
        this._emit('onSectionMoveOn', k);
      }
      this._evalSection(k);
    }
    /** When every note of part k is decided: pass (>= half right), retry, or move on. */
    _evalSection(k) {
      const sc = this.sections[k], st = this.secStats[k];
      if (!sc || st.evaluated || !sc.notes.every(i => this.done.has(i))) return;
      st.evaluated = true;
      const n = sc.notes.length, max = this.settings.sectionRetries === undefined ? 3 : this.settings.sectionRetries;
      if (st.hits * 2 >= n) {
        this._emit('onSectionPass', k, { hits: st.hits, n, retried: st.retries > 0 });
        // a good part: one step faster again, but never above the chosen speed
        const cap = this.speedCeiling;
        if (st.misses <= 1 && this.speed < cap - 1e-6) {
          this.speed = Math.min(cap, this._snapStep(+1) / 100);
          this._emit('onSpeed', this.speedPct, 'up');
        }
      } else if (!st.gaveUp && st.retries < max) {
        this._retrySection(k);
      } else if (!st.gaveUp) {
        st.gaveUp = true;
        this._emit('onSectionMoveOn', k);
      }
    }
    /** Go back to the start of part k, one step slower, and wait (paused) for the app. */
    _retrySection(k) {
      const sc = this.sections[k], st = this.secStats[k], r = this._range();
      const max = this.settings.sectionRetries === undefined ? 3 : this.settings.sectionRetries;
      st.retries++; this.stats.retries++;
      for (let i = sc.a; i <= r.b; i++) { this.done.delete(i); this.pre.delete(i); this.score.setState(i, null); }
      for (let j = k; j < this.sections.length; j++) Object.assign(this.secStats[j], { hits: 0, misses: 0, evaluated: false, gaveUp: false });
      this.target = -1; this.wrongCount = 0; this.consecMiss = 0; this.streak = 0;
      this.window = []; this.windowBase = 0;
      this.speed = Math.max(SPEED_MIN, this._snapStep(-1)) / 100;
      this.stats.slowdowns++;
      this.songBeat = sc.startBeat - 1;       // one beat of lead-in before the part
      if (k === 0) this.leadStart = this.songBeat;
      this._rewound = true;
      this._setPhase('lead');
      this.paused = true;
      this.score.hideRing();
      this._emit('onHintClear');
      this._drawCursor();
      this._emit('onSectionRetry', k, { pct: this.speedPct, retry: st.retries, max });
    }

    // ------------------------------------------------------------------ wait-mode escape
    /** The app heard some sound (a note being played, even if not recognised). */
    activity() { this.lastActivity = this.lastNow || 0; }
    _waitEscape(now) {
      const secs = +this.settings.waitSkip;
      if (!(secs > 0) || this.target < 0) return;
      const quiet = now - this.lastActivity, total = now - this.waitStart;
      const hintAt = secs >= 5 ? Math.max(2500, secs * 500) : secs * 500;   // the hint shows halfway
      if (!this.hintShown && quiet >= hintAt) this._showHint(this.target);
      if (quiet >= secs * 1000 || total >= secs * 2500) this._skip(this.target);
    }
    /** Wait mode: move on gently from a note nobody (or no microphone) played. */
    _skip(i) {
      this.done.add(i);
      this.score.setState(i, 'missed');
      this.stats.skipped++; this.stats.notes++;
      this.streak = 0; this.wrongCount = 0; this.hintShown = false;
      this._emit('onHintClear');
      this._emit('onSkip', i);
      this._setPhase('moving');
    }

    // ------------------------------------------------------------------ helpers
    get beatsPerBar() { return this.time[0] * 4 / this.time[1]; }
    _range() {
      const ev = this.events;
      if (!this.loop) return { a: 0, b: ev.length - 1 };
      let a = ev.findIndex(e => e.bar >= this.loop.from - 1);
      let b = -1; ev.forEach((e, i) => { if (e.bar <= this.loop.to - 1) b = i; });
      if (a < 0 || b < a) return { a: 0, b: ev.length - 1 };
      return { a, b };
    }
    _startBeat() { const r = this._range(); return this.events[r.a] ? this.events[r.a].startBeat : 0; }
    _endBeat() { const r = this._range(); const e = this.events[r.b]; return e ? e.startBeat + e.beats : 0; }
    /** Is `midi` the right key for event i? Sharps/flats are always strict. */
    matches(midi, i) {
      const e = this.events[i]; if (!e || e.rest) return false;
      if (this.settings.anyOctave) return e.midis.some(m => ((m - midi) % 12 + 12) % 12 === 0);
      return e.midis.indexOf(midi) >= 0;
    }
    /** First unfinished note event at or after beat b (within the range). */
    _nextNote(b, inclusive) {
      const r = this._range(), ev = this.events;
      for (let i = r.a; i <= r.b; i++) {
        const e = ev[i];
        if (e.rest || this.done.has(i)) continue;
        if (inclusive ? e.startBeat >= b - 1e-9 : e.startBeat > b + 1e-9) return i;
      }
      return -1;
    }
    _emit(name, ...args) { if (this.hooks[name]) this.hooks[name](...args); }
    _setPhase(p) { this.phase = p; this._emit('onPhase', p); }

    // ------------------------------------------------------------------ control
    /** leadBeats (optional): beats of lead-in before the first note (default:
     *  one bar in play-along, one beat in wait mode). */
    start(now, leadBeats) {
      this.reset();
      if (!this.events.length) return;
      const lead = leadBeats > 0 ? leadBeats : this.settings.mode === 'playalong' ? this.beatsPerBar : 1;
      this.leadStart = this._startBeat() - lead;
      this.songBeat = this.leadStart;
      this.lastNow = now;
      this._initSections();
      this._setPhase('lead');
      this.score.setCursor(-1, 0);
    }
    pause() { this.paused = true; }
    resume(now) { this.paused = false; this.lastNow = now; this.waitStart = this.lastActivity = now; }
    setLoop(from, to) {
      this.loop = from && to && to >= from ? { from, to } : null;
    }

    // ------------------------------------------------------------------ main loop
    update(now) {
      if (this.phase === 'idle' || this.phase === 'done' || this.paused) { this.lastNow = now; return; }
      const dt = Math.min(100, Math.max(0, now - (this.lastNow === null ? now : this.lastNow)));
      this.lastNow = now;
      if (this.phase === 'waiting') { this._waitEscape(now); this._drawCursor(); return; }
      const prevBeat = this.songBeat;
      this.songBeat += dt / 60000 * this.bpm;
      this._ticks(prevBeat, this.songBeat);
      if (this.settings.mode === 'playalong') this._updatePlayAlong();
      else this._updateWait();
      if (this.phase !== 'done') this._drawCursor();
    }

    _ticks(from, to) {
      if (!this.settings.metronome) return;
      const f = Math.floor(from + 1e-6), t = Math.floor(to + 1e-6);
      if (t > f) {
        const rel = t - this.leadStart;
        const beatInBar = ((Math.round(t - this._startBeat()) % this.beatsPerBar) + this.beatsPerBar) % this.beatsPerBar;
        if (rel >= 0) this._emit('onBeat', beatInBar === 0);
      }
    }

    _updateWait() {
      if (this.phase === 'lead' && this.songBeat >= this._startBeat()) this._setPhase('moving');
      // Arrived at the next note?
      for (;;) {
        const i = this._nextNote(this.songBeat - 1e-9 - 10, true); // first unfinished note
        if (i < 0) break;
        const e = this.events[i];
        if (this.songBeat + 1e-9 < e.startBeat) break;
        if (this.pre.has(i)) { this.pre.delete(i); continue; } // already played early
        this.songBeat = e.startBeat;
        this._setTarget(i);
        this.waitStart = this.lastActivity = this.lastNow || 0;
        this._setPhase('waiting');
        return;
      }
      if (this.songBeat >= this._endBeat()) this._finishPass();
    }

    _updatePlayAlong() {
      if (this.phase === 'lead' && this.songBeat >= this._startBeat() - 0.4) this._setPhase('moving');
      const show = 0.4;   // the highlight moves to a note just before its beat
      const r = this._range(), ev = this.events;
      this._rewound = false;
      // Notes whose late window has closed without being played are missed.
      for (let i = r.a; i <= r.b; i++) {
        const e = ev[i];
        if (e.rest || this.done.has(i)) continue;
        if (e.startBeat - show > this.songBeat) break;
        if (this.songBeat > e.startBeat + this.lateBeats(i)) { this._miss(i); if (this._rewound) return; }
      }
      // current (highlighted) note = last note whose beat has (almost) come
      let cur = -1;
      for (let i = r.a; i <= r.b; i++) if (!ev[i].rest && ev[i].startBeat - show <= this.songBeat) cur = i;
      if (cur !== this.target) {
        if (cur >= 0 && !this.done.has(cur)) this._setTarget(cur); else this.target = cur;
      }
      // the pass ends when the music has ended AND the last note's window closed
      let last = -1; for (let i = r.b; i >= r.a; i--) if (!ev[i].rest) { last = i; break; }
      const end = Math.max(this._endBeat(), last >= 0 ? ev[last].startBeat + this.lateBeats(last) : 0);
      if (this.songBeat >= end) {
        for (let i = r.a; i <= r.b; i++) if (!ev[i].rest && !this.done.has(i)) { this._miss(i); if (this._rewound) return; }
        this.sections.forEach((sc, k) => { if (!this._rewound) this._evalSection(k); });
        if (this._rewound) return;            // the last part is played again
        this._finishPass();
      }
    }
    /** Play-along: the unfinished note whose timing window contains now and that
     *  matches `midi` (the earliest one, so repeated notes are taken in order). */
    _playAlongMatch(midi) {
      const r = this._range(), ev = this.events, b = this.songBeat, early = this.earlyBeats();
      for (let i = r.a; i <= r.b; i++) {
        const e = ev[i];
        if (e.rest || this.done.has(i)) continue;
        if (e.startBeat - early > b) break;
        if (b <= e.startBeat + this.lateBeats(i) && this.matches(midi, i)) return i;
      }
      return -1;
    }
    /** Was `midi` the right note for a note that just went by? (then: no scolding) */
    _recentlyPassed(midi) {
      const r = this._range(), ev = this.events, b = this.songBeat;
      for (let i = r.a; i <= r.b; i++) {
        const e = ev[i];
        if (e.rest || !this.done.has(i) || e.startBeat > b) continue;
        if (b - e.startBeat <= this.lateBeats(i) * 2 + 1 && this.matches(midi, i)) return true;
      }
      return false;
    }

    _finishPass() {
      if (this.loop) {
        const r = this._range();
        for (let i = r.a; i <= r.b; i++) { this.done.delete(i); this.score.setState(i, null); }
        this.pre.clear();
        this.secStats.forEach(st => Object.assign(st, { hits: 0, misses: 0, retries: 0, evaluated: false, gaveUp: false }));
        this.stats.loops++;
        this.target = -1;
        this.songBeat = this._startBeat() - 1;
        this.leadStart = this.songBeat;
        this._setPhase('lead');
        this._emit('onLoop');
        return;
      }
      this._setPhase('done');
      this.score.hideRing();
      this._emit('onHintClear');
      this.stats.speed = this.speedPct;
      this._emit('onDone', this.stats);
    }

    _setTarget(i) {
      this.target = i;
      this.wrongCount = 0;
      this.hintShown = false;
      this.score.setState(i, 'target');
      this._emit('onHintClear');
      this._emit('onTarget', i);
      // play-along: keep showing the hint while the child is struggling
      if (this.settings.mode === 'playalong' && this.consecMiss >= this.settings.hintAfter) this._showHint(i);
    }

    _drawCursor() {
      const ev = this.events, b = this.songBeat;
      if (b < this._startBeat()) {
        const s = this._startBeat();
        this.score.setCursor(-1, (b - this.leadStart) / Math.max(1e-6, s - this.leadStart));
        return;
      }
      const r = this._range();
      let k = r.a;
      for (let i = r.a; i <= r.b; i++) if (ev[i].startBeat <= b + 1e-9) k = i;
      this.score.setCursor(k, (b - ev[k].startBeat) / Math.max(1e-6, ev[k].beats));
    }

    // ------------------------------------------------------------------ input
    /** A key was played (mic, MIDI or on-screen). */
    input(midi) {
      if (this.paused || this.phase === 'idle' || this.phase === 'done') return 'ignored';
      this.activity();
      if (this.settings.mode === 'playalong') {
        // right note inside its (early ... late) window = right, early or late
        const m = this._playAlongMatch(midi);
        if (m >= 0) { this._correct(m); return 'correct'; }
        const i = this.target;
        if (i < 0 || this.done.has(i)) return 'ignored';
        if (this._recentlyPassed(midi)) return 'ignored';   // a bit too late: no scolding
        this._wrong(i, midi); return 'wrong';
      }
      // wait mode
      if (this.phase === 'waiting') {
        const i = this.target;
        if (this.matches(midi, i)) { this._correct(i); this._setPhase('moving'); return 'correct'; }
        this._wrong(i, midi); return 'wrong';
      }
      // moving / lead-in: accept the NEXT note if it comes a little early
      const n = this._nextNote(this.songBeat, false);
      if (n >= 0 && !this.pre.has(n)) {
        const e = this.events[n];
        const away = e.startBeat - this.songBeat;
        if (away <= this.waitEarlyBeats(n) && this.matches(midi, n)) {
          this.pre.add(n);
          this.target = n; this.wrongCount = 0;
          this._correct(n);
          return 'correct';
        }
      }
      return 'ignored';
    }
    _prevBeats(n) { const ev = this.events; return n > 0 ? ev[n - 1].beats : 1; }

    _correct(i) {
      // (play-along: an early/late note can be another note than the highlighted one)
      const isTarget = i === this.target;
      const firstTry = !isTarget || this.wrongCount === 0;
      this.done.add(i);
      this.score.setState(i, 'correct');
      this.stats.notes++;
      if (firstTry) this.stats.firstTry++;
      this.window.push(isTarget ? Math.max(0, this.wrongCount - this.windowBase) : 0);
      if (isTarget) this.windowBase = 0;
      while (this.window.length > this.settings.slowWindow) this.window.shift();
      this.consecMiss = 0;
      if (firstTry) { this.streak++; this.stats.bestStreak = Math.max(this.stats.bestStreak, this.streak); } else this.streak = 0;
      this._emit('onHintClear');
      this.hintShown = false;
      this._emit('onCorrect', i, firstTry);
      if (isTarget) this.wrongCount = 0;
      this._sectionNote(i, true);
      // speed back up after a streak of first-try notes - but never above the
      // speed chosen with the turtle/rabbit buttons (or 100 % if none chosen)
      const cap = this.speedCeiling;
      if (!this.sectionsOn && this.settings.adaptive && this.settings.speedUp && this.speed < cap - 1e-6 && this.streak >= this.settings.speedUpStreak) {
        this.speed = Math.min(cap, Math.round((this.speed + 0.1) * 20) / 20);
        this.streak = 0;
        this._emit('onSpeed', this.speedPct, 'up');
      }
    }

    _wrong(i, midi) {
      this.wrongCount++;
      this.stats.wrong++;
      this.streak = 0;
      this.score.flashWrong(i);
      this._emit('onWrong', i, this.wrongCount, midi);
      if (this.wrongCount >= this.settings.hintAfter && !this.hintShown) this._showHint(i);
      if (!this.sectionsOn) this._checkSlowdown();   // (play-along: parts are replayed instead)
    }

    _miss(i) {
      this.done.add(i);
      this.score.setState(i, 'missed');
      this.stats.missed++;
      this.stats.notes++;
      this.consecMiss++;
      this.streak = 0;
      const isTarget = i === this.target;
      this.window.push(1 + (isTarget ? Math.max(0, this.wrongCount - this.windowBase) : 0));
      if (isTarget) { this.windowBase = 0; this.wrongCount = 0; }
      while (this.window.length > this.settings.slowWindow) this.window.shift();
      this._emit('onMiss', i);
      if (this.sectionsOn) this._sectionNote(i, false); else this._checkSlowdown();
    }

    _showHint(i) {
      this.hintShown = true;
      this.stats.hints++;
      this._emit('onHint', i);
    }

    /** More than M mistakes in the last K notes => slow down (not below the floor). */
    _checkSlowdown() {
      const s = this.settings;
      if (!s.adaptive || this.sectionsOn) return;   // play-along uses the part retries instead
      const current = Math.max(0, this.wrongCount - this.windowBase);
      const recent = this.window.slice(-(s.slowWindow - 1)).reduce((a, b) => a + b, 0) + current;
      const floor = s.slowFloor / 100;
      if (recent > s.slowWrong && this.speed > floor + 1e-6) {
        this.speed = Math.max(floor, Math.round(this.speed * (1 - s.slowStep / 100) * 100) / 100);
        this.window = [];
        this.windowBase = this.wrongCount;
        this.stats.slowdowns++;
        this._emit('onSpeed', this.speedPct, 'down');
      }
    }
  }
  PP.Practice = Practice;
  PP.Practice.TIMING = TIMING;
  PP.Practice.SPEED_MIN = SPEED_MIN; PP.Practice.SPEED_MAX = SPEED_MAX; PP.Practice.SPEED_STEP = SPEED_STEP;
})(typeof self !== 'undefined' ? self : this);
