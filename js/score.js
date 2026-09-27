/*
 * score.js — renders a song as sheet music with abcjs and knows where every
 * note is on screen, so the practice engine can move the cursor, colour notes
 * and add note-name labels.
 *
 * Score.events[i] = {
 *   rest, midis:[..], sp:{letter,acc,octave}, startBeat, beats, bar, line,
 *   els:[SVG <g>], heads:[SVG <path>], x (cursor x, px, relative to the wrap)
 * }
 */
(function (root) {
  'use strict';
  const PP = root.PP = root.PP || {};
  const M = PP.music;

  const ACC_MAP = { sharp: 1, flat: -1, natural: 0, dblsharp: 2, dblflat: -2 };
  const SCALES = { small: 1.35, medium: 1.7, large: 2.1, xlarge: 2.6 };

  class Score {
    /** wrap: scrolling container (position:relative); it gets an inner div + cursor. */
    constructor(wrap) {
      this.wrap = wrap;
      this.inner = document.createElement('div');
      this.inner.className = 'score-inner';
      this.cursor = document.createElement('div');
      this.cursor.className = 'score-cursor';
      this.ring = document.createElement('div');
      this.ring.className = 'target-ring';
      this.wrap.append(this.inner, this.cursor, this.ring);
      this.events = [];
      this.lines = [];
      this.states = [];
      this.targetIndex = -1;
    }

    /**
     * Render a prepared song (from PP.music.prepareSong).
     * opts: { size, hand: 'rh'|'lh', namesBelow, namesInHeads, nameStyle, width }
     */
    render(prep, opts) {
      opts = opts || {};
      this.prep = prep; this.opts = opts;
      let abc = (opts.fingers === false ? M.stripFingers(prep.abc) : prep.abc).replace(/^T:.*(\r?\n|$)/m, '').replace(/^Q:.*(\r?\n|$)/m, ''); // title & tempo are shown by the app // the title is shown in the app header
      const directives = [];
      if (opts.namesBelow) directives.push('%%staffsep 84', '%%sysstaffsep 64');
      else directives.push('%%staffsep 64');
      abc = abc.replace(/^(X:.*)$/m, '$1\n' + directives.join('\n'));
      const width = opts.width || this.wrap.clientWidth || 800;
      const height = this.wrap.clientHeight || 400;
      const maxScale = (SCALES[opts.size] || SCALES.large) * (width < 700 ? 0.8 : 1);
      const barsPerLine = prep.look === 'open' ? 4 : (prep.time && prep.time[0] >= 6 ? 2 : 4);
      // Try the chosen size first; if the song doesn't fit on screen, shrink a
      // little (down to 60%) so short songs are fully visible without scrolling.
      let res, scale = maxScale;
      for (let attempt = 0; attempt < 8; attempt++) {
        const staffwidth = Math.max(300, (width - 30) / scale);
        this.inner.innerHTML = '';
        res = root.ABCJS.renderAbc(this.inner, abc, {
          add_classes: true, staffwidth, responsive: 'resize',
          wrap: { minSpacing: 1.6, maxSpacing: 3.2, preferredMeasuresPerLine: barsPerLine },
          paddingtop: 10, paddingbottom: opts.namesBelow ? 36 : 16, paddingleft: 10, paddingright: 10,
          selectTypes: false,
        });
        const svgH = [...this.inner.querySelectorAll('svg')].reduce((h, el) => h + el.getBoundingClientRect().height, 0);
        if (opts.noFit || svgH <= height - 16 || scale <= Math.max(1.2, maxScale * 0.6)) break;
        scale = Math.max(1.2, maxScale * 0.6, scale * 0.88);
      }
      this.scale = scale;
      this.tune = res && res[0];
      this.warnings = (this.tune && this.tune.warnings) || [];
      this._extract(prep, opts);
      this._measure();
      if (opts.namesBelow || opts.namesInHeads) this._labels(opts);
      this.applyStates();
      return this;
    }

    /** Walk the abcjs tune structure and build the list of playable events. */
    _extract(prep, opts) {
      const tune = this.tune;
      const events = [];
      this.lineInfo = [];
      if (!tune) { this.events = events; return; }
      const nStaffs = Math.max(...tune.lines.map(l => (l.staff ? l.staff.length : 0)));
      const staffIdx = opts.hand === 'lh' && nStaffs > 1 ? 1 : 0;
      this.staffIdx = staffIdx; this.nStaffs = nStaffs;
      let beat = 0, bar = 0, barHasNotes = false, tripletMult = 1, tripletLeft = 0;
      tune.lines.forEach((line, li) => {
        if (!line.staff) return;
        const st = line.staff[staffIdx] || line.staff[0];
        const keyAcc = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 };
        ((st.key && st.key.accidentals) || []).forEach(a => { keyAcc[a.note.toUpperCase()] = ACC_MAP[a.acc] || 0; });
        let barAcc = {};
        const info = { line: li, bars: [] };
        this.lineInfo.push(info);
        const voice = st.voices[0] || [];
        for (const el of voice) {
          if (el.el_type === 'bar') {
            barAcc = {};
            if (barHasNotes) { bar++; barHasNotes = false; }
            if (el.abselem && el.abselem.elemset && el.abselem.elemset[0]) info.bars.push(el.abselem.elemset[0]);
            continue;
          }
          if (el.el_type !== 'note') continue;
          if (el.startTriplet) { tripletMult = el.tripletMultiplier || 2 / 3; tripletLeft = el.startTriplet; }
          let beats = (el.duration || 0) * 4 * (tripletLeft > 0 ? tripletMult : 1);
          if (tripletLeft > 0) tripletLeft--;
          const abs = el.abselem || {};
          const els = abs.elemset ? abs.elemset.slice() : [];
          const heads = (abs.heads || []).map(h => h.graphelem).filter(Boolean);
          if (el.rest) {
            if (el.rest.type === 'spacer' || /invisible/.test(el.rest.type)) { beat += beats; continue; }
            events.push({ rest: true, midis: [], beats, startBeat: beat, bar, line: li, els, heads });
            beat += beats; barHasNotes = true; continue;
          }
          const sps = (el.pitches || []).map(p => {
            const pitch = p.pitch;
            const letter = M.LETTERS[((pitch % 7) + 7) % 7];
            const octave = 4 + Math.floor(pitch / 7);
            let acc;
            if (p.accidental && ACC_MAP.hasOwnProperty(p.accidental)) { acc = ACC_MAP[p.accidental]; barAcc[pitch] = acc; }
            else acc = barAcc.hasOwnProperty(pitch) ? barAcc[pitch] : keyAcc[letter];
            return { letter, acc, octave, endTie: !!p.endTie };
          });
          if (!sps.length) continue;
          const midis = sps.map(M.spellToMidi);
          const prev = events[events.length - 1];
          if (sps.every(s => s.endTie) && prev && !prev.rest && prev.midis[0] === midis[0]) {
            prev.beats += beats; prev.els.push(...els); prev.tiedHeads = (prev.tiedHeads || []).concat(heads);
            beat += beats; barHasNotes = true; continue;
          }
          let top = 0; midis.forEach((m, i) => { if (m > midis[top]) top = i; });
          // finger number from ABC: !1!..!5! decoration (above) or "_1".."_5" annotation (below = left hand)
          let finger = null, hand = staffIdx === 1 ? 'L' : 'R';
          (el.decoration || []).forEach(d => { if (/^[1-5]$/.test(d)) finger = +d; });
          (el.chord || []).forEach(c => { if (/^[1-5]$/.test(c.name)) { finger = +c.name; if (c.position === 'below') hand = 'L'; } });
          events.push({ rest: false, midis, sp: sps[top], beats, startBeat: beat, bar, line: li, els, heads, open: el.duration >= 0.5, finger, hand });
          beat += beats; barHasNotes = true;
        }
      });
      // Simple-format songs: use the typed spelling and real lengths
      // ("look: open" draws every note as a round whole note).
      if (prep.format === 'simple' && prep.hands) {
        const src = prep.hands[staffIdx === 1 ? 'lh' : 'rh'];
        if (src && src.length === events.length) {
          let b = 0;
          events.forEach((e, i) => {
            const s = src[i];
            e.beats = s.beats; e.startBeat = b; b += s.beats;
            if (!s.rest && !e.rest) { e.sp = s.sp; e.midis = [s.midi]; e.finger = s.finger || null; e.hand = s.hand || e.hand; }
          });
        }
      }
      this.events = events;
      this.totalBeats = events.length ? events[events.length - 1].startBeat + events[events.length - 1].beats : 0;
      this.barCount = events.length ? events[events.length - 1].bar + 1 : 0;
      if (this.states.length !== events.length) this.states = new Array(events.length).fill(null);
    }

    /** Screen positions (relative to the wrap's scrolling content). */
    _measure() {
      const wr = this.wrap.getBoundingClientRect();
      const ox = -wr.left + this.wrap.scrollLeft, oy = -wr.top + this.wrap.scrollTop;
      const rectOf = el => { const r = el.getBoundingClientRect(); return { left: r.left + ox, right: r.right + ox, top: r.top + oy, bottom: r.bottom + oy, width: r.width, height: r.height }; };
      this.events.forEach(e => {
        const target = e.heads[0] || e.els[0];
        if (!target) { e.x = 0; return; }
        const r = rectOf(target);
        e.headRect = r;
        e.x = r.left + r.width / 2;
      });
      // Staff extents per line (from the bar lines of the practised staff)
      this.lines = {};
      this.lineInfo.forEach(info => {
        const evs = this.events.filter(e => e.line === info.line);
        let top, bottom, right, left;
        if (info.bars.length) {
          const rs = info.bars.map(rectOf);
          top = Math.min(...rs.map(r => r.top)); bottom = Math.max(...rs.map(r => r.bottom));
          right = Math.max(...rs.map(r => r.right));
        }
        if (evs.length) {
          const hs = evs.map(e => e.headRect).filter(Boolean);
          if (top === undefined) { top = Math.min(...hs.map(r => r.top)); bottom = Math.max(...hs.map(r => r.bottom)); }
          left = Math.min(...hs.map(r => r.left)) - 40;
          if (right === undefined) right = Math.max(...hs.map(r => r.right)) + 20;
        }
        if (top !== undefined) this.lines[info.line] = { top, bottom, left: Math.max(0, left || 0), right };
      });
    }

    /** Coloured note names below the staff and/or letters inside note heads. */
    _labels(opts) {
      const style = opts.nameStyle;
      const svgNS = 'http://www.w3.org/2000/svg';
      // lowest point (in SVG units) per line, so labels sit in one tidy row
      const lineLow = {};
      this.lineInfo.forEach(info => {
        let low = -Infinity;
        info.bars.forEach(b => { try { const bb = b.getBBox(); low = Math.max(low, bb.y + bb.height); } catch (e) { /* ignore */ } });
        this.events.filter(e => e.line === info.line && !e.rest && e.heads[0]).forEach(e => {
          try { const bb = e.heads[0].getBBox(); low = Math.max(low, bb.y + bb.height); } catch (err) { /* ignore */ }
        });
        lineLow[info.line] = low;
      });
      this.events.forEach(e => {
        if (e.rest || !e.heads[0] || !e.els[0]) return;
        let bb; try { bb = e.heads[0].getBBox(); } catch (err) { return; }
        const cx = bb.x + bb.width / 2;
        const g = e.els[0];
        if (opts.namesBelow) {
          const t = document.createElementNS(svgNS, 'text');
          t.setAttribute('x', cx); t.setAttribute('y', lineLow[e.line] + 16);
          t.setAttribute('text-anchor', 'middle');
          t.setAttribute('class', 'pp-label-below');
          t.setAttribute('fill', M.NOTE_COLORS[e.sp.letter]);
          t.textContent = M.noteName(e.sp, style);
          g.appendChild(t);
        }
        if (opts.namesInHeads) {
          const t = document.createElementNS(svgNS, 'text');
          const txt = style === 'letters' ? e.sp.letter : M.SOLFEGE[e.sp.letter];
          const fs = Math.min(bb.height * 1.05, (bb.width * 1.5) / Math.max(1, txt.length));
          t.setAttribute('x', cx); t.setAttribute('y', bb.y + bb.height / 2 + fs * 0.36);
          t.setAttribute('text-anchor', 'middle');
          t.setAttribute('font-size', fs.toFixed(2));
          t.setAttribute('class', 'pp-label-head' + (e.open ? ' open' : ''));
          t.textContent = txt;
          g.appendChild(t);
        }
      });
    }

    // ------------------------------------------------------------------
    // States & cursor
    // ------------------------------------------------------------------
    /** state: null | 'target' | 'correct' | 'missed' */
    setState(i, state) {
      this.states[i] = state;
      const e = this.events[i]; if (!e) return;
      e.els.forEach(el => {
        el.classList.remove('pp-target', 'pp-correct', 'pp-missed');
        if (state) el.classList.add('pp-' + state);
      });
      if (state === 'target') this._placeRing(i); else if (this.targetIndex === i) this.hideRing();
    }
    applyStates() { this.states.forEach((s, i) => this.setState(i, s)); }
    clearStates() { this.states = new Array(this.events.length).fill(null); this.applyStates(); this.hideRing(); }
    /** Brief orange flash on a wrong note (gentle, no sound). */
    flashWrong(i) {
      const e = this.events[i]; if (!e) return;
      e.els.forEach(el => { el.classList.remove('pp-wrong'); void el.getBBox; el.classList.add('pp-wrong'); });
      clearTimeout(e._wt);
      e._wt = setTimeout(() => e.els.forEach(el => el.classList.remove('pp-wrong')), 650);
      this.ring.classList.remove('wobble'); void this.ring.offsetWidth; this.ring.classList.add('wobble');
    }
    _placeRing(i) {
      const e = this.events[i]; if (!e || !e.headRect) return;
      this.targetIndex = i;
      const r = e.headRect, size = Math.max(r.width, r.height) * 2.6;
      Object.assign(this.ring.style, { left: (r.left + r.width / 2 - size / 2) + 'px', top: (r.top + r.height / 2 - size / 2) + 'px', width: size + 'px', height: size + 'px', display: 'block' });
    }
    hideRing() { this.ring.style.display = 'none'; this.targetIndex = -1; }

    /**
     * Put the cursor between event i and the next one. frac 0..1.
     * i = -1 means the lead-in before the first note.
     */
    setCursor(i, frac) {
      const ev = this.events;
      if (!ev.length) return;
      let x, lineIdx;
      if (i < 0) {
        const e0 = ev[0]; lineIdx = e0.line;
        const L = this.lines[lineIdx];
        const x0 = Math.max(L ? L.left : 0, e0.x - 90);
        x = x0 + (e0.x - x0) * frac;
      } else if (i >= ev.length) {
        const last = ev[ev.length - 1]; lineIdx = last.line;
        x = (this.lines[lineIdx] || {}).right || last.x;
      } else {
        const e = ev[i], n = ev[i + 1];
        lineIdx = e.line;
        const L = this.lines[lineIdx] || { right: e.x + 60 };
        const xEnd = n && n.line === e.line ? n.x : L.right - 4;
        x = e.x + (xEnd - e.x) * Math.max(0, Math.min(1, frac));
      }
      const L = this.lines[lineIdx];
      if (!L) return;
      const pad = 18;
      this.cursor.style.transform = `translate(${x - 3}px, ${L.top - pad}px)`;
      this.cursor.style.height = (L.bottom - L.top + pad * 2) + 'px';
      this.cursor.style.display = 'block';
      if (lineIdx !== this._curLine) { this._curLine = lineIdx; this._scrollToLine(L); }
    }
    hideCursor() { this.cursor.style.display = 'none'; this._curLine = -1; }
    _scrollToLine(L) {
      const w = this.wrap, top = L.top - 50, bottom = L.bottom + 90;
      if (top < w.scrollTop || bottom > w.scrollTop + w.clientHeight) {
        w.scrollTo({ top: Math.max(0, top - 10), behavior: 'smooth' });
      }
    }
  }
  PP.Score = Score;
})(typeof self !== 'undefined' ? self : this);
