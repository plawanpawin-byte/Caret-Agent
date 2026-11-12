// Code editor (Monaco, the editor inside VS Code) with tabs, plus the
// "no folder open" and "no file open" screens.
import { h, icon, fileBadge, toast, logo } from './ui.js';
import { api, state, on, emit } from './state.js';

let monaco = null;
let editor = null;
const tabs = []; // { path, model, view, dirty, saved } — or { path, image: { url, size } } for a picture
let active = null;

function loadMonaco() {
  if (monaco) return Promise.resolve(monaco);
  return new Promise((resolve, reject) => {
    self.MonacoEnvironment = { getWorkerUrl: () => 'caret://app/monaco-worker.js' };
    window.require.config({ paths: { vs: 'monaco/vs' } });
    window.require(['vs/editor/editor.main'], m => {
      monaco = window.monaco || m;
      monaco.editor.defineTheme('caret', {
        base: 'vs-dark', inherit: true,
        rules: [
          { token: 'comment', foreground: '6c6c75', fontStyle: 'italic' },
          { token: 'keyword', foreground: 'e8a35a' },
          { token: 'string', foreground: 'a8c98a' },
          { token: 'number', foreground: 'd7a5f0' },
          { token: 'type', foreground: '7fb6e8' },
        ],
        colors: {
          'editor.background': '#181818', 'editor.foreground': '#d4d4d4', 'editorLineNumber.foreground': '#4d4d4d', 'editorLineNumber.activeForeground': '#a0a0a0',
          'editor.lineHighlightBackground': '#1e1e1e', 'editor.lineHighlightBorder': '#00000000', 'editor.selectionBackground': '#f0a63a30', 'editorCursor.foreground': '#f0a63a',
          'editorIndentGuide.background1': '#2a2a2a', 'editorIndentGuide.activeBackground1': '#444444', 'editorWidget.background': '#1f1f1f', 'editorWidget.border': '#353535',
          'editorGutter.background': '#181818', 'minimap.background': '#181818', 'scrollbarSlider.background': '#ffffff12', 'scrollbarSlider.hoverBackground': '#ffffff22',
          'editorSuggestWidget.background': '#1f1f1f', 'editorSuggestWidget.border': '#353535', 'editorSuggestWidget.selectedBackground': '#2e2e2e',
        },
      });
      resolve(monaco);
    }, reject);
  });
}

function languageFor(path) {
  const ext = '.' + (path.split('.').pop() || '').toLowerCase();
  const name = path.split('/').pop().toLowerCase();
  const lang = monaco.languages.getLanguages().find(l => (l.extensions || []).includes(ext) || (l.filenames || []).map(f => f.toLowerCase()).includes(name));
  if (ext === '.luau') return 'lua';
  return lang ? lang.id : 'plaintext';
}

