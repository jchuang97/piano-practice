/*
 * app.js — screens, settings, input (mic / MIDI / on-screen keys) and the
 * glue between the practice engine and the user interface.
 */
(function () {
  'use strict';
  const PP = window.PP;
  const M = PP.music, store = PP.store, audio = PP.audio;
  const $ = (id) => document.getElementById(id);

  const app = PP.app = {
    settings: store.getSettings(),
    song: null, prep: null,
    started: false,       // audio unlocked & inputs chosen at least once
    input: 'screen',      // what is actually being used: 'mic' | 'midi' | 'screen'
    midiDevices: [],
  };
  const S = () => app.settings;

  // ------------------------------------------------------------------ screens
  function show(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id));
    app.screen = id;
    if (id !== 'practice') { stopListen('away'); cancelCountdown(); }
    if (id !== 'practice' && app.engine && !app.engine.paused) pausePractice();
  }

  // ------------------------------------------------------------------ home
  const CARD_COLORS = ['#8b5cf6', '#ec4899', '#f97316', '#10b981', '#3b82f6', '#eab308', '#06b6d4', '#ef4444'];
  const CARD_EMOJI = ['🌟', '🐑', '🥐', '✨', '🎶', '🦋', '🐢', '🌈', '🚀', '🐱'];
  function renderHome() {
    const grid = $('songGrid');
    grid.innerHTML = '';
    store.getSongs().forEach((song, i) => {
      const b = document.createElement('button');
      b.className = 'song-card' + (i === 0 && song.id === 'lazy-song' ? ' first' : '');
      b.style.background = `linear-gradient(135deg, ${CARD_COLORS[i % CARD_COLORS.length]}, ${CARD_COLORS[(i + 3) % CARD_COLORS.length]})`;
      const p = M.prepareSong(song);
      b.innerHTML = `<span class="emoji">${CARD_EMOJI[i % CARD_EMOJI.length]}</span><span>${esc(p.title || song.title)}</span>`;
      b.addEventListener('click', () => openSong(song.id));
      grid.appendChild(b);
    });
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  // ------------------------------------------------------------------ practice screen
  function openSong(id) {
    const song = store.getSongs().find(s => s.id === id);
    if (!song) return;
    const prep = M.prepareSong(song);
    if (prep.errors.length) { toast('This song has a mistake in it. Open ⚙️ to fix it.'); return; }
    stopListen('away'); cancelCountdown();
    app.song = song; app.prep = prep;
    show('practice');
    $('songTitle').textContent = prep.title;
    app.engine.load(prep.tempo, prep.time);
    const saved = store.getSongSpeed(song.id);           // speed picked with 🐢/🐰 last time
    if (saved !== null) app.engine.setManualSpeed(saved, true);
    renderScore();
    if (layoutHandPanel()) renderScore();   // the music gets narrower/wider
    buildKeyboard();
    fillLoopSelects();
    updateBadges();
    $('hintBox').classList.remove('show');
    hideFinger();
    showStartOverlay('start');
    setPlayButton();
  }
  /** kind 'start' = normal ▶ Start, 'try' = after Listen: "Now you try!" */
  function showStartOverlay(kind) {
    $('startOverlay').hidden = false;
    $('startOverlay').classList.toggle('try', kind === 'try');
    if (kind === 'try') {
      $('btnStart').innerHTML = '🎹&nbsp; Now you try!';
      $('startNote').innerHTML = "That's how it sounds! 🎶 Now it's your turn.<br>Tap 👂 Listen to hear it again.";
    } else {
      $('btnStart').innerHTML = '▶&nbsp; Start';
      $('startNote').innerHTML = startNoteText();
    }
  }

  function renderScore() {
    if (!app.prep) return;
    const s = S();
    app.score.render(app.prep, { fingers: s.showFingers, size: s.size, hand: s.hand, namesBelow: s.namesBelow, namesInHeads: s.namesInHeads, nameStyle: s.nameStyle });
    if (app.engine && app.engine.phase !== 'idle') app.engine._drawCursor(); else app.score.setCursor(-1, 0);
  }

  function buildKeyboard() {
    const s = S();
    let low, high;
    if (s.kbAuto && app.score.events.length) {
      const ms = []; app.score.events.forEach(e => ms.push(...e.midis));
      const mn = Math.min(...ms), mx = Math.max(...ms);
      low = mn - (mn % 12); high = mx + (11 - (mx % 12));
      const treble = (mn + mx) / 2 >= 57;
      while (high - low < 23) { if (treble) high += 12; else low -= 12; }
      if (low > 60) low = 60 - (high - low < 35 ? 0 : 0);  // keep middle C visible
    } else {
      low = +s.kbStart; high = low + 12 * (+s.kbOctaves) - 1;
    }
    app.kb.build(low, high + 1 /* finish on a C */, s.keyLabels, s.nameStyle);
  }

  function fillLoopSelects() {
    const n = Math.max(1, app.score.barCount || 1);
    for (const id of ['loopFrom', 'loopTo']) {
      const sel = $(id); sel.innerHTML = '';
      for (let i = 1; i <= n; i++) sel.add(new Option(String(i), String(i)));
    }
    $('loopFrom').value = '1'; $('loopTo').value = String(Math.min(n, 2));
    $('btnLoop').classList.remove('on');
    $('btnLoop').parentElement.classList.remove('on');
  }

  function startNoteText() {
    const parts = [];
    if (!window.isSecureContext) parts.push('⚠️ This page is not on https, so the microphone cannot be used here. The on-screen keys still work.');
    else if (S().input === 'screen') parts.push('The app will listen to the on-screen keys only (change this in ⚙️).');
    else parts.push('When you tap Start, allow the <b>microphone</b> so the app can hear the piano.');
    if (S().mode === 'wait') parts.push('The pink line waits at each note until you play it.');
    else parts.push('Play along: the line keeps moving. If a part is tricky, we play it again a little slower.');
    return parts.join('<br>');
  }

  function updateBadges() {
    const sp = app.engine ? app.engine.speedPct : 100;
    const b = $('speedBadge');
    b.textContent = `${sp}%`;
    b.title = `Speed ${sp}%` + (app.engine && app.engine.manualSpeed !== null ? ' (chosen with 🐢/🐰)' : '');
    b.classList.toggle('slow', sp < 100);
    b.classList.toggle('fast', sp > 100);
    $('btnSlower').disabled = sp <= PP.Practice.SPEED_MIN;
    $('btnFaster').disabled = sp >= PP.Practice.SPEED_MAX;
    $('modeBadge').textContent = S().mode === 'wait' ? '✋ Wait for me' : '🎵 Play along';
    $('btnMode').textContent = S().mode === 'wait' ? '✋ Wait' : '🎵 Play along';
    $('btnMode').classList.toggle('on', S().mode === 'playalong');
    $('btnMetro').classList.toggle('on', !!S().metronome);
    const icon = app.input === 'midi' ? '🎹' : app.input === 'mic' ? '🎤' : '👆';
    $('inputIcon').textContent = icon;
    $('inputIcon').title = app.input === 'midi' ? 'Keyboard connected (MIDI): ' + app.midiDevices.join(', ') : app.input === 'mic' ? 'Listening with the microphone' : 'On-screen keys';
  }
  function setPlayButton() {
    const e = app.engine, b = $('btnPlay');
    const playing = !!app.counting || (e && (e.phase === 'lead' || e.phase === 'moving' || e.phase === 'waiting') && !e.paused);
    b.textContent = playing ? '⏸' : '▶';
    b.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  }

  // ------------------------------------------------------------------ start / inputs
  async function onStartTap() {
    audio.unlock();                           // must happen inside the tap (iOS)
    stopListen('practice');
    $('startOverlay').hidden = true;
    if (!app.started) {
      app.started = true;
      await chooseInput();
    } else if (app.input === 'mic' && !audio.micOn) {
      await chooseInput();
    }
    startPractice();
  }

  async function chooseInput() {
    const want = S().input;
    app.input = 'screen';
    if (want === 'screen') { audio.stopMic(); updateBadges(); return; }
    if ((want === 'auto' || want === 'midi') && audio.midiSupported()) {
      await audio.startMidi((note) => handleNote(note, 'midi'), (names) => {
        app.midiDevices = names;
        const prefer = names.length > 0 && (S().input === 'auto' || S().input === 'midi');
        if (prefer && app.input !== 'midi') { app.input = 'midi'; audio.stopMic(); toast('🎹 Keyboard connected: ' + names[0]); }
        else if (!names.length && app.input === 'midi' && S().input === 'auto') { app.input = 'screen'; startMic(); }
        updateBadges();
      });
      if (app.input === 'midi') { updateBadges(); return; }
    }
    if (want === 'midi') { toast('No MIDI keyboard found — using the on-screen keys.'); updateBadges(); return; }
    await startMic();
  }

  async function startMic() {
    app.micStartedAt = performance.now();
    try {
      const r = await audio.startMic();
      if (r === 'cancelled') { updateBadges(); return; }    // Listen was tapped meanwhile
      app.micStartedAt = performance.now();
      app.input = 'mic';
      app.micPaused = false;
      app.tracker.reset();
    } catch (err) {
      app.input = 'screen';
      showMicHelp(err.code || 'other');
    }
    updateBadges();
  }

  function showMicHelp(code) {
    const t = $('micHelpText');
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    let html = '';
    if (code === 'insecure') {
      html = `<p>The microphone only works when this page is opened from a secure address (<b>https://</b>…) or from <b>localhost</b> on this computer.</p><p>You can still practise with the keys on the screen.</p>`;
    } else if (code === 'denied') {
      html = `<p>The browser said <b>no</b> to the microphone. To allow it:</p><ul>` +
        (ios ? `<li><b>iPad / iPhone (Safari):</b> tap <b>aA</b> (or the page icon) in the address bar → <b>Website Settings</b> → <b>Microphone</b> → <b>Allow</b>. Then tap “Try again”.</li>
                 <li>If that doesn't help: open the <b>Settings</b> app → <b>Apps → Safari</b> → <b>Microphone</b> → <b>Allow</b> (or Ask), then reload this page.</li>`
             : `<li><b>Chrome (computer):</b> click the icon left of the address (🔒 or ⚙) → <b>Microphone</b> → <b>Allow</b>, then reload.</li>
                <li><b>Android Chrome:</b> ⋮ menu → <b>Settings</b> → <b>Site settings</b> → <b>Microphone</b> → allow this site.</li>
                <li><b>Safari (Mac):</b> Safari menu → <b>Settings for this website</b> → <b>Microphone: Allow</b>.</li>`) +
        `</ul><p>Meanwhile you can use the on-screen keys.</p>`;
    } else if (code === 'nodevice') {
      html = `<p>No microphone was found. Check that one is connected, or use the on-screen keys.</p>`;
    } else if (code === 'unsupported') {
      html = `<p>This browser can't use the microphone. Please try <b>Safari</b> on iPad or <b>Chrome</b>.</p>`;
    } else {
      html = `<p>Something stopped the microphone from starting. Close other apps that use the microphone and tap “Try again”.</p>`;
    }
    t.innerHTML = html;
    $('micHelp').hidden = false;
    pausePractice();
  }

  // ------------------------------------------------------------------ practice control
  function startPractice() {
    stopListen('practice');
    hideEnd(); hideFinger();
    app.kb.clearHint();
    $('hintBox').classList.remove('show');
    $('startOverlay').hidden = true;
    resumeMicAfterListen();
    const loopOn = $('btnLoop').classList.contains('on');
    app.engine.setLoop(loopOn ? +$('loopFrom').value : null, loopOn ? +$('loopTo').value : null);
    app.engine.reset();                       // (stops an old run; nothing is scored during the countdown)
    app.score.setCursor(-1, 0);
    renderStars();
    runCountdown(() => {
      // after 3-2-1 the line starts right away (one beat of lead-in, also in play-along)
      app.engine.start(performance.now(), S().countdown ? 1 : 0);
      setPlayButton(); updateBadges();
      if (!S().countdown && S().mode === 'playalong') bubble('Get ready… 🎵', 'good', 1500);
    });
    setPlayButton(); updateBadges();
  }
  /** The mic was switched off for Listen: switch it back on for practice. */
  function resumeMicAfterListen() {
    if (app.micPaused && !audio.micOn) { app.micPaused = false; startMic(); }
  }
  function pausePractice() {
    if (app.counting) { const wasResume = app.counting.resume; cancelCountdown(); if (!wasResume) showStartOverlay('start'); }
    if (app.engine && app.engine.phase !== 'idle' && app.engine.phase !== 'done') { app.engine.pause(); setPlayButton(); }
  }
  function togglePlay() {
    audio.unlock();
    if (app.counting) { pausePractice(); return; }            // tap during 3-2-1 = stop
    if (app.listening) { stopListen('practice'); onStartTap(); return; }
    const e = app.engine;
    if (e.phase === 'idle' || e.phase === 'done') { if ($('startOverlay').hidden) startPractice(); else onStartTap(); return; }
    if (e.paused) { resumeMicAfterListen(); runCountdown(() => { e.resume(performance.now()); setPlayButton(); }, true); }
    else e.pause();
    setPlayButton();
  }

  // ------------------------------------------------------------------ 3-2-1 countdown
  // Big numbers, one per second (3, 2, 1, then "Go! ⭐"), with an optional soft
  // "tok". Practice (and scoring) only starts at Go. Stop / Home / Listen cancel it.
  const COUNT_MS = 1000;
  /** opt: { message (html card shown first), messageMs, stepMs (shorter count) } */
  function runCountdown(onGo, resume, opt) {
    opt = opt || {};
    cancelCountdown();
    const numbers = !!S().countdown;
    if (!numbers && !opt.message) { onGo(); return; }
    const el = $('countdown');
    const c = app.counting = { timers: [], resume: !!resume };
    app.countdownTimers = c.timers;
    const step = opt.stepMs || COUNT_MS;
    const showStep = (n) => {
      el.hidden = false;
      el.innerHTML = n > 0 ? `<div class="cd-bubble cd-${n}" style="animation-duration:${step}ms"><span>${n}</span></div>`
                           : `<div class="cd-bubble cd-go"><span>Go!</span><i>⭐</i></div>`;
      if (S().countdownSound) audio.countTick(n === 0);
      if (app.tracker) app.tracker.reset();
    };
    const at = (ms, fn) => { if (ms <= 0) fn(); else c.timers.push(setTimeout(fn, ms)); };
    let t = 0;
    if (opt.message) { el.hidden = false; el.innerHTML = `<div class="cd-message">${opt.message}</div>`; t = opt.messageMs || 2200; }
    if (numbers) { [3, 2, 1].forEach((n, k) => at(t + k * step, () => showStep(n))); t += 3 * step; }
    at(t, () => {
      if (numbers) showStep(0); else el.hidden = true;
      app.counting = null;                    // practice starts now
      onGo();
      setPlayButton();
      if (numbers) c.timers.push(setTimeout(() => { if (!app.counting) el.hidden = true; }, 700));
    });
  }
  function cancelCountdown() {
    if (app.countdownTimers) app.countdownTimers.forEach(clearTimeout);
    app.countdownTimers = null;
    const was = !!app.counting;
    app.counting = null;
    const el = $('countdown'); el.hidden = true; el.innerHTML = '';
    if (was) setPlayButton();
    return was;
  }

  // ------------------------------------------------------------------ speed (🐢 / 🐰)
  // A tap sets the speed by one 10 % step (30 %…120 %), works mid-song, and is
  // remembered for this song on this device. The chosen speed is also the
  // ceiling for the automatic speed-up (see practice.js).
  function stepSpeed(dir) {
    audio.unlock();
    const pct = app.engine.stepSpeed(dir);
    if (app.song) store.setSongSpeed(app.song.id, pct);
  }

  // ------------------------------------------------------------------ listen mode (👂)
  // The app plays the song (current speed, both hands), moves the cursor and
  // lights the keys. The microphone is ignored meanwhile so it doesn't hear
  // itself, and nothing is scored. Afterwards: "Now you try!".
  async function toggleListen() {
    if (app.listening) { audio.unlock(); stopListen('stopped'); return; }
    if (!app.prep || !app.score.events.length) return;
    cancelCountdown();
    // Switch the microphone really OFF first (not only ignored): on iOS an open
    // mic puts the page in phone-call style "play-and-record" audio, where the
    // app's own music can come out very quietly or not at all. Then unlock (or,
    // if the old context is broken, re-create) the AudioContext inside the tap.
    if (audio.releaseMicForPlayback() && S().input !== 'screen') app.micPaused = true;
    app.listenStarting = true;
    const ctx = audio.unlock();
    // stop any practice run: Listen never scores
    app.engine.reset();
    hideEnd(); hideFinger(); app.kb.clearHint();
    $('hintBox').classList.remove('show');
    $('startOverlay').hidden = true;
    const loopOn = $('btnLoop').classList.contains('on');
    app.engine.setLoop(loopOn ? +$('loopFrom').value : null, loopOn ? +$('loopTo').value : null);
    app.listening = true;
    setListenButton(); setPlayButton();
    // iOS resumes the AudioContext asynchronously: wait (briefly) until it runs
    if (ctx && ctx.state !== 'running') {
      try { await Promise.race([ctx.resume(), new Promise(r => setTimeout(r, 800))]); } catch (e) { /* ignore */ }
    }
    app.listenStarting = false;
    if (!app.listening) return;               // stopped while waiting
    if (!app.listener.start(performance.now(), app.engine._range())) { app.listening = false; setListenButton(); }
  }
  /** why: 'done' (finished) | 'stopped' (Stop tapped) | 'practice' | 'away' */
  function stopListen(why) {
    if (!app.listening) return;
    app.listening = false;
    if (app.listener.active) app.listener.stop();
    audio.stopVoices();
    audio._deaf(700);                         // let the last notes fade before listening again
    if (app.tracker) app.tracker.reset();
    $('bubble').classList.remove('show', 'listen');
    setListenButton(); setPlayButton();
    if (why === 'done' || why === 'stopped') showStartOverlay('try');
  }
  function setListenButton() {
    const b = $('btnListen');
    b.textContent = app.listening ? '⏹ Stop' : '👂 Listen';
    b.classList.toggle('on', !!app.listening);
    b.setAttribute('aria-label', app.listening ? 'Stop listening' : 'Listen to the song');
  }
  function showListenNote(e) {
    const b = $('bubble');
    clearTimeout(bubbleTimer);
    b.className = 'bubble show listen';
    if (!e) { b.textContent = '🤫'; return; }
    const style = S().nameStyle;
    b.innerHTML = '🎵 ' + e.midis.slice().sort((x, y) => x - y).map(m => {
      const sp = e.midis.length === 1 ? e.sp : M.midiToSpell(m);
      return `<span style="color:${M.NOTE_COLORS[sp.letter]}">${esc(M.noteName(sp, style))}</span>`;
    }).join(' ');
  }

  // ------------------------------------------------------------------ notes in
  /** Every played note ends up here (mic, MIDI or on-screen key). */
  function handleNote(midi, source) {
    if (PP.app.onNoteDebug) PP.app.onNoteDebug(midi, source);   // used by the automated tests
    if (source === 'screen' && S().keySound) audio.playNote(midi, 0.7);
    if (source !== 'screen') app.kb.flash(midi, 'heard', 300);
    if (source === 'midi' || source === 'screen') showHeard(midi);
    if (app.screen !== 'practice' || app.listening) return;   // Listen mode: nothing is scored
    const r = app.engine.input(midi);
    if (r === 'wrong') app.kb.flash(midi, 'oops', 500);
  }
  function showHeard(midi) {
    $('hearText').textContent = M.noteName(midi, S().nameStyle, { octave: true });
    app.heardUntil = performance.now() + 900;
  }

  // ------------------------------------------------------------------ feedback
  const PRAISE = ['Great! ⭐', 'Yay! 🎉', 'Super! 🌟', 'Well done! 👏', 'Nice! 😊', 'You got it! 💜', 'Wonderful! 🌈'];
  const GENTLE = ['Oops! Try again 🙂', 'Almost! 🙂', 'Try another key 🎹', 'Keep going! 💪'];
  let bubbleTimer = null;
  function bubble(text, kind, ms, hold) {
    // (hold: an important kind message - e.g. "let's keep going" - is not covered by small ones)
    const now = performance.now();
    if (!hold && now < (app.bubbleHold || 0)) return;
    app.bubbleHold = hold ? now + (ms || 1300) : 0;
    const b = $('bubble');
    b.textContent = text;
    b.className = 'bubble show ' + (kind || '');
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => b.classList.remove('show'), ms || 1300);
  }
  let toastTimer = null;
  function toast(text, ms) {
    const t = $('toast'); t.textContent = text; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms || 2600);
  }
  PP.ui = { toast, bubble };

  // ---- finger picture + finger number on the next key ----
  // The hand picture sits to the right of the music whenever the song has
  // finger numbers (and the setting is on); it lights up while waiting.
  function songHasFingers() { return !!(app.prep && /![1-5]!|"[_^][1-5]"/.test(app.prep.abc)); }
  function layoutHandPanel() {
    const want = !!(S().showFingers && app.prep && songHasFingers());
    const changed = $('handPanel').hidden === want;
    $('handPanel').hidden = !want;
    return changed;
  }
  function showFinger(i) {
    const e = app.score.events[i];
    if (!S().showFingers || !e || !e.finger) { hideFinger(); return; }
    $('handSvg').innerHTML = PP.handSVG(e.hand, e.finger);
    $('handText').innerHTML = `${e.hand === 'L' ? 'Left' : 'Right'} hand<br><b>finger ${e.finger}</b> (${M.FINGER_NAMES[e.finger]})`;
    $('handPanel').classList.add('active');
    app.kb.showFinger(e.midis[0], e.finger);
  }
  function hideFinger() {
    const first = app.score && app.score.events.find(e => e.finger);
    $('handSvg').innerHTML = PP.handSVG(first ? first.hand : 'R', null);
    $('handText').innerHTML = 'Fingers<br><b>1</b> = thumb … <b>5</b> = pinky';
    $('handPanel').classList.remove('active');
    if (app.kb) app.kb.clearFinger();
  }
  function fingerWords(e) { return e.finger && S().showFingers ? `Use finger ${e.finger} (${M.FINGER_NAMES[e.finger]}) on ` : 'Find '; }

  // ---- per-part progress: one little star per note of the current part ----
  function renderStars() {
    const el = $('sectionStars'), e = app.engine;
    if (!e || !e.sectionsOn || e.phase === 'idle' || e.phase === 'done') { el.hidden = true; return; }
    const k = e.currentSection();
    const sc = e.sections[k];
    if (!sc) { el.hidden = true; return; }
    el.innerHTML = `<span class="part">Part ${k + 1}/${e.sections.length}</span>` + sc.notes.map(i => {
      const st = app.score.states[i];
      return st === 'correct' ? '<i class="st on">★</i>' : st === 'missed' ? '<i class="st miss">★</i>' : '<i class="st">☆</i>';
    }).join('');
    el.hidden = false;
  }

  const hooks = {
    onTarget(i) { showFinger(i); renderStars(); },
    onCorrect(i, firstTry) {
      if (S().mode === 'wait') hideFinger();
      if (S().successSound) audio.chime();
      const e = app.score.events[i];
      app.kb.flash(e.midis[0], 'good', 450);
      renderStars();
      const n = app.engine.stats.notes;
      if (!firstTry) bubble('You found it! 🎉', 'good');
      else if (n % 3 === 0) bubble(PRAISE[Math.floor(Math.random() * PRAISE.length)], 'good');
    },
    onWrong(i, count) {
      if (count < S().hintAfter) bubble(GENTLE[(count - 1) % GENTLE.length], 'soft', 1100);
    },
    onHint(i) {
      const e = app.score.events[i], style = S().nameStyle;
      app.kb.hint(e.midis[0]);
      $('hintBox').innerHTML = `💡 ${fingerWords(e)}<b>${esc(M.noteNameLong(e.sp, style))}</b> — it's ${esc(M.keyHint(e.sp, style))}.`;
      $('hintBox').classList.add('show');
      bubble('Look at the glowing key! ✨', 'slow', 1600);
    },
    onHintClear() { app.kb.clearHint(); $('hintBox').classList.remove('show'); },
    onSpeed(pct, dir) {
      updateBadges();
      if (dir === 'manual') { if (app.screen === 'practice' && !app.listening) bubble(`${pct < 100 ? '🐢' : pct > 100 ? '🐰' : '🎵'} ${pct}%`, 'good', 900); }
      else if (dir === 'down') bubble("Let's slow down a little! 🐢", 'slow', 2200);
      else if (app.counting) { /* (quiet while a message/countdown shows) */ }
      else bubble("You're doing great — a bit faster! 🚀", 'good', 2200);
    },
    onBeat(accent) { audio.click(accent); },
    onLoop() { bubble('Again! 🔁', 'good', 1000); },
    onPhase() { setPlayButton(); renderStars(); },
    onMiss() { renderStars(); },
    onSkip() { renderStars(); hideFinger(); bubble("Let's keep going! 🎵", 'good', 1600, true); },
    // play-along parts: never harsh - a kind message, one step slower, a short 3-2-1
    onSectionRetry(k, info) {
      updateBadges(); renderStars(); hideFinger();
      $('bubble').classList.remove('show'); app.bubbleHold = 0;
      const msg = `<div class="cdm-emoji">🐢</div><div class="cdm-title">Let's try that part again,<br>a little slower!</div>` +
        `<div class="cdm-sub">Speed ${info.pct}% · you can do it 💜</div>`;
      runCountdown(() => { app.engine.resume(performance.now()); setPlayButton(); }, true, { message: msg, messageMs: 2200, stepMs: 700 });
    },
    onSectionPass(k, info) { renderStars(); if (info.retried) bubble('You did it! 🎉', 'good', 1800, true); },
    onSectionMoveOn() { renderStars(); bubble("Great trying! Let's keep going 🌟", 'good', 2400, true); },
    onDone(stats) { hideFinger(); setTimeout(() => showEnd(stats), 500); },
  };

  // ------------------------------------------------------------------ end screen
  function showEnd(stats) {
    const total = Math.max(1, stats.notes);
    const ratio = stats.firstTry / total;
    const stars = ratio >= 0.85 ? 3 : ratio >= 0.5 ? 2 : 1;
    $('endTitle').textContent = stars === 3 ? 'Amazing! 🎉' : stars === 2 ? 'Great job! 🎉' : 'You did it! 🎉';
    $('endStars').innerHTML = [0, 1, 2].map(i => `<span class="${i < stars ? '' : 'dim'}">⭐</span>`).join('');
    const lines = [
      `🎵 Notes played: <b>${stats.notes}</b>`,
      S().mode === 'playalong' ? `✅ Notes on time: <b>${stats.notes - stats.missed}</b> of ${stats.notes}` : `✅ Right the first time: <b>${stats.firstTry}</b> of ${stats.notes}`,
      `💡 Hints used: <b>${stats.hints}</b>`,
      `🐢 Speed: <b>${stats.speed}%</b>`,
    ];
    if (stats.bestStreak >= 3) lines.push(`🔥 Best streak: <b>${stats.bestStreak}</b> notes in a row`);
    $('endStats').innerHTML = lines.map(l => `<li>${l}</li>`).join('');
    $('endScreen').hidden = false;
    audio.fanfare();
    confetti($('confetti'));
    setPlayButton();
  }
  function hideEnd() { $('endScreen').hidden = true; }

  function confetti(canvas) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * dpr; canvas.height = canvas.clientHeight * dpr;
    const colors = ['#ff7ab8', '#6d4aff', '#ffd43b', '#4ade80', '#38bdf8', '#fb923c'];
    const parts = Array.from({ length: 160 }, () => ({
      x: Math.random() * canvas.width, y: -Math.random() * canvas.height * 0.6,
      vx: (Math.random() - 0.5) * 2 * dpr, vy: (2 + Math.random() * 3) * dpr,
      s: (6 + Math.random() * 8) * dpr, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3,
      c: colors[Math.floor(Math.random() * colors.length)], star: Math.random() < 0.25,
    }));
    const t0 = performance.now();
    (function frame(now) {
      if ($('endScreen').hidden) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      parts.forEach(p => {
        p.x += p.vx; p.y += p.vy; p.r += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c;
        if (p.star) { ctx.font = `${p.s * 2}px sans-serif`; ctx.fillText('⭐', 0, 0); } else ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
        ctx.restore();
      });
      if (now - t0 < 5000) requestAnimationFrame(frame); else ctx.clearRect(0, 0, canvas.width, canvas.height);
    })(t0);
  }

  // ------------------------------------------------------------------ main loop
  function loop() {
    const now = performance.now();
    // Microphone: analyse the latest ~43 ms of audio every frame.
    if (audio.micOn && app.listening) {
      $('meterFill').style.width = '0%';          // Listen mode: the mic is not used
    } else if (audio.micOn) {
      const buf = audio.readMic();
      const level = PP.pitch.rms(buf);
      const pct = Math.min(1, Math.sqrt(level / 0.15));
      $('meterFill').style.width = (pct * 100).toFixed(0) + '%';
      if (now < audio.deafUntil) {
        app.tracker.deaf(now, level);            // ignore our own sounds
      } else {
        const gate = app.tracker.effectiveGate;
        const r = level > gate * 0.5 ? PP.pitch.yin(buf, audio.ctx.sampleRate) : null;
        const midi = app.tracker.process(now, level, r && r.freq, r && r.clarity);
        if (app.tracker.current !== null && app.tracker.current !== undefined) {
          $('hearText').textContent = M.noteName(app.tracker.current, S().nameStyle, { octave: true });
          app.heardUntil = now + 600;
          app.engine.activity();                 // wait mode: she is playing, don't skip
        }
        if (midi !== null) handleNote(midi, 'mic');
      }
      micWatch(now, buf, level);
    }
    if (app.heardUntil && now > app.heardUntil) { $('hearText').textContent = '–'; app.heardUntil = 0; }
    audio.checkClock(now);
    if (app.engine) app.engine.update(now);
    if (app.listener && app.listener.active) app.listener.update(now);
    requestAnimationFrame(loop);
  }

  /**
   * Microphone health: on iOS the mic can stop delivering sound without any
   * error (the AudioContext got suspended/interrupted when the audio session
   * switched, or the track went silent). A frozen analyser (identical samples)
   * for 1.5 s, or pure digital silence for 4 s, while practising => resume the
   * AudioContext and restart the microphone (at most every 15 s).
   */
  function micWatch(now, buf, level) {
    const w = app.micWatchState || (app.micWatchState = { sig: null, frozenSince: 0, zeroSince: 0, lastFix: -1e9 });
    let sig = 0; for (let i = 0; i < buf.length; i += 61) sig += buf[i] * (i + 1);
    if (sig === w.sig) w.frozenSince = w.frozenSince || now; else w.frozenSince = 0;
    w.sig = sig;
    if (level === 0) w.zeroSince = w.zeroSince || now; else w.zeroSince = 0;
    const bad = (w.frozenSince && now - w.frozenSince > 1500) || (w.zeroSince && now - w.zeroSince > 4000);
    if (!bad || app.screen !== 'practice' || app.listening || now - w.lastFix < 15000) return;
    w.lastFix = now; w.frozenSince = 0; w.zeroSince = 0;
    app.micFixes = (app.micFixes || 0) + 1;
    try { const p = audio.ctx.resume(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* ignore */ }
    audio.stopMic();
    startMic().then(() => { if (audio.micOn) toast('🎤 Listening again'); });
  }

  // ------------------------------------------------------------------ settings form
  const SETTINGS_UI = [
    { group: '🎵 Notes & music', rows: [
      { key: 'nameStyle', label: 'Note names', type: 'select', options: [['solfege', 'Do Re Mi (solfège)'], ['letters', 'C D E (letters)']] },
      { key: 'namesBelow', label: 'Coloured names under the notes', type: 'check' },
      { key: 'namesInHeads', label: 'Names inside the note heads', type: 'check' },
      { key: 'showFingers', label: 'Finger numbers & hand picture', help: '1 = thumb … 5 = pinky', type: 'check' },
      { key: 'size', label: 'Music size', type: 'select', options: [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large'], ['xlarge', 'Extra large']] },
      { key: 'hand', label: 'Hand to practise', help: 'Only for songs with two staves (LH: line)', type: 'select', options: [['rh', 'Right hand (top)'], ['lh', 'Left hand (bottom)']] },
    ] },
    { group: '🎮 Practice', rows: [
      { key: 'mode', label: 'Mode', help: 'Play along: the line keeps moving and hard parts are played again, slower. Wait for me: the line stops at each note.', type: 'select', options: [['playalong', '🎵 Play along'], ['wait', '✋ Wait for me']] },
      { key: 'missLimit', label: 'Play along: play a part again after … missed notes', type: 'number', min: 1, max: 10 },
      { key: 'sectionRetries', label: '… at most … times, then move on', type: 'number', min: 0, max: 5 },
      { key: 'waitSkip', label: 'Wait for me: move on after … seconds of silence', help: '0 = never. The hint shows halfway.', type: 'number', min: 0, max: 30 },
      { key: 'timing', label: 'Timing', help: 'How early or late a right note may come and still count. Relaxed is best for little ones.', type: 'select', options: [['relaxed', '😌 Relaxed (most forgiving)'], ['normal', 'Normal'], ['strict', 'Strict']] },
      { key: 'anyOctave', label: 'Accept the right note in any octave', help: 'Recommended with a microphone. Sharps/flats are always checked exactly.', type: 'check' },
      { key: 'hintAfter', label: 'Show a hint after … wrong notes', type: 'number', min: 1, max: 10 },
      { key: 'countdown', label: 'Count 3-2-1 before playing', type: 'check' },
      { key: 'countdownSound', label: 'Soft tick with each number', type: 'check' },
      { key: 'metronome', label: 'Metronome click', type: 'check' },
      { key: 'successSound', label: 'Little “ding” for right notes', type: 'check' },
    ] },
    { group: '🐢 Automatic speed', rows: [
      { key: 'adaptive', label: 'Slow down when it gets hard', type: 'check' },
      { key: 'slowWrong', label: 'Slow down after more than … mistakes', type: 'number', min: 1, max: 20 },
      { key: 'slowWindow', label: '… within the last … notes', type: 'number', min: 2, max: 30 },
      { key: 'slowStep', label: 'Slow down by (%)', type: 'number', min: 5, max: 50 },
      { key: 'slowFloor', label: 'Never slower than (% of song tempo)', type: 'number', min: 20, max: 100 },
      { key: 'speedUp', label: 'Speed up again after a streak', help: 'Never faster than the speed chosen with 🐢/🐰 (or 100 %).', type: 'check' },
      { key: 'speedUpStreak', label: 'Streak length (notes right first time)', type: 'number', min: 3, max: 30 },
    ] },
    { group: '🎤 Listening', rows: [
      { key: 'input', label: 'Listen with', type: 'select', options: [['auto', 'Automatic (MIDI keyboard if connected, else microphone)'], ['mic', 'Microphone'], ['midi', 'MIDI keyboard (USB, Chrome)'], ['screen', 'On-screen keys only']] },
      { key: 'micGate', label: 'Microphone sensitivity', help: 'Move left if it hears notes nobody played; right if it misses soft notes.', type: 'range', min: 0.003, max: 0.05, step: 0.001, invert: true },
      { key: 'stableMs', label: 'Note must be steady for (ms)', type: 'number', min: 40, max: 300 },
      { key: 'keySound', label: 'On-screen keys make a sound', type: 'check' },
    ] },
    { group: '🎹 On-screen keyboard', rows: [
      { key: 'keyLabels', label: 'Show note names on the keys', type: 'check' },
      { key: 'kbAuto', label: 'Fit the keyboard to the song', type: 'check' },
      { key: 'kbStart', label: 'Otherwise start at', type: 'select', options: [['36', 'Do2 / C2'], ['48', 'Do3 / C3'], ['60', 'Do4 / C4 (middle)']] },
      { key: 'kbOctaves', label: 'Number of octaves', type: 'select', options: [['2', '2'], ['3', '3'], ['4', '4']] },
    ] },
  ];

  function renderSettings() {
    const f = $('settingsForm'); f.innerHTML = '';
    const s = S();
    SETTINGS_UI.forEach(g => {
      const box = document.createElement('div'); box.className = 'set-group';
      box.innerHTML = `<h3>${g.group}</h3>`;
      g.rows.forEach(r => {
        const row = document.createElement('label'); row.className = 'set-row';
        row.innerHTML = `<span>${r.label}${r.help ? `<small>${r.help}</small>` : ''}</span>`;
        let inp;
        if (r.type === 'select') { inp = document.createElement('select'); r.options.forEach(([v, t]) => inp.add(new Option(t, v))); inp.value = String(s[r.key]); }
        else if (r.type === 'check') { inp = document.createElement('input'); inp.type = 'checkbox'; inp.checked = !!s[r.key]; }
        else if (r.type === 'number') { inp = document.createElement('input'); inp.type = 'number'; inp.min = r.min; inp.max = r.max; inp.value = s[r.key]; }
        else if (r.type === 'range') { inp = document.createElement('input'); inp.type = 'range'; inp.min = r.min; inp.max = r.max; inp.step = r.step; inp.value = r.min + r.max - s[r.key]; }
        inp.dataset.key = r.key;
        inp.addEventListener('change', () => {
          let v;
          if (r.type === 'check') v = inp.checked;
          else if (r.type === 'number') { v = Math.max(r.min, Math.min(r.max, parseInt(inp.value, 10) || r.min)); inp.value = v; }
          else if (r.type === 'range') v = +(r.min + r.max - parseFloat(inp.value)).toFixed(4);
          else v = /^\d+$/.test(inp.value) && r.key !== 'nameStyle' ? +inp.value : inp.value;
          setSetting(r.key, v);
        });
        row.appendChild(inp); box.appendChild(row);
      });
      f.appendChild(box);
    });
    const reset = document.createElement('div'); reset.className = 'set-group';
    reset.innerHTML = `<h3>↺ Reset</h3><button type="button" class="btn" id="btnResetSettings">Reset all settings to default</button>`;
    f.appendChild(reset);
    $('btnResetSettings').onclick = () => { app.settings = Object.assign({}, store.DEFAULT_SETTINGS); store.saveSettings(app.settings); applySettingsEverywhere(); renderSettings(); toast('Settings reset'); };
  }

  function setSetting(key, v) {
    app.settings[key] = v;
    store.saveSettings(app.settings);
    applySettingsEverywhere(key);
  }
  function applySettingsEverywhere(key) {
    const s = S();
    app.tracker.opts.gate = s.micGate;
    app.tracker.opts.stableMs = s.stableMs;
    app.engine.settings = s;
    if (key === 'mode' || key === 'hand') { stopListen('away'); cancelCountdown(); }
    const rerender = !key || ['nameStyle', 'namesBelow', 'namesInHeads', 'size', 'hand', 'showFingers'].indexOf(key) >= 0;
    if (key === 'showFingers' && app.prep) { layoutHandPanel(); if (!s.showFingers) hideFinger(); else if (app.engine.target >= 0 && app.engine.phase === 'waiting') showFinger(app.engine.target); }
    if (app.prep && rerender) {
      if (key === 'hand') { app.engine.reset(); renderScore(); fillLoopSelects(); } else renderScore();
    }
    if (app.prep && (!key || ['nameStyle', 'keyLabels', 'kbAuto', 'kbStart', 'kbOctaves', 'hand'].indexOf(key) >= 0)) buildKeyboard();
    if (key === 'mode') { app.engine.reset(); if (app.prep) showStartOverlay('start'); else $('startOverlay').hidden = true; }
    if (key === 'input' && app.started) { app.started = false; audio.stopMic(); app.input = 'screen'; }
    updateBadges();
    if (PP.editor) PP.editor.refreshPreview();
  }

  // ------------------------------------------------------------------ help page
  function renderHelp() {
    $('helpContent').innerHTML = `
<h2>How to use</h2>
<ol>
  <li>Put the tablet on the piano's music stand, close to the piano, and pick a song.</li>
  <li>Tap <b>▶ Start</b> and allow the <b>microphone</b>. The meter next to 🎤 moves when the app hears sound, and “I hear” shows the note.</li>
  <li>The pink line walks over the music at the chosen speed and she plays along (🎵 <b>Play along</b>, the default). Right notes turn green. In ✋ <b>Wait for me</b> mode the line waits at each purple note until it is played.</li>
  <li>After ${S().hintAfter} wrong notes a key on the screen keyboard glows and a hint appears.</li>
</ol>
<h2>🎵 Play along: little parts, played again if needed</h2>
<p>The song is split into little <b>parts</b> of whole bars, about 6 notes each (Lazy Song: 2 bars = 6 notes). The stars at the top (<b>Part 1/2 ☆☆☆☆☆☆</b>) fill with a gold ★ for every right note of the part.</p>
<ul>
  <li>The line <b>never stops by itself</b>: if she doesn't play, it keeps moving.</li>
  <li>After <b>${S().missLimit}</b> missed notes in a part it stops gently and says <i>“Let's try that part again, a little slower 🐢”</i>, goes back to the start of that part, one speed step slower (10 %, never below 30 %), counts a short 3-2-1 and plays the part again.</li>
  <li>A part is done when at least <b>half</b> of its notes were right. After <b>${S().sectionRetries}</b> replays of the same part it moves on anyway with praise, so she never gets stuck.</li>
  <li>After a good part (at most one miss) the speed goes up one step again, but never above the speed chosen with 🐢/🐰.</li>
  <li>⏸ / ▶ always works, also during the message.</li>
</ul>
<p>Grown-ups can change both numbers in ⚙️ Settings → Practice.</p>
<h2>✋ Wait for me</h2>
<p>The line waits at every note. If no sound is heard for a while (the note wasn't played, or the microphone didn't hear it), the hint shows after half the time and after <b>${S().waitSkip} seconds</b> it gently moves on to the next note (“Let's keep going! 🎵”). Change the time in ⚙️ Settings (0 = wait forever).</p>
<h2>3-2-1 Go!</h2>
<p>Every time practice starts (▶ Start, 🎹 Now you try!, ▶ after a pause, ↺ Again) big numbers count <b>3, 2, 1, Go! ⭐</b>, one per second, with a soft tick. Nothing is scored during the countdown. Tap ⏸ or 🏠 to cancel it. You can switch the countdown or its tick off in ⚙️ Settings → Practice.</p>
<h2>👂 Listen first</h2>
<p>Tap <b>👂 Listen</b> and the app plays the song for her at the current speed: the pink line moves along, each key lights up pink on the screen keyboard (in the right octave; the other hand's notes light up blue) and the note name is shown. Nothing is scored, and the microphone is really switched off meanwhile (so the app doesn't hear itself, and so the iPad plays the music at full volume); it switches back on for practice. Tap <b>⏹ Stop</b> to end it early. Afterwards she gets a big <b>🎹 Now you try!</b> button. (On iPad, turn the volume up; Listen uses the same sound as the on-screen keys.)</p>
<h2>🐢 Slower / 🐰 Faster</h2>
<p>The turtle and rabbit buttons change the speed in steps of 10 % (from 30 % to 120 % of the song's tempo), also in the middle of a song. The speed you choose is remembered for that song on this device. The automatic slow-down still helps when many notes are hard, but when it speeds up again after a streak it never goes <b>above</b> the speed you chose (or 100 % if you never touched the buttons).</p>
<h2>⏱️ Timing</h2>
<p>In ⚙️ Settings → <i>Timing</i> you choose how early or late a right note may come and still count: <b>Relaxed</b> (default, most forgiving), <b>Normal</b> or <b>Strict</b>. The window grows automatically for slow songs and slow speeds. A right note that is a little early or late simply counts as right; in Play-along a note that comes too late is quietly skipped, never scolded. Relaxed at tempo 90: up to 0.6 s early and 0.8 s late (longer notes: until they end).</p>
<p><b>If the line seemed stuck:</b> in the old default (Wait for me) the line waited for a note the microphone hadn't heard. Now Play along is the default, Wait for me moves on by itself, and if the iPad microphone stops delivering sound the app restarts it by itself (“🎤 Listening again”).</p>
<p><b>Digital piano tips:</b> use a normal “piano” sound, one note at a time, and turn the volume up a bit. Keep the room quiet (no TV). If it hears notes nobody played, lower the <i>Microphone sensitivity</i> in Settings. You can also tap the keys on the screen.</p>
<h2>Writing songs (Simple format)</h2>
<pre>title: Lazy Song
tempo: 60
time: 3/4
look: open
Si4/5 Fa#4/2 Mi4/1 | Si4/5 Fa#4/2 Mi4/1 |
Si4/5 Fa#4/2 Mi4/1 | Si4/5 Re#4/1 Mi4/2 |</pre>
<ul>
  <li><b>A note</b> = its name + the octave number: <code>Do4 Re4 Mi4 Fa4 Sol4 La4 Si4</code>, then <code>Do5</code> is the next Do up. <code>Do4</code> is <b>middle C</b>. Letters also work: <code>C4 D4 E4 F4 G4 A4 B4</code>.</li>
  <li><b>Sharps and flats:</b> <code>#</code> for sostenido (<code>Fa#4</code>), <code>b</code> for bemol (<code>Sib4</code>, <code>Bb4</code>).</li>
  <li><b>How long:</b> put a letter after the note: <code>w</code> = whole (4 beats), <code>h</code> = half (2), <code>q</code> = quarter (1), <code>e</code> = eighth (½), <code>s</code> = sixteenth. Add a dot for dotted: <code>h.</code> = 3 beats. If you leave it out, the note is a quarter. Examples: <code>Do4 h</code> or <code>Do4h</code>.</li>
  <li><b>Bar line:</b> <code>|</code>. <b>Rest</b> (silence): <code>R</code>, e.g. <code>R h</code>.</li>
  <li><b>Fingers (optional):</b> after the note put <code>/</code> and the finger number: <code>Si4/5</code> or <code>Si4/5 q</code>. 1 = thumb, 2 = index, 3 = middle, 4 = ring, 5 = pinky. It is shown above the note, and a hand picture lights up that finger. For the left hand add <code>L</code>: <code>Do3/5L</code> (notes on an <code>LH:</code> line are left hand automatically). Notes without a number just show no finger.</li>
  <li>Commas and new lines are optional. Lines starting with <code>//</code> are notes to yourself.</li>
  <li>Top lines (all optional): <code>title:</code>, <code>tempo:</code> (beats per minute, 60 = slow), <code>time:</code> (4/4, 3/4…), <code>key:</code> (e.g. <code>key: G</code> — then write the sharps anyway, like <code>Fa#4</code>), <code>clef: bass</code>, <code>look: open</code> (round notes without stems, like a teacher's hand-written sheet).</li>
  <li>Two hands: a line starting with <code>LH:</code> is the left hand (bass clef, shown underneath). Choose which hand to practise in Settings.</li>
</ul>
<h2>ABC format (for people who know it)</h2>
<p>Choose “ABC” above the text box and paste standard ABC notation (from the internet or from other apps). Finger numbers are written <code>!1!</code>…<code>!5!</code> before a note. Example:</p>
<pre>X:1
T:Ode to Joy
M:4/4
L:1/4
Q:1/4=90
K:C
E E F G | G F E D | C C D E | E3/2 D/ D2 |]</pre>
<h2>Keeping songs safe</h2>
<p>Songs are saved inside this browser on this device. Use <b>Download all songs (backup)</b> now and then, and <b>Load a backup file</b> to bring them back or move them to another device.</p>
<h2>Microphone needs https</h2>
<p>Browsers only allow the microphone on secure pages: <code>https://…</code> or <code>http://localhost</code>. If the page is opened any other way, the on-screen keys still work.</p>`;
  }

  // ------------------------------------------------------------------ wiring
  function init() {
    app.score = new PP.Score($('scoreWrap'));
    app.kb = new PP.Keyboard($('keyboard'), (midi) => { audio.unlock(); handleNote(midi, 'screen'); });
    app.tracker = new PP.pitch.NoteTracker({ gate: S().micGate, stableMs: S().stableMs });
    app.engine = new PP.Practice(app.score, S(), hooks);
    app.listener = new PP.Listener({
      score: app.score, kb: app.kb, audio,
      getBpm: () => app.engine.bpm,
      onNote: (e) => showListenNote(e),
      onDone: (completed) => stopListen(completed ? 'done' : 'stopped'),
    });

    renderHome();
    renderSettings();
    renderHelp();

    $('btnStart').addEventListener('click', onStartTap);
    $('btnHome').addEventListener('click', () => { show('home'); renderHome(); });
    $('btnPlay').addEventListener('click', togglePlay);
    $('btnRestart').addEventListener('click', () => { audio.unlock(); stopListen('practice'); $('startOverlay').hidden = true; if (!app.started) onStartTap(); else startPractice(); });
    $('btnListen').addEventListener('click', toggleListen);
    $('btnSlower').addEventListener('click', () => stepSpeed(-1));
    $('btnFaster').addEventListener('click', () => stepSpeed(+1));
    $('btnMode').addEventListener('click', () => {
      setSetting('mode', S().mode === 'wait' ? 'playalong' : 'wait');
      renderSettings();
      bubble(S().mode === 'wait' ? '✋ Wait for me' : '🎵 Play along', 'good');
    });
    $('btnMetro').addEventListener('click', () => { audio.unlock(); setSetting('metronome', !S().metronome); renderSettings(); });
    $('btnLoop').addEventListener('click', () => {
      const on = !$('btnLoop').classList.contains('on');
      $('btnLoop').classList.toggle('on', on);
      $('btnLoop').parentElement.classList.toggle('on', on);
      bubble(on ? `🔁 Bars ${$('loopFrom').value}–${$('loopTo').value}` : 'Whole song', 'good');
      if (app.engine.phase !== 'idle') startPractice();
    });
    ['loopFrom', 'loopTo'].forEach(id => $(id).addEventListener('change', () => {
      if (+$('loopTo').value < +$('loopFrom').value) $('loopTo').value = $('loopFrom').value;
      if ($('btnLoop').classList.contains('on') && app.engine.phase !== 'idle') startPractice();
    }));
    const openParent = () => { renderSettings(); show('parent'); PP.editor.open(app.song ? app.song.id : null); };
    $('gearHome').addEventListener('click', openParent);
    $('gearPractice').addEventListener('click', openParent);
    $('btnParentBack').addEventListener('click', () => {
      if (app.song && store.getSongs().some(s => s.id === app.song.id)) openSong(app.song.id); else { show('home'); renderHome(); }
    });
    document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === t));
      document.querySelectorAll('.tab-page').forEach(p => p.classList.toggle('active', p.id === t.dataset.tab));
      if (t.dataset.tab === 'tabSongs') PP.editor.refreshPreview();
      if (t.dataset.tab === 'tabHelp') renderHelp();
    }));
    $('btnAgain').addEventListener('click', () => { hideEnd(); startPractice(); });
    $('btnSongs').addEventListener('click', () => { hideEnd(); show('home'); renderHome(); });
    $('btnMicRetry').addEventListener('click', async () => { $('micHelp').hidden = true; audio.unlock(); await startMic(); if (app.engine.paused) { app.engine.resume(performance.now()); setPlayButton(); } });
    $('btnMicSkip').addEventListener('click', () => { $('micHelp').hidden = true; if (app.engine.paused) { app.engine.resume(performance.now()); setPlayButton(); } });

    // computer keyboard shortcuts (handy for testing): space = play/pause
    document.addEventListener('keydown', (e) => {
      if (app.screen !== 'practice' || e.target.closest('input,textarea,select')) return;
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    });
    // re-layout the music when the screen size / orientation changes
    let rt = null;
    window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (app.screen === 'practice' && app.prep) renderScore(); }, 200); });
    // pause when the tab/app goes to the background
    document.addEventListener('visibilitychange', () => { if (document.hidden) { stopListen('stopped'); pausePractice(); } });
    audio.onStateChange = (st) => {
      if (st !== 'interrupted' && st !== 'suspended') return;
      // Starting the microphone switches the iOS audio session, which can blip
      // the context to "interrupted" for a moment. That must not pause (and so
      // freeze) the practice that is just starting: just wake the context up.
      if (app.listenStarting || performance.now() - (app.micStartedAt || -1e9) < 4000) {
        try { const p = audio.ctx.resume(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* ignore */ }
        return;
      }
      stopListen('stopped');
      pausePractice();
    };
    audio.onMicEnded = () => { app.input = 'screen'; updateBadges(); toast('The microphone stopped. Tap ▶ to continue.'); };

    PP.editor.init({ openSong, toast, onSongsChanged: renderHome });
    requestAnimationFrame(loop);
  }

  PP.app.show = show; PP.app.openSong = openSong; PP.app.handleNote = handleNote; PP.app.startPractice = startPractice;
  PP.app.onStartTap = onStartTap; PP.app.toggleListen = toggleListen; PP.app.stopListen = stopListen; PP.app.cancelCountdown = cancelCountdown;
  document.addEventListener('DOMContentLoaded', init);
})();
