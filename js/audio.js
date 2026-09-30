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

    /**
     * Must be called from a user gesture (tap/click). Safe to call often.
     * If the context is broken (closed, iOS "interrupted", or its clock stopped
     * moving - this can happen on iOS after the microphone changes the audio
     * route), a fresh AudioContext is made right here, inside the tap.
     */
    unlock() {
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return null;
      if (this.ctx && (this.ctx.state === 'closed' || this.ctx.state === 'interrupted' || this.stalled)) this.recreate();
      if (!this.ctx) this._create(AC);
      if (this.ctx.state !== 'running') { try { const p = this.ctx.resume(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* ignore */ } }
      // Play a silent buffer: the classic iOS unlock trick.
      try {
        const b = this.ctx.createBuffer(1, 1, 22050), s = this.ctx.createBufferSource();
        s.buffer = b; s.connect(this.ctx.destination); s.start(0);
      } catch (e) { /* ignore */ }
      return this.ctx;
    },
    _create(AC) {
      AC = AC || root.AudioContext || root.webkitAudioContext;
      const ctx = new AC({ latencyHint: 'interactive' });
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = 0.8;
      this.master.connect(ctx.destination);
      this.stalled = false; this._clock = null;
      // iOS may "interrupt" the context (phone call, Siri, lock screen)
      ctx.onstatechange = () => { if (ctx === this.ctx && this.onStateChange) this.onStateChange(ctx.state); };
      this.contexts = (this.contexts || 0) + 1;
    },
    /** Replace the AudioContext (keeps a running microphone connected). */
    recreate() {
      const old = this.ctx, stream = this.mic.stream;
      this.voices = [];
      if (this.mic.source) try { this.mic.source.disconnect(); } catch (e) { /* ignore */ }
      this._create();
      if (stream) {
        const src = this.ctx.createMediaStreamSource(stream), an = this.ctx.createAnalyser();
        an.fftSize = 2048; an.smoothingTimeConstant = 0; src.connect(an);
        this.mic = { stream, analyser: an, source: src, buf: new Float32Array(an.fftSize) };
      }
      if (old) { old.onstatechange = null; try { const p = old.close(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* ignore */ } }
    },
    /** Called every frame: notices a "running" context whose clock is stuck. */
    checkClock(nowMs) {
      const c = this.ctx;
      if (!c || c.state !== 'running') { this._clock = null; return; }
      if (!this._clock || this._clock.t !== c.currentTime) { this._clock = { t: c.currentTime, wall: nowMs }; this.stalled = false; }
      else if (nowMs - this._clock.wall > 700) this.stalled = true;
    },
    /** iOS (Safari 17+) audio session: 'playback' while the app plays music. */
    setSession(type) {
      try { if (navigator.audioSession && navigator.audioSession.type !== type) navigator.audioSession.type = type; } catch (e) { /* ignore */ }
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
    /**
     * Piano-like note for Listen mode, scheduled at AudioContext time `when`
     * (seconds) for `dur` seconds. A few slightly stretched partials that fade
     * at different rates + a closing low-pass give a soft, round piano tone.
     * Voices are remembered so stopVoices() can silence everything at once.
     */
    pianoNote(midi, when, dur, vel) {
      if (!this.ctx) return;
      const c = this.ctx, f = 440 * Math.pow(2, (midi - 69) / 12);
      const t = Math.max(c.currentTime, when || 0), v = (vel || 0.8) * 0.32;
      dur = Math.max(0.12, dur || 0.5);
      const ring = Math.max(0.6, Math.min(3.5, 2.6 - (midi - 60) * 0.04)); // low notes ring longer
      const end = t + dur, stopAt = end + 0.35;
      const out = c.createGain(), lp = c.createBiquadFilter();
      lp.type = 'lowpass'; lp.Q.value = 0.4;
      lp.frequency.setValueAtTime(Math.min(12000, f * 10), t);
      lp.frequency.setTargetAtTime(Math.min(6000, f * 3.5), t + 0.02, 0.25);
      out.gain.setValueAtTime(0.0001, t);
      out.gain.linearRampToValueAtTime(v, t + 0.006);
      out.gain.setTargetAtTime(v * 0.35, t + 0.01, ring * 0.35);
      out.gain.setTargetAtTime(0.0001, end, 0.07);                       // key released
      lp.connect(out); out.connect(this.master);
      const oscs = [];
      [[1, 1], [2, 0.5], [3, 0.22], [4, 0.12], [5, 0.06], [6, 0.03]].forEach(([k, a]) => {
        const o = c.createOscillator(), og = c.createGain();
        o.type = 'sine';
        o.frequency.value = f * k * (1 + 0.0004 * k * k);                 // slight string stretch
        og.gain.setValueAtTime(a, t);
        og.gain.setTargetAtTime(a * 0.15, t + 0.01, ring / (k * 1.3));    // upper partials fade first
        o.connect(og); og.connect(lp); o.start(t); o.stop(stopAt);
        oscs.push(o);
      });
      const voice = { oscs, out, stopAt };
      this.voices = (this.voices || []).filter(x => x.stopAt > c.currentTime);
      this.voices.push(voice);
      return voice;
    },
    /** Silence every scheduled Listen-mode note (fast fade, no click). */
    stopVoices() {
      if (!this.ctx || !this.voices) return;
      const t = this.ctx.currentTime;
      this.voices.forEach(vc => {
        try { vc.out.gain.cancelScheduledValues(t); vc.out.gain.setTargetAtTime(0.0001, t, 0.03); } catch (e) { /* ignore */ }
        vc.oscs.forEach(o => { try { o.stop(t + 0.2); } catch (e) { /* ignore */ } });
      });
      this.voices = [];
    },
    /** Countdown tick: a soft wooden "tok" (3, 2, 1) and a brighter one for Go. */
    countTick(go) {
      if (!this.running) return;
      const c = this.ctx, t = c.currentTime;
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'triangle'; o.frequency.setValueAtTime(go ? 1046 : 784, t);
      o.frequency.exponentialRampToValueAtTime(go ? 1000 : 700, t + 0.12);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(go ? 0.2 : 0.14, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (go ? 0.35 : 0.16));
      o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.4);
      this._deaf(go ? 450 : 260);
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
    startMic() {
      if (this.mic.stream) return Promise.resolve('ok');
      if (!this._micP) this._micP = this._startMic().finally(() => { this._micP = null; });
      return this._micP;
    },
    async _startMic() {
      // Never capture while the session is 'playback' (set for Listen): iOS ends
      // or silences a microphone track unless the type is play-and-record/auto.
      this.setSession('play-and-record');
      const gen = this._micGen = (this._micGen || 0) + 1;
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
      if (gen !== this._micGen) { stream.getTracks().forEach(t => t.stop()); return 'cancelled'; }  // Listen started meanwhile
      if (this.mic.stream) { stream.getTracks().forEach(t => t.stop()); return 'ok'; }
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
    /**
     * Listen mode: really switch the microphone OFF (not just ignore it). On
     * iOS an open microphone keeps the page in "play-and-record" (phone-call
     * style audio route), which can make the app's own music very quiet or
     * silent. The 'playback' session gives normal loud speaker output.
     */
    releaseMicForPlayback() {
      const had = !!this.mic.stream || !!this._micP;
      this._micGen = (this._micGen || 0) + 1;   // a mic start still in progress is dropped
      this.stopMic();
      this.setSession('playback');
      return had;
    },
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
