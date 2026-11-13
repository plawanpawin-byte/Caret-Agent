// Extensions: a small marketplace for the Claude Code app. A list on the left (search, categories on top,
// Installed and Recommended below), the details of the chosen one on the right. Install and remove happen here.
import { h, icon, toast } from './ui.js';
import { api } from './state.js';

const clean = e => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const CATS = ['All', 'MCP', 'Skills', 'Tools'];
const TINT = { 'github-mcp': ['#24292f', 'GH'], superpowers: ['#7c5cff', 'SP'], aislop: ['#16a34a', 'AS'], rea: ['#d9480f', 'RE'], 'roblox-studio': ['#e11d48', 'RB'] };

export function createExtensions() {
  let data = { claude: true, items: [] };
  let current = null;          // id shown on the right
  let cat = 'All';
  let query = '';
  let tab = 'details';
  const working = new Map();   // id -> 'install' | 'uninstall'
  const lastLine = new Map();
  let token = '';

  const search = h('input', { class: 'ext-search', placeholder: 'Search extensions', spellcheck: 'false', oninput: e => { query = e.target.value.trim().toLowerCase(); renderList(); } });
  const tabsEl = h('div', { class: 'ext-cats' });
  const listEl = h('div', { class: 'ext-list-body' });
  const bodyEl = h('div', { class: 'ext-body' });
  const closeBtn = h('button', { class: 'icon-btn pp-close', title: 'Close (Esc)', onclick: () => close() }, icon('x'));
  const page = h('div', { class: 'ext-page hidden' },
    h('div', { class: 'ext-list' },
      h('div', { class: 'ext-head' }, h('div', { class: 'ext-title', text: 'Extensions' }),
        h('button', { class: 'icon-btn', title: 'Refresh', onclick: () => load() }, icon('refresh'))),
      h('div', { class: 'ext-searchbox' }, icon('search'), search),
      tabsEl, listEl),
    bodyEl, closeBtn);

  api.extensions.onProgress(({ id, line }) => {
    lastLine.set(id, line);
    const t = page.querySelector('.ext-log');
    if (t && id === current) t.textContent = line;
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !e.defaultPrevented && !page.classList.contains('hidden') && !document.querySelector('.menu, .overlay')) close();
  });

  async function load() {
    try { data = await api.extensions.status(); } catch (e) { toast(clean(e), { error: true }); }
    if (!current && data.items.length) current = (data.items.find(i => i.recommended && !i.installed) || data.items[0]).id;
    render();
  }
  const render = () => { renderTabs(); renderList(); renderBody(); };
  function open(id) {
    if (id) current = id;
    page.classList.remove('hidden');
    load();
    setTimeout(() => search.focus(), 30);
  }
  function close() { page.classList.add('hidden'); }

  const avatar = (id, size) => {
    const [bg, txt] = TINT[id] || ['#444', '?'];
    return h('span', { class: 'ext-ico', style: { width: size + 'px', height: size + 'px', background: bg, fontSize: Math.round(size * .36) + 'px' }, text: txt });
  };

  function renderTabs() {
    tabsEl.replaceChildren(...CATS.map(c => h('button', { class: 'ext-cat' + (c === cat ? ' on' : ''), text: c, onclick: () => { cat = c; renderTabs(); renderList(); } })));
  }
  const matches = i => (cat === 'All' || i.category === cat) && (!query || (i.name + ' ' + i.summary + ' ' + i.by + ' ' + i.category).toLowerCase().includes(query));

  function row(i) {
    const w = working.get(i.id);
    const state = w ? h('span', { class: 'ext-state busy', text: w === 'install' ? 'Installing…' : 'Removing…' })
      : i.installed ? h('span', { class: 'ext-state ok' }, icon('check'), 'Installed')
        : h('span', { class: 'ext-state btn', text: 'Install' });
    return h('button', { class: 'ext-row' + (i.id === current ? ' on' : ''), title: i.name, onclick: () => { current = i.id; tab = 'details'; token = ''; render(); } },
      avatar(i.id, 40),
      h('span', { class: 'ext-main' }, h('span', { class: 'ext-name', text: i.name }), h('span', { class: 'ext-sum', text: i.summary }), h('span', { class: 'ext-by', text: i.by + ' · ' + i.category })),
      state);
  }
  function renderList() {
    const shown = data.items.filter(matches);
    const inst = shown.filter(i => i.installed), rec = shown.filter(i => !i.installed);
    const section = (label, list) => list.length ? [h('div', { class: 'ext-sec' }, h('span', { text: label }), h('span', { class: 'ext-count', text: String(list.length) })), ...list.map(row)] : [];
    const parts = [...section('Installed', inst), ...section('Recommended', rec)];
    listEl.replaceChildren(...(parts.length ? parts : [h('div', { class: 'ext-none', text: 'No extension matches.' })]));
  }

  async function doInstall(i) {
    if (working.has(i.id)) return;
    working.set(i.id, 'install'); lastLine.delete(i.id); render();
    try {
      await api.extensions.install(i.id, { token });
      token = '';
      toast(`${i.name} installed. Restart Claude Code chats to use it.`);
    } catch (e) { toast(clean(e), { error: true }); }
    working.delete(i.id);
    await load();
  }
  async function doRemove(i) {
    if (working.has(i.id)) return;
    working.set(i.id, 'uninstall'); lastLine.delete(i.id); render();
    try { await api.extensions.uninstall(i.id); toast(`${i.name} removed.`); } catch (e) { toast(clean(e), { error: true }); }
    working.delete(i.id);
    await load();
  }

  function renderBody() {
    const i = data.items.find(x => x.id === current);
    if (!i) { bodyEl.replaceChildren(h('div', { class: 'pp-empty muted', text: 'Choose an extension on the left.' })); return; }
    const w = working.get(i.id);
    const needsToken = i.needsToken && !i.installed;
    const tokenBox = needsToken ? h('div', { class: 'ext-token' },
      h('label', { text: 'GitHub personal access token' }),
      h('input', { type: 'password', class: 'key-input', placeholder: 'ghp_… or github_pat_…', value: token, autocomplete: 'off', spellcheck: 'false', oninput: e => { token = e.target.value; } }),
      h('div', { class: 'muted', text: 'Stored by Claude Code on this computer. Give the token only the permissions you want the AI to have.' })) : null;
    const action = w ? h('button', { class: 'btn primary', disabled: true, text: w === 'install' ? 'Installing…' : 'Removing…' })
      : i.installed ? h('button', { class: 'btn', onclick: () => doRemove(i), text: 'Uninstall' })
        : h('button', { class: 'btn primary', disabled: !!i.blocked, onclick: () => doInstall(i), text: 'Install' });
    const detail = h('div', { class: 'ext-detail' },
      ...i.about.map(t => h('p', { text: t })),
      h('h3', { text: 'What it does' }),
      h('ul', {}, ...i.features.map(f => h('li', { text: f }))));
    bodyEl.replaceChildren(
      h('div', { class: 'ext-hero' }, avatar(i.id, 88),
        h('div', { class: 'ext-hero-main' },
          h('h1', { text: i.name }),
          h('div', { class: 'ext-hero-by', text: i.by }),
          h('p', { class: 'ext-hero-sum', text: i.summary }),
          h('div', { class: 'ext-actions' }, action, i.installed ? h('span', { class: 'ext-state ok' }, icon('check'), 'Installed') : null),
          i.blocked && !i.installed ? h('div', { class: 'ext-blocked', text: i.blocked }) : null,
          tokenBox,
          h('div', { class: 'ext-log muted', text: w ? (lastLine.get(i.id) || 'Working…') : '' }))),
      h('div', { class: 'ext-cols' },
        h('div', { class: 'ext-text' }, detail),
        h('div', { class: 'ext-facts' },
          h('h4', { text: 'Details' }),
          fact('Category', i.category), fact('Source', i.repo), fact('Works with', 'Claude Code'), fact('Installs from', i.id === 'github-mcp' ? 'GitHub (hosted)' : i.id === 'roblox-studio' ? 'Roblox Studio on this PC' : 'The author\'s package'))));
  }
  const fact = (k, v) => h('div', { class: 'ext-fact' }, h('div', { class: 'k', text: k }), h('div', { class: 'v', text: v }));

  return { page, open, close };
}
