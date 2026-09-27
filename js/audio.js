/*
 * audio.js — Web Audio context, microphone listening, gentle sounds and Web MIDI.
 *
 * iOS Safari notes:
 *  - The AudioContext is created/resumed inside a tap handler (unlock()).
 *  - getUserMedia is called with echoCancellation / noiseSuppression /
 *    autoGainControl OFF, because those filters distort pitch.
 *  - We never force a sample rate; the detector uses ctx.sampleRate (often 48 kHz).
 */
(function (root) {
  'use strict';
  const PP = root.PP = root.PP || {};

  const A = PP.audio = {
    ctx: null,
    master: null,
    deafUntil: 0,        // performance.now() until which mic input is ignored (our own sounds)

    /** Must be called from a user gesture (tap/click). Safe to call often. */
    unlock() {
      if (!this.ctx) {
        const AC = root.AudioContext || root.webkitAudioContext;
        if (!AC) return null;
        this.ctx = new AC({ latencyHint: 'interactive' });
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.8;
        this.master.connect(this.ctx.destination);
        // iOS may "interrupt" the context (phone call, Siri, lock screen)
        this.ctx.onstatechange = () => { if (this.onStateChange) this.onStateChange(this.ctx.state); };
      }
      if (this.ctx.state !== 'running') { try { this.ctx.resume(); } catch (e) { /* ignore */ } }
      // Play a silent buffer: the classic iOS unlock trick.
      try {
        const b = this.ctx.createBuffer(1, 1, 22050), s = this.ctx.createBufferSource();
        s.buffer = b; s.connect(this.ctx.destination); s.start(0);
      } catch (e) { /* ignore */ }
      return this.ctx;
    },
    get running() { return !!this.ctx && this.ctx.state === 'running'; },

    // ---------------------------------------------------------------
    // Sounds (all soft; there is intentionally no "error buzz").
    // ---------------------------------------------------------------
    _deaf(ms) { this.deafUntil = Math.max(this.deafUntil, performance.now() + ms); },

    /** Soft piano-like tone for on-screen key taps. */
    playNote(midi, dur) {
      if (!this.running) return;
      dur = dur || 0.6;
      const c = this.ctx, t = c.currentTime, f = 440 * Math.pow(2, (midi - 69) / 12);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.35, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      g.connect(this.master);
      [[1, 1], [2, 0.35], [3, 0.12], [4, 0.06]].forEach(([k, a]) => {
        const o = c.createOscillator(), og = c.createGain();
        o.type = 'sine'; o.frequency.value = f * k; og.gain.value = a;
        o.connect(og); og.connect(g); o.start(t); o.stop(t + dur + 0.05);
      });
      this._deaf(dur * 1000 + 150);
    },
    /** Little two-note "ding" for correct notes (high, short, quiet). */
    chime() {
      if (!this.running) return;
      const c = this.ctx, t = c.currentTime;
      [[1568, 0], [2093, 0.07]].forEach(([f, dt]) => {
        const o = c.createOscillator(), g = c.createGain();
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t + dt);
        g.gain.exponentialRampToValueAtTime(0.12, t + dt + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.25);
        o.connect(g); g.connect(this.master); o.start(t + dt); o.stop(t + dt + 0.3);
      });
      this._deaf(380);
    },
    /** Happy arpeggio at the end of the song. */
    fanfare() {
      if (!this.running) return;
      [72, 76, 79, 84].forEach((m, i) => setTimeout(() => this.playNote(m, 0.5), i * 120));
    },
    /** Metronome click (a short noise tick; not a pitched note). */
    click(accent) {
      if (!this.running) return;
      const c = this.ctx, t = c.currentTime;
      const len = Math.floor(c.sampleRate * 0.02);
      const b = c.createBuffer(1, len, c.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len / 6));
      const s = c.createBufferSource(), g = c.createGain(), f = c.createBiquadFilter();
      f.type = 'bandpass'; f.frequency.value = accent ? 3000 : 2000;
      g.gain.value = accent ? 0.5 : 0.3;
      s.buffer = b; s.connect(f); f.connect(g); g.connect(this.master); s.start(t);
      this._deaf(60);
    },

    // ---------------------------------------------------------------
    // Microphone
    // ---------------------------------------------------------------
    mic: { stream: null, analyser: null, buf: null, source: null },

    micSupported() { return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia); },

    /**
     * Ask for the microphone. Resolves to 'ok' or rejects with an Error whose
     * .code is 'insecure' | 'unsupported' | 'denied' | 'nodevice' | 'other'.
     */
    async startMic() {
      if (this.mic.stream) return 'ok';
      if (!root.isSecureContext) throw Object.assign(new Error('insecure'), { code: 'insecure' });
      if (!this.micSupported()) throw Object.assign(new Error('unsupported'), { code: 'unsupported' });
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
          video: false,
        });
      } catch (e) {
        const code = (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) ? 'denied'
          : (e && (e.name === 'NotFoundError' || e.name === 'OverconstrainedError')) ? 'nodevice' : 'other';
        throw Object.assign(new Error(e && e.message || code), { code });
      }
      if (!this.ctx) this.unlock();
      if (this.ctx.state !== 'running') { try { await this.ctx.resume(); } catch (e) { /* ignore */ } }
      const src = this.ctx.createMediaStreamSource(stream);
      const an = this.ctx.createAnalyser();
      an.fftSize = 2048;               // ~43 ms at 48 kHz, ~46 ms at 44.1 kHz
      an.smoothingTimeConstant = 0;
      src.connect(an);                 // (not connected to the speakers)
      this.mic = { stream, analyser: an, source: src, buf: new Float32Array(an.fftSize) };
      // If the track ends (e.g. iOS took the mic away), tell the app.
      stream.getAudioTracks().forEach(tr => tr.addEventListener('ended', () => { this.stopMic(); if (this.onMicEnded) this.onMicEnded(); }));
      return 'ok';
    },
    stopMic() {
      if (this.mic.stream) this.mic.stream.getTracks().forEach(t => t.stop());
      if (this.mic.source) try { this.mic.source.disconnect(); } catch (e) { /* ignore */ }
      this.mic = { stream: null, analyser: null, buf: null, source: null };
    },
    get micOn() { return !!this.mic.analyser; },
    /** Latest audio window (Float32Array) or null. */
    readMic() {
      if (!this.mic.analyser) return null;
      this.mic.analyser.getFloatTimeDomainData(this.mic.buf);
      return this.mic.buf;
    },

    // ---------------------------------------------------------------
    // Web MIDI (desktop Chrome/Edge; not available on iPad Safari)
    // ---------------------------------------------------------------
    midiAccess: null,
    midiSupported() { return typeof navigator.requestMIDIAccess === 'function' && root.isSecureContext; },
    async startMidi(onNote, onDevices) {
      if (!this.midiSupported()) return false;
      try {
        this.midiAccess = this.midiAccess || await navigator.requestMIDIAccess({ sysex: false });
      } catch (e) { return false; }
      const hook = () => {
        const names = [];
        this.midiAccess.inputs.forEach(inp => {
          names.push(inp.name || 'MIDI keyboard');
          inp.onmidimessage = (ev) => {
            const [st, note, vel] = ev.data;
            if ((st & 0xf0) === 0x90 && vel > 0) onNote(note, vel);
          };
        });
        onDevices(names);
      };
      this.midiAccess.onstatechange = hook;
      hook();
      return true;
    },
  };
})(typeof self !== 'undefined' ? self : this);
