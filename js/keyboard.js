/*
 * keyboard.js — on-screen piano keyboard (touch + mouse).
 * Tapping a key calls onPress(midi). Keys can glow (hint), flash (heard,
 * correct, wrong) and show note names.
 */
(function (root) {
  'use strict';
  const PP = root.PP = root.PP || {};
  const M = PP.music;

  class Keyboard {
    constructor(el, onPress) {
      this.el = el; this.onPress = onPress;
      this.keys = {}; this.low = 48; this.high = 83;
      this.labels = true; this.style = 'solfege';
      // one pointer = one key press; stop the page from scrolling/zooming
      el.addEventListener('pointerdown', (ev) => {
        const k = ev.target.closest('.key'); if (!k) return;
        ev.preventDefault();
        const midi = +k.dataset.midi;
        k.classList.add('pressed');
        setTimeout(() => k.classList.remove('pressed'), 180);
        this.onPress(midi);
      });
      el.addEventListener('contextmenu', ev => ev.preventDefault());
      el.addEventListener('touchstart', ev => { if (ev.target.closest('.key')) ev.preventDefault(); }, { passive: false });
    }
    /** Build keys from low..high (both snapped to whole octaves C..B). */
    build(low, high, labels, style) {
      this.low = low - (((low % 12) + 12) % 12);
      this.high = M.isBlack(high) ? high + 1 : high;
      this.labels = labels; this.style = style;
      this.el.innerHTML = '';
      this.keys = {};
      const whites = [];
      for (let m = this.low; m <= this.high; m++) if (!M.isBlack(m)) whites.push(m);
      const wPct = 100 / whites.length;
      whites.forEach((m, i) => {
        const k = this._key(m, 'white');
        k.style.left = (i * wPct) + '%'; k.style.width = wPct + '%';
        this.el.appendChild(k);
      });
      for (let m = this.low; m <= this.high; m++) {
        if (!M.isBlack(m)) continue;
        const wi = whites.indexOf(m - 1);
        const k = this._key(m, 'black');
        const bw = wPct * 0.62;
        k.style.left = ((wi + 1) * wPct - bw / 2) + '%'; k.style.width = bw + '%';
        this.el.appendChild(k);
      }
    }
    _key(m, color) {
      const k = document.createElement('div');
      k.className = 'key ' + color + (m === 60 ? ' middle-c' : '');
      k.dataset.midi = m;
      const sp = M.midiToSpell(m);
      if (this.labels) {
        const lab = document.createElement('span');
        lab.className = 'key-label';
        lab.textContent = M.noteName(sp, this.style);
        if (color === 'white') lab.style.color = M.NOTE_COLORS[sp.letter];
        k.appendChild(lab);
      }
      if (m === 60) { const d = document.createElement('span'); d.className = 'mc-dot'; d.title = 'Middle C'; k.appendChild(d); }
      this.keys[m] = k;
      return k;
    }
    /** Find the key for a MIDI note; if outside the range, the same note name in range. */
    keyFor(midi, anyOctave) {
      if (this.keys[midi]) return this.keys[midi];
      if (!anyOctave) return null;
      let m = midi;
      while (m < this.low) m += 12;
      while (m > this.high) m -= 12;
      return this.keys[m] || null;
    }
    flash(midi, cls, ms) {
      const k = this.keyFor(midi, true); if (!k) return;
      k.classList.remove(cls); void k.offsetWidth; k.classList.add(cls);
      clearTimeout(k['_t' + cls]);
      k['_t' + cls] = setTimeout(() => k.classList.remove(cls), ms || 400);
    }
    /** Small finger-number badge on a key (the key to play next). */
    showFinger(midi, finger) {
      this.clearFinger();
      const k = this.keyFor(midi, true); if (!k || !finger) return;
      const b = document.createElement('span');
      b.className = 'finger-badge'; b.textContent = finger;
      k.appendChild(b); this._finger = b;
    }
    clearFinger() { if (this._finger) this._finger.remove(); this._finger = null; }
    hint(midi) {
      this.clearHint();
      const k = this.keyFor(midi, true); if (k) { k.classList.add('hint'); this._hint = k; }
    }
    clearHint() { if (this._hint) this._hint.classList.remove('hint'); this._hint = null; }
  }
  PP.Keyboard = Keyboard;
})(typeof self !== 'undefined' ? self : this);
