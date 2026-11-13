// AI chat: many tabs, a prompt bar with mode / permission / model, image
// paste, live tool activity and approval cards.
import { h, icon, logo, menu, toast, timeAgo, fileBadge } from './ui.js';
import { api, state, on, emit, saveSettings, getCatalog, refreshCatalog, modelLabel } from './state.js';
import { mountMarkdown } from './markdown.js';

const MODES = {
  plan: { label: 'Plan', icon: 'plan', sub: 'Plans first and changes nothing, then asks to start coding.' },
  code: { label: 'Code', icon: 'code', sub: 'Makes just the change you ask for, then stops.' },
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
  const permBtn = h('button', { class: 'pill ico', title: 'Permissions' });
  const modelBtn = h('button', { class: 'pill model', title: 'Model' });
  const ctxBtn = h('button', { class: 'pill ico toggle', title: 'Search the whole project for context' }, icon('layers'));
  const attachBtn = h('button', { class: 'pill ico', title: 'Attach an image (you can also paste or drop one)', onclick: () => fileInput.click() }, icon('paperclip'));
  const modeBtn = h('button', { class: 'pill mode', title: 'How the AI works (Shift+Tab switches Plan on and off)' });
  const sendBtn = h('button', { class: 'send', title: 'Send (Enter)' });
  const plusBtn = h('button', { class: 'ctx-plus', title: 'Add context' }, icon('plus'));
  const composer = h('div', { class: 'composer' }, attachEl, textarea,
    h('div', { class: 'composer-row' }, modeBtn, modelBtn, h('span', { class: 'grow' }), ctxBtn, attachBtn, permBtn, sendBtn), fileInput);
  const composerWrap = h('div', { class: 'composer-wrap' }, composer);
  // panel header: a title and the chat actions
  const subHead = h('div', { class: 'chat-head' }, h('span', { class: 'chat-title', text: 'AI' }), h('span', { class: 'grow' }),
    h('button', { class: 'icon-btn', title: 'New chat (Ctrl+T)', onclick: () => newChat() }, icon('plus')),
    h('button', { class: 'icon-btn', title: 'Past chats', onclick: e => historyMenu(e.currentTarget) }, icon('history')),
    h('button', { class: 'icon-btn', title: 'Switch to the Agent', onclick: () => emit('cmd', { layout: 'agent' }) }, icon('expand')));
  const el = h('div', { class: 'chat' }, subHead, tabStrip, transcript, welcome, composerWrap);
  let useCodebase = false; try { useCodebase = localStorage.getItem('caret.codebase') === '1'; } catch {}
  let lastNonPlan = 'code';

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

  let initP = Promise.resolve();
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
  // The AI splits the request into tasks (TodoWrite for Claude, update_tasks for the others); the latest list is shown as a checklist.
  const TASK_TOOLS = /^(TodoWrite|update_tasks)$/;
  function taskList(p) {
    const list = (p.args?.todos || p.args?.tasks || []).filter(t => t && typeof t.content === 'string').slice(0, 20);
    if (!list.length) return null;
    const done = list.filter(t => t.status === 'completed').length;
    return h('div', { class: 'tasks' },
      h('div', { class: 'tasks-head', text: `${done} of ${list.length} tasks done` }),
      ...list.map(t => h('div', { class: 'task ' + (t.status || 'pending') },
        h('span', { class: 'tk' }, t.status === 'completed' ? icon('check') : null),
        h('span', { class: 'tt', text: t.status === 'in_progress' && t.activeForm ? t.activeForm : t.content }))));
  }
  function renderPart(p) {
    if (p.type === 'text') { const d = h('div', { class: 'md' }); mountMarkdown(d, p.text); return d; }
    if (p.type === 'thinking') return h('details', { class: 'thinking' }, h('summary', { text: 'Thinking' }), h('div', { text: p.text }));
    if (p.type === 'error') return h('div', { class: 'part-error', text: p.text });
    if (p.type === 'note') return h('div', { class: 'part-note', text: p.text });
    if (p.type === 'tool' && TASK_TOOLS.test(p.name || '')) return taskList(p);
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
    const lastTasks = (item.parts || []).map((p, i) => p.type === 'tool' && TASK_TOOLS.test(p.name || '') ? i : -1).filter(i => i >= 0).pop();
    (item.parts || []).forEach((p, i) => {
      if (p.type === 'tool' && TASK_TOOLS.test(p.name || '') && i !== lastTasks) return;   // older versions of the list
      const n = renderPart(p); if (n) box.append(n);
    });
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

  // After a Plan run: ask once whether to start coding (Full access skips the question).
  function renderPlanCard(c) {
    if (!c.planReady || c.running) return [];
    return [h('div', { class: 'plancard' },
      icon('plan'),
      h('div', { class: 'pc-text' }, h('b', { text: 'Plan ready' }), h('span', { text: 'Start coding it now? The plan is saved in .caret/PLAN.md.' })),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onclick: () => startCoding(c) }, 'Start coding'),
        h('button', { class: 'btn ghost', onclick: () => { c.planReady = false; renderAll(); } }, 'Not yet')))];
  }
  async function startCoding(c) {
    c.planReady = false;
    if (c.running) return;
    await saveSettings({ mode: 'agent' });
    c.running = true; updateComposer(); renderAll();
    const s = state.settings;
    try {
      await api.agent.send({ tabId: c.id, text: 'Looks good. Start coding the plan now and check that it works.', images: [], mode: 'agent', permission: s.permission, model: s.model || 'auto' });
    } catch (e) {
      // It could not start (for example the chat is still busy): do not leave the chat looking like it is working.
      c.running = false; c.planReady = true; updateComposer(); renderAll();
      toast(String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), { error: true });
    }
  }

  let renderQueued = false;
  function renderAll() {
    renderQueued = false;
    const c = chats.get(activeId);
    const empty = !c || !c.transcript.length;
    if (variant === 'center') {
      welcome.classList.toggle('hidden', !empty);
      transcript.classList.toggle('hidden', empty);
      if (empty) {
        const name = state.settings?.name ? state.settings.name.split(' ')[0] : '';
        const inner = h('div', { class: 'welcome-inner' },
          h('div', { class: 'ag-hello' }, logo(30), h('h1', { text: name ? `What should we build, ${name}?` : 'What should we build?' })));
        inner.append(h('div', { class: 'ctx-row' },
          h('button', { class: 'ctx-chip', title: 'Folder the AI works in', onclick: () => emit('cmd', 'open-folder') }, icon('folder'), h('span', { text: state.workspace ? state.workspace.name : 'Choose a project' }), icon('down')),
          h('span', { class: 'ctx-sep' }),
          h('span', { class: 'ctx-note' }, icon('laptop'), 'Runs on this PC')));
        inner.append(composerWrap);
        inner.append(starters());
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
    transcript.replaceChildren(...items, ...renderApprovals(c), ...renderPlanCard(c));
    if (stick || c.approvals.length || c.planReady) transcript.scrollTop = transcript.scrollHeight;
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

  // Starting points under the prompt in the Agent view: what each one does, in one line.
  function starters() {
    const list = [
      { icon: 'rocket', title: 'Build something new', sub: 'Describe an app or page and watch it get made', text: 'Build ', mode: 'agent' },
      { icon: 'plan', title: 'Start with a plan', sub: 'Agree on the steps before any code changes', text: 'Plan how to ', mode: 'plan' },
      { icon: 'bug', title: 'Fix a bug', sub: 'Find the real cause and fix it', text: 'Find and fix the bug where ', mode: 'agent' },
      { icon: 'book', title: 'Explain this project', sub: 'How it works, where things live', text: 'Explain how this project works', mode: 'code' },
    ];
    return h('div', { class: 'starters' }, ...list.map(s => h('button', { class: 'starter', onclick: async () => {
      if (state.settings.mode !== s.mode) await saveSettings({ mode: s.mode });
      updateComposer();
      textarea.value = s.text; autosize(); textarea.focus(); textarea.setSelectionRange(s.text.length, s.text.length);
    } }, icon(s.icon), h('span', { class: 'starter-title', text: s.title }), h('span', { class: 'starter-sub', text: s.sub }))));
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
        // Full access never asks: a finished plan goes straight on to coding.
        if (!ev.running && c.planReady && state.settings.permission === 'full') { c.planReady = false; setTimeout(() => startCoding(c), 0); }
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
      case 'plan-ready': c.planReady = true; break;
    }
    if (ev.tab === activeId) queueRender();
  });

  // ---------- composer ----------
  function updateComposer() {
    const s = state.settings || {};
    const p = PERMS[s.permission] || PERMS.ask;
    const mode = s.mode || 'code';
    if (mode !== 'plan') lastNonPlan = mode;
    const md = MODES[mode] || MODES.code;
    modeBtn.className = 'pill mode mode-' + mode;
    modeBtn.replaceChildren(icon(md.icon), h('span', { text: md.label }), icon('down', 'caret-down'));
    ctxBtn.classList.toggle('on', useCodebase);
    permBtn.className = 'pill ico perm-' + (s.permission || 'ask');
    permBtn.title = `Permissions: ${p.label}. ${p.sub || ''}`.trim();
    permBtn.replaceChildren(icon(p.icon));
    ctxBtn.title = useCodebase ? 'Searching the whole project (click to turn off)' : 'Search the whole project for context';
    modelBtn.replaceChildren(icon(s.model === 'auto' || !s.model ? 'sparkle' : 'cloud'),
      h('span', { text: s.model && s.model !== 'auto' ? modelLabel(s.model) : 'Auto' }), icon('down', 'caret-down'));
    const c = chats.get(activeId);
    const busy = !!c?.running;
    sendBtn.className = 'send' + (busy ? ' stop' : '');
    sendBtn.replaceChildren(busy ? icon('stop') : icon('arrowUp'));
    sendBtn.title = busy ? 'Stop' : 'Send (Enter)';
    sendBtn.disabled = !busy && !textarea.value.trim() && !attachments.length;
  }

  modeBtn.onclick = () => menu(modeBtn, ['agent', 'plan', 'code'].map(k => ({ label: MODES[k].label, sub: MODES[k].sub, icon: MODES[k].icon, checked: (state.settings.mode || 'code') === k, onClick: () => setTabMode(k) })), { above: true });
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
    const have = new Set();
    for (const p of cat?.providers || []) {
      if (!p.models.length && !p.error) continue;
      have.add(p.family || p.id);
      items.push('sep', { group: p.name, right: p.kind === 'cli' ? 'app on this computer' : 'API key' });
      if (p.error) { items.push({ note: `Could not list models: ${p.error}` }, { label: 'Check this key…', icon: 'key', onClick: () => emit('cmd', { providers: p.family, method: 'api' }) }); continue; }
      for (const m of p.models) items.push({ label: m.label || m.id, checked: cur === m.key, onClick: () => pick(m.key) });
    }
    // AIs that are not set up yet: picking one opens its page, where the key is entered or the app installed.
    const todo = [
      { id: 'claude', name: 'Claude', sub: 'Use the app or an API key' }, { id: 'codex', name: 'Codex', sub: 'Use the app or an API key' },
      { id: 'xai', name: 'Grok', sub: 'Add an xAI API key' }, { id: 'gemini', name: 'Antigravity', sub: 'Add a Google AI Studio key' },
    ].filter(f => !have.has(f.id));
    if (todo.length) items.push('sep', { group: 'Set up' }, ...todo.map(f => ({ label: f.name, sub: f.sub, icon: 'plus', onClick: () => emit('cmd', { providers: f.id }) })));
    items.push('sep', { label: 'Models and API keys…', sub: 'Choose the app or an API key for each AI', icon: 'key', onClick: () => emit('cmd', 'providers') });
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
  sendBtn.onclick = () => { const c = chats.get(activeId); if (c?.running) { c.planReady = false; api.agent.stop(activeId); } else submit(); };

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
    c.planReady = false;
    c._pendingThumbs = images.map(i => i.dataUrl);
    textarea.value = ''; attachments = []; drafts.delete(activeId); renderAttachments(); autosize();
    c.running = true; updateComposer();
    const s = state.settings;
    try {
      await api.agent.send({ tabId: activeId, text: full, images: images.map(i => ({ dataUrl: i.dataUrl })), mode: s.mode, permission: s.permission, model: s.model || 'auto' });
    } catch (e) {
      c.running = false; updateComposer();   // it never started: do not leave the chat looking busy
      toast(String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), { error: true });
    }
  }

  // ---------- wiring ----------
  on('settings', updateComposer);
  on('catalog', updateComposer);
  on('attach-file', p => { addFile(p); textarea.focus(); });
  // Right-click a picture you pasted, in the box or in the conversation, to copy it again or save it.
  const pngOf = src => new Promise((ok, no) => {
    const im = new Image();
    im.onload = () => { const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; c.getContext('2d').drawImage(im, 0, 0); c.toBlob(b => b ? ok(b) : no(new Error('Could not read the image')), 'image/png'); };
    im.onerror = () => no(new Error('Could not read the image'));
    im.src = src;
  });
  document.addEventListener('contextmenu', e => {
    const img = e.target.closest?.('.thumbs img, .attachments .chip img');
    if (!img) return;
    e.preventDefault();
    const src = img.src;
    menu(img, [
      { label: 'Copy image', icon: 'copy', onClick: async () => {
        try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': await pngOf(src) })]); toast('Image copied'); }
        catch (err) { toast(err.message || 'Could not copy the image', { error: true }); }
      } },
      { label: 'Save image', icon: 'download', onClick: async () => {
        try {
          const url = URL.createObjectURL(await pngOf(src));
          const a = document.createElement('a'); a.href = url; a.download = 'image.png'; document.body.append(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 10000);
        } catch (err) { toast(err.message || 'Could not save the image', { error: true }); }
      } },
    ], { x: e.clientX, y: e.clientY });
  });

  on('workspace', () => { initP = (async () => { chats.clear(); openIds = []; activeId = null; await init(); })(); });
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
    textarea.placeholder = v === 'center' ? 'Describe a task. @ to mention a file, paste a screenshot' : 'Ask anything (Ctrl+L), @ to mention';
    if (v === 'center') el.classList.remove('empty-chat');
    renderTabs(); renderAll();
  }

  init();
  getCatalog();
  // From the side bar: wait for a project switch to finish first, and reuse a chat that is still empty.
  const newChatHere = async () => { await initP; const c = chats.get(activeId); if (c && !c.transcript.length && !c.running) { await select(activeId); textarea.focus(); return; } return newChat(); };
  return { el, setVariant, newChat: newChatHere, select: async id => { await initP; return select(id); }, deleteChat, listChats, focus: () => textarea.focus(), rename: async (id, t) => { await api.agent.rename(id, t); await refreshList(); renderTabs(); } };
}
