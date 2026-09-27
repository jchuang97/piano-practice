/*
 * music.js — note names (solfege / letters), hint texts, and the song formats.
 *
 *  - Simple format ("Si4 q, Fa#4 q, Mi4 q |") is parsed into events and
 *    converted to ABC notation, which abcjs renders as real sheet music.
 *  - ABC songs are passed straight through (with a few defaults added).
 *  - MusicXML (uncompressed .musicxml/.xml) can be imported into the simple format.
 *
 * Works in the browser (PP.music) and in Node (require) for tests.
 */
(function (root) {
  'use strict';

  const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  const LETTER_SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const SOLFEGE = { C: 'Do', D: 'Re', E: 'Mi', F: 'Fa', G: 'Sol', A: 'La', B: 'Si' };
  const SOLFEGE_TO_LETTER = { do: 'C', re: 'D', mi: 'E', fa: 'F', sol: 'G', la: 'A', si: 'B' };
  // Colours for note-name labels (inspired by the teacher's sheet:
  // Si green, Fa purple, Mi pink, Re green).
  const NOTE_COLORS = { C: '#e53935', D: '#2e9e5b', E: '#e84fa0', F: '#8e44ec', G: '#f08c00', A: '#1e88e5', B: '#1faa59' };

  // Sharps are the default spelling for sounds that are heard (not written).
  const SHARP_SPELL = [['C', 0], ['C', 1], ['D', 0], ['D', 1], ['E', 0], ['F', 0], ['F', 1], ['G', 0], ['G', 1], ['A', 0], ['A', 1], ['B', 0]];

  /** {letter, acc (-2..2), octave} -> MIDI number (C4 = 60). */
  function spellToMidi(sp) { return 12 * (sp.octave + 1) + LETTER_SEMI[sp.letter] + (sp.acc || 0); }
  /** MIDI -> {letter, acc, octave} using sharps. */
  function midiToSpell(midi) {
    const pc = ((midi % 12) + 12) % 12;
    const [letter, acc] = SHARP_SPELL[pc];
    return { letter, acc, octave: Math.floor(midi / 12) - 1 };
  }
  function isBlack(midi) { return [1, 3, 6, 8, 10].indexOf(((midi % 12) + 12) % 12) >= 0; }

  const ACC_TEXT = { '-2': 'bb', '-1': 'b', '0': '', '1': '#', '2': '##' };
  const ACC_WORD = {
    solfege: { '-1': 'bemol', '1': 'sostenido', '-2': 'doble bemol', '2': 'doble sostenido' },
    letters: { '-1': 'flat', '1': 'sharp', '-2': 'double flat', '2': 'double sharp' },
  };

  /**
   * Human name of a note. style: 'solfege' (Do Re Mi, default) or 'letters'.
   * opts.octave: append the octave number (Fa#4).
   */
  function noteName(sp, style, opts) {
    if (typeof sp === 'number') sp = midiToSpell(sp);
    opts = opts || {};
    const base = style === 'letters' ? sp.letter : SOLFEGE[sp.letter];
    return base + ACC_TEXT[String(sp.acc || 0)] + (opts.octave ? sp.octave : '');
  }
  /** "Fa# (Fa sostenido)" style long name for hints. */
  function noteNameLong(sp, style) {
    if (typeof sp === 'number') sp = midiToSpell(sp);
    const short = noteName(sp, style);
    if (!sp.acc) return short;
    const base = style === 'letters' ? sp.letter : SOLFEGE[sp.letter];
    return `${short} (${base} ${ACC_WORD[style === 'letters' ? 'letters' : 'solfege'][String(sp.acc)]})`;
  }

  /** Where to find a key on the piano, in child-friendly words. */
  function keyHint(sp, style) {
    if (typeof sp === 'number') sp = midiToSpell(sp);
    const midi = spellToMidi(sp);
    const pc = ((midi % 12) + 12) % 12;
    const n = l => noteName({ letter: l, acc: 0 }, style);
    const white = {
      0: `the WHITE key just left of the 2 black keys`,
      2: `the WHITE key in the middle of the 2 black keys`,
      4: `the WHITE key just right of the 2 black keys`,
      5: `the WHITE key just left of the 3 black keys`,
      7: `the WHITE key between the 1st and 2nd of the 3 black keys`,
      9: `the WHITE key between the 2nd and 3rd of the 3 black keys`,
      11: `the WHITE key just right of the 3 black keys`,
    };
    const black = {
      1: `the BLACK key just to the right of ${n('C')} (the 1st of the 2 black keys)`,
      3: `the BLACK key just to the right of ${n('D')} (the 2nd of the 2 black keys)`,
      6: `the BLACK key just to the right of ${n('F')} (the 1st of the 3 black keys)`,
      8: `the BLACK key just to the right of ${n('G')} (the middle one of the 3 black keys)`,
      10: `the BLACK key just to the right of ${n('A')} (the 3rd of the 3 black keys)`,
    };
    let where = white[pc] || black[pc];
    if (midi === 60) where += ' (Middle ' + n('C') + ')';
    return where;
  }

  // ------------------------------------------------------------------
  // Simple song format
  // ------------------------------------------------------------------
  const DUR_BEATS = { w: 4, h: 2, q: 1, e: 0.5, s: 0.25 }; // in quarter-note beats

  // Keys: number of sharps (+) / flats (-) for major keys and relative minors.
  const KEY_FIFTHS = {
    'C': 0, 'G': 1, 'D': 2, 'A': 3, 'E': 4, 'B': 5, 'F#': 6, 'C#': 7, 'F': -1, 'Bb': -2, 'Eb': -3, 'Ab': -4, 'Db': -5, 'Gb': -6, 'Cb': -7,
    'Am': 0, 'Em': 1, 'Bm': 2, 'F#m': 3, 'C#m': 4, 'G#m': 5, 'D#m': 6, 'Dm': -1, 'Gm': -2, 'Cm': -3, 'Fm': -4, 'Bbm': -5, 'Ebm': -6,
  };
  function keyAccidentals(fifths) {
    const acc = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 };
    const sharps = ['F', 'C', 'G', 'D', 'A', 'E', 'B'], flats = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];
    if (fifths > 0) for (let i = 0; i < fifths; i++) acc[sharps[i]] = 1;
    if (fifths < 0) for (let i = 0; i < -fifths; i++) acc[flats[i]] = -1;
    return acc;
  }
  function normaliseKey(k) {
    if (!k) return 'C';
    let s = k.trim().replace(/\s+/g, '');
    const m = s.match(/^(do|re|mi|fa|sol|la|si|[a-g])([#b]?)(m|min|minor|menor)?$/i) ||
              s.match(/^(do|re|mi|fa|sol|la|si|[a-g])([#b]?)(maj|major|mayor)?$/i);
    if (!m) return null;
    let letter = m[1].length > 1 ? SOLFEGE_TO_LETTER[m[1].toLowerCase()] : m[1].toUpperCase();
    const minor = m[3] && /^m(in|inor|enor)?$/i.test(m[3]);
    const name = letter + (m[2] || '') + (minor ? 'm' : '');
    return KEY_FIFTHS.hasOwnProperty(name) ? name : null;
  }

  // note name, accidental, octave, optional /finger (1-5, optional R/L hand), optional length
const NOTE_RE = /^(sol|do|re|mi|fa|la|si|[a-g])(##|bb|#|b|s)?(-?\d)(?:\/(?:([1-5])([rl])?|([rl])([1-5])))?(?:[:/]?(w|h|q|e|s)(\.)?)?$/i;
  const FINGER_NAMES = { 1: 'thumb', 2: 'index', 3: 'middle', 4: 'ring', 5: 'pinky' };
  const REST_RE = /^(r|rest|z|silencio)(?:[:/](w|h|q|e|s)(\.)?)?$/i;
  const DUR_RE = /^(w|h|q|e|s)(\.)?$/;

  /**
   * Parse the simple format. Returns
   * { title, tempo, time:[n,d], key, clef, look, hands:{rh:[events], lh:[events]},
   *   errors:[{line, msg}], warnings:[...] }
   * Event: { rest, sp:{letter,acc,octave}, midi, beats, bar, line }
   */
  function parseSimple(text) {
    const res = { title: '', tempo: 80, time: [4, 4], key: 'C', clef: 'treble', look: 'normal', hands: { rh: [], lh: [] }, errors: [], warnings: [] };
    const lines = String(text || '').replace(/\r/g, '').split('\n');
    lines.forEach((raw, li) => {
      const lineNo = li + 1;
      let line = raw.replace(/\/\/.*$/, '').trim();
      if (!line) return;
      const hm = line.match(/^(title|titulo|título|tempo|time|meter|key|clef|look|lh|rh|left|right)\s*:\s*(.*)$/i);
      let hand = 'rh';
      if (hm) {
        const field = hm[1].toLowerCase(), val = hm[2].trim();
        if (field === 'title' || field === 'titulo' || field === 'título') { res.title = val; return; }
        if (field === 'tempo') {
          const t = parseInt(val, 10);
          if (!(t >= 20 && t <= 240)) res.errors.push({ line: lineNo, msg: `Tempo should be a number between 20 and 240 (beats per minute), e.g. "tempo: 80".` });
          else res.tempo = t;
          return;
        }
        if (field === 'time' || field === 'meter') {
          const m = val.match(/^(\d+)\s*\/\s*(\d+)$/);
          if (!m || [2, 4, 8, 16].indexOf(+m[2]) < 0 || +m[1] < 1 || +m[1] > 16) res.errors.push({ line: lineNo, msg: `Time signature should look like 4/4, 3/4 or 6/8.` });
          else res.time = [+m[1], +m[2]];
          return;
        }
        if (field === 'key') {
          const k = normaliseKey(val);
          if (!k) res.errors.push({ line: lineNo, msg: `I don't know the key "${val}". Try C, G, F, D, Bb, Am...` });
          else res.key = k;
          return;
        }
        if (field === 'clef') {
          const v = val.toLowerCase();
          if (v !== 'treble' && v !== 'bass') res.errors.push({ line: lineNo, msg: `Clef can be "treble" or "bass".` });
          else res.clef = v;
          return;
        }
        if (field === 'look') {
          const v = val.toLowerCase();
          if (v !== 'open' && v !== 'normal') res.errors.push({ line: lineNo, msg: `Look can be "normal" or "open" (open = round notes without stems, like a teacher's sheet).` });
          else res.look = v;
          return;
        }
        hand = (field === 'lh' || field === 'left') ? 'lh' : 'rh';
        line = val;
      }
      const target = res.hands[hand];
      // tokens separated by spaces/commas; bar lines may touch notes
      const tokens = line.replace(/\|/g, ' | ').split(/[\s,;]+/).filter(Boolean);
      let lastTokBad = false;
      for (const tok of tokens) {
        const errCount = res.errors.length;
        lastTokBad = handleTok(tok, lastTokBad) || res.errors.length > errCount;
      }
      function handleTok(tok, prevBad) {
        if (tok === '|' ) { target.push({ bar: true, line: lineNo }); return; }
        if (DUR_RE.test(tok)) {
          const prev = target[target.length - 1];
          if (prevBad) return true; // the note before already had an error
          if (!prev || prev.bar || prev._durSet) { res.errors.push({ line: lineNo, msg: `"${tok}" is a note length, but there's no note right before it.` }); return; }
          const m = tok.match(DUR_RE);
          prev.beats = DUR_BEATS[m[1]] * (m[2] ? 1.5 : 1); prev._durSet = true; return;
        }
        let m = tok.match(REST_RE);
        if (m) {
          const ev = { rest: true, beats: 1, line: lineNo };
          if (m[2]) { ev.beats = DUR_BEATS[m[2].toLowerCase()] * (m[3] ? 1.5 : 1); ev._durSet = true; }
          target.push(ev); return;
        }
        m = tok.match(NOTE_RE);
        if (m) {
          const name = m[1].toLowerCase();
          const letter = name.length > 1 ? SOLFEGE_TO_LETTER[name] : name.toUpperCase();
          const a = (m[2] || '').toLowerCase();
          const acc = a === '#' || a === 's' ? 1 : a === 'b' ? -1 : a === '##' ? 2 : a === 'bb' ? -2 : 0;
          const octave = parseInt(m[3], 10);
          const sp = { letter, acc, octave };
          const ev = { rest: false, sp, midi: spellToMidi(sp), beats: 1, line: lineNo, hand: hand === 'lh' ? 'L' : 'R' };
          const finger = m[4] || m[7];
          const handLetter = m[5] || m[6];
          if (finger) ev.finger = +finger;
          if (handLetter) ev.hand = handLetter.toUpperCase();
          if (m[8]) { ev.beats = DUR_BEATS[m[8].toLowerCase()] * (m[9] ? 1.5 : 1); ev._durSet = true; }
          if (ev.midi < 24 || ev.midi > 108) res.errors.push({ line: lineNo, msg: `"${tok}" is outside the piano range.` });
          target.push(ev); return;
        }
        // Friendly diagnosis of common mistakes
        if (/^(sol|do|re|mi|fa|la|si|[a-g])(##|bb|#|b|s)?-?\d\/\w*/i.test(tok)) {
          res.errors.push({ line: lineNo, msg: `"${tok}": after the / put a finger number 1–5 (1 = thumb, 5 = pinky), like Si4/5 or Si4/5 q.` });
          return;
        }
        const noOct = tok.match(/^(sol|do|re|mi|fa|la|si|[a-g])(##|bb|#|b)?(w|h|q|e|s)?$/i);
        if (noOct) {
          res.errors.push({ line: lineNo, msg: `"${tok}" needs an octave number, like ${noOct[1]}${noOct[2] || ''}4 (4 = the octave of Middle C).` + (/^re$/i.test(tok) ? ' For a rest of one eighth, write "R e".' : '') });
        } else {
          res.errors.push({ line: lineNo, msg: `I don't understand "${tok}". Notes look like Do4, Fa#4, Si4 or C4, F#4, B4; rests are R; lengths are w h q e s.` });
        }
      }
    });
    for (const h of ['rh', 'lh']) res.hands[h].forEach(e => delete e._durSet);
    if (!res.hands.rh.some(e => !e.bar && !e.rest)) {
      if (res.hands.lh.some(e => !e.bar && !e.rest)) { res.hands.rh = res.hands.lh; res.hands.lh = []; if (res.clef === 'treble') res.clef = 'bass'; }
      else res.errors.push({ line: 0, msg: 'Type some notes, for example:  Do4 q, Re4 q, Mi4 h |' });
    }
    // Bar length check (warnings only; first bar may be a pick-up, last may be short)
    const barBeats = res.time[0] * 4 / res.time[1];
    for (const h of ['rh', 'lh']) {
      const bars = [[]];
      res.hands[h].forEach(e => { if (e.bar) bars.push([]); else bars[bars.length - 1].push(e); });
      const nonEmpty = bars.filter(b => b.length);
      nonEmpty.forEach((b, i) => {
        const sum = b.reduce((s, e) => s + e.beats, 0);
        if (Math.abs(sum - barBeats) > 1e-6 && i !== 0 && i !== nonEmpty.length - 1 && res.look !== 'open') {
          res.warnings.push(`${h === 'lh' ? 'Left hand, b' : 'B'}ar ${i + 1} has ${fmtBeats(sum)} beat${sum === 1 ? '' : 's'}, but ${res.time[0]}/${res.time[1]} needs ${fmtBeats(barBeats)}.`);
        }
      });
    }
    return res;
  }
  function fmtBeats(b) { return Number.isInteger(b) ? String(b) : b.toFixed(2).replace(/0+$/, ''); }

  /** ABC pitch text for a spelled note (without accidental). */
  function abcPitch(sp) {
    let s;
    if (sp.octave >= 5) s = sp.letter.toLowerCase() + "'".repeat(sp.octave - 5);
    else s = sp.letter + ','.repeat(Math.max(0, 4 - sp.octave));
    return s;
  }
  const ABC_ACC = { '-2': '__', '-1': '_', '0': '=', '1': '^', '2': '^^' };

  /** Convert one hand's events to an ABC voice body. L:1/16 is used. */
  function handToAbc(events, keyName, time, look) {
    const keyAcc = keyAccidentals(KEY_FIFTHS[keyName] || 0);
    let barState = {}; // "E4" -> current accidental in this bar
    let out = '', posInBar = 0;
    const beatUnits = time[1] === 8 && time[0] % 3 === 0 ? 6 : 4 * 4 / time[1] * (time[1] === 2 ? 1 : 1); // 16ths per beam group
    let prevShort = false;
    events.forEach((e) => {
      if (e.bar) { out += ' |'; barState = {}; posInBar = 0; prevShort = false; return; }
      let units = Math.round(e.beats * 4);
      if (look === 'open' && !e.rest) units = 16; // whole-note heads, no stems
      let tok;
      if (e.rest) tok = 'z';
      else {
        const k = e.sp.letter + e.sp.octave;
        const current = barState.hasOwnProperty(k) ? barState[k] : keyAcc[e.sp.letter];
        let accTxt = '';
        if (current !== e.sp.acc) { accTxt = ABC_ACC[String(e.sp.acc)]; barState[k] = e.sp.acc; }
        tok = accTxt + abcPitch(e.sp);
        // finger numbers: above the note for the right hand, below for the left
        if (e.finger) tok = (e.hand === 'L' ? `"_${e.finger}"` : `!${e.finger}!`) + tok;
      }
      tok += units === 1 ? '/' : (units === 4 && look !== 'open' ? '4' : String(units));
      // beam eighths/sixteenths that fall in the same beat group
      const short = units < 4 && !e.rest;
      const sameGroup = Math.floor(posInBar / beatUnits) === Math.floor((posInBar + units - 1) / beatUnits);
      const groupStart = posInBar % beatUnits === 0;
      if (short && prevShort && !groupStart && sameGroup) out += tok; else out += ' ' + tok;
      prevShort = short;
      posInBar += Math.round(e.beats * 4);
    });
    out = out.trim();
    if (!/\|\s*$/.test(out)) out += ' |]'; else out = out.replace(/\|\s*$/, '|]');
    return out;
  }

  /** Convert a parsed simple song to ABC text. */
  function simpleToAbc(p) {
    const head = [`X:1`, `T:${p.title || 'My song'}`, `M:${p.time[0]}/${p.time[1]}`, `L:1/16`, `Q:1/4=${p.tempo}`];
    const keyAbc = p.key;
    if (p.hands.lh.length) {
      head.push('%%staves {1 2}');
      head.push(`K:${keyAbc}`);
      return head.join('\n') + `\nV:1 clef=treble\n${handToAbc(p.hands.rh, p.key, p.time, p.look)}\nV:2 clef=bass\n${handToAbc(p.hands.lh, p.key, p.time, p.look)}\n`;
    }
    head.push(`K:${keyAbc} clef=${p.clef}`);
    return head.join('\n') + '\n' + handToAbc(p.hands.rh, p.key, p.time, p.look) + '\n';
  }

  /** Remove finger numbers (!1!..!5! and "_1".."_5") from ABC text. */
  function stripFingers(abc) { return String(abc).replace(/![1-5]!/g, '').replace(/"[_^]?[1-5]"/g, ''); }

  /** Read T:/Q:/M: from ABC text and add X: if missing. */
  function prepareAbc(text) {
    let abc = String(text || '').replace(/\r/g, '').trim();
    const errors = [], warnings = [];
    if (!/^X:/m.test(abc)) abc = 'X:1\n' + abc;
    if (!/^K:/m.test(abc)) {
      // K: must be the last header line; add it after the headers
      const lines = abc.split('\n'); let i = 0;
      while (i < lines.length && /^[A-Za-z]:/.test(lines[i])) i++;
      lines.splice(i, 0, 'K:C'); abc = lines.join('\n');
      warnings.push('No key line (K:) found, so I used K:C.');
    }
    const t = (abc.match(/^T:(.*)$/m) || [])[1];
    let tempo = 80;
    const q = (abc.match(/^Q:(.*)$/m) || [])[1];
    if (q) {
      const m = q.match(/(\d+)\s*\/\s*(\d+)\s*=\s*(\d+)/) || q.match(/^\s*(\d+)\s*$/);
      if (m && m.length === 4) tempo = Math.round(+m[3] * (+m[1] / +m[2]) * 4); // convert to quarter-note bpm
      else if (m) tempo = +m[1];
    }
    const mm = (abc.match(/^M:\s*(\d+)\/(\d+)/m) || []);
    const time = mm[1] ? [+mm[1], +mm[2]] : (/^M:\s*C\|/m.test(abc) ? [2, 2] : [4, 4]);
    return { abc, title: t ? t.trim() : 'My song', tempo, time, errors, warnings };
  }

  /**
   * Turn a stored song {format, text} into something the score can render:
   * { abc, title, tempo, time, look, events (simple format only), errors, warnings }
   */
  function prepareSong(song) {
    if (song.format === 'abc') {
      const r = prepareAbc(song.text);
      r.format = 'abc';
      return r;
    }
    const p = parseSimple(song.text);
    const out = { format: 'simple', title: p.title || song.title || 'My song', tempo: p.tempo, time: p.time, look: p.look,
      errors: p.errors, warnings: p.warnings, parsed: p, abc: '' };
    if (!p.errors.length) out.abc = simpleToAbc(Object.assign({}, p, { title: out.title }));
    out.hands = { rh: p.hands.rh.filter(e => !e.bar), lh: p.hands.lh.filter(e => !e.bar) };
    return out;
  }

  // ------------------------------------------------------------------
  // MusicXML import (uncompressed). Converts the first part/voice to the
  // simple format. Chords: top note only. Needs DOMParser (browser).
  // ------------------------------------------------------------------
  function musicXmlToSimple(xmlText) {
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('This file is not valid MusicXML.');
    const part = doc.getElementsByTagName('part')[0];
    if (!part) throw new Error('No music part found in this file.');
    const title = (doc.querySelector('work-title') || doc.querySelector('movement-title') || {}).textContent || 'Imported song';
    let divisions = 1, beats = 4, beatType = 4, fifths = 0, tempo = 80, clef = 'treble';
    const soundTempo = doc.querySelector('sound[tempo]');
    if (soundTempo) tempo = Math.round(parseFloat(soundTempo.getAttribute('tempo')));
    const bars = [];
    const txt = (el, sel) => { const n = el.querySelector(sel); return n ? n.textContent.trim() : null; };
    for (const measure of part.getElementsByTagName('measure')) {
      const attrs = measure.querySelector('attributes');
      if (attrs) {
        if (txt(attrs, 'divisions')) divisions = +txt(attrs, 'divisions');
        if (txt(attrs, 'time beats')) { beats = +txt(attrs, 'time beats'); beatType = +txt(attrs, 'time beat-type'); }
        if (txt(attrs, 'key fifths') !== null) fifths = +txt(attrs, 'key fifths');
        const sign = txt(attrs, 'clef sign'); if (sign === 'F') clef = 'bass';
      }
      const toks = [];
      for (const note of measure.getElementsByTagName('note')) {
        if (note.querySelector('chord') || note.querySelector('grace')) continue;
        const voice = txt(note, 'voice'); if (voice && voice !== '1') continue;
        const staff = txt(note, 'staff'); if (staff && staff !== '1') continue;
        const dur = +(txt(note, 'duration') || 0) / divisions; // in quarter beats
        const tie = note.querySelector('tie[type="stop"]');
        const d = beatsToDur(dur);
        if (note.querySelector('rest')) { toks.push('R ' + d); continue; }
        const step = txt(note, 'pitch step'), oct = txt(note, 'pitch octave'), alter = +(txt(note, 'pitch alter') || 0);
        if (!step) continue;
        if (tie && toks.length) continue; // tied continuation: keep first note only
        const fing = txt(note, 'technical fingering');
        toks.push(step + (alter === 1 ? '#' : alter === -1 ? 'b' : alter === 2 ? '##' : alter === -2 ? 'bb' : '') + oct + (/^[1-5]$/.test(fing || '') ? '/' + fing : '') + ' ' + d);
      }
      bars.push(toks.join(', '));
    }
    const keyNames = { '-7': 'Cb', '-6': 'Gb', '-5': 'Db', '-4': 'Ab', '-3': 'Eb', '-2': 'Bb', '-1': 'F', '0': 'C', '1': 'G', '2': 'D', '3': 'A', '4': 'E', '5': 'B', '6': 'F#', '7': 'C#' };
    return `title: ${title.trim()}\ntempo: ${tempo}\ntime: ${beats}/${beatType}\nkey: ${keyNames[String(fifths)] || 'C'}\n` +
      (clef === 'bass' ? 'clef: bass\n' : '') + bars.map(b => b + ' |').join('\n') + '\n';
  }
  function beatsToDur(b) {
    const table = [[6, 'w.'], [4, 'w'], [3, 'h.'], [2, 'h'], [1.5, 'q.'], [1, 'q'], [0.75, 'e.'], [0.5, 'e'], [0.25, 's']];
    let best = table[0], bd = Infinity;
    for (const t of table) { const d = Math.abs(t[0] - b); if (d < bd) { bd = d; best = t; } }
    return best[1];
  }

  const api = { LETTERS, SOLFEGE, NOTE_COLORS, LETTER_SEMI, spellToMidi, midiToSpell, isBlack, noteName, noteNameLong, keyHint,
    parseSimple, simpleToAbc, prepareAbc, prepareSong, musicXmlToSimple, stripFingers, FINGER_NAMES, keyAccidentals, KEY_FIFTHS, DUR_BEATS };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.PP = root.PP || {}; root.PP.music = api; }
})(typeof self !== 'undefined' ? self : this);
