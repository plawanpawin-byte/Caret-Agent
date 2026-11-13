// The search box in the title bar. Type a file name to open it, ">" to run a command, "%" to search the
// text of every file, "@" for symbols, ":" for a line number, "?" for help. Ctrl+P and Ctrl+Shift+P open it.
import { h, fileBadge } from './ui.js';
import { api, state, on, emit } from './state.js';

const ed = id => () => emit('editor-action', id);

// The built-in commands. `ctx` carries the few things only the app shell knows how to do.
export function buildCommands(ctx) {
  const c = (label, run, key, group = 'Caret') => ({ label, run, key, group });
  const e = (label, id, key) => c(label, ed(id), key, 'Editor');
  return [
    // files and folders
    c('File: Open Folder…', () => emit('cmd', 'open-folder'), 'Ctrl+O'),
    c('File: Clone Repository…', () => emit('cmd', 'clone')),
    c('File: Close Folder', () => emit('cmd', 'close-folder')),
    c('File: Save', () => emit('editor-cmd', 'save'), 'Ctrl+S'),
    c('File: Save All', () => emit('editor-cmd', 'save-all')),
    c('File: Close Editor', () => emit('editor-cmd', 'close')),
    c('File: Close All Editors', () => emit('editor-cmd', 'close-all')),
    c('File: Open Project Memory (HANDOFF.md)', () => emit('open-file-studio', '.caret/HANDOFF.md')),
    // view
    c('View: Toggle Side Bar', () => emit('cmd', 'toggle-sidebar'), 'Ctrl+B'),
    c('View: Toggle Terminal', () => emit('cmd', 'toggle-bottom'), 'Ctrl+`'),
    c('View: Toggle AI Panel', () => emit('cmd', 'toggle-chat'), 'Ctrl+Alt+B'),
    c('View: Show Explorer', () => emit('cmd', 'explorer'), 'Ctrl+Shift+E'),
    c('View: Switch to Agent', () => ctx.setLayout('agent')),
    c('View: Switch to IDE', () => ctx.setLayout('studio')),
    c('View: Reload Window', () => location.reload()),
    // search
    c('Search: Find in Files', () => emit('cmd', 'search'), 'Ctrl+Shift+F'),
    e('Search: Find in File', 'actions.find', 'Ctrl+F'),
    e('Search: Replace in File', 'editor.action.startFindReplace', 'Ctrl+H'),
    e('Go to Line…', 'editor.action.gotoLine', 'Ctrl+G'),
    e('Go to Symbol in Editor…', 'editor.action.quickOutline', 'Ctrl+Shift+O'),
    e('Select All Occurrences of Selection', 'editor.action.selectHighlights', 'Ctrl+Shift+L'),
    e('Add Next Occurrence to Selection', 'editor.action.addSelectionToNextFindMatch', 'Ctrl+D'),
    // AI
    c('AI: New Chat', () => emit('cmd', 'new-chat'), 'Ctrl+T'),
    c('AI: Ask the AI', () => emit('cmd', 'focus-chat'), 'Ctrl+L'),
    c('Account: Sign out', async () => { await api.auth.signOut(); location.reload(); }),
    c('AI: Extensions…', () => emit('cmd', 'extensions')),
    c('AI: Models and API Keys…', () => emit('cmd', 'providers'), 'Ctrl+Shift+X'),
    // terminal
    c('Terminal: New Terminal', () => emit('cmd', 'new-terminal')),
    // app
    c('Preferences: Open Settings', () => ctx.openSettings(), 'Ctrl+,'),
    c('Help: Check for Updates', () => ctx.checkUpdate()),
    c('Help: Caret Agent on GitHub', () => api.app.openExternal('https://github.com/plawanpawin-byte/Caret-Agent')),
    // editing
    e('Edit: Undo', 'undo', 'Ctrl+Z'),
    e('Edit: Redo', 'redo', 'Ctrl+Y'),
    e('Edit: Select All', 'editor.action.selectAll', 'Ctrl+A'),
    e('Edit: Format Document', 'editor.action.formatDocument', 'Shift+Alt+F'),
    e('Edit: Toggle Line Comment', 'editor.action.commentLine', 'Ctrl+/'),
    e('Edit: Toggle Block Comment', 'editor.action.blockComment', 'Shift+Alt+A'),
    e('Edit: Indent Line', 'editor.action.indentLines', 'Ctrl+]'),
    e('Edit: Outdent Line', 'editor.action.outdentLines', 'Ctrl+['),
    e('Edit: Duplicate Line Down', 'editor.action.copyLinesDownAction', 'Shift+Alt+Down'),
    e('Edit: Duplicate Line Up', 'editor.action.copyLinesUpAction', 'Shift+Alt+Up'),
    e('Edit: Move Line Up', 'editor.action.moveLinesUpAction', 'Alt+Up'),
    e('Edit: Move Line Down', 'editor.action.moveLinesDownAction', 'Alt+Down'),
    e('Edit: Delete Line', 'editor.action.deleteLines', 'Ctrl+Shift+K'),
    e('Edit: Insert Line Below', 'editor.action.insertLineAfter', 'Ctrl+Enter'),
    e('Edit: Insert Line Above', 'editor.action.insertLineBefore', 'Ctrl+Shift+Enter'),
    e('Edit: Join Lines', 'editor.action.joinLines'),
    e('Edit: Sort Lines Ascending', 'editor.action.sortLinesAscending'),
    e('Edit: Sort Lines Descending', 'editor.action.sortLinesDescending'),
    e('Edit: Transform to Uppercase', 'editor.action.transformToUppercase'),
    e('Edit: Transform to Lowercase', 'editor.action.transformToLowercase'),
    e('Edit: Transform to Title Case', 'editor.action.transformToTitlecase'),
    e('Edit: Trim Trailing Whitespace', 'editor.action.trimTrailingWhitespace', 'Ctrl+K Ctrl+X'),
    e('Edit: Rename Symbol', 'editor.action.rename', 'F2'),
    e('Edit: Trigger Suggestions', 'editor.action.triggerSuggest', 'Ctrl+Space'),
    e('Fold: Fold All', 'editor.foldAll', 'Ctrl+K Ctrl+0'),
    e('Fold: Unfold All', 'editor.unfoldAll', 'Ctrl+K Ctrl+J'),
    e('Fold: Fold Current Region', 'editor.fold', 'Ctrl+Shift+['),
    e('Fold: Unfold Current Region', 'editor.unfold', 'Ctrl+Shift+]'),
  ];
}

