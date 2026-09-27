/*
 * pitch.js — monophonic pitch detection (YIN) + note tracker.
 *
 * Pure JavaScript with no browser dependencies, so the same file runs in the
 * browser (as PP.pitch) and in Node for offline tests (require('./pitch.js')).
 *
 *  - yin(buffer, sampleRate)  -> { freq, clarity } or null
 *  - NoteTracker               turns a stream of analysis frames
 *                              (time, rms, freq) into discrete "key pressed"
 *                              events: requires a stable pitch for ~100 ms,
 *                              a level above a noise gate, and debounces so
 *                              that one key press is counted once.
 */
(function (root) {
  'use strict';

  /** Root-mean-square level of a buffer (0..1 for float audio). */
  function rms(buf) {
    let s = 0;
    for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    return Math.sqrt(s / buf.length);
  }

  /** Frequency (Hz) -> fractional MIDI number (A4 = 440 Hz = 69). */
  function freqToMidiFloat(f) { return 69 + 12 * Math.log2(f / 440); }
  function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  /**
   * YIN pitch estimator (de Cheveigné & Kawahara, 2002).
   * Uses the cumulative-mean-normalised difference function with an absolute
   * threshold and parabolic interpolation. Returns null when no clear pitch.
   *
   * opts.minFreq / opts.maxFreq limit the search (defaults cover A1..C7,
   * the useful range of a piano for a beginner).
   */
  function yin(buf, sampleRate, opts) {
    opts = opts || {};
    const threshold = opts.threshold || 0.15;
    const minFreq = opts.minFreq || 60; // ~B1; below that is mostly hum/rumble
    const maxFreq = opts.maxFreq || 2200;
    const n = buf.length;
    const W = Math.floor(n / 2);
    const tauMin = Math.max(2, Math.floor(sampleRate / maxFreq));
    const tauMax = Math.min(W - 1, Math.ceil(sampleRate / minFreq));
    if (tauMax <= tauMin + 2) return null;

    // Remove DC offset (cheap high-pass) into a scratch buffer.
    let mean = 0;
    for (let i = 0; i < n; i++) mean += buf[i];
    mean /= n;
    const x = yin._scratch && yin._scratch.length === n ? yin._scratch : (yin._scratch = new Float32Array(n));
    for (let i = 0; i < n; i++) x[i] = buf[i] - mean;

    // Difference function d(tau) and its cumulative mean normalisation.
    const d = yin._d && yin._d.length === tauMax + 1 ? yin._d : (yin._d = new Float32Array(tauMax + 1));
    d[0] = 1;
    let running = 0;
    for (let tau = 1; tau <= tauMax; tau++) {
      let s = 0;
      for (let j = 0; j < W; j++) {
        const diff = x[j] - x[j + tau];
        s += diff * diff;
      }
      running += s;
      d[tau] = running > 0 ? (s * tau) / running : 1;
    }

    // First dip under the threshold (then walk down to its local minimum).
    let tauEst = -1;
    for (let tau = tauMin; tau <= tauMax; tau++) {
      if (d[tau] < threshold) {
        while (tau + 1 <= tauMax && d[tau + 1] < d[tau]) tau++;
        tauEst = tau;
        break;
      }
    }
    if (tauEst < 0) {
      // No dip under the threshold: accept the global minimum only if it is
      // still reasonably periodic (keeps decaying piano tails usable).
      let best = tauMin;
      for (let tau = tauMin + 1; tau <= tauMax; tau++) if (d[tau] < d[best]) best = tau;
      if (d[best] > 0.3) return null;
      tauEst = best;
    }

    // Parabolic interpolation for sub-sample accuracy.
    let betterTau = tauEst;
    if (tauEst > 1 && tauEst < tauMax) {
      const s0 = d[tauEst - 1], s1 = d[tauEst], s2 = d[tauEst + 1];
      const denom = 2 * (2 * s1 - s2 - s0);
      if (denom !== 0) betterTau = tauEst + (s2 - s0) / denom;
    }
    return { freq: sampleRate / betterTau, clarity: 1 - d[tauEst] };
  }

  /**
   * NoteTracker: debounced note-onset logic.
   *
   * Feed it once per analysis frame with process(timeMs, level, freq|null).
   * It returns a MIDI number when a NEW key press is recognised, else null.
   *
   * Rules:
   *  - level must exceed the gate (max of the user sensitivity threshold and
   *    3x the measured background noise floor);
   *  - the rounded MIDI note must stay the same for `stableMs` (and be within
   *    `maxCents` of the semitone, so F and F# are never confused);
   *  - after a note is reported it is not reported again until the sound dies
   *    down (level falls well under the gate), OR a fresh attack is detected
   *    (level jumps by `onsetRatio` compared to the recent minimum: this is how
   *    repeated notes like "Mi Mi Mi" are counted on a ringing piano), OR a
   *    different note becomes stable. Jumps of exactly an octave / octave+fifth
   *    without a new attack are treated as detector octave errors, not a new note.
   */
  class NoteTracker {
    constructor(opts) {
      this.opts = Object.assign({
        stableMs: 100,      // how long the pitch must be steady
        gate: 0.01,         // minimum RMS level (sensitivity)
        onsetRatio: 1.6,    // level jump that means "a new key was struck"
        onsetLookbackMs: 120,
        onsetRefractoryMs: 150, // one attack = one onset (level keeps rising for a few frames)
        minRetriggerMs: 140,// a child can't strike the same key faster than this
        releaseFactor: 0.6, // level < gate*releaseFactor => silence, re-arm
        maxCents: 42,       // ignore frames too far between two semitones
        minClarity: 0.7,
      }, opts || {});
      this.reset();
    }
    reset() {
      this.cand = null;          // { midi, since }
      this.lastEmitted = null;   // midi of the note already reported
      this.lastEmitTime = -1e9;
      this.lastOnset = -1e9;
      this.levels = [];          // [{t, v}] recent levels for onset detection
      this.noiseFloor = 0.002;
      this.current = null;       // note currently heard (for display)
      this.currentCents = 0;
    }
    /**
     * Call instead of process() while the app itself is making a sound
     * (chime, on-screen key tone, metronome): keeps the level history up to
     * date so our own sound is never mistaken for a new key press.
     */
    deaf(t, level) {
      this.levels.push({ t, v: level });
      while (this.levels.length && this.levels[0].t < t - this.opts.onsetLookbackMs) this.levels.shift();
      this.cand = null;
      this.lastOnset = t;
    }
    get effectiveGate() { return Math.max(this.opts.gate, this.noiseFloor * 3); }

    process(t, level, freq, clarity) {
      const o = this.opts;
      // --- background noise floor: slow rise, fast fall ---
      if (level < this.noiseFloor) this.noiseFloor = this.noiseFloor * 0.9 + level * 0.1;
      else this.noiseFloor = this.noiseFloor * 0.9995 + level * 0.0005;
      this.noiseFloor = Math.min(this.noiseFloor, 0.05);

      // --- onset detection (sudden level jump) ---
      this.levels.push({ t, v: level });
      while (this.levels.length && this.levels[0].t < t - o.onsetLookbackMs) this.levels.shift();
      let minRecent = Infinity;
      for (let i = 0; i < this.levels.length - 1; i++) minRecent = Math.min(minRecent, this.levels[i].v);
      const gate = this.effectiveGate;
      let onset = false;
      if (level > gate && minRecent !== Infinity && level > minRecent * o.onsetRatio &&
          t - this.lastEmitTime > o.minRetriggerMs && t - this.lastOnset > o.onsetRefractoryMs) {
        onset = true;
      }
      if (onset) {
        this.lastOnset = t;
        this.lastEmitted = null;       // re-arm: the same note may count again
        if (this.cand) this.cand.since = t; // let the attack settle first
      }

      // --- silence => re-arm ---
      if (level < gate * o.releaseFactor) {
        this.lastEmitted = null;
        this.cand = null;
        this.current = null;
        return null;
      }
      if (level < gate || !freq || (clarity !== undefined && clarity < o.minClarity)) {
        this.cand = null;
        return null;
      }

      const mf = freqToMidiFloat(freq);
      const midi = Math.round(mf);
      const cents = (mf - midi) * 100;
      if (Math.abs(cents) > o.maxCents) return null; // ambiguous: between keys

      if (!this.cand || this.cand.midi !== midi) {
        this.cand = { midi, since: t };
        return null;
      }
      if (t - this.cand.since >= o.stableMs * 0.5) { this.current = midi; this.currentCents = cents; } // for the "I hear" display
      if (t - this.cand.since < o.stableMs) return null;

      // Stable note. Decide whether it is a new key press.
      if (this.lastEmitted === midi) return null;
      if (this.lastEmitted !== null) {
        const diff = Math.abs(midi - this.lastEmitted);
        if (diff === 12 || diff === 19 || diff === 24) return null; // octave slip
      }
      if (t - this.lastEmitTime < o.minRetriggerMs && this.lastEmitted !== null) return null;
      this.lastEmitted = midi;
      this.lastEmitTime = t;
      return midi;
    }
  }

  const api = { yin, rms, freqToMidiFloat, midiToFreq, NoteTracker };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.PP = root.PP || {}; root.PP.pitch = api; }
})(typeof self !== 'undefined' ? self : this);
