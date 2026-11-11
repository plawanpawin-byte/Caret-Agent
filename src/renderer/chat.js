// AI chat: many tabs, a prompt bar with mode / permission / model, image
// paste, live tool activity and approval cards.
import { h, icon, logo, menu, toast, timeAgo, fileBadge } from './ui.js';
import { api, state, on, emit, saveSettings, getCatalog, refreshCatalog, modelLabel } from './state.js';
import { mountMarkdown } from './markdown.js';

const MODES = {
  plan: { label: 'Plan', icon: 'plan', sub: 'Reads the project and writes a plan. Changes nothing.' },
  code: { label: 'Code', icon: 'code', sub: 'Makes the change you ask for, then stops.' },
  agent: { label: 'Agent', icon: 'agent', sub: 'Works on its own until the task is done and checked.' },
};
const PERMS = {
  ask: { label: 'Ask first', icon: 'shield', sub: 'Every edit and command waits for your OK.' },
  auto: { label: 'Decide for me', icon: 'shieldCheck', sub: 'Normal edits and commands run. Risky ones still ask.' },
  full: { label: 'Full access', icon: 'bolt', sub: 'Nothing asks. Files stay inside the project.' },
};

export function createChat() {
  const chats = new Map();          // id -> { id, title, running, transcript, approvals: [], loaded }
  let openIds = loadOpen();
  let activeId = null;
  let variant = 'panel';
  const drafts = new Map();
  let attachments = [];             // { kind:'image', name, dataUrl } | { kind:'file', path }
  const openDetails = new Set();     // tool rows the user expanded stay expanded while streaming

  // ---------- skeleton ----------
  const tabStrip = h('div', { class: 'chat-tabs' });
  const transcript = h('div', { class: 'transcript' });
  const welcome = h('div', { class: 'welcome hidden' });
  const textarea = h('textarea', { rows: 1, placeholder: 'Ask anything (Ctrl+L), @ to mention' });
  const attachEl = h('div', { class: 'attachments' });
  const fileInput = h('input', { type: 'file', accept: 'image/*', multiple: true, class: 'hidden' });
  const permBtn = h('button', { class: 'pill', title: 'Permissions' });
  const modelBtn = h('button', { class: 'pill model', title: 'Model' });
  const ctxBtn = h('button', { class: 'pill toggle', title: 'Let the AI search the whole project for context' }, icon('layers'), h('span', { text: 'Codebase' }));
  const planBtn = h('button', { class: 'pill toggle', title: 'Plan only: read the project and write a plan, change nothing (Shift+Tab)' }, icon('plan'), h('span', { text: 'Plan' }));
  const sendBtn = h('button', { class: 'send', title: 'Send (Enter)' });
  const plusBtn = h('button', { class: 'ctx-plus', title: 'Add context' }, icon('plus'));
  const composer = h('div', { class: 'composer' }, attachEl, textarea,
    h('div', { class: 'composer-row' }, modelBtn, ctxBtn, planBtn, h('span', { class: 'grow' }), permBtn, sendBtn), fileInput);
  const composerWrap = h('div', { class: 'composer-wrap' }, composer);
  // panel header: two tabs (Chat = edits you ask for, Composer = works on its own) + actions on the right
  const tabChat = h('button', { class: 'htab', onclick: () => setTab('code') }, 'Chat');
  const tabComposer = h('button', { class: 'htab', onclick: () => setTab('agent') }, 'Composer');
  const subHead = h('div', { class: 'chat-head' }, tabChat, tabComposer, h('span', { class: 'grow' }),
    h('button', { class: 'icon-btn', title: 'New chat (Ctrl+T)', onclick: () => newChat() }, icon('plus')),
    h('button', { class: 'icon-btn', title: 'Past chats', onclick: e => historyMenu(e.currentTarget) }, icon('history')),
    h('button', { class: 'icon-btn', title: 'Open in Agent view', onclick: () => emit('cmd', { layout: 'agent' }) }, icon('expand')));
  const el = h('div', { class: 'chat' }, subHead, tabStrip, transcript, welcome, composerWrap);
  let useCodebase = false; try { useCodebase = localStorage.getItem('caret.codebase') === '1'; } catch {}
  let lastNonPlan = 'code';
  function setTab(mode) { lastNonPlan = mode; saveSettings({ mode }).then(updateComposer); }

  // ---------- tabs ----------
  function loadOpen() { try { return JSON.parse(localStorage.getItem('caret.openChats') || '[]'); } catch { return []; } }
  function saveOpen() { try { localStorage.setItem('caret.openChats', JSON.stringify(openIds)); } catch {} }

  async function refreshList() {
    const list = await api.agent.list();
    for (const s of list) chats.set(s.id, { ...(chats.get(s.id) || { transcript: [], approvals: [], loaded: false }), ...s });
    for (const id of [...chats.keys()]) if (!list.find(s => s.id === id)) chats.delete(id);
    openIds = openIds.filter(id => chats.has(id));
    emit('chats', listChats());
    return list;
  }
  const listChats = () => [...chats.values()].sort((a, b) => b.updatedAt - a.updatedAt).map(c => ({ id: c.id, title: c.title, updatedAt: c.updatedAt, running: c.running, active: c.id === activeId }));

  async function newChat() {
    const t = await api.agent.create();
    chats.set(t.id, { ...t, transcript: [], approvals: [], loaded: true });
    openIds.push(t.id); saveOpen();
    await select(t.id);
    emit('chats', listChats());
    textarea.focus();
  }

  async function select(id) {
    if (activeId) drafts.set(activeId, textarea.value);
    activeId = id;
    const c = chats.get(id);
    if (c && !c.loaded) {
      const full = await api.agent.get(id);
      if (full) { c.transcript = full.transcript; c.loaded = true; }
    }
    if (id && !openIds.includes(id)) { openIds.push(id); saveOpen(); }
    textarea.value = drafts.get(id) || '';
    autosize();
    renderTabs(); renderAll(); updateComposer();
    emit('chats', listChats());
  }

  async function closeTab(id) {
    openIds = openIds.filter(x => x !== id); saveOpen();
    const c = chats.get(id);
    if (c && !c.transcript.length && !c.running) { await api.agent.remove(id); chats.delete(id); }
    if (activeId === id) {
      const next = openIds[openIds.length - 1];
      if (next) await select(next); else { activeId = null; await newChat(); return; }
    }
    renderTabs();
    emit('chats', listChats());
  }

  async function deleteChat(id) {
    await api.agent.remove(id);
    chats.delete(id);
    openIds = openIds.filter(x => x !== id); saveOpen();
    if (activeId === id) { activeId = null; if (openIds.length) await select(openIds[openIds.length - 1]); else await newChat(); }
    emit('chats', listChats());
  }

  function renderTabs() {
    tabStrip.classList.toggle('hidden', variant === 'center' || openIds.length < 2);
    tabStrip.replaceChildren(
      ...openIds.map(id => {
        const c = chats.get(id); if (!c) return null;
        return h('button', { class: 'chat-tab' + (id === activeId ? ' on' : ''), title: c.title, onclick: () => select(id), onauxclick: e => { if (e.button === 1) closeTab(id); } },
          c.running ? h('span', { class: 'busy' }) : null, h('span', { text: c.title }),
          h('span', { class: 'x', title: 'Close', onclick: e => { e.stopPropagation(); closeTab(id); } }, icon('x')));
      }),
      h('span', { class: 'grow' }));
  }

  function historyMenu(anchor) {
    const list = listChats();
    menu(anchor, list.length ? [{ group: 'Past chats' }, ...list.slice(0, 30).map(c => ({ label: c.title, sub: timeAgo(c.updatedAt), checked: c.active, onClick: () => select(c.id) }))] : [{ note: 'No chats yet' }], { align: 'right' });
  }

  // ---------- transcript ----------
  const rel = p => {
    const r = (state.workspace?.root || '').replace(/\\/g, '/').replace(/\/+$/, '');
    let s = String(p || '').replace(/\\/g, '/');
    if (r && s.toLowerCase().startsWith(r.toLowerCase() + '/')) s = s.slice(r.length + 1);
    return s;
  };
  function toolLabel(p) {
    const a = p.args || {};
    const f = rel(a.path || a.file_path || a.notebook_path || '');
    const n = p.name || '';
    if (/^(read_file|Read)$/.test(n)) return ['Read', f];
    if (/^(write_file|Write)$/.test(n)) return ['Wrote', f];
    if (/^(edit_file|Edit|MultiEdit|NotebookEdit)$/.test(n)) return ['Edited', f];
    if (/^(delete_file)$/.test(n)) return ['Deleted', f];
    if (/^(list_dir|LS)$/.test(n)) return ['Listed', f || '.'];
    if (n === 'Glob') return ['Found files', a.pattern || ''];
    if (/^(search|Grep)$/.test(n)) return ['Searched', `“${a.query || a.pattern || ''}”`];
    if (/^(run_command|Bash|PowerShell)$/.test(n)) return [a.background ? 'Started' : 'Ran', a.command || ''];
    if (n === 'open_preview') return ['Opened preview', a.url || ''];
    if (n === 'update_progress') return ['Updated project memory', '.caret/HANDOFF.md'];
    if (n === 'write_plan') return ['Saved plan', '.caret/PLAN.md'];
    if (n === 'TodoWrite') return ['Updated task list', ''];
    if (n === 'WebFetch') return ['Read web page', a.url || ''];
    if (n === 'WebSearch') return ['Searched the web', a.query || ''];
    return [n.replace(/^mcp__\w+__/, ''), ''];
  }

  // While a tool is still running it should not read as finished.
  const RUNNING_VERB = { Read: 'Reading', Wrote: 'Writing', Edited: 'Editing', Deleted: 'Deleting', Listed: 'Listing', 'Found files': 'Finding files', Searched: 'Searching', Ran: 'Running', Started: 'Starting', 'Opened preview': 'Opening preview', 'Updated project memory': 'Updating project memory', 'Saved plan': 'Saving plan', 'Updated task list': 'Updating task list', 'Read web page': 'Reading web page', 'Searched the web': 'Searching the web' };
  function renderPart(p) {
    if (p.type === 'text') { const d = h('div', { class: 'md' }); mountMarkdown(d, p.text); return d; }
    if (p.type === 'thinking') return h('details', { class: 'thinking' }, h('summary', { text: 'Thinking' }), h('div', { text: p.text }));
    if (p.type === 'error') return h('div', { class: 'part-error', text: p.text });
    if (p.type === 'note') return h('div', { class: 'part-note', text: p.text });
    if (p.type === 'tool') {
      const [done, target] = toolLabel(p);
      const verb = (!p.status || p.status === 'running') ? (RUNNING_VERB[done] || done) : done;
      const st =h('span', { class: 'st ' + (p.status || 'running') }, p.status === 'done' ? icon('check') : (p.status === 'error' || p.status === 'denied') ? icon('x') : null);
      const sum = h('summary', {}, st, h('span', { class: 'label' }, h('b', { text: verb }), target ? h('span', { class: 'tgt', text: target }) : null, p.status === 'denied' ? ' — not allowed' : ''));
      const d = h('details', { class: 'tool' }, sum, p.result ? h('pre', { text: p.result }) : null);
      if (openDetails.has(p.id)) d.open = true;
      d.addEventListener('toggle', () => { d.open ? openDetails.add(p.id) : openDetails.delete(p.id); });
      const file = a => a.path || a.file_path;
      if (p.status === 'done' && /^(write_file|edit_file|Write|Edit|MultiEdit)$/.test(p.name) && file(p.args || {})) {
        sum.addEventListener('dblclick', () => emit('open-file', rel(file(p.args))));
        sum.title = 'Double-click to open the file';
      }
      return d;
    }
    return null;
  }

  function renderItem(item, c, isLast) {
    if (item.role === 'user') {
      return h('div', { class: 'msg user' },
        item.thumbs?.length ? h('div', { class: 'thumbs' }, ...item.thumbs.map(src => h('img', { src, alt: 'attached image' }))) : null,
        h('div', { class: 'bubble', text: item.text || (item.images?.length ? '(image)' : '') }),
        h('div', { class: 'msg-meta' }, item.mode ? h('span', { text: MODES[item.mode]?.label + ' mode' }) : null, !item.thumbs && item.images?.length ? h('span', { text: `· ${item.images.length} image${item.images.length > 1 ? 's' : ''}` }) : null));
    }
    const box = h('div', { class: 'msg assistant' });
    for (const p of item.parts || []) { const n = renderPart(p); if (n) box.append(n); }
    if (isLast && c.running) box.append(h('div', { class: 'working', text: (item.parts || []).length ? 'Working…' : `Starting ${item.model ? modelLabel(item.model) : ''}…` }));
    if (!c.running && item.model) {
      const answer = (item.parts || []).filter(p => p.type === 'text').map(p => p.text).join('').trim();
      const copy = answer ? h('button', { class: 'msg-copy', title: 'Copy answer', onclick: e => { navigator.clipboard.writeText(answer); const b = e.currentTarget; b.textContent = 'Copied'; setTimeout(() => { b.replaceChildren(icon('copy'), 'Copy'); }, 1200); } }, icon('copy'), 'Copy') : null;
      box.append(h('div', { class: 'msg-meta' }, h('span', { text: modelLabel(item.model) }), copy));
    }
    return box;
  }

  function renderApprovals(c) {
    return c.approvals.map(a => {
      const pv = a.preview || {};
      let body = null;
      if (pv.command != null) body = h('pre', { text: (pv.background ? '(background) ' : '') + pv.command });
      else if (pv.path) {
        body = h('pre');
        if (pv.before != null && pv.after != null && a.tool !== 'write_file') { body.append(h('span', { class: 'del', text: prefix(pv.before, '- ') }), '\n', h('span', { class: 'add', text: prefix(pv.after, '+ ') })); }
        else if (pv.after != null) body.append(h('span', { class: 'add', text: pv.before == null ? prefix(pv.after, '+ ') : pv.after }));
        else body.textContent = pv.path;
      } else body = h('pre', { text: JSON.stringify(a.args, null, 2).slice(0, 3000) });
      const [past, target] = toolLabel({ name: a.tool, args: a.args });
      const verb = ({ Wrote: 'Write', Edited: 'Edit', Ran: 'Run', Started: 'Start', Deleted: 'Delete', Listed: 'List', Searched: 'Search' })[past] || past;
      const decide = d => { api.agent.approve(a.reqId, d); c.approvals = c.approvals.filter(x => x !== a); renderAll(); };
      return h('div', { class: 'approval' },
        h('div', { class: 'head' }, icon('alert'), h('span', { class: 'ttl' }, h('b', { text: verb }), target ? h('span', { class: 'tgt', text: target }) : null)),
        h('div', { class: 'why', text: a.reason || 'Needs your OK' }),
        body,
        h('div', { class: 'actions' },
          h('button', { class: 'btn primary', onclick: () => decide('allow') }, 'Allow'),
          h('button', { class: 'btn', onclick: () => decide('always') }, 'Allow for this chat'),
          h('button', { class: 'btn ghost', onclick: () => decide('deny') }, 'Deny')));
    });
  }
  const prefix = (t, p) => String(t).split('\n').map(l => p + l).join('\n');

  let renderQueued = false;
  function renderAll() {
    renderQueued = false;
    const c = chats.get(activeId);
    const empty = !c || !c.transcript.length;
    if (variant === 'center') {
      welcome.classList.toggle('hidden', !empty);
      transcript.classList.toggle('hidden', empty);
      if (empty) {
        const inner = h('div', { class: 'welcome-inner' }, h('h1', { text: `What are we building${state.settings?.name ? ', ' + state.settings.name : ''}?` }));
        inner.append(h('div', { class: 'ctx-row' }, h('button', { class: 'ctx-chip', title: 'Folder the AI works in', onclick: () => emit('cmd', state.workspace ? 'open-folder' : 'open-folder') }, icon('folder'), state.workspace ? state.workspace.name : 'Open a folder')));
        inner.append(composerWrap);
        inner.append(suggestions());
        welcome.replaceChildren(inner);
        return;
      }
      if (composerWrap.parentElement !== el) el.append(composerWrap);
    } else {
      welcome.classList.add('hidden');
      transcript.classList.remove('hidden');
      if (composerWrap.parentElement !== el) el.append(composerWrap);
    }
    const stick = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 80;
    el.classList.toggle('empty-chat', empty && variant === 'panel');
    if (empty) {
      transcript.replaceChildren(previousChats());
      return;
    }
    const items = c.transcript.map((it, i) => renderItem(it, c, i === c.transcript.length - 1));
    transcript.replaceChildren(...items, ...renderApprovals(c));
    if (stick || c.approvals.length) transcript.scrollTop = transcript.scrollHeight;
  }
  const queueRender = () => { if (!renderQueued) { renderQueued = true; setTimeout(renderAll, 60); } };

  // Shown above the prompt in a fresh chat: collapsible list of earlier chats.
  let prevOpen = true; try { prevOpen = localStorage.getItem('caret.prevOpen') !== '0'; } catch {}
  function previousChats() {
    const all = listChats().filter(c => c.id !== activeId && c.title !== 'New chat');
    const list = all.slice(0, 8);
    if (!list.length) {
      return h('div', { class: 'prev' }, h('div', { class: 'prev-head static' }, h('span', { text: 'Try asking' })), suggestions());
    }
    const body = h('div', { class: 'prev-list' + (prevOpen ? '' : ' hidden') }, ...list.map(c => h('button', { class: 'prev-item', title: c.title, onclick: () => select(c.id) },
      c.running ? h('span', { class: 'busy-dot' }) : icon('chat'), h('span', { class: 'prev-title', text: c.title }), h('span', { class: 'prev-time', text: timeAgo(c.updatedAt) }))));
    const head = h('button', { class: 'prev-head' + (prevOpen ? '' : ' closed'), onclick: () => { prevOpen = !prevOpen; try { localStorage.setItem('caret.prevOpen', prevOpen ? '1' : '0'); } catch {} head.classList.toggle('closed', !prevOpen); body.classList.toggle('hidden', !prevOpen); } },
      icon('chevron', 'chev'), h('span', { class: 'grow', text: 'Previous chats' }), h('span', { class: 'count', text: String(all.length) }));
    return h('div', { class: 'prev' }, head, body);
  }

  function suggestions() {
    const list = state.workspace
      ? ['Explain how this project works', 'Find and fix bugs', 'Add a dark mode', 'Write tests for the main module']
      : ['Build a landing page for a coffee shop', 'Make a to-do app', 'Plan a REST API'];
    return h('div', { class: 'suggest' }, ...list.map(s => h('button', { onclick: () => { textarea.value = s; autosize(); textarea.focus(); } }, s)));
  }

  // ---------- live events ----------
  api.agent.onEvent(ev => {
    const c = chats.get(ev.tab);
    if (!c) { refreshList(); return; }
    const reply = () => { let last = c.transcript[c.transcript.length - 1]; if (!last || last.role !== 'assistant') { last = { role: 'assistant', parts: [] }; c.transcript.push(last); } return last; };
    const lastPart = (r, type) => { const p = r.parts[r.parts.length - 1]; return p && p.type === type ? p : null; };
    switch (ev.type) {
      case 'running':
        c.running = ev.running;
        if (!ev.running) c.approvals = [];
        renderTabs(); emit('chats', listChats()); updateComposer();
        break;
      case 'user': {
        const pending = c._pendingThumbs; c._pendingThumbs = null;
        c.transcript.push({ ...ev.item, thumbs: pending || null });
        c.transcript.push({ role: 'assistant', parts: [] });
        c.title = ev.title; renderTabs(); emit('chats', listChats());
        break;
      }
      case 'model': reply().model = ev.model; if (ev.reason && c.id === activeId) emit('status', ev.reason); break;
      case 'text': { const r = reply(); const p = lastPart(r, 'text') || (r.parts.push({ type: 'text', text: '' }), lastPart(r, 'text')); p.text += ev.text; break; }
      case 'thinking': { const r = reply(); const p = lastPart(r, 'thinking') || (r.parts.push({ type: 'thinking', text: '' }), lastPart(r, 'thinking')); p.text += ev.text; break; }
      case 'tool': { const r = reply(); const i = r.parts.findIndex(p => p.type === 'tool' && p.id === ev.part.id); if (i >= 0) r.parts[i] = ev.part; else r.parts.push(ev.part); break; }
      case 'error': reply().parts.push({ type: 'error', text: ev.text }); break;
      case 'note': reply().parts.push({ type: 'note', text: ev.text }); break;
      case 'approval': c.approvals.push(ev); if (ev.tab !== activeId) toast(`"${c.title}" needs your OK`); emit('attention', ev.tab); break;
      case 'approval-closed': c.approvals = c.approvals.filter(a => a.reqId !== ev.reqId); break;
      case 'done': if (ev.files?.length) emit('fs-changed', {}); break;
    }
    if (ev.tab === activeId) queueRender();
  });

  // ---------- composer ----------
  function updateComposer() {
    const s = state.settings || {};
    const p = PERMS[s.permission] || PERMS.ask;
    const mode = s.mode || 'code';
    if (mode !== 'plan') lastNonPlan = mode;
    tabChat.classList.toggle('on', mode !== 'agent');
    tabComposer.classList.toggle('on', mode === 'agent');
    planBtn.classList.toggle('on', mode === 'plan');
    ctxBtn.classList.toggle('on', useCodebase);
    permBtn.className = 'pill perm-' + (s.permission || 'ask');
    permBtn.replaceChildren(icon(p.icon), h('span', { text: p.label }), icon('down', 'caret-down'));
    modelBtn.replaceChildren(icon(s.model && s.model !== 'auto' && /^(ollama|lmstudio|llamacpp):/.test(s.model) ? 'laptop' : s.model === 'auto' || !s.model ? 'sparkle' : 'cloud'),
      h('span', { text: s.model && s.model !== 'auto' ? modelLabel(s.model) : 'Auto' }), icon('down', 'caret-down'));
    const c = chats.get(activeId);
    const busy = !!c?.running;
    sendBtn.className = 'send' + (busy ? ' stop' : '');
    sendBtn.replaceChildren(busy ? icon('stop') : icon('arrowUp'));
    sendBtn.title = busy ? 'Stop' : 'Send (Enter)';
    sendBtn.disabled = !busy && !textarea.value.trim() && !attachments.length;
  }

  planBtn.onclick = () => setTabMode(state.settings.mode === 'plan' ? lastNonPlan : 'plan');
  ctxBtn.onclick = () => { useCodebase = !useCodebase; try { localStorage.setItem('caret.codebase', useCodebase ? '1' : '0'); } catch {} updateComposer(); };
  function setTabMode(m) { saveSettings({ mode: m }).then(updateComposer); }
  permBtn.onclick = () => menu(permBtn, Object.entries(PERMS).map(([k, v]) => ({ label: v.label, sub: v.sub, icon: v.icon, checked: state.settings.permission === k, onClick: async () => { await saveSettings({ permission: k }); updateComposer(); } })), { above: true });
  modelBtn.onclick = async () => {
    const loading = menu(modelBtn, [{ note: 'Looking for models…' }], { above: true, align: 'right' });
    const cat = await refreshCatalog({ mode: state.settings.mode });
    if (!document.body.contains(loading)) return;
    menu(modelBtn, modelItems(cat), { above: true, align: 'right' });
  };

  function modelItems(cat) {
    const cur = state.settings.model || 'auto';
    const items = [{ label: 'Auto', sub: cat?.auto?.reason || 'Picks the best model for the task and this computer', icon: 'sparkle', checked: cur === 'auto', onClick: () => pick('auto') }];
    const hw = cat?.hardware;
    for (const p of cat?.providers || []) {
      if (p.kind === 'local' && p.id === 'ollama' && !p.models.length) {
        items.push('sep', { group: p.name }, { note: p.installed ? (p.running ? 'No models yet. Run "ollama pull qwen3:8b" in the terminal.' : 'Ollama is installed but did not start.') : 'Ollama is not installed. Get it free at ollama.com to run models on this computer.' });
        continue;
      }
      if (!p.models.length && !p.error) continue;
      const right = p.kind === 'local' && hw ? (hw.vramGB ? `GPU ${Math.round(hw.vramGB)} GB` : `RAM ${Math.round(hw.ramGB)} GB`) : p.kind === 'cli' ? 'your sign-in' : 'your key';
      items.push('sep', { group: p.name, right });
      if (p.error) { items.push({ note: `Could not list models: ${p.error}` }); continue; }
      for (const m of p.models) {
        const tooBig = m.score === -Infinity;
        const tags = [];
        if (p.kind === 'local') {
          if (m.sizeGB) tags.push({ text: `${m.sizeGB.toFixed(1)} GB` });
          if (m.tools) tags.push({ text: 'can edit files', good: true });
          if (m.vision) tags.push({ text: 'sees images' });
        }
        items.push({ label: m.label || m.id, tags, sub: p.kind === 'local' ? (m.why || []).join(' · ') : null, icon: p.kind === 'local' ? 'laptop' : 'cloud', checked: cur === m.key, disabled: false, onClick: () => { if (tooBig) toast(`${m.id} is larger than this computer can run well — it may be very slow.`); pick(m.key); } });
      }
    }
    items.push('sep', { label: 'Install or connect an AI…', icon: 'extensions', onClick: () => emit('cmd', 'providers') });
    return items;
  }
  async function pick(key) { await saveSettings({ model: key }); updateComposer(); }

  function autosize() { textarea.style.height = 'auto'; textarea.style.height = Math.min(260, textarea.scrollHeight) + 'px'; updateComposer(); }
  textarea.addEventListener('input', () => {
    autosize();
    const m = /(^|\s)@([^\s@]*)$/.exec(textarea.value.slice(0, textarea.selectionStart));
    if (m && state.workspace) fileMention(m[2]);
  });
  textarea.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); }
    if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault();
      setTabMode(state.settings.mode === 'plan' ? lastNonPlan : 'plan');
    }
  });
  sendBtn.onclick = () => { const c = chats.get(activeId); if (c?.running) api.agent.stop(activeId); else submit(); };

  let mentionTimer;
  function fileMention(q) {
    clearTimeout(mentionTimer);
    mentionTimer = setTimeout(async () => {
      const res = q ? await api.fs.search(q) : [];
      const files = [...new Set(res.filter(r => r.line === 0).map(r => r.path))].slice(0, 12);
      if (!files.length) return;
      menu(composer, files.map(f => ({ label: f.split('/').pop(), sub: f, icon: 'files', onClick: () => {
        textarea.value = textarea.value.replace(/@([^\s@]*)$/, '');
        addFile(f); textarea.focus();
      } })), { above: true });
    }, 120);
  }

  function addFile(path) { if (!attachments.find(a => a.kind === 'file' && a.path === path)) attachments.push({ kind: 'file', path }); renderAttachments(); }
  function addImageFile(file) {
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) return toast('Use a PNG, JPG, WebP or GIF image');
    if (file.size > 15 * 1024 * 1024) return toast('Image is larger than 15 MB', { error: true });
    if (attachments.filter(a => a.kind === 'image').length >= 8) return toast('Up to 8 images per message');
    const r = new FileReader();
    r.onload = () => { attachments.push({ kind: 'image', name: file.name || 'Pasted image', dataUrl: r.result }); renderAttachments(); };
    r.readAsDataURL(file);
  }
  // The file open in the editor is added automatically (remove it with the x).
  let activePath = null, openPaths = [], dismissedAuto = null;
  const autoFile = () => (activePath && !/\.(png|jpe?g|gif|webp|ico|bmp)$/i.test(activePath) && dismissedAuto !== activePath && !attachments.some(a => a.kind === 'file' && a.path === activePath)) ? activePath : null;

  function renderAttachments() {
    const auto = autoFile();
    const chip = (title, glyph, label, onRemove, dim) => h('span', { class: 'chip' + (dim ? ' dim' : ''), title },
      glyph, h('span', { text: label }), onRemove ? h('button', { title: 'Remove', onclick: onRemove }, icon('x')) : null);
    attachEl.replaceChildren(...[
      plusBtn,
      auto ? chip(auto + ' (open file)', fileBadge(auto.split('/').pop()), auto.split('/').pop(), () => { dismissedAuto = auto; renderAttachments(); }, false) : null,
      ...attachments.map(a => chip(a.path || a.name,
        a.kind === 'image' ? h('img', { src: a.dataUrl, alt: '' }) : fileBadge(a.path.split('/').pop()),
        a.kind === 'image' ? a.name : a.path.split('/').pop(),
        () => { attachments = attachments.filter(x => x !== a); renderAttachments(); })),
    ].filter(Boolean));
    updateComposer();
  }
  plusBtn.onclick = () => {
    const open = openPaths.filter(p => p !== autoFile() && !attachments.some(a => a.path === p));
    menu(plusBtn, [
      ...(open.length ? [{ group: 'Open files' }, ...open.slice(0, 8).map(p => ({ label: p.split('/').pop(), sub: p, icon: 'files', onClick: () => addFile(p) }))] : []),
      ...(open.length ? ['sep'] : []),
      { label: 'Find a file…', sub: 'or type @ in the box', icon: 'search', onClick: () => { textarea.focus(); textarea.setRangeText('@', textarea.selectionStart, textarea.selectionEnd, 'end'); textarea.dispatchEvent(new Event('input')); } },
      { label: 'Add an image…', sub: 'or paste / drop one', icon: 'image', onClick: () => fileInput.click() },
    ], { above: variant === 'center' });
  };
  on('editor-tabs', ({ active, paths }) => { if (active !== activePath) dismissedAuto = null; activePath = active; openPaths = paths || []; renderAttachments(); });
  textarea.addEventListener('paste', e => {
    const files = [...(e.clipboardData?.items || [])].filter(i => i.kind === 'file').map(i => i.getAsFile()).filter(Boolean);
    if (files.length) { e.preventDefault(); files.forEach(addImageFile); }
  });
  composer.addEventListener('dragover', e => { e.preventDefault(); composer.classList.add('drop'); });
  composer.addEventListener('dragleave', () => composer.classList.remove('drop'));
  composer.addEventListener('drop', e => {
    e.preventDefault(); composer.classList.remove('drop');
    const p = e.dataTransfer.getData('application/x-caret-path');
    if (p) { if (/\.(png|jpe?g|gif|webp|bmp|ico)$/i.test(p)) toast('Drop pictures from your computer, or paste them, to show them to the AI'); else addFile(p); return; }
    [...e.dataTransfer.files].forEach(addImageFile);
  });
  fileInput.onchange = () => { [...fileInput.files].forEach(addImageFile); fileInput.value = ''; };

  async function submit() {
    const text = textarea.value.trim();
    if (!text && !attachments.length) return;
    if (!activeId) await newChat();
    const c = chats.get(activeId);
    if (c.running) return;
    const files = attachments.filter(a => a.kind === 'file').map(a => a.path);
    const auto = autoFile();
    if (auto) files.unshift(auto);
    const images = attachments.filter(a => a.kind === 'image');
    let full = files.length ? `${text}\n\n(Files I mean: ${files.join(', ')})` : text;
    if (useCodebase) full += '\n\n(Use the whole codebase as context: search and read the relevant files before answering.)';
    c._pendingThumbs = images.map(i => i.dataUrl);
    textarea.value = ''; attachments = []; drafts.delete(activeId); renderAttachments(); autosize();
    c.running = true; updateComposer();
    const s = state.settings;
    await api.agent.send({ tabId: activeId, text: full, images: images.map(i => ({ dataUrl: i.dataUrl })), mode: s.mode, permission: s.permission, model: s.model || 'auto' });
  }

  // ---------- wiring ----------
  on('settings', updateComposer);
  on('catalog', updateComposer);
  on('attach-file', p => { addFile(p); textarea.focus(); });
  on('workspace', async () => { chats.clear(); openIds = []; activeId = null; await init(); });
  on('cmd', c => { if (c === 'focus-chat') textarea.focus(); if (c === 'new-chat') newChat(); });

  async function init() {
    const list = await refreshList();
    openIds = openIds.filter(id => chats.has(id));
    if (!openIds.length && list.length) openIds = [list[0].id];
    saveOpen();
    if (openIds.length) await select(openIds[openIds.length - 1]); else await newChat();
  }

  function setVariant(v) {
    variant = v;
    subHead.classList.toggle('hidden', v === 'center');
    if (v === 'center') el.classList.remove('empty-chat');
    renderTabs(); renderAll();
  }

  init();
  getCatalog();
  return { el, setVariant, newChat, select, deleteChat, listChats, focus: () => textarea.focus(), rename: async (id, t) => { await api.agent.rename(id, t); await refreshList(); renderTabs(); } };
}