const HOME = [
  { id: 'file', label: 'Go to File', key: 'Ctrl+P' },
  { id: 'cmd', label: 'Show and Run Commands', hint: '>', key: 'Ctrl+Shift+P' },
  { id: 'text', label: 'Search for Text', hint: '%' },
  { id: 'ai', label: 'Ask the AI', key: 'Ctrl+L' },
  { id: 'sym', label: 'Go to Symbol in Editor', hint: '@', key: 'Ctrl+Shift+O' },
  { id: 'line', label: 'Go to Line', hint: ':', key: 'Ctrl+G' },
  { id: 'more', label: 'More', hint: '?' },
];

// "ab" matches "a…b" in order; closer and earlier matches score higher. Returns -1 for no match.
function fuzzy(q, s) {
  q = q.toLowerCase(); const t = s.toLowerCase();
  const base = t.lastIndexOf('/') + 1;
  const whole = t.indexOf(q);
  if (whole >= 0) return 1000 - whole + (whole >= base ? 200 : 0) - t.length / 10;
  let i = 0, score = 0, last = -2;
  for (let j = 0; j < t.length && i < q.length; j++) {
    if (t[j] === q[i]) { score += (j === last + 1 ? 6 : 2) + (j === base || '/._-'.includes(t[j - 1] || '') ? 4 : 0); last = j; i++; }
  }
  return i === q.length ? score - t.length / 20 : -1;
}

const kbd = key => h('span', { class: 'pal-keys' }, ...String(key).split(' ').flatMap(chunk => chunk.split('+').map(k => h('span', { class: 'kbd', text: k }))));

