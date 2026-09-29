/*
 * listen.js — Listen mode: the app plays the song itself so the child can hear
 * how it goes. Nothing is scored.
 *
 *  - Plays every note (both hands on a grand staff, chords, real lengths,
 *    rests are silent) with PP.audio.pianoNote, at the current practice speed
 *    (it follows the turtle/rabbit buttons live).
 *  - Moves the pink cursor, rings the current note, lights the key(s) on the
 *    on-screen keyboard in the right octave and reports each note (onNote) so
 *    the app can show its name.
 *  - Audio is scheduled a little ahead on the AudioContext clock (smooth even
 *    if a frame is late); the visuals follow the same beat clock.
 *
 * new PP.Listener({ score, kb, audio, getBpm, onNote(e|null), onDone(completed) })
 *   start(now, range{a,b})   stop()   update(now)   .active
 */
(function (root) {
  'use strict';
  const PP = root.PP = root.PP || {};

  const LEAD_BEATS = 1;        // the cursor slides in for one beat first
  const AHEAD_S = 0.2;         // schedule sounds this far ahead (seconds)

  class Listener {
    constructor(o) { Object.assign(this, o); this.active = false; }

    start(now, range) {
      const ev = this.score.events;
      if (!ev.length) return false;
      const r = range || { a: 0, b: ev.length - 1 };
      this.a = r.a; this.b = r.b;
      this.startBeat = ev[r.a].startBeat;
      this.endBeat = ev[r.b].startBeat + ev[r.b].beats;
      this.beat = this.startBeat - LEAD_BEATS;
      this.lastNow = now;
      this.cur = -1;                         // index of the note being shown
      this.sounded = new Set();              // main-part indices already scheduled
      // other hand (grand staff) inside the same beat range
      this.other = (this.score.otherEvents || [])
        .filter(e => e.startBeat >= this.startBeat - 1e-6 && e.startBeat < this.endBeat - 1e-6)
        .map(e => ({ e, sounded: false, lit: false, off: false }));
      this.lit = [];                         // [{ midi, cls, until }]
      this.active = true;
      this.score.clearStates();
      this.score.setCursor(-1, 0);
      return true;
    }

    stop() {
      if (!this.active) return;
      this.active = false;
      this.audio.stopVoices();
      this._unlightAll();
      this.score.clearStates();
      this.score.setCursor(-1, 0);
    }

    update(now) {
      if (!this.active) return;
      const dt = Math.min(100, Math.max(0, now - this.lastNow));
      this.lastNow = now;
      const bpm = Math.max(1, this.getBpm());
      this.beat += dt / 60000 * bpm;
      const b = this.beat, ev = this.score.events;
      if (!ev.length || this.b >= ev.length) { this._finish(false); return; }

      // 1) sounds, a little ahead of time
      const ctx = this.audio.ctx, spb = 60 / bpm;
      const canPlay = ctx && ctx.state === 'running';
      const aheadBeats = AHEAD_S / spb;
      const schedule = (e) => {
        if (!canPlay) return;
        const when = ctx.currentTime + Math.max(0, (e.startBeat - b) * spb);
        const dur = e.beats * spb * 0.92;
        e.midis.forEach(m => this.audio.pianoNote(m, when, dur, 0.8));
      };
      for (let i = this.a; i <= this.b; i++) {
        const e = ev[i];
        if (e.startBeat > b + aheadBeats) break;
        if (this.sounded.has(i)) continue;
        this.sounded.add(i);
        if (!e.rest && e.startBeat >= b - 0.05) schedule(e);
      }
      this.other.forEach(o => {
        if (!o.sounded && o.e.startBeat <= b + aheadBeats) { o.sounded = true; if (o.e.startBeat >= b - 0.05) schedule(o.e); }
      });

      // 2) visuals: current note (ring + key + name)
      this.lit = this.lit.filter(l => { if (b >= l.until) { this.kb.lightOff(l.midi, l.cls); return false; } return true; });
      let k = -1;
      for (let i = this.a; i <= this.b; i++) if (ev[i].startBeat <= b + 1e-9) k = i; else break;
      if (k !== this.cur && k >= 0) {
        if (this.cur >= 0) this.score.setState(this.cur, null);
        this.cur = k;
        const e = ev[k];
        if (!e.rest) {
          this.score.setState(k, 'target');
          e.midis.forEach(m => this._light(m, 'listen', e.startBeat + e.beats * 0.9, false));
        } else this.score.hideRing();
        if (this.onNote) this.onNote(e.rest ? null : e, k);
      }
      this.other.forEach(o => {
        if (!o.lit && o.e.startBeat <= b + 1e-9) { o.lit = true; o.e.midis.forEach(m => this._light(m, 'listen2', o.e.startBeat + o.e.beats * 0.9, true)); }
      });

      // 3) cursor
      if (b < this.startBeat) this.score.setCursor(-1, (b - (this.startBeat - LEAD_BEATS)) / LEAD_BEATS);
      else if (k >= 0) this.score.setCursor(k, (b - ev[k].startBeat) / Math.max(1e-6, ev[k].beats));

      if (b >= this.endBeat + 0.25) this._finish(true);
    }

    _light(midi, cls, until, exactOnly) {
      if (this.kb.lightOn(midi, cls, exactOnly)) this.lit.push({ midi, cls, until });
    }
    _unlightAll() { this.lit.forEach(l => this.kb.lightOff(l.midi, l.cls)); this.lit = []; }
    _finish(completed) {
      this.stop();
      if (this.onDone) this.onDone(completed);
    }
  }
  PP.Listener = Listener;
})(typeof self !== 'undefined' ? self : this);
