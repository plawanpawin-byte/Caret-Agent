import { h, icon, logo, menu, toast, timeAgo, fileBadge, askText } from './ui.js';
import { api, state, on, emit, saveSettings, modelLabel, getCatalog } from './state.js';
import { createExplorer } from './explorer.js';
import { createEditorArea } from './editor.js';
import { createTerminalPanel } from './terminal.js';
import { createChat } from './chat.js';
import { onboarding, openSettings, cloneDialog } from './dialogs.js';
import { createProviders } from './providers.js';

const $ = id => document.getElementById(id);
const store = { get: (k, d) => { try { const v = localStorage.getItem('caret.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set: (k, v) => { try { localStorage.setItem('caret.' + k, JSON.stringify(v)); } catch {} } };

async function boot() {
  [state.settings, state.info, state.workspace] = await Promise.all([api.settings.get(), api.app.info(), api.workspace.current()]);
  document.body.classList.toggle('mac', state.info.platform === 'darwin');

  const explorer = createExplorer();
  const filesExplorer = createExplorer({ title: 'Files', onOpen: p => { setLayout('studio'); emit('open-file', p); } });
  const editorArea = createEditorArea();
  const terminal = createTerminalPanel();
  const chat = createChat();
  const search = createSearch();
  const providersPanel = createProviders();
  let side = 'explorer';

  // ---------- title bar ----------
  const omni = h('button', { class: 'omnibox', title: 'Folder', onclick: () => folderMenu(omni) }, icon('folder'), h('span', { text: 'No folder' }), icon('down'));
  // Left of the title bar: the view you are in (a menu), then File / Edit / View / Help.
  const viewName = h('span', { text: 'IDE' });
  const viewBtn = h('button', { class: 'viewbtn', title: 'Switch view', onclick: () => viewMenu() }, viewName, icon('down'));
  async function checkUpdate() {
    toast('Checking for updates…');
    const r = await api.app.checkUpdate().catch(() => null);
    if (r?.newer) { toast(`Version ${r.latest} is available (you have ${r.current})`); if (r.url) api.app.openExternal(r.url); }
    else toast(`No updates here — you are on the latest version (${r?.current || state.info?.version})`);
  }
  function viewMenu() {
    const inIde = state.layout !== 'agent';
    menu(viewBtn, inIde ? [
      { label: 'Check for updates', icon: 'refresh', onClick: checkUpdate },
      'sep',
      { label: 'Exit IDE', sub: 'Back to the Agent', icon: 'agent', onClick: () => setLayout('agent') },
    ] : [
      { label: 'Open IDE', sub: 'Code editor, files and terminal', icon: 'code', onClick: () => setLayout('studio') },
      'sep',
      { label: 'Check for updates', icon: 'refresh', onClick: checkUpdate },
    ]);
  }
  const doc = c => () => { try { document.execCommand(c); } catch {} };
  const pasteText = async () => { try { document.execCommand('insertText', false, await navigator.clipboard.readText()); } catch {} };
  const menus = {
    File: () => [
      { label: 'Open Folder…', key: 'Ctrl+O', icon: 'folderOpen', onClick: () => emit('cmd', 'open-folder') },
      { label: 'Clone Repository…', icon: 'git', onClick: () => cloneDialog() },
      ...((state.settings.recentFolders || []).filter(d => d !== state.workspace?.root).slice(0, 5).length ? ['sep', { group: 'Recent' },
        ...(state.settings.recentFolders || []).filter(d => d !== state.workspace?.root).slice(0, 5).map(d => ({ label: d.split(/[\\/]/).pop(), sub: d, icon: 'folder', onClick: () => emit('cmd', { open: d }) }))] : []),
      'sep',
      { label: 'Close Folder', icon: 'x', disabled: !state.workspace, onClick: () => emit('cmd', 'close-folder') },
      { label: 'Settings', key: 'Ctrl+,', icon: 'settings', onClick: () => openSettings() },
    ],
    Edit: () => [
      { label: 'Undo', key: 'Ctrl+Z', onClick: doc('undo') }, { label: 'Redo', key: 'Ctrl+Y', onClick: doc('redo') }, 'sep',
      { label: 'Cut', key: 'Ctrl+X', onClick: doc('cut') }, { label: 'Copy', key: 'Ctrl+C', onClick: doc('copy') }, { label: 'Paste', key: 'Ctrl+V', onClick: pasteText },
      { label: 'Select all', key: 'Ctrl+A', onClick: doc('selectAll') }, 'sep',
      { label: 'Search in files', key: 'Ctrl+Shift+F', icon: 'search', onClick: () => emit('cmd', 'search') },
    ],
    View: () => [
      { label: 'Side bar', key: 'Ctrl+B', icon: 'sidebar', onClick: () => emit('cmd', 'toggle-sidebar') },
      { label: 'Terminal', key: 'Ctrl+`', icon: 'terminal', onClick: () => emit('cmd', 'toggle-bottom') },
      { label: state.layout === 'agent' ? 'Files' : 'AI panel', key: 'Ctrl+Alt+B', icon: 'files', onClick: () => emit('cmd', 'toggle-chat') }, 'sep',
      { label: 'AI providers', key: 'Ctrl+Shift+X', icon: 'extensions', onClick: () => emit('cmd', 'providers') },
      { label: state.layout === 'agent' ? 'Open IDE' : 'Exit IDE (Agent)', icon: state.layout === 'agent' ? 'code' : 'agent', onClick: () => setLayout(state.layout === 'agent' ? 'studio' : 'agent') },
    ],
    Help: () => [
      { label: 'Project memory', sub: '.caret/HANDOFF.md', icon: 'book', disabled: !state.workspace, onClick: () => emit('open-file-studio', '.caret/HANDOFF.md') },
      { label: 'Caret Agent on GitHub', icon: 'git', onClick: () => api.app.openExternal('https://github.com/plawanpawin-byte/Caret-Agent') },
      'sep', { label: 'Check for updates', icon: 'refresh', onClick: checkUpdate },
      { note: `Caret Agent ${state.info?.version || ''}` },
    ],
  };
  const menubar = h('div', { class: 'menubar' }, ...Object.entries(menus).map(([name, items]) => {
    const b = h('button', { text: name, onclick: () => { menu(b, items()); b.classList.add('open'); } });
    b.addEventListener('mouseenter', () => { if (document.querySelector('.menu') && menubar.querySelector('.open')) { menu(b, items()); menubar.querySelectorAll('.open').forEach(x => x.classList.remove('open')); b.classList.add('open'); } });
    return b;
  }));
  document.addEventListener('mousedown', e => { if (!e.target.closest('.menubar')) menubar.querySelectorAll('.open').forEach(x => x.classList.remove('open')); }, true);
  $('titlebar').append(
    h('div', { class: 'brand', title: 'Caret Agent' }, logo(24)),
    viewBtn, menubar,
    omni, h('div', { class: 'spacer' }),
    h('div', { class: 'tools' },
      h('button', { class: 'icon-btn', title: 'Toggle side bar (Ctrl+B)', onclick: () => emit('cmd', 'toggle-sidebar') }, icon('sidebar')),
      h('button', { class: 'icon-btn', title: 'Toggle terminal (Ctrl+`)', onclick: () => emit('cmd', 'toggle-bottom') }, icon('panel')),
      h('button', { class: 'icon-btn', title: 'Toggle AI chat (Ctrl+Alt+B)', onclick: () => emit('cmd', 'toggle-chat') }, icon('sidebarRight')),
      h('button', { class: 'icon-btn', title: 'Settings (Ctrl+,)', onclick: () => openSettings() }, icon('settings'))));

  function folderMenu(anchor) {
    const recent = (state.settings.recentFolders || []).filter(d => d !== state.workspace?.root).slice(0, 8);
    menu(anchor, [
      { label: 'Open Folder…', icon: 'folderOpen', key: 'Ctrl+O', onClick: () => emit('cmd', 'open-folder') },
      { label: 'Clone Repository…', icon: 'git', onClick: () => cloneDialog() },
      ...(state.workspace ? [{ label: 'Close Folder', icon: 'x', onClick: () => emit('cmd', 'close-folder') }] : []),
      ...(recent.length ? ['sep', { group: 'Recent' }, ...recent.map(d => ({ label: d.split(/[\\/]/).pop(), sub: d, icon: 'folder', onClick: () => emit('cmd', { open: d }) }))] : []),
    ]);
  }

  // ---------- studio ----------
  const activityItems = {
    explorer: h('button', { class: 'icon-btn on', title: 'Explorer (Ctrl+Shift+E)', onclick: () => goSide('explorer') }, icon('files')),
    search: h('button', { class: 'icon-btn', title: 'Search (Ctrl+Shift+F)', onclick: () => goSide('search') }, icon('search')),
    providers: h('button', { class: 'icon-btn', title: 'AI providers (Ctrl+Shift+X)', onclick: () => goSide('providers') }, icon('extensions')),
  };
  function goSide(which) { if (state.layout === 'agent') { setLayout('studio'); showSide(which, true); } else showSide(which, true); }
  const actMore = h('button', { class: 'icon-btn', title: 'More', onclick: () => menu(actMore, [
    { label: 'Project memory', sub: '.caret/HANDOFF.md', icon: 'book', onClick: () => state.workspace ? emit('open-file-studio', '.caret/HANDOFF.md') : toast('Open a folder first') },
    { label: 'Open Folder…', icon: 'folderOpen', onClick: () => emit('cmd', 'open-folder') },
    { label: 'Clone Repository…', icon: 'git', onClick: () => cloneDialog() },
    'sep',
    { label: 'Settings', icon: 'settings', key: 'Ctrl+,', onClick: () => openSettings() },
  ]) }, icon('down'));
  // One row of tools at the top of the side panel (no separate left rail).
  const toolRow = h('div', { class: 'toolrow' }, activityItems.explorer, activityItems.search, activityItems.providers, h('span', { class: 'grow' }), actMore);
  $('sidebar').append(toolRow, explorer.el, search.el, providersPanel.el);
  $('editor-area').append(editorArea.el);
  $('bottom').append(terminal.el);

  function showSide(which, force) {
    const sb = $('sidebar');
    showPane('sidebar', true);
    for (const [k, b] of Object.entries(activityItems)) b.classList.toggle('on', k === which);
    explorer.el.classList.toggle('hidden', which !== 'explorer');
    search.el.classList.toggle('hidden', which !== 'search');
    providersPanel.el.classList.toggle('hidden', which !== 'providers');
    side = which;
    if (which === 'search') search.focus();
    if (which === 'providers') providersPanel.load();
  }
  search.el.classList.add('hidden');
  providersPanel.el.classList.add('hidden');

  // ---------- agent layout ----------
  // A desktop agent, not an IDE: your projects and chats on the left, the conversation in the middle.
  // Files and the terminal are there when you ask for them; the full editor is one click away.
  const chatFilter = h('input', { class: 'ag-filter hidden', placeholder: 'Search chats', spellcheck: 'false' });
  const sessionList = h('div', { class: 'ag-chats' });
  const projList = h('div', { class: 'ag-projects' });
  const agModel = h('button', { class: 'ag-ai', title: 'AI providers', onclick: () => providersPanel.openList() });
  $('sessions').append(
    h('div', { class: 'ag-nav' },
      h('button', { class: 'ag-item strong', onclick: () => chat.newChat() }, icon('compose'), h('span', { class: 'grow', text: 'New task' }), h('span', { class: 'ag-kbd', text: 'Ctrl T' })),
      h('button', { class: 'ag-item', onclick: () => { chatFilter.classList.toggle('hidden'); if (!chatFilter.classList.contains('hidden')) chatFilter.focus(); else { chatFilter.value = ''; paintChats(); } } }, icon('search'), h('span', { class: 'grow', text: 'Search chats' })),
      h('button', { class: 'ag-item', onclick: () => providersPanel.openList() }, icon('extensions'), h('span', { class: 'grow', text: 'AI providers' }))),
    h('div', { class: 'ag-label' }, h('span', { class: 'grow', text: 'Projects' }),
      h('button', { class: 'icon-btn', title: 'Open a folder', onclick: () => emit('cmd', 'open-folder') }, icon('plus'))),
    projList,
    h('div', { class: 'ag-label' }, h('span', { class: 'grow', text: 'Chats' })),
    chatFilter, sessionList,
    h('div', { class: 'ag-foot' }, agModel,
      h('button', { class: 'icon-btn', title: 'Settings (Ctrl+,)', onclick: () => openSettings() }, icon('settings'))));
  // Going to a chat or a project from the side bar leaves the AI providers page.
  $('sessions').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (b && b !== agModel && !b.textContent.includes('AI providers') && !b.closest('.ag-foot')) providersPanel.close();
  }, true);
  $('filespane').append(filesExplorer.el);
  const agentTerm = h('div', { class: 'col hidden', style: { height: '220px', borderTop: '1px solid var(--border)', background: 'var(--panel)' } });
  const agFilesBtn = h('button', { class: 'ag-top-btn', title: 'Show files', onclick: () => emit('cmd', 'toggle-chat') }, icon('files'), h('span', { text: 'Files' }));
  const agTop = h('div', { class: 'ag-top' },
    h('button', { class: 'icon-btn', title: 'Side bar (Ctrl+B)', onclick: () => emit('cmd', 'toggle-sidebar') }, icon('sidebar')),
    h('span', { class: 'grow' }),
    agFilesBtn,
    h('button', { class: 'ag-top-btn', title: 'Terminal (Ctrl+`)', onclick: () => emit('cmd', 'toggle-bottom') }, icon('terminal'), h('span', { text: 'Terminal' })),
    h('button', { class: 'ag-top-btn', title: 'Open the code editor', onclick: () => setLayout('studio') }, h('span', { text: 'Editor' }), icon('external')));
  $('agent-center').append(agTop);
  if (!store.get('agFiles', false)) $('filespane').classList.add('hidden');

  let chatRows = [];
  function paintChats() {
    const q = chatFilter.value.trim().toLowerCase();
    const list = chatRows.filter(c => !q || c.title.toLowerCase().includes(q));
    sessionList.replaceChildren(...(list.length ? list.map(c => h('button', { class: 'ag-chat' + (c.active ? ' on' : ''), title: c.title, onclick: () => chat.select(c.id),
      oncontextmenu: e => { e.preventDefault(); menu(null, [
        { label: 'Rename', icon: 'edit', onClick: () => askText('Rename chat', c.title).then(t => t && chat.rename(c.id, t)) },
        { label: 'Delete', icon: 'trash', onClick: () => chat.deleteChat(c.id) }], { x: e.clientX, y: e.clientY }); } },
      c.running ? h('span', { class: 'ag-run' }) : null,
      h('span', { class: 'grow', text: c.title }), h('span', { class: 'ag-time', text: timeAgo(c.updatedAt) })))
      : [h('div', { class: 'ag-empty', text: q ? 'No chat matches' : 'No chats yet' })]));
  }
  chatFilter.addEventListener('input', paintChats);
  chatFilter.addEventListener('keydown', e => { if (e.key === 'Escape') { chatFilter.value = ''; chatFilter.classList.add('hidden'); paintChats(); } });
  on('chats', list => { chatRows = list.filter(c => c.title !== 'New chat' || c.active); paintChats(); });

  function paintProjects() {
    const cur = state.workspace?.root;
    const all = [...(cur ? [cur] : []), ...(state.settings.recentFolders || []).filter(d => d !== cur)].slice(0, 6);
    projList.replaceChildren(...(all.length ? all.map(d => h('button', { class: 'ag-item' + (d === cur ? ' on' : ''), title: d, onclick: () => d !== cur && emit('cmd', { open: d }) },
      icon(d === cur ? 'folderOpen' : 'folder'), h('span', { class: 'grow', text: d.split(/[\\/]/).pop() })))
      : [h('button', { class: 'ag-item', onclick: () => emit('cmd', 'open-folder') }, icon('folder'), h('span', { class: 'grow muted', text: 'Open a folder…' }))]));
  }
  function paintAi() {
    const s = state.settings;
    const auto = !s.model || s.model === 'auto';
    const key = auto ? state.catalog?.auto?.key : s.model;
    const label = auto ? (key ? `Auto · ${modelLabel(key).split(" (")[0]}` : state.catalog ? 'No AI set up' : 'Auto') : modelLabel(s.model);
    agModel.title = auto && state.catalog?.auto?.reason ? state.catalog.auto.reason : 'AI providers';
    agModel.replaceChildren(h('i', { class: 'dot ' + (key ? 'ok' : 'off') }), h('span', { class: 'grow', text: label }), icon('extensions'));
  }
  on('settings', paintAi); on('catalog', paintAi); paintAi();
  getCatalog().catch(() => {});

  // ---------- layout switching ----------
  function setLayout(l) {
    state.layout = l;
    document.body.classList.toggle('agent-layout', l === 'agent');
    $('studio').classList.toggle('hidden', l !== 'studio');
    $('agentview').classList.toggle('hidden', l !== 'agent');
    viewName.textContent = l === 'agent' ? 'Agent' : 'IDE';
    const which = side;
    for (const [k, b] of Object.entries(activityItems)) b.classList.toggle('on', l === 'studio' && k === which);
    // The overlay page for an AI provider lives over whichever centre is showing.
    (l === 'agent' ? $('agent-center') : document.querySelector('#studio main.center')).append(providersPanel.page);
    if (l === 'agent') {
      paintProjects();
      $('agent-center').append(chat.el, agentTerm);
      chat.setVariant('center');
      if (!agentTerm.classList.contains('hidden')) agentTerm.append(terminal.el);
    } else {
      $('chatpane').append(chat.el);
      chat.setVariant('panel');
      $('bottom').append(terminal.el);
    }
    store.set('layout', l);
  }

  // ---------- panes & resizing ----------
  const sizes = store.get('sizes', { sidebar: 260, chatpane: 400, bottom: 240 });
  for (const [k, v] of Object.entries(sizes)) { const el = $(k); if (el) el.style[k === 'bottom' ? 'height' : 'width'] = v + 'px'; }
  const hiddenPanes = store.get('hiddenPanes', {});
  for (const [k, v] of Object.entries(hiddenPanes)) if (v) showPane(k, false, true);
  function showPane(id, show, silent) {
    const el = $(id);
    const isHidden = el.classList.contains('hidden');
    const next = show === undefined ? isHidden : show;
    el.classList.toggle('hidden', !next);
    const rz = document.querySelector(`[data-resize="${id}"]`);
    if (rz) rz.classList.toggle('hidden', !next);
    hiddenPanes[id] = !next;
    if (!silent) store.set('hiddenPanes', hiddenPanes);
  }
  document.querySelectorAll('.resizer').forEach(rz => {
    rz.addEventListener('mousedown', e => {
      e.preventDefault();
      const id = rz.dataset.resize, el = $(id);
      const vertical = id === 'bottom';
      const start = vertical ? e.clientY : e.clientX;
      const startSize = vertical ? el.offsetHeight : el.offsetWidth;
      const dir = id === 'chatpane' || id === 'bottom' ? -1 : 1;
      rz.classList.add('drag');
      const move = ev => {
        const d = ((vertical ? ev.clientY : ev.clientX) - start) * dir;
        const v = Math.max(vertical ? 80 : 180, Math.min(vertical ? innerHeight - 200 : 720, startSize + d));
        el.style[vertical ? 'height' : 'width'] = v + 'px';
        sizes[id] = v;
      };
      const up = () => { rz.classList.remove('drag'); removeEventListener('mousemove', move); removeEventListener('mouseup', up); store.set('sizes', sizes); };
      addEventListener('mousemove', move); addEventListener('mouseup', up);
    });
  });

  // ---------- status bar ----------
  const sbFolder = h('button', { onclick: () => folderMenu(sbFolder) }, icon('folder'), h('span', { text: 'No folder' }));
  const sbMsg = h('span', { class: 'muted', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '40vw' } });
  const sbCursor = h('span');
  const sbLang = h('span');
  const sbModel = h('button', { onclick: () => { showPane('chatpane', true); chat.focus(); } });
  const sbMem = h('button', { title: 'What the AIs remember about this project', onclick: () => state.workspace && emit('open-file', '.caret/HANDOFF.md') }, icon('book'), 'Memory');
  $('statusbar').append(sbFolder, sbMsg, h('span', { class: 'grow' }), sbCursor, sbLang, sbMem, sbModel);
  let msgTimer;
  on('status', t => { sbMsg.textContent = t; clearTimeout(msgTimer); msgTimer = setTimeout(() => (sbMsg.textContent = ''), 8000); });
  on('cursor', c => { sbCursor.textContent = c.lang === 'image' ? '' : `Ln ${c.line}, Col ${c.col}`; sbLang.textContent = c.lang || ''; });
  on('editor-tabs', ({ active }) => { if (!active) { sbCursor.textContent = ''; sbLang.textContent = ''; } });
  const paintModel = () => {
    const s = state.settings;
    sbModel.replaceChildren(icon('sparkle'), `${modelLabel(s.model)} · ${{ plan: 'Plan', code: 'Code', agent: 'Agent' }[s.mode]} · ${{ ask: 'Ask first', auto: 'Decide for me', full: 'Full access' }[s.permission]}`);
  };
  on('settings', paintModel); on('catalog', paintModel); paintModel();

  // ---------- workspace ----------
  function paintWorkspace() {
    const name = state.workspace?.name || 'No folder';
    omni.querySelector('span').textContent = name;
    omni.title = state.workspace?.root || '';
    sbFolder.querySelector('span').textContent = name;
    paintProjects();
    document.title = state.workspace ? `${name} — Caret Agent` : 'Caret Agent';
  }
  async function setWorkspace(ws) {
    state.workspace = ws;
    state.settings = await api.settings.get();
    paintWorkspace();
    emit('workspace', ws);
    emit('recent-changed');
  }
  on('workspace-opened', setWorkspace);
  api.fs.onChanged(() => emit('fs-changed', {}));
  on('open-file-studio', p => { setLayout('studio'); emit('open-file', p); });

  // ---------- commands ----------
  on('cmd', async c => {
    try {
      if (c === 'open-folder') { const ws = await api.workspace.pick(); if (ws) setWorkspace(ws); }
      else if (c === 'clone') cloneDialog();
      else if (c === 'close-folder') { await api.workspace.close(); setWorkspace(null); }
      else if (c?.open) { const ws = await api.workspace.openRecent(c.open); setWorkspace(ws); }
      else if (c?.layout) setLayout(c.layout);
      else if (c === 'toggle-sidebar') state.layout === 'studio' ? showPane('sidebar') : $('sessions').classList.toggle('hidden');
      else if (c === 'toggle-chat') {
        if (state.layout === 'studio') showPane('chatpane');
        else { const show = $('filespane').classList.toggle('hidden') === false; store.set('agFiles', show); agFilesBtn.classList.toggle('on', show); }
      }
      else if (c === 'toggle-bottom' || c === 'show-bottom') {
        if (state.layout === 'studio') showPane('bottom', c === 'show-bottom' ? true : undefined);
        else { const show = c === 'show-bottom' ? true : agentTerm.classList.contains('hidden'); agentTerm.classList.toggle('hidden', !show); if (show) agentTerm.append(terminal.el); }
      }
      else if (c === 'focus-chat') { if (state.layout === 'studio') showPane('chatpane', true); chat.focus(); }
      else if (c === 'settings-models') openSettings('models');
      else if (c === 'providers') goSide('providers');
      else if (c === 'search') { goSide('search'); }
    } catch (e) { toast(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), { error: true }); }
  });

  addEventListener('keydown', e => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const k = e.key.toLowerCase();
    if (k === 'o' && !e.shiftKey) { e.preventDefault(); emit('cmd', 'open-folder'); }
    else if (k === 'l') { e.preventDefault(); if (state.layout === 'studio') showPane('chatpane', true); chat.focus(); }
    else if (k === 't' && !e.shiftKey) { e.preventDefault(); chat.newChat(); }
    else if (k === 'b' && e.altKey) { e.preventDefault(); emit('cmd', 'toggle-chat'); }
    else if (k === 'b') { e.preventDefault(); emit('cmd', 'toggle-sidebar'); }
    else if (k === '`' || k === 'j') { e.preventDefault(); emit('cmd', 'toggle-bottom'); }
    else if (k === ',') { e.preventDefault(); openSettings(); }
    else if (k === 'f' && e.shiftKey) { e.preventDefault(); goSide('search'); }
    else if (k === 'e' && e.shiftKey) { e.preventDefault(); goSide('explorer'); }
    else if (k === 'x' && e.shiftKey) { e.preventDefault(); goSide('providers'); }
  });
  // Dropping files onto the window must never navigate away.
  addEventListener('dragover', e => e.preventDefault());
  addEventListener('drop', e => e.preventDefault());

  paintWorkspace();
  setLayout(store.get('layout', null) || state.settings.layout || 'studio');

  if (!state.settings.onboarded) {
    await onboarding();
    setLayout(state.settings.layout);
    emit('settings', state.settings);
  }
}