export function createPalette(ctx) {
  const commands = buildCommands(ctx);
  let wrap = null, files = null, filesAt = 0;
  const recent = () => { try { return JSON.parse(localStorage.getItem('caret.recentFiles') || '[]'); } catch { return []; } };
  on('open-file', p => { if (typeof p !== 'string') return; try { localStorage.setItem('caret.recentFiles', JSON.stringify([p, ...recent().filter(x => x !== p)].slice(0, 12))); } catch {} });
  on('workspace', () => { files = null; });

  async function allFiles() {
    if (files && Date.now() - filesAt < 15000) return files;
    files = state.workspace ? await api.fs.files().catch(() => []) : [];
    filesAt = Date.now();
    return files;
  }

  function close() { wrap?.remove(); wrap = null; document.removeEventListener('mousedown', outside, true); }
  const outside = e => { if (wrap && !wrap.contains(e.target) && !e.target.closest('.omnibox')) close(); };

  function open(initial = '') {
    if (wrap) { wrap.querySelector('input').focus(); return; }
    const input = h('input', { class: 'pal-input', placeholder: 'Search files by name (append : to go to line or @ to go to symbol), or type > for commands', spellcheck: 'false' });
    const list = h('div', { class: 'pal-list' });
    wrap = h('div', { class: 'palette' }, input, list);
    document.body.append(wrap);
    setTimeout(() => document.addEventListener('mousedown', outside, true));
    let rows = [], sel = 0, forceFiles = false, seq = 0, timer;

    const choose = i => { const r = rows[i]; if (r) r.run(); };
    const paint = () => {
      list.replaceChildren(...rows.map((r, i) => {
        if (r.heading) return h('div', { class: 'pal-head', text: r.heading });
        return h('div', { class: 'pal-row' + (i === sel ? ' on' : ''), onmousemove: () => { if (sel !== i) { sel = i; mark(); } }, onclick: () => choose(i) }, ...r.node);
      }));
      mark();
    };
    const mark = () => {
      [...list.children].forEach((el, i) => el.classList?.toggle('on', i === sel && !rows[i]?.heading));
      list.children[sel]?.scrollIntoView({ block: 'nearest' });
    };
    const set = (next, keepSel) => { rows = next; if (!keepSel || !rows[sel] || rows[sel].heading) sel = Math.max(0, rows.findIndex(r => !r.heading)); paint(); };

    const openPath = p => () => { close(); emit('open-file-studio', p); };
    const fileRow = p => {
      const name = p.split('/').pop(), dir = p.slice(0, p.length - name.length - 1);
      return { node: [fileBadge(name), h('span', { class: 'pal-name', text: name }), h('span', { class: 'pal-dir', text: dir })], run: openPath(p) };
    };

    async function refresh() {
      const text = input.value, my = ++seq;
      const mode = text[0];
      if (mode === '>') {
        const q = text.slice(1).trim();
        const found = commands.map(cm => ({ cm, s: q ? fuzzy(q, cm.label) : 0 })).filter(x => x.s >= 0);
        if (q) found.sort((a, b) => b.s - a.s);
        set(found.map(({ cm }) => ({ node: [h('span', { class: 'pal-name', text: cm.label }), cm.key ? kbd(cm.key) : null], run: () => { close(); cm.run(); } })));
        if (!found.length) set([{ heading: 'No matching commands' }]);
      } else if (mode === '%') {
        const q = text.slice(1).trim();
        if (!q) return set([{ heading: 'Type the text to look for in every file' }]);
        if (!state.workspace) return set([{ heading: 'Open a folder first' }]);
        const res = await api.fs.search(q).catch(() => []);
        if (my !== seq) return;
        set(res.length ? res.slice(0, 60).map(r => ({ node: [fileBadge(r.path), h('span', { class: 'pal-name', text: r.path.split('/').pop() + (r.line ? ':' + r.line : '') }), h('span', { class: 'pal-dir', text: r.line ? r.text : r.path })], run: openPath(r.path) })) : [{ heading: 'No results' }]);
      } else if (mode === '@') {
        set([{ node: [h('span', { class: 'pal-name', text: 'Show the symbols in this file' })], run: () => { close(); setTimeout(ed('editor.action.quickOutline'), 0); } }]);
      } else if (mode === ':') {
        set([{ node: [h('span', { class: 'pal-name', text: 'Go to line…' })], run: () => { close(); setTimeout(ed('editor.action.gotoLine'), 0); } }]);
      } else if (mode === '?') {
        set(HOME.filter(x => x.hint).map(x => ({ node: [h('span', { class: 'pal-name', text: x.label }), h('span', { class: 'pal-hint', text: x.hint })], run: () => { input.value = x.hint; refresh(); input.focus(); } })));
      } else if (text.trim() || forceFiles) {
        const q = text.trim();
        if (!state.workspace) return set([{ heading: 'Open a folder to search its files' }]);
        const all = await allFiles();
        if (my !== seq) return;
        const found = q ? all.map(p => ({ p, s: fuzzy(q, p) })).filter(x => x.s >= 0).sort((a, b) => b.s - a.s).slice(0, 60).map(x => x.p) : [...new Set([...recent().filter(p => all.includes(p)), ...all])].slice(0, 60);
        set(found.length ? found.map(fileRow) : [{ heading: 'No matching files' }]);
      } else {
        const rec = recent().slice(0, 6);
        set([
          ...HOME.map(x => ({
            node: [h('span', { class: 'pal-name', text: x.label }), x.hint ? h('span', { class: 'pal-hint', text: x.hint }) : null, x.key ? kbd(x.key) : null],
            run: () => {
              if (x.id === 'ai') { close(); emit('cmd', 'focus-chat'); return; }
              if (x.id === 'file') { forceFiles = true; refresh(); input.focus(); return; }
              input.value = x.hint; refresh(); input.focus();
              if (x.id === 'sym' || x.id === 'line') choose(0);
            },
          })),
          ...(rec.length ? [{ heading: 'recently opened' }, ...rec.map(fileRow)] : []),
        ]);
      }
    }

    input.addEventListener('input', () => { forceFiles = false; clearTimeout(timer); timer = setTimeout(refresh, input.value[0] === '%' ? 220 : 0); });
    input.addEventListener('keydown', e => {
      const move = d => { const n = rows.length; if (!n) return; let i = sel; do { i = (i + d + n) % n; } while (rows[i].heading); sel = i; mark(); };
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); choose(sel); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    input.value = initial;
    refresh();
    input.focus();
  }

  addEventListener('keydown', e => {
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (mod && k === 'p' && !e.altKey) { e.preventDefault(); e.stopPropagation(); close(); open(e.shiftKey ? '>' : ''); }
    else if (e.key === 'F1') { e.preventDefault(); e.stopPropagation(); close(); open('>'); }
  }, true);
  return { open, close };
}