export function createEditorArea() {
  const tabBar = h('div', { class: 'tabs' });
  tabBar.addEventListener('wheel', e => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { tabBar.scrollLeft += e.deltaY; e.preventDefault(); } }, { passive: false });
  const crumbs = h('div', { class: 'crumbs' });
  const host = h('div', { id: 'editor-host' });
  const blank = h('div', { class: 'empty' });
  const picture = h('div', { class: 'img-view hidden' });
  const el = h('div', { class: 'col', style: { flex: 1 } }, tabBar, crumbs, host, picture, blank);

  function showEmpty() {
    tabBar.classList.toggle('hidden', !tabs.length);
    crumbs.classList.toggle('hidden', !active);
    host.classList.toggle('hidden', !active || !!active.image);
    picture.classList.toggle('hidden', !active?.image);
    blank.classList.toggle('hidden', !!active);
    if (active) return;
    blank.replaceChildren(state.workspace ? folderWelcome() : noFolder());
  }

  function renderTabs() {
    tabBar.replaceChildren(...tabs.map(t => {
      const name = t.path.split('/').pop();
      const tab = h('div', { class: 'tab' + (t === active ? ' on' : '') + (t.dirty ? ' dirty' : ''), title: t.path, onclick: () => activate(t), onauxclick: e => { if (e.button === 1) close(t); } },
        fileBadge(name), h('span', { class: 'name', text: name }),
        h('button', { class: 'x', title: 'Close', onclick: e => { e.stopPropagation(); close(t); } }, icon('x')));
      return tab;
    }));
    crumbs.replaceChildren(...(active ? active.path.split('/').flatMap((p, i, a) => [h('span', { text: p }), i < a.length - 1 ? icon('chevron') : null]).filter(Boolean) : []));
    crumbs.querySelectorAll('svg').forEach(s => { s.style.width = '11px'; s.style.height = '11px'; });
    // Many tabs scroll sideways: keep the active one in view, and let the mouse wheel scroll the bar.
    tabBar.querySelector('.tab.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    showEmpty();
    emit('editor-tabs', { active: active?.path || null, paths: tabs.map(t => t.path) });
  }

  async function open(path) {
    let t = tabs.find(x => x.path === path);
    if (!t) {
      if (/\.(png|jpe?g|gif|webp|ico|bmp|svg)$/i.test(path)) {
        let image;
        try { image = await api.fs.readImage(path); } catch (e) { toast(e.message, { error: true }); return; }
        t = { path, image, dirty: false };
        tabs.push(t);
        activate(t);
        return;
      }
      if (/\.(pdf|zip|exe|dll|woff2?|ttf|mp[34]|wav)$/i.test(path)) { toast('This file type cannot be opened as text'); return; }
      let text;
      try { text = await api.fs.read(path); } catch (e) { toast(e.message, { error: true }); return; }
      await loadMonaco();
      ensureEditor();
      const model = monaco.editor.createModel(text, languageFor(path));
      t = { path, model, view: null, dirty: false, saved: text };
      model.onDidChangeContent(() => { const d = model.getValue() !== t.saved; if (d !== t.dirty) { t.dirty = d; renderTabs(); } });
      tabs.push(t);
    }
    activate(t);
  }

  function ensureEditor() {
    if (editor) return;
    editor = monaco.editor.create(host, {
      theme: 'caret', automaticLayout: true, fontFamily: getComputedStyle(document.body).getPropertyValue('--mono'), fontSize: 13, lineHeight: 20,
      minimap: { enabled: true, renderCharacters: false, scale: 1 }, scrollBeyondLastLine: false, smoothScrolling: true, cursorBlinking: 'smooth',
      renderLineHighlight: 'all', padding: { top: 8 }, bracketPairColorization: { enabled: true }, tabSize: 2, stickyScroll: { enabled: true },
    });
    // A narrow editor needs its width for code, not for the minimap.
    let mini = true;
    new ResizeObserver(() => { const want = host.clientWidth >= 520; if (want !== mini) { mini = want; editor.updateOptions({ minimap: { enabled: want, renderCharacters: false, scale: 1 } }); } }).observe(host);
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => save(active));
    editor.onDidChangeCursorPosition(e => emit('cursor', { line: e.position.lineNumber, col: e.position.column, lang: active ? active.model.getLanguageId() : '' }));
  }

  function showPicture(t) {
    const img = h('img', { src: t.image.url, alt: t.path, draggable: 'false' });
    const info = h('div', { class: 'img-info', text: `${(t.image.size / 1024).toFixed(t.image.size < 10240 ? 1 : 0)} KB` });
    img.addEventListener('load', () => { info.textContent = `${img.naturalWidth} × ${img.naturalHeight} · ${(t.image.size / 1024).toFixed(t.image.size < 10240 ? 1 : 0)} KB`; });
    picture.replaceChildren(h('div', { class: 'img-stage' }, img), info);
    emit('cursor', { line: 1, col: 1, lang: 'image' });
  }

  function activate(t) {
    if (active && editor && !active.image) active.view = editor.saveViewState();
    active = t;
    if (t?.image) showPicture(t);
    else if (t && editor) {
      editor.setModel(t.model);
      if (t.view) editor.restoreViewState(t.view);
      editor.focus();
      emit('cursor', { line: editor.getPosition()?.lineNumber || 1, col: editor.getPosition()?.column || 1, lang: t.model.getLanguageId() });
    }
    renderTabs();
  }

  async function save(t) {
    if (!t || t.image) return;
    const text = t.model.getValue();
    try { await api.fs.write(t.path, text); t.saved = text; t.dirty = false; renderTabs(); }
    catch (e) { toast(e.message, { error: true }); }
  }

  function close(t) {
    if (t.dirty && !confirm(`${t.path} has unsaved changes. Close anyway?`)) return;
    const i = tabs.indexOf(t);
    tabs.splice(i, 1);
    t.model?.dispose();
    if (active === t) { active = null; activate(tabs[Math.min(i, tabs.length - 1)] || null); if (!tabs.length && editor) editor.setModel(null); }
    else renderTabs();
  }

  function closeAll() { for (const t of [...tabs]) { t.model?.dispose(); } tabs.length = 0; active = null; editor?.setModel(null); renderTabs(); }

  // Reload files the AI (or anything else) changed, unless the user has edits.
  async function syncFromDisk() {
    for (const t of tabs) {
      if (t.dirty || t.image) continue;
      try {
        const text = await api.fs.read(t.path);
        if (text !== t.saved) { t.saved = text; const pos = t === active ? editor.getPosition() : null; t.model.setValue(text); if (pos) editor.setPosition(pos); }
      } catch {}
    }
  }

  on('editor-action', id => { if (!editor || !id) return; editor.focus(); editor.trigger('menu', id, null); });
  on('open-file', open);
  on('editor-cmd', async c => {
    if (c === 'save' && active) await save(active);
    else if (c === 'save-all') { for (const t of tabs.filter(x => x.dirty)) await save(t); }
    else if (c === 'close' && active) close(active);
    else if (c === 'close-all') { if (!tabs.some(t => t.dirty) || confirm('Some files have unsaved changes. Close them all anyway?')) closeAll(); }
  });
  on('workspace', () => { closeAll(); });
  on('fs-changed', () => syncFromDisk());
  on('file-renamed', ({ from }) => { const t = tabs.find(x => x.path === from); if (t) { t.dirty = false; close(t); } });
  on('file-deleted', p => { for (const t of tabs.filter(x => x.path === p || x.path.startsWith(p + '/'))) { t.dirty = false; close(t); } });
  on('recent-changed', () => showEmpty());

  renderTabs();
  return { el, open };
}

