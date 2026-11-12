// AI providers: a plain list in the side bar (like an extensions list — no
// buttons in the rows) and a page for the one you click, where you install it,
// sign in, or connect a key.
import { h, icon, toast } from './ui.js';
import { api, state, refreshCatalog } from './state.js';
import { brand } from './brands.js';

const clean = e => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

// The longer text on each page. Kept here, next to the layout that shows it.
const ABOUT = {
  claude: { lead: 'Anthropic\'s coding agent. It reads your project, edits files and runs commands, and asks before anything risky when you tell it to.',
    points: ['Uses the Claude plan you already pay for — no API key', 'Signs in through your browser', 'Caret Agent never sees or stores your login'], kind: 'Command-line agent', uses: 'Your Claude plan' },
  codex: { lead: 'OpenAI\'s coding agent. Give it a task and it writes and changes the code in your project.',
    points: ['Uses your ChatGPT plan — no API key', 'Signs in through your browser', 'Caret Agent never sees or stores your login'], kind: 'Command-line agent', uses: 'Your ChatGPT plan' },
  xai: { lead: 'Grok models from xAI, used through your own API key.',
    points: ['Pay xAI for what you use', 'Your key is encrypted on this computer and never shown again'], kind: 'API key', uses: 'Your xAI account' },
  gemini: { lead: 'Gemini models from Google, the same family that powers Antigravity, used through your own Google AI Studio key.',
    points: ['Google AI Studio has a free tier', 'Your key is encrypted on this computer and never shown again'], kind: 'API key', uses: 'Your Google account' },
  openai: { lead: 'GPT models from OpenAI, used through your own API key. This is separate from a ChatGPT plan — for that, use Codex.',
    points: ['Pay OpenAI for what you use', 'Your key is encrypted on this computer and never shown again'], kind: 'API key', uses: 'Your OpenAI account' },
};

