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
 * The engine talks to the UI through `hooks` (all optional):
 *  onTarget(i) onCorrect(i, firstTry) onWrong(i, wrongCount, midi)
 *  onHint(i) onHintClear() onSpeed(pct, 'down'|'up') onBeat(accent)
 *  onMiss(i) onLoop() onDone(stats) onPhase(phase)
 */
(function (root) {
  'use strict';
  const PP = root.PP = root.PP || {};

  class Practice {
    constructor(score, settings, hooks) {
      this.score = score; this.settings = settings; this.hooks = hooks || {};
      this.speed = 1; this.loop = null;
      this.reset();
    }
    get events() { return this.score.events; }
    get bpm() { return (this.baseTempo || 80) * this.speed; }
    get speedPct() { return Math.round(this.speed * 100); }

    /** Prepare for a (new) song. */
    load(tempo, time) {
      this.baseTempo = tempo; this.time = time || [4, 4];
      this.speed = 1; this.loop = null;
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
      const tol = 0.4;
      const r = this._range(), ev = this.events;
      // current note = last note whose window has opened
      let cur = -1;
      for (let i = r.a; i <= r.b; i++) if (!ev[i].rest && ev[i].startBeat - tol <= this.songBeat) cur = i;
      if (cur !== this.target) {
        const old = this.target;
        if (old >= 0 && !this.done.has(old)) this._miss(old);
        if (cur >= 0 && !this.done.has(cur)) this._setTarget(cur); else this.target = cur;
      }
      if (this.songBeat >= this._endBeat()) {
        if (this.target >= 0 && !this.done.has(this.target)) this._miss(this.target);
        this._finishPass();
      }
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
        const i = this.target;
        if (i < 0 || this.done.has(i)) {
          // between notes: maybe the next note, played a little early
          const n = this._nextNote(this.songBeat, false);
          if (n >= 0 && this.events[n].startBeat - this.songBeat < 0.6 && this.matches(midi, n)) { this._correct(n); return 'correct'; }
          return 'ignored';
        }
        if (this.matches(midi, i)) { this._correct(i); return 'correct'; }
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
        if (away <= Math.max(0.75, this._prevBeats(n) * 0.5) && this.matches(midi, n)) {
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
      const firstTry = this.wrongCount === 0;
      this.done.add(i);
      this.score.setState(i, 'correct');
      this.stats.notes++;
      if (firstTry) this.stats.firstTry++;
      this.window.push(Math.max(0, this.wrongCount - this.windowBase));
      this.windowBase = 0;
      while (this.window.length > this.settings.slowWindow) this.window.shift();
      this.consecMiss = 0;
      if (firstTry) { this.streak++; this.stats.bestStreak = Math.max(this.stats.bestStreak, this.streak); } else this.streak = 0;
      this._emit('onHintClear');
      this.hintShown = false;
      this._emit('onCorrect', i, firstTry);
      this.wrongCount = 0;
      // speed back up after a streak of first-try notes
      if (this.settings.adaptive && this.settings.speedUp && this.speed < 1 && this.streak >= this.settings.speedUpStreak) {
        this.speed = Math.min(1, Math.round((this.speed + 0.1) * 20) / 20);
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
      this.window.push(1 + Math.max(0, this.wrongCount - this.windowBase));
      this.windowBase = 0;
      while (this.window.length > this.settings.slowWindow) this.window.shift();
      this.wrongCount = 0;
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
})(typeof self !== 'undefined' ? self : this);
