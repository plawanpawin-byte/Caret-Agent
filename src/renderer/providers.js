// Models & API keys: one page where every AI is set up. It opens from the model menu
// (there is no separate panel). Claude and Codex can be used as an app on this computer
// or through an API key; Grok and Antigravity (Gemini) use an API key.
import { h, icon, toast } from './ui.js';
import { api, state, saveSettings, refreshCatalog } from './state.js';
import { brand } from './brands.js';

const clean = e => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

// The text on each page, kept next to the layout that shows it.
const ABOUT = {
  claude: { lead: 'Anthropic\'s Claude models. Use the Claude app on this computer, or call the API with your own key.',
    app: { title: 'Claude Code app', text: 'Runs on this computer and uses the Claude plan you already pay for. It signs in through your browser; Caret Agent never sees your login.' },
    api: { title: 'Claude API', text: 'Pay per use with an Anthropic API key. Works without installing anything.' } },
  codex: { lead: 'OpenAI\'s models. Use the Codex app on this computer, or call the OpenAI API with your own key.',
    app: { title: 'Codex app', text: 'Runs on this computer and uses your ChatGPT plan. It signs in through your browser; Caret Agent never sees your login.' },
    api: { title: 'OpenAI API', text: 'Pay per use with an OpenAI API key. This is separate from a ChatGPT plan.' } },
  xai: { lead: 'Grok models from xAI.', api: { title: 'Grok API', text: 'Pay xAI for what you use, with your own API key.' } },
  gemini: { lead: 'Gemini models from Google, the family behind Antigravity.', api: { title: 'Gemini API', text: 'Use a Google AI Studio key. It has a free tier.' } },
};

