import { h, icon, logo, menu, toast, timeAgo, fileBadge, askText } from './ui.js';
import { api, state, on, emit, saveSettings, modelLabel } from './state.js';
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
  $('titlebar').append(
    h('div', { class: 'brand', title: 'Caret Agent' }, logo(24)),
    omni, h('div', { class: 'spacer' }),
    h('div', { class: 'tools' },
      h('button', { class: 'icon-btn', title: 'Toggle side bar (Ctrl+B)', onclick: () => emit('cmd', 'toggle-sidebar') }, icon('sidebar')),
      h('button', { class: 'icon-btn', title: 'Toggle terminal (Ctrl+`)', onclick: () => emit('cmd', 'toggle-bottom') }, icon('panel')),
      h('button', { class: 'icon-btn', title: 'Toggle AI chat (Ctrl+Alt+B)', onclick: () => emit('cmd', 'toggle-chat') }, icon('sidebarRight')),
      h('button', { class: 'icon-btn', title: 'Settings (Ctrl+,)', onclick: () => openSettings() }, icon('settings'))));

  function folderMenu(anchor) {
    const recent = (state.settings.recentFolders || []).filter(d => d !== state.workspace?.root).slice(0, 8);
    menu(anchor, [
      { label: 'Open Folder…', icon: 'folderOpen', sub: 'Ctrl+O', onClick: () => emit('cmd', 'open-folder') },
      { label: 'Clone Repository…', icon: 'git', onClick: () => cloneDialog() },
      ...(state.workspace ? [{ label: 'Close Folder', icon: 'x', onClick: () => emit('cmd', 'close-folder') }] : []),
      ...(recent.length ? ['sep', { group: 'Recent' }, ...recent.map(d => ({ label: d.split(/[\\/]/).pop(), sub: d, icon: 'folder', onClick: () => emit('cmd', { open: d }) }))] : []),
    ]);
  }

  // ---------- studio ----------
  const activityItems = {
    explorer: h('button', { class: 'icon-btn on', title: 'Explorer (Ctrl+Shift+E)', onclick: () => goSide('explorer') }, icon('files')),
    search: h('button', { class: 'icon-btn', title: 'Search (Ctrl+Shift+F)', onclick: () => goSide('search') }, icon('search')),
    providers: h('button', { class: 'icon-btn', title: 'AI providers — install and connect', onclick: () => goSide('providers') }, icon('extensions')),
  };
  function goSide(which) { if (state.layout === 'agent') { setLayout('studio'); showSide(which, true); } else showSide(which, true); }
  const actAgent = h('button', { class: 'icon-btn', title: 'Agent view (chat first)', onclick: () => setLayout(state.layout === 'agent' ? 'studio' : 'agent') }, icon('agent'));
  const actMore = h('button', { class: 'icon-btn', title: 'More', onclick: () => menu(actMore, [
    { label: 'Project memory', sub: '.caret/HANDOFF.md', icon: 'book', onClick: () => state.workspace ? emit('open-file-studio', '.caret/HANDOFF.md') : toast('Open a folder first') },
    { label: 'Open Folder…', icon: 'folderOpen', onClick: () => emit('cmd', 'open-folder') },
    { label: 'Clone Repository…', icon: 'git', onClick: () => cloneDialog() },
    'sep',
    { label: 'Settings', icon: 'settings', sub: 'Ctrl+,', onClick: () => openSettings() },
  ]) }, icon('down'));
  // One row of tools at the top of the side panel (no separate left rail).
  const toolRow = h('div', { class: 'toolrow' }, activityItems.explorer, activityItems.search, activityItems.providers, actAgent, actMore);
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
  const sessionList = h('div', { class: 'col', style: { overflowY: 'auto', flex: 1 } });
  $('sessions').append(
    h('button', { class: 'nav-item', onclick: () => chat.newChat() }, icon('plus'), h('span', { class: 'grow', text: 'New chat' }), h('span', { class: 'kbd', text: 'Ctrl T' })),
    h('button', { class: 'nav-item', onclick: () => folderMenu(document.activeElement) }, icon('folder'), h('span', { class: 'grow', id: 'agent-folder', text: 'No folder' })),
    h('button', { class: 'nav-item', onclick: () => emit('cmd', 'toggle-bottom') }, icon('terminal'), h('span', { class: 'grow', text: 'Terminal' })),
    h('div', { class: 'nav-label' }, h('span', { class: 'grow', text: 'Chats' })),
    sessionList);
  $('filespane').append(filesExplorer.el);
  const agentTerm = h('div', { class: 'col hidden', style: { height: '220px', borderTop: '1px solid var(--border)', background: 'var(--panel)' } });

  on('chats', list => {
    sessionList.replaceChildren(...list.map(c => {
      const b = h('button', { class: 'nav-item' + (c.active ? ' on' : ''), style: { height: 'auto', padding: '6px 8px', alignItems: 'flex-start' }, onclick: () => chat.select(c.id),
        oncontextmenu: e => { e.preventDefault(); menu(null, [
          { label: 'Rename', icon: 'edit', onClick: () => askText('Rename chat', c.title).then(t => t && chat.rename(c.id, t)) },
          { label: 'Delete', icon: 'trash', onClick: () => chat.deleteChat(c.id) }], { x: e.clientX, y: e.clientY }); } },
        c.running ? h('span', { class: 'busy', style: { width: '6px', height: '6px', borderRadius: '50%', background: 'var(--accent)', marginTop: '7px', flex: 'none' } }) : icon('chat'),
        h('span', { class: 'grow' }, h('div', { style: { overflow: 'hidden', textOverflow: 'ellipsis' }, text: c.title }), h('div', { class: 'session-meta', text: timeAgo(c.updatedAt) })));
      return b;
    }));
  });

  // ---------- layout switching ----------
  function setLayout(l) {
    state.layout = l;
    document.body.classList.toggle('agent-layout', l === 'agent');
    $('studio').classList.toggle('hidden', l !== 'studio');
    $('agentview').classList.toggle('hidden', l !== 'agent');
    actAgent.classList.toggle('on', l === 'agent');
    const which = side;
    for (const [k, b] of Object.entries(activityItems)) b.classList.toggle('on', l === 'studio' && k === which);
    if (l === 'agent') $('sessions').prepend(toolRow); else $('sidebar').prepend(toolRow);
    if (l === 'agent') {
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
  on('cursor', c => { sbCursor.textContent = `Ln ${c.line}, Col ${c.col}`; sbLang.textContent = c.lang || ''; });
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
    $('agent-folder').textContent = name;
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
      else if (c === 'toggle-chat') state.layout === 'studio' ? showPane('chatpane') : $('filespane').classList.toggle('hidden');
      else if (c === 'toggle-bottom' || c === 'show-bottom') {
        if (state.layout === 'studio') showPane('bottom', c === 'show-bottom' ? true : undefined);
        else { const show = c === 'show-bottom' ? true : agentTerm.classList.contains('hidden'); agentTerm.classList.toggle('hidden', !show); if (show) agentTerm.append(terminal.el); }
      }
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
