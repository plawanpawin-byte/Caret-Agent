// Connectors: a marketplace for what the AI can plug into (GitHub, Cloudflare, Roblox Studio, ...).
// Two tabs, Marketplace and Installed, a search box, groups of cards. A card opens its details, where the
// connector is installed or removed. Keys are always the person's own; they go to Claude Code, not to any website.
import { h, icon, toast } from './ui.js';
import { api } from './state.js';

const clean = e => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const GROUPS = ['Source control', 'Cloud and hosting', 'Docs and planning', 'Browser and testing', 'Game development', 'Skills and tools'];
const SUB = {
  'Source control': 'Repositories, issues and pull requests.',
  'Cloud and hosting': 'Deploy and manage your apps and databases.',
  'Docs and planning': 'Current documentation, notes and issue trackers.',
  'Browser and testing': 'Let the AI open a browser and check its own work.',
  'Game development': 'Build games from inside their editors.',
  'Skills and tools': 'Methods and checkers that make the AI work better.',
};
// Brand colours for the letter tiles. GitHub and Roblox Studio have real logos (see avatar()).
const TINT = {
  cloudflare: ['#f6821f', 'CF'], 'cloudflare-docs': ['#f6821f', 'CD'], supabase: ['#1f8f5f', 'SB'], firebase: ['#f5a300', 'FB'],
  context7: ['#2a2a2a', 'C7'], 'sequential-thinking': ['#52525b', 'ST'], notion: ['#2b2b2b', 'N'], linear: ['#5e6ad2', 'LN'],
  playwright: ['#2e7d32', 'PW'], 'chrome-devtools': ['#1a73e8', 'DT'], superpowers: ['#52525b', 'SP'], aislop: ['#52525b', 'AS'], rea: ['#52525b', 'RE'],
};