// One action on the start page: icon, what it does, a short line of help, and its key.
const shortcut = (ic, label, sub, key, fn) => h('button', { class: 'shortcut', onclick: fn }, icon(ic),
  h('span', { class: 'sc-text' }, h('span', { class: 'sc-title', text: label }), sub ? h('span', { class: 'sc-sub', text: sub }) : null),
  key ? h('span', { class: 'sc-keys' }, ...key.split(' ').map(k => h('span', { class: 'kbd', text: k }))) : null);

export function noFolder() {
  const recent = (state.settings?.recentFolders || []).slice(0, 5);
  return h('div', { class: 'watermark' },
    h('div', { class: 'wm-head' }, logo(36), h('div', { class: 'title', text: 'Open a project to start' }),
      h('div', { class: 'wm-sub', text: 'Pick a folder on this PC, or copy one from GitHub.' })),
    h('div', { class: 'shortcuts' },
      shortcut('folderOpen', 'Open folder', 'Work on code that is already on this PC', 'Ctrl O', () => emit('cmd', 'open-folder')),
      shortcut('git', 'Clone repository', 'Copy a project from GitHub or any Git link', null, () => emit('cmd', 'clone'))),
    recent.length ? h('div', { class: 'recent' }, h('h2', { text: 'Recent' }),
      ...recent.map(d => h('button', { onclick: () => emit('cmd', { open: d }), title: d }, icon('folder'), h('span', { class: 'n', text: d.split(/[\\/]/).pop() }), h('span', { class: 'p', text: d })))) : null,
  );
}

function folderWelcome() {
  return h('div', { class: 'watermark' },
    h('div', { class: 'wm-head' }, logo(36), h('div', { class: 'title', text: state.workspace.name }),
      h('div', { class: 'wm-sub', text: state.workspace.root, title: state.workspace.root })),
    h('div', { class: 'shortcuts' },
      shortcut('sparkle', 'Ask the AI', 'Explain, change or build something in this project', 'Ctrl L', () => emit('cmd', 'focus-chat')),
      shortcut('search', 'Search in files', 'Find text anywhere in the project', 'Ctrl Shift F', () => emit('cmd', 'search')),
      shortcut('terminal', 'Terminal', 'Run commands in this folder', 'Ctrl `', () => emit('cmd', 'new-terminal')),
      shortcut('book', 'Project memory', 'What every AI knows about this project', null, () => emit('open-file', '.caret/HANDOFF.md'))));
}
