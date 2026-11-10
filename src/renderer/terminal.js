// Terminal panel. Commands the AI runs appear here too, marked with ◆.
import { h, icon } from './ui.js';
import { api, state, on, emit } from './state.js';

const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07|\x1b[()][A-Z0-9]|\r(?!\n)/g;
const URL_RE = /(https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):\d{2,5}[^\s'"<>)\]]*)/;

export function createTerminalPanel() {
  const sessions = new Map(); // id -> { id, title, out: el, cwd, running, history, hIndex }
  let current = null;
  const tabsEl = h('div', { style: { display: 'flex', gap: '2px', flex: 1, overflow: 'hidden' } });
  const head = h('div', { class: 'term-head' },
    h('span', { class: 'term-title', text: 'Terminal' }),
    tabsEl,
    h('button', { class: 'icon-btn', title: 'New terminal', onclick: () => create() }, icon('plus')),
    h('button', { class: 'icon-btn', title: 'Stop running command (Ctrl+C)', onclick: () => current && api.term.kill(current.id) }, icon('stop')),
    h('button', { class: 'icon-btn', title: 'Close terminal', onclick: () => current && api.term.close(current.id) }, icon('trash')),
    h('button', { class: 'icon-btn', title: 'Hide panel', onclick: () => emit('cmd', 'toggle-bottom') }, icon('down')));
  const outWrap = h('div');
  const cwdEl = h('span', { class: 'cwd' });
  const input = h('input', { spellcheck: 'false', placeholder: 'Type a command and press Enter' });
  const inRow = h('div', { class: 'term-in' }, cwdEl, h('span', { class: 'prompt', text: '>' }), input);
  const body = h('div', { class: 'term-body' }, outWrap, inRow);
  const el = h('div', { class: 'col', style: { flex: 1 } }, head, body);

  function renderTabs() {
    tabsEl.replaceChildren(...[...sessions.values()].map(s => h('button', { class: 'term-tab' + (s === current ? ' on' : ''), onclick: () => select(s.id), title: s.cwd || '' },
      s.running ? h('span', { class: 'dot' }) : icon('terminal'), h('span', { text: s.title }))));
    cwdEl.textContent = current?.cwd || '';
    cwdEl.title = current?.cwd || '';
    inRow.classList.toggle('hidden', !current);
  }

  function ensure(t) {
    if (sessions.has(t.id)) return sessions.get(t.id);
    const out = h('div', { class: 'term-out' });
    const s = { id: t.id, title: t.title, cwd: t.cwd, out, running: false, history: [], hIndex: 0 };
    sessions.set(t.id, s);
    return s;
  }

  function select(id) {
    current = sessions.get(id) || null;
    outWrap.replaceChildren(current ? current.out : h('div', { class: 'term-out muted', text: 'No terminal open. Press + to start one.' }));
    renderTabs();
    if (current) body.scrollTop = body.scrollHeight;
  }

  async function create() {
    const id = await api.term.create();
    select(id);
    input.focus();
    return id;
  }

  function write(s, chunk, kind) {
    const text = chunk.replace(ANSI, '').replace(/\r\n/g, '\n');
    const stick = body.scrollHeight - body.scrollTop - body.clientHeight < 30;
    if (kind === 'cmd') s.out.append(h('span', { class: 'cmd', text }));
    else {
      // Turn local server addresses into a preview button.
      const parts = text.split(URL_RE);
      for (let i = 0; i < parts.length; i++) {
        if (i % 2) s.out.append(h('button', { class: 'url-chip', onclick: () => api.app.preview(parts[i]) }, icon('globe'), parts[i]));
        else if (parts[i]) s.out.append(document.createTextNode(parts[i]));
      }
    }
    // keep memory bounded
    while (s.out.childNodes.length > 4000) s.out.firstChild.remove();
    if (stick && s === current) body.scrollTop = body.scrollHeight;
  }

  api.term.onCreated(t => { ensure(t); if (!current) select(t.id); else renderTabs(); if (/^AI/.test(t.title)) emit('cmd', 'show-bottom'); });
  api.term.onData(({ id, chunk, kind }) => {
    const s = sessions.get(id) || ensure({ id, title: 'Terminal' });
    if (kind === 'cmd') { s.running = true; renderTabs(); }
    write(s, chunk, kind);
  });
  api.term.onExit(({ id, code, cwd }) => {
    const s = sessions.get(id); if (!s) return;
    s.running = false; s.cwd = cwd;
    if (code) write(s, `\n[exit ${code}]\n`);
    renderTabs();
  });
  api.term.onClosed(({ id }) => { sessions.delete(id); if (current?.id === id) select([...sessions.keys()].pop()); else renderTabs(); });

  input.addEventListener('keydown', e => {
    if (!current) return;
    if (e.key === 'Enter' && input.value.trim()) {
      const cmd = input.value;
      if (current.running) { write(current, '\n(busy — stop the running command first, or open a new terminal)\n'); return; }
      current.history.push(cmd); current.hIndex = current.history.length;
      input.value = '';
      if (cmd.trim() === 'clear' || cmd.trim() === 'cls') { current.out.replaceChildren(); return; }
      api.term.run(current.id, cmd);
    } else if (e.key === 'ArrowUp') {
      if (current.hIndex > 0) { current.hIndex--; input.value = current.history[current.hIndex] || ''; e.preventDefault(); }
    } else if (e.key === 'ArrowDown') {
      if (current.hIndex < current.history.length) { current.hIndex++; input.value = current.history[current.hIndex] || ''; e.preventDefault(); }
    } else if (e.key === 'c' && e.ctrlKey && !input.selectionEnd) { api.term.kill(current.id); e.preventDefault(); }
  });
  el.addEventListener('mouseup', () => { if (!getSelection().toString()) input.focus(); });

  on('cmd', c => { if (c === 'new-terminal') { emit('cmd', 'show-bottom'); create(); } });
  on('workspace', async () => {
    for (const id of [...sessions.keys()]) await api.term.close(id);
    if (state.workspace) create();
  });

  select(null);
  api.term.list().then(list => { for (const t of list) ensure(t); if (list[0]) select(list[0].id); else if (state.workspace) create(); });
  return { el, create };
}