export function createExtensions() {
  let data = { claude: true, items: [] };
  let view = 'market';         // 'market' | 'installed' | 'detail'
  let tabBefore = 'market';
  let current = null;
  let query = '';
  const working = new Map();   // id -> 'install' | 'uninstall'
  const lastLine = new Map();
  let token = '';

  const search = h('input', { class: 'cn-search', placeholder: 'Search connectors…', spellcheck: 'false', oninput: e => { query = e.target.value.trim().toLowerCase(); if (view === 'detail') view = tabBefore; render(); } });
  const seg = h('div', { class: 'cn-seg' });
  const body = h('div', { class: 'cn-body' });
  const page = h('div', { class: 'ext-page cn-page hidden' },
    h('div', { class: 'cn-wrap' },
      h('div', { class: 'cn-head' }, h('h1', { text: 'Connectors' }), seg),
      h('div', { class: 'cn-searchbox' }, icon('search'), search),
      body),
    h('button', { class: 'icon-btn pp-close', title: 'Close (Esc)', onclick: () => close() }, icon('x')));

  api.extensions.onProgress(({ id, line }) => {
    lastLine.set(id, line);
    const t = page.querySelector('.cn-log');
    if (t && id === current) t.textContent = line;
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !e.defaultPrevented && !page.classList.contains('hidden') && !document.querySelector('.menu, .overlay')) {
      if (view === 'detail') { view = tabBefore; render(); } else close();
    }
  });

  async function load() {
    try { data = await api.extensions.status(); } catch (e) { toast(clean(e), { error: true }); }
    render();
  }
  function open(id) {
    page.classList.remove('hidden');
    if (id) { current = id; tabBefore = view === 'detail' ? 'market' : view; view = 'detail'; }
    else view = view === 'detail' ? tabBefore : view;
    render(); load();
    setTimeout(() => search.focus(), 30);
  }
  function close() { page.classList.add('hidden'); }

  // ---------- icons ----------
  function avatar(id, size) {
    const mk = (cls, style, ...kids) => h('span', { class: 'cn-ico ' + cls, style: { width: size + 'px', height: size + 'px', borderRadius: Math.round(size * .24) + 'px', ...style } }, ...kids);
    if (id === 'roblox-studio') return h('img', { class: 'cn-ico', src: './roblox.png', alt: '', style: { width: size + 'px', height: size + 'px', borderRadius: Math.round(size * .24) + 'px' } });
    if (id === 'github-mcp') {
      const el = mk('', { background: '#000', border: '1px solid #2a2723' }, icon('github'));
      const sv = el.querySelector('svg'); if (sv) { sv.style.width = sv.style.height = Math.round(size * .6) + 'px'; sv.style.fill = '#fff'; }
      return el;
    }
    const [bg, txt] = TINT[id] || ['#444', '?'];
    return mk('', { background: bg, fontSize: Math.round(size * .36) + 'px' }, txt);
  }

  // ---------- pieces ----------
  const matches = i => !query || (i.name + ' ' + i.summary + ' ' + i.by + ' ' + (i.group || '')).toLowerCase().includes(query);
  const openDetail = id => { tabBefore = view === 'detail' ? tabBefore : view; current = id; token = ''; view = 'detail'; render(); };

  function card(i) {
    const w = working.get(i.id);
    const tail = w ? h('span', { class: 'cn-state', text: w === 'install' ? 'Installing…' : 'Removing…' })
      : i.installed ? h('span', { class: 'cn-state ok', title: 'Installed' }, icon('check'))
        : h('span', { class: 'cn-add', title: 'Add' }, icon('plus'));
    return h('button', { class: 'cn-card', onclick: () => openDetail(i.id) },
      avatar(i.id, 44),
      h('span', { class: 'cn-main' }, h('span', { class: 'cn-name', text: i.name }), h('span', { class: 'cn-sum', text: i.summary })),
      tail);
  }

  function featured() {
    const i = data.items.find(x => x.id === 'github-mcp');
    if (!i || query) return null;
    const floating = ['github-mcp', 'cloudflare', 'supabase', 'linear', 'notion', 'playwright'];
    const tiles = floating.map((id, k) => h('div', { class: 'cn-float f' + k }, avatar(id, 54)));
    return h('div', { class: 'cn-feature' },
      h('div', { class: 'cn-art' }, ...tiles),
      h('div', { class: 'cn-fmain' },
        h('div', { class: 'cn-kicker', text: 'Featured' }),
        h('div', { class: 'cn-ftitle', text: i.name }),
        h('p', { text: 'Let the AI work with your repositories, issues and pull requests, using the GitHub account you signed in with.' }),
        h('div', { class: 'cn-factions' },
          i.installed ? h('span', { class: 'cn-state ok' }, icon('check'), 'Installed')
            : h('button', { class: 'cn-btn blue', onclick: () => doInstall(i), text: '+ Add' }),
          h('button', { class: 'cn-btn', onclick: () => openDetail(i.id), text: 'Details' }))));
  }

  function market() {
    const shown = data.items.filter(matches);
    const out = [];
    if (!data.claude) out.push(h('div', { class: 'cn-note', text: 'Claude Code is not installed yet. Connectors work through it: set it up from the model menu first.' }));
    const f = featured(); if (f) out.push(f);
    for (const g of GROUPS) {
      const list = shown.filter(i => (i.group || 'Skills and tools') === g);
      if (!list.length) continue;
      out.push(h('section', { class: 'cn-group' }, h('h2', { text: g }), h('p', { text: SUB[g] }), h('div', { class: 'cn-grid' }, ...list.map(card))));
    }
    if (!shown.length) out.push(h('div', { class: 'cn-none', text: 'No connector matches.' }));
    return out;
  }
  function installed() {
    const list = data.items.filter(i => i.installed && matches(i));
    if (!list.length) return [h('div', { class: 'cn-none', text: query ? 'No installed connector matches.' : 'Nothing installed yet. Open the Marketplace and add one.' })];
    return [h('div', { class: 'cn-grid' }, ...list.map(card))];
  }

  async function doInstall(i) {
    if (working.has(i.id)) return;
    working.set(i.id, 'install'); lastLine.delete(i.id); render();
    try {
      await api.extensions.install(i.id, { token });
      token = '';
      toast(`${i.name} connected. Start a new conversation to use it.`);
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

  function detail() {
    const i = data.items.find(x => x.id === current);
    if (!i) return [h('div', { class: 'cn-none', text: 'Choose a connector.' })];
    const w = working.get(i.id);
    // GitHub signs in with the account already used for Caret Agent; every other connector that needs a key asks for the person's own.
    const own = i.needsToken && i.id !== 'github-mcp' && !i.installed;
    const tokenBox = own ? h('div', { class: 'ext-token' },
      h('label', { text: i.tokenLabel || 'Your key' }),
      h('input', { type: 'password', class: 'key-input', placeholder: 'Paste your own key', value: token, autocomplete: 'off', spellcheck: 'false', oninput: e => { token = e.target.value; } }),
      h('div', { class: 'muted', text: (i.tokenHint ? i.tokenHint + ' ' : '') + 'It is passed to Claude Code and kept on this computer only.' })) : null;
    const action = w ? h('button', { class: 'cn-btn blue', disabled: true, text: w === 'install' ? 'Installing…' : 'Removing…' })
      : i.installed ? h('button', { class: 'cn-btn', onclick: () => doRemove(i), text: 'Remove' })
        : h('button', { class: 'cn-btn blue', disabled: !!i.blocked, onclick: () => doInstall(i), text: '+ Add' });
    const fact = (k, v) => h('div', { class: 'ext-fact' }, h('div', { class: 'k', text: k }), h('div', { class: 'v', text: v }));
    return [
      h('button', { class: 'cn-back', onclick: () => { view = tabBefore; render(); } }, icon('chevronLeft'), 'Back'),
      h('div', { class: 'ext-hero' }, avatar(i.id, 84),
        h('div', { class: 'ext-hero-main' },
          h('h1', { text: i.name }),
          h('div', { class: 'ext-hero-by', text: i.by }),
          h('p', { class: 'ext-hero-sum', text: i.summary }),
          h('div', { class: 'ext-actions' }, action, i.installed ? h('span', { class: 'cn-state ok' }, icon('check'), 'Connected') : null),
          i.blocked && !i.installed ? h('div', { class: 'ext-blocked', text: i.blocked }) : null,
          tokenBox,
          h('div', { class: 'cn-log muted', text: w ? (lastLine.get(i.id) || 'Working…') : '' }))),
      h('div', { class: 'ext-cols' },
        h('div', { class: 'ext-text' }, h('div', { class: 'ext-detail' },
          ...i.about.map(t => h('p', { text: t })),
          h('h3', { text: 'What it does' }), h('ul', {}, ...i.features.map(f => h('li', { text: f }))))),
        h('div', { class: 'ext-facts' }, h('h4', { text: 'Details' }),
          fact('Group', i.group || i.category), fact('Source', i.repo), fact('Works with', 'Claude Code'),
          fact('Key', i.needsToken ? (i.id === 'github-mcp' ? 'Your GitHub sign-in' : 'Your own, kept on this PC') : 'None needed'))),
    ];
  }

  function render() {
    seg.replaceChildren(...[['market', 'Marketplace'], ['installed', 'Installed']].map(([k, t]) =>
      h('button', { class: 'cn-seg-b' + ((view === k || (view === 'detail' && tabBefore === k)) ? ' on' : ''), text: t, onclick: () => { view = k; tabBefore = k; render(); } })));
    body.replaceChildren(...(view === 'detail' ? detail() : view === 'installed' ? installed() : market()));
  }

  return { page, open, close };
}