export function createProviders() {
  let items = [];
  let query = '';
  let current = null;           // id shown on the page
  let keyOpen = false;          // the API-key field is showing
  const progress = new Map();   // id -> last output line
  const working = new Map();    // id -> 'install' | 'signin'
  const openCbs = [];

  const input = h('input', { class: 'field', placeholder: 'Search', spellcheck: 'false' });
  const list = h('div', { class: 'prov-list' });
  const head = h('div', { class: 'panel-head' }, h('span', { class: 'grow', text: 'AI providers' }),
    h('button', { class: 'icon-btn', title: 'Refresh', onclick: () => load() }, icon('refresh')));
  const el = h('div', { class: 'col', style: { flex: 1, minHeight: 0 } }, head, h('div', { style: { padding: '0 10px 8px' } }, input), list);
  input.addEventListener('input', () => { query = input.value.trim().toLowerCase(); renderList(); });

  // The page. `pageList` is only visible where there is no side bar list next to it (Agent view).
  const pageList = h('div', { class: 'pp-list' });
  const pageBody = h('div', { class: 'pp-body' });
  const page = h('div', { class: 'prov-page hidden' }, pageList, pageBody);

  api.providers.onProgress(({ id, line }) => {
    progress.set(id, line);
    const t = page.querySelector('.pp-log');
    if (t && id === current) t.textContent = line;
  });

  async function load() {
    try { items = await api.providers.status(); } catch (e) { items = []; toast(clean(e), { error: true }); }
    render();
  }
  const render = () => { renderList(); renderPage(); };
  renderList(); // shows "Loading…" until the first status comes back

  async function act(p, kind) {
    working.set(p.id, kind); progress.delete(p.id); render();
    try {
      await (kind === 'install' ? api.providers.install(p.id) : api.providers.signIn(p.id));
      toast(kind === 'install' ? `${p.name} installed` : `${p.name} signed in`);
    } catch (e) { toast(clean(e), { error: true, ms: 8000 }); }
    working.delete(p.id);
    await load();
    refreshCatalog({ mode: state.settings.mode }).catch(() => {});
  }

  function status(p) {
    if (working.has(p.id)) return { dot: 'busy', text: working.get(p.id) === 'install' ? 'Installing…' : 'Waiting for sign-in…' };
    if (p.kind === 'cli') return p.ready ? { dot: 'ok', text: 'Ready' } : p.installed ? { dot: 'warn', text: 'Sign in needed' } : { dot: 'off', text: 'Not installed' };
    return p.signedIn ? { dot: 'ok', text: 'Connected' } : { dot: 'off', text: 'Not connected' };
  }

  function show(id) {
    current = id; keyOpen = false;
    page.classList.remove('hidden');
    render();
    openCbs.forEach(f => f(id));
  }
  function close() { current = null; page.classList.add('hidden'); renderList(); openCbs.forEach(f => f(null)); }

  // ---------- list ----------
  function row(p) {
    const st = status(p);
    return h('button', { class: 'prov' + (p.id === current ? ' on' : ''), title: p.name, onclick: () => show(p.id) },
      brand(p.id, 36),
      h('span', { class: 'prov-main' },
        h('span', { class: 'prov-name', text: p.name }),
        h('span', { class: 'prov-blurb', text: p.blurb }),
        h('span', { class: 'prov-foot' }, h('span', { class: 'prov-by', text: p.by }), h('span', { class: 'grow' }),
          h('span', { class: 'prov-state' }, h('i', { class: 'dot ' + st.dot }), st.text))));
  }
  function rows() {
    const match = p => !query || `${p.name} ${p.by} ${p.blurb}`.toLowerCase().includes(query);
    const shown = items.filter(match);
    const ready = shown.filter(p => p.ready), rest = shown.filter(p => !p.ready);
    const sec = (title, list) => list.length ? [h('div', { class: 'prov-sec' }, h('span', { class: 'grow', text: title }), h('span', { class: 'prov-count', text: String(list.length) })), ...list.map(row)] : [];
    const out = [...sec('Ready', ready), ...sec(ready.length ? 'Available' : 'Set up an AI', rest)];
    return out.length ? out : [h('div', { class: 'muted', style: { padding: '8px 12px' }, text: items.length ? 'No match' : 'Looking for your AIs…' })];
  }
  function renderList() { list.replaceChildren(...rows()); pageList.replaceChildren(h('div', { class: 'pp-list-head', text: 'AI providers' }), ...rows()); }

  // ---------- page ----------
  function actions(p) {
    const busy = working.has(p.id);
    const btn = (label, onclick, cls = 'primary', ic = null) => h('button', { class: 'btn ' + cls, disabled: busy, onclick }, ic ? icon(ic) : null, label);
    if (p.kind === 'cli') {
      if (!p.installed) return [btn(busy ? 'Installing…' : 'Install', () => act(p, 'install'), 'primary', 'download')];
      if (!p.signedIn) return [btn(busy ? 'Waiting for your browser…' : 'Sign in', () => act(p, 'signin'))];
      return [h('span', { class: 'pp-ok' }, icon('check'), 'Installed and signed in')];
    }
    if (!p.signedIn) return keyOpen ? [] : [btn('Connect', () => { keyOpen = true; renderPage(); }, 'primary', 'key')];
    return [h('span', { class: 'pp-ok' }, icon('check'), 'Connected'),
      btn('Remove key', async () => { state.settings = await api.settings.setKey(p.id, ''); await load(); refreshCatalog().catch(() => {}); }, '')];
  }

  function keyForm(p) {
    const key = h('input', { class: 'field', type: 'password', placeholder: 'Paste your API key', spellcheck: 'false' });
    const save = async () => {
      const v = key.value.trim(); if (!v) return;
      try { state.settings = await api.settings.setKey(p.id, v); keyOpen = false; toast(`${p.name} connected`); await load(); refreshCatalog().catch(() => {}); }
      catch (e) { toast(clean(e), { error: true }); }
    };
    key.addEventListener('keydown', e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { keyOpen = false; renderPage(); } });
    setTimeout(() => key.focus(), 0);
    return h('div', { class: 'pp-key' }, key,
      h('button', { class: 'btn primary', onclick: save }, 'Save'),
      h('button', { class: 'btn ghost', onclick: () => { keyOpen = false; renderPage(); } }, 'Cancel'));
  }

  function renderPage() {
    const p = items.find(x => x.id === current);
    if (!p) { pageBody.replaceChildren(h('div', { class: 'pp-empty muted', text: current ? 'Loading…' : 'Choose an AI on the left.' })); return; }
    const a = ABOUT[p.id] || { lead: p.blurb, points: [], kind: '', uses: '' };
    const st = status(p);
    const link = (text, url) => url ? h('a', { href: '#', 'data-href': url, class: 'md', text }) : null;
    const fact = (k, v) => v ? h('div', { class: 'pp-fact' }, h('span', { text: k }), h('span', {}, v)) : null;
    const steps = p.kind === 'cli'
      ? [['Install', p.installed], ['Sign in with your browser', p.signedIn], ['Pick it from the model menu', p.ready]]
      : [['Get a key from ' + p.by, p.signedIn], ['Paste it here', p.signedIn], ['Pick it from the model menu', p.signedIn]];
    pageBody.replaceChildren(
      h('button', { class: 'icon-btn pp-close', title: 'Close', onclick: close }, icon('x')),
      h('div', { class: 'pp-hero' },
        brand(p.id, 84),
        h('div', { class: 'pp-hero-main' },
          h('h1', { text: p.name }),
          h('div', { class: 'pp-sub' }, h('span', { text: p.by }), h('span', { class: 'prov-state' }, h('i', { class: 'dot ' + st.dot }), st.text)),
          h('p', { class: 'pp-lead', text: p.blurb }),
          h('div', { class: 'pp-actions' }, ...actions(p)),
          keyOpen && p.kind === 'api' && !p.signedIn ? keyForm(p) : null,
          working.has(p.id) ? h('div', { class: 'pp-log mono', text: progress.get(p.id) || 'Starting…' }) : null)),
      h('div', { class: 'pp-cols' },
        h('div', { class: 'pp-main' },
          h('h2', { text: 'About' }),
          h('p', { text: a.lead }),
          h('ul', {}, ...a.points.map(t => h('li', { text: t }))),
          h('h2', { text: 'Set up' }),
          h('ol', { class: 'pp-steps' }, ...steps.map(([t, done]) => h('li', { class: done ? 'done' : '' }, h('i', {}, done ? icon('check') : null), h('span', { text: t })))),
          p.kind === 'cli' && !p.installed ? h('div', { class: 'pp-note' }, h('div', { class: 'muted', text: 'Install runs this command on your computer:' }), h('code', { text: p.command })) : null),
        h('aside', { class: 'pp-side' },
          h('h3', { text: 'Details' }),
          fact('Type', a.kind), fact('Uses', a.uses), fact('Made by', p.by),
          h('h3', { text: 'Links' }),
          link('Website', p.site), link('Get an API key', p.keyUrl))));
  }

  return { el, page, load, show, close, focus: () => input.focus(), onOpen: f => openCbs.push(f), isOpen: () => !!current || !page.classList.contains('hidden'),
    openList: async () => {
      page.classList.remove('hidden');
      await load();
      // Never open on an empty pane: start on the first AI that still needs setting up, or simply the first one.
      if (!current && items.length) show((items.find(p => !p.ready) || items[0]).id);
    } };
}