export function createProviders() {
  let items = [];
  let current = null;                  // family id shown on the page
  const method = new Map();            // family id -> 'app' | 'api' (the tab the person is looking at)
  const working = new Map();           // family id -> 'install' | 'signin'
  const progress = new Map();          // family id -> last output line
  const key = { value: '', shown: false, state: 'idle', message: '', replace: false };   // the API-key box
  const openCbs = [];

  const pageList = h('div', { class: 'pp-list' });
  const pageBody = h('div', { class: 'pp-body' });
  const page = h('div', { class: 'prov-page hidden' }, pageList, pageBody);

  api.providers.onProgress(({ id, line }) => {
    progress.set(id, line);
    const t = page.querySelector('.pp-log');
    if (t && id === current) t.textContent = line;
  });
  page.addEventListener('keydown', e => { if (e.key === 'Escape' && !page.classList.contains('hidden')) close(); });

  async function load() {
    try { items = await api.providers.status(); } catch (e) { items = []; toast(clean(e), { error: true }); }
    render();
  }
  const render = () => { renderList(); renderPage(); };
  const refreshModels = () => refreshCatalog({ mode: state.settings.mode }).catch(() => {});

  // ---------- state of one family ----------
  function summary(p) {
    if (working.has(p.id)) return { dot: 'busy', text: working.get(p.id) === 'install' ? 'Installing…' : 'Signing in…' };
    const parts = [];
    if (p.app?.ready) parts.push('App');
    if (p.api?.hasKey) parts.push('API');
    if (parts.length) return { dot: 'ok', text: parts.join(' + ') };
    if (p.app?.installed) return { dot: 'warn', text: 'Sign in needed' };
    return { dot: 'off', text: 'Not set up' };
  }
  const methodOf = p => {
    const m = method.get(p.id);
    if (m === 'app' && p.app) return 'app';
    if (m === 'api' && p.api) return 'api';
    return p.app && !p.api?.hasKey ? 'app' : p.app?.ready ? 'app' : 'api';
  };

  function show(id, m) {
    current = id;
    if (m) method.set(id, m);
    Object.assign(key, { value: '', shown: false, state: 'idle', message: '', replace: false });
    page.classList.remove('hidden');
    render();
    openCbs.forEach(f => f(id));
    setTimeout(() => page.querySelector('.key-input')?.focus(), 30);
  }
  function close() { current = null; page.classList.add('hidden'); renderList(); openCbs.forEach(f => f(null)); }

  // ---------- list on the left ----------
  function row(p) {
    const st = summary(p);
    return h('button', { class: 'pl-row' + (p.id === current ? ' on' : ''), title: p.name, onclick: () => show(p.id) },
      brand(p.id, 30),
      h('span', { class: 'pl-main' }, h('span', { class: 'pl-name', text: p.name }), h('span', { class: 'pl-by', text: p.by })),
      h('span', { class: 'pl-state' }, h('i', { class: 'dot ' + st.dot }), st.text));
  }
  function renderList() {
    pageList.replaceChildren(
      h('div', { class: 'pl-head' }, h('div', { class: 'pl-title', text: 'Models' }), h('div', { class: 'pl-sub', text: 'Set up the AIs you want to use.' })),
      ...(items.length ? items.map(row) : [h('div', { class: 'muted', style: { padding: '8px 16px' }, text: 'Looking for your AIs…' })]));
  }

  // ---------- actions ----------
  async function act(p, kind) {
    working.set(p.id, kind); progress.delete(p.id); render();
    try {
      await (kind === 'install' ? api.providers.install(p.id) : api.providers.signIn(p.id));
      toast(kind === 'install' ? `${p.name} installed` : `${p.name} signed in`);
    } catch (e) { toast(clean(e), { error: true, ms: 8000 }); }
    working.delete(p.id);
    await load();
    refreshModels();
  }

  async function saveKey(p) {
    const v = key.value.trim();
    if (!v || key.state === 'checking') return;
    key.state = 'checking'; key.message = ''; renderPage();
    let r;
    try { r = await api.providers.checkKey(p.api.id, v); } catch (e) { r = { ok: false, error: clean(e) }; }
    if (!r.ok) { key.state = 'error'; key.message = r.error; renderPage(); return; }
    try { state.settings = await api.settings.setKey(p.api.id, v); }
    catch (e) { key.state = 'error'; key.message = clean(e); renderPage(); return; }
    Object.assign(key, { value: '', shown: false, state: 'idle', message: '', replace: false });
    toast(`${p.name} API connected`);
    await load();
    refreshModels();
  }
  async function removeKey(p) {
    state.settings = await api.settings.setKey(p.api.id, '');
    await load();
    refreshModels();
  }

  // Makes this AI the one new messages go to.
  async function useIt(p, m) {
    const cat = await refreshCatalog({ mode: state.settings.mode }).catch(() => state.catalog);
    const prov = (cat?.providers || []).find(x => x.family === p.id && x.method === m && x.models.length);
    if (!prov) { toast('No model found yet. Try again in a moment.'); return; }
    await saveSettings({ model: prov.models[0].key });
    toast(`Using ${prov.models[0].label || prov.models[0].id}`);
  }

  // ---------- the page ----------
  const stepRow = (done, text, action) => h('li', { class: 'ps-row' + (done ? ' done' : '') },
    h('i', { class: 'ps-dot' }, done ? icon('check') : null), h('span', { class: 'ps-text', text }), action || null);

  function appPanel(p) {
    const busy = working.has(p.id);
    const a = p.app;
    const install = h('button', { class: 'btn primary', disabled: busy || a.installed, onclick: () => act(p, 'install') }, icon('download'), busy && working.get(p.id) === 'install' ? 'Installing…' : 'Install');
    const signin = h('button', { class: 'btn primary', disabled: busy || !a.installed || a.signedIn, onclick: () => act(p, 'signin') }, busy && working.get(p.id) === 'signin' ? 'Waiting for your browser…' : 'Sign in');
    return h('div', { class: 'pp-card' },
      h('div', { class: 'pc-head' }, h('div', { class: 'pc-title', text: ABOUT[p.id].app.title }), a.ready ? h('span', { class: 'pc-badge ok' }, icon('check'), 'Ready') : null),
      h('p', { class: 'pc-text', text: ABOUT[p.id].app.text }),
      h('ol', { class: 'ps-list' },
        stepRow(a.installed, 'Install the app on this computer', a.installed ? null : install),
        stepRow(a.signedIn, 'Sign in with your browser', a.installed && !a.signedIn ? signin : null)),
      busy ? h('div', { class: 'pp-log mono', text: progress.get(p.id) || 'Starting…' }) : null,
      !a.installed ? h('div', { class: 'pp-cmd' }, h('span', { text: 'Install runs this command on your computer' }), h('code', { text: a.command })) : null,
      a.ready ? h('div', { class: 'pc-foot' }, h('button', { class: 'btn', onclick: () => useIt(p, 'app') }, 'Use ' + ABOUT[p.id].app.title)) : null);
  }

  function apiPanel(p) {
    const a = p.api;
    const models = (state.catalog?.providers || []).find(x => x.id === a.id)?.models || [];
    const head = h('div', { class: 'pc-head' }, h('div', { class: 'pc-title', text: ABOUT[p.id].api.title }),
      a.hasKey ? h('span', { class: 'pc-badge ok' }, icon('check'), 'Connected') : null);
    const secure = h('div', { class: 'pc-secure' }, icon('lock'), 'Your key is encrypted with this computer\'s secure storage and is only sent to ' + p.by + '.');
    if (a.hasKey && !key.replace) {
      return h('div', { class: 'pp-card' }, head,
        h('p', { class: 'pc-text', text: ABOUT[p.id].api.text }),
        h('div', { class: 'key-saved' }, h('span', { class: 'ks-dots', text: '••••••••••••••••••••' }), h('span', { class: 'grow' }),
          h('button', { class: 'btn small', onclick: () => { key.replace = true; renderPage(); setTimeout(() => page.querySelector('.key-input')?.focus(), 0); } }, 'Replace'),
          h('button', { class: 'btn small danger', onclick: () => removeKey(p) }, 'Remove')),
        models.length ? h('div', { class: 'pc-models' }, h('div', { class: 'pc-label', text: models.length + ' models available' }),
          h('div', { class: 'chips' }, ...models.slice(0, 8).map(m => h('span', { class: 'mchip', text: m.label || m.id })), models.length > 8 ? h('span', { class: 'mchip more', text: '+' + (models.length - 8) }) : null)) : null,
        h('div', { class: 'pc-foot' }, h('button', { class: 'btn', onclick: () => useIt(p, 'api') }, 'Use ' + ABOUT[p.id].api.title)),
        secure);
    }
    const input = h('input', { class: 'key-input', type: key.shown ? 'text' : 'password', placeholder: a.keyHint || 'Paste your API key', spellcheck: 'false', autocomplete: 'off', value: key.value });
    input.addEventListener('input', () => { key.value = input.value; if (key.state === 'error') { key.state = 'idle'; key.message = ''; status.replaceChildren(); } save.disabled = !key.value.trim(); });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') saveKey(p); });
    const eye = h('button', { class: 'icon-btn', title: key.shown ? 'Hide' : 'Show', onclick: () => { key.shown = !key.shown; input.type = key.shown ? 'text' : 'password'; eye.replaceChildren(icon(key.shown ? 'eyeOff' : 'eye')); input.focus(); } }, icon(key.shown ? 'eyeOff' : 'eye'));
    const save = h('button', { class: 'btn primary', disabled: !key.value.trim() || key.state === 'checking', onclick: () => saveKey(p) }, key.state === 'checking' ? 'Checking…' : 'Verify and save');
    const status = h('div', { class: 'key-status' + (key.state === 'error' ? ' err' : '') }, key.state === 'checking' ? 'Checking the key with ' + p.by + '…' : key.message || '');
    return h('div', { class: 'pp-card' }, head,
      h('p', { class: 'pc-text', text: ABOUT[p.id].api.text }),
      h('div', { class: 'pc-label' }, h('span', { text: p.by + ' API key' }), h('span', { class: 'grow' }), a.keyUrl ? h('a', { href: '#', 'data-href': a.keyUrl, class: 'md', text: 'Get a key' }) : null),
      h('div', { class: 'key-field' + (key.state === 'error' ? ' err' : '') }, icon('key'), input, eye),
      status,
      h('div', { class: 'pc-foot' }, save, key.replace ? h('button', { class: 'btn ghost', onclick: () => { Object.assign(key, { value: '', state: 'idle', message: '', replace: false }); renderPage(); } }, 'Cancel') : null),
      secure);
  }

  function renderPage() {
    const p = items.find(x => x.id === current);
    if (!p) { pageBody.replaceChildren(h('div', { class: 'pp-empty muted', text: current ? 'Loading…' : 'Choose an AI on the left.' })); return; }
    const m = methodOf(p);
    const st = summary(p);
    const both = !!(p.app && p.api);
    const seg = both ? h('div', { class: 'pp-seg', role: 'tablist' },
      h('button', { class: m === 'app' ? 'on' : '', onclick: () => { method.set(p.id, 'app'); renderPage(); } }, icon('laptop'), 'App on this computer', p.app.ready ? h('i', { class: 'dot ok' }) : null),
      h('button', { class: m === 'api' ? 'on' : '', onclick: () => { method.set(p.id, 'api'); renderPage(); setTimeout(() => page.querySelector('.key-input')?.focus(), 0); } }, icon('key'), 'API key', p.api.hasKey ? h('i', { class: 'dot ok' }) : null)) : null;
    pageBody.replaceChildren(
      h('button', { class: 'icon-btn pp-close', title: 'Close (Esc)', onclick: close }, icon('x')),
      h('div', { class: 'pp-wrap' },
        h('div', { class: 'pp-hero' },
          brand(p.id, 56),
          h('div', { class: 'pp-hero-main' },
            h('h1', { text: p.name }),
            h('div', { class: 'pp-sub' }, h('span', { text: p.by }), h('span', { class: 'prov-state' }, h('i', { class: 'dot ' + st.dot }), st.text)))),
        h('p', { class: 'pp-lead', text: ABOUT[p.id].lead }),
        seg,
        m === 'app' && p.app ? appPanel(p) : apiPanel(p)));
  }

  return { page, load, show, close, onOpen: f => openCbs.push(f), isOpen: () => !page.classList.contains('hidden'),
    // Opens the page; `id` and `m` ('app' or 'api') jump straight to one AI and one way of using it.
    openList: async (id, m) => {
      page.classList.remove('hidden');
      renderList();
      await load();
      if (id) { show(id, m); return; }
      if (!current && items.length) show((items.find(p => !p.ready) || items[0]).id);
    } };
}
