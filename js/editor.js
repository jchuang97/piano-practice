/*
 * editor.js — the grown-ups' song editor: list, edit with live preview,
 * friendly errors, save to localStorage, backup export/import, MusicXML import.
 */
(function () {
  'use strict';
  const PP = window.PP;
  const M = PP.music, store = PP.store;
  const $ = (id) => document.getElementById(id);

  const NEW_SONG_TEXT = `title: My new song
tempo: 80
time: 4/4
Do4 q, Re4 q, Mi4 q, Fa4 q | Sol4 w |`;

  const ed = PP.editor = {
    currentId: null, dirty: false, preview: null, cb: {},

    init(cb) {
      this.cb = cb;
      this.preview = new PP.Score($('previewWrap'));
      let t = null;
      $('songText').addEventListener('input', () => { this.dirty = true; clearTimeout(t); t = setTimeout(() => this.refreshPreview(), 250); });
      document.querySelectorAll('input[name=fmt]').forEach(r => r.addEventListener('change', () => { this.dirty = true; this.refreshPreview(); }));
      $('btnNewSong').onclick = () => this.newSong();
      $('btnSaveSong').onclick = () => this.save();
      $('btnPlaySong').onclick = () => { if (this.save()) cb.openSong(this.currentId); };
      $('btnDupSong').onclick = () => this.duplicate();
      $('btnCopySong').onclick = () => copyText($('songText').value, 'Song text copied');
      $('btnDeleteSong').onclick = () => this.remove();
      $('btnExport').onclick = () => download('piano-songs-backup.json', store.exportAll());
      $('btnCopyAll').onclick = () => copyText(store.exportAll(), 'All songs copied — paste them in an email or note to keep them safe');
      $('btnPasteImport').onclick = () => {
        const txt = prompt('Paste the songs text (from “Copy all songs as text”):');
        if (txt) this.importBackup(txt);
      };
      $('btnRestore').onclick = () => {
        if (!confirm('Put the built-in songs back to how they were? (Your own songs stay.)')) return;
        store.restoreBuiltins(); this.renderList(); cb.onSongsChanged(); cb.toast('Built-in songs restored');
      };
      $('fileImport').onchange = (e) => readFile(e.target, (txt) => this.importBackup(txt));
      $('fileMusicXml').onchange = (e) => readFile(e.target, (txt) => {
        try {
          const simple = M.musicXmlToSimple(txt);
          this.newSong(simple, 'simple');
          cb.toast('MusicXML imported — check it and tap Save');
        } catch (err) { cb.toast('Sorry, I could not read that file: ' + err.message, 4000); }
      });
    },

    open(id) {
      const songs = store.getSongs();
      const song = songs.find(s => s.id === id) || songs[0];
      this.renderList();
      if (song) this.load(song); else this.newSong();
    },
    renderList() {
      const ul = $('songList'); ul.innerHTML = '';
      store.getSongs().forEach(s => {
        const li = document.createElement('li'), b = document.createElement('button');
        b.innerHTML = `${escapeHtml(s.title || 'Untitled')}<small>${s.format === 'abc' ? 'ABC' : 'Simple'}${s.builtin ? ' · built-in' : ''}</small>`;
        if (s.id === this.currentId) b.classList.add('sel');
        b.onclick = () => { if (this.dirty && !confirm('You have unsaved changes. Leave them?')) return; this.load(s); };
        li.appendChild(b); ul.appendChild(li);
      });
    },
    load(song) {
      this.currentId = song.id;
      $('songText').value = song.text;
      setFormat(song.format || 'simple');
      this.dirty = false;
      this.renderList();
      this.refreshPreview();
    },
    newSong(text, format) {
      this.currentId = null;
      $('songText').value = text || NEW_SONG_TEXT;
      setFormat(format || 'simple');
      this.dirty = true;
      this.renderList();
      this.refreshPreview();
      $('songText').focus();
    },
    currentSong() {
      return { id: this.currentId, format: getFormat(), text: $('songText').value };
    },
    /** Parse + render the preview and show friendly messages. Returns the prepared song. */
    refreshPreview() {
      if (!this.preview || !document.getElementById('parent').classList.contains('active')) return null;
      const song = this.currentSong();
      const prep = M.prepareSong(song);
      const msgs = $('editorMsgs');
      let html = '';
      if (prep.errors.length) {
        html += prep.errors.slice(0, 6).map(e => `<div class="err">✏️ ${e.line ? `Line ${e.line}: ` : ''}${escapeHtml(e.msg)}</div>`).join('');
      }
      if (!prep.errors.length && prep.abc) {
        const s = PP.app.settings;
        try {
          this.preview.render(prep, { noFit: true, fingers: s.showFingers, size: 'medium', hand: s.hand, namesBelow: s.namesBelow, namesInHeads: s.namesInHeads, nameStyle: s.nameStyle });
        } catch (err) { html += `<div class="err">✏️ Could not draw this music (${escapeHtml(err.message)})</div>`; }
        const n = this.preview.events.filter(e => !e.rest).length;
        const warns = prep.warnings.slice();
        if (prep.format === 'abc') (this.preview.warnings || []).slice(0, 4).forEach(w => warns.push(String(w).replace(/<[^>]+>/g, '')));
        if (!n) html += `<div class="err">✏️ I can't find any notes yet.</div>`;
        html += warns.map(w => `<div class="warn">⚠️ ${escapeHtml(w)}</div>`).join('');
        if (n) html += `<div class="ok">✓ Looks good! “${escapeHtml(prep.title)}” — ${n} notes, ${this.preview.barCount} bars, tempo ${prep.tempo}.${this.dirty ? ' Don’t forget to tap 💾 Save.' : ''}</div>`;
      } else {
        $('previewWrap').querySelector('.score-inner').innerHTML = '';
        this.preview.events = []; this.preview.hideCursor(); this.preview.hideRing();
      }
      msgs.innerHTML = html;
      return prep;
    },
    save() {
      const song = this.currentSong();
      const prep = M.prepareSong(song);
      if (prep.errors.length) { this.cb.toast('Please fix the ✏️ mistakes first'); this.refreshPreview(); return false; }
      const existing = store.getSongs().find(s => s.id === song.id);
      const out = { id: song.id || store.newId(), title: prep.title, format: song.format, text: song.text };
      if (existing && existing.builtin) out.builtin = true;
      store.upsertSong(out);
      this.currentId = out.id; this.dirty = false;
      this.renderList(); this.refreshPreview();
      this.cb.onSongsChanged();
      this.cb.toast('Saved “' + out.title + '” ✓');
      return true;
    },
    duplicate() {
      const song = this.currentSong();
      let text = song.text;
      if (song.format === 'simple') text = /^title:/im.test(text) ? text.replace(/^(title:\s*)(.*)$/im, '$1$2 (copy)') : 'title: Copy\n' + text;
      else text = text.replace(/^(T:\s*)(.*)$/m, '$1$2 (copy)');
      this.newSong(text, song.format);
    },
    remove() {
      if (!this.currentId) { this.open(null); return; }
      const s = store.getSongs().find(x => x.id === this.currentId);
      if (!s || !confirm(`Delete “${s.title}”? This can't be undone (unless you have a backup).`)) return;
      store.deleteSong(this.currentId);
      this.currentId = null;
      this.cb.onSongsChanged();
      this.open(null);
      this.cb.toast('Deleted');
    },
    importBackup(txt) {
      try {
        const n = store.importAll(txt);
        this.renderList(); this.cb.onSongsChanged();
        this.cb.toast(`Loaded ${n} song${n === 1 ? '' : 's'} ✓`);
      } catch (err) { this.cb.toast('That doesn’t look like a songs backup: ' + err.message, 4000); }
    },
  };

  function getFormat() { const r = document.querySelector('input[name=fmt]:checked'); return r ? r.value : 'simple'; }
  function setFormat(f) { document.querySelectorAll('input[name=fmt]').forEach(r => { r.checked = r.value === f; }); }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function download(name, text) {
    const blob = new Blob([text], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function copyText(text, msg) {
    const done = () => ed.cb.toast(msg || 'Copied');
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, () => fallback());
    else fallback();
    function fallback() {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { ed.cb.toast('Could not copy'); }
      ta.remove();
    }
  }
  function readFile(input, cb) {
    const f = input.files && input.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => { cb(String(r.result)); input.value = ''; };
    r.readAsText(f);
  }
})();
