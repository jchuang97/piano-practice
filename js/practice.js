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
 * Speed: `speed` is the effective multiplier. setManualSpeed(pct) is the
 *  turtle/rabbit buttons: it sets the speed AND becomes the ceiling for the
 *  automatic speed-up (auto slow-down can still go below it when things get
 *  hard, and the streak speed-up climbs back only up to the manual speed).
 *
 * The engine talks to the UI through `hooks` (all optional):
 *  onTarget(i) onCorrect(i, firstTry) onWrong(i, wrongCount, midi)
 *  onHint(i) onHintClear() onSpeed(pct, 'down'|'up') onBeat(accent)
 *  onMiss(i) onLoop() onDone(stats) onPhase(phase)
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
      this.stats = { notes: 0, firstTry: 0, hints: 0, wrong: 0, missed: 0, bestStreak: 0, slowdowns: 0, loops: 0 };
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
    start(now) {
      this.reset();
      if (!this.events.length) return;
      const lead = this.settings.mode === 'playalong' ? this.beatsPerBar : 1;
      this.leadStart = this._startBeat() - lead;
      this.songBeat = this.leadStart;
      this.lastNow = now;
      this._setPhase('lead');
      this.score.setCursor(-1, 0);
    }
    pause() { this.paused = true; }
    resume(now) { this.paused = false; this.lastNow = now; }
    setLoop(from, to) {
      this.loop = from && to && to >= from ? { from, to } : null;
    }

    // ------------------------------------------------------------------ main loop
    update(now) {
      if (this.phase === 'idle' || this.phase === 'done' || this.paused) { this.lastNow = now; return; }
      const dt = Math.min(100, Math.max(0, now - (this.lastNow === null ? now : this.lastNow)));
      this.lastNow = now;
      if (this.phase === 'waiting') { this._drawCursor(); return; }
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
        this._setPhase('waiting');
        return;
      }
      if (this.songBeat >= this._endBeat()) this._finishPass();
    }

    _updatePlayAlong() {
      if (this.phase === 'lead' && this.songBeat >= this._startBeat() - 0.4) this._setPhase('moving');
      const show = 0.4;   // the highlight moves to a note just before its beat
      const r = this._range(), ev = this.events;
      // Notes whose late window has closed without being played are missed.
      for (let i = r.a; i <= r.b; i++) {
        const e = ev[i];
        if (e.rest || this.done.has(i)) continue;
        if (e.startBeat - show > this.songBeat) break;
        if (this.songBeat > e.startBeat + this.lateBeats(i)) this._miss(i);
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
        for (let i = r.a; i <= r.b; i++) if (!ev[i].rest && !this.done.has(i)) this._miss(i);
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
      // speed back up after a streak of first-try notes - but never above the
      // speed chosen with the turtle/rabbit buttons (or 100 % if none chosen)
      const cap = this.speedCeiling;
      if (this.settings.adaptive && this.settings.speedUp && this.speed < cap - 1e-6 && this.streak >= this.settings.speedUpStreak) {
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
      this._checkSlowdown();
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
      this._checkSlowdown();
    }

    _showHint(i) {
      this.hintShown = true;
      this.stats.hints++;
      this._emit('onHint', i);
    }

    /** More than M mistakes in the last K notes => slow down (not below the floor). */
    _checkSlowdown() {
      const s = this.settings;
      if (!s.adaptive) return;
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