// Shows the matching part of a line, centred and highlighted, so the match is never cut off.
function snippet(text, q) {
  const t = String(text || '').trim();
  const i = t.toLowerCase().indexOf(String(q || '').toLowerCase());
  if (i < 0) return [t];
  const start = Math.max(0, i - 24);
  return [(start ? '…' : '') + t.slice(start, i), h('span', { class: 'hit', text: t.slice(i, i + q.length) }), t.slice(i + q.length)];
}

function createSearch() {
  const input = h('input', { class: 'field', placeholder: 'Search in files', spellcheck: 'false' });
  const results = h('div', { class: 'tree' });
  const el = h('div', { class: 'col', style: { flex: 1 } }, h('div', { class: 'panel-head' }, h('span', { class: 'grow', text: 'Search' })),
    h('div', { style: { padding: '0 10px 8px' } }, input), results);
  let t, seq = 0;
  input.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const q = input.value.trim();
      const my = ++seq;
      if (!q || !state.workspace) { results.replaceChildren(); return; }
      const res = await api.fs.search(q).catch(() => []);
      if (my !== seq) return;
      if (!res.length) { results.replaceChildren(h('div', { class: 'muted', style: { padding: '8px 12px' }, text: 'No results' })); return; }
      results.replaceChildren(...res.map(r => h('div', { class: 'row', style: { paddingLeft: '10px', height: 'auto', padding: '3px 10px', flexDirection: 'column', alignItems: 'flex-start' }, onclick: () => emit('open-file', r.path) },
        h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, fileBadge(r.path), h('span', { text: r.path.split('/').pop() }), h('span', { class: 'muted', style: { fontSize: '11px' }, text: r.line ? `:${r.line}` : '' })),
        r.line ? h('div', { class: 'hit-line' }, ...snippet(r.text, q)) : null)));
    }, 250);
  });
  return { el, focus: () => input.focus() };
}

boot().catch(e => {
  document.body.append(h('pre', { style: { color: '#e8645a', padding: '20px' }, text: 'Caret Agent failed to start:\n' + (e.stack || e.message) }));
});
