// "AI" panel in the side bar: the AIs Caret Agent can use, what is ready, and a
// one-click way to install or connect each of them (like an extensions list).
import { h, icon, toast } from './ui.js';
import { api, state, refreshCatalog } from './state.js';

const TONE = { claude: '#d97757', codex: '#7c9cf5', xai: '#c8c8c8', gemini: '#6aa3ff', openai: '#4fb99f', ollama: '#e8e8e8', lmstudio: '#9b8cf0', llamacpp: '#e0a046' };
const clean = e => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

export function createProviders() {
  let items = [];
  let query = '';
  const progress = new Map();   // id -> last output line
  const working = new Map();    // id -> 'install' | 'signin'
  const open = new Map();       // id -> 'confirm' | 'key'
  const input = h('input', { class: 'field', placeholder: 'Search AI providers', spellcheck: 'false' });
  const list = h('div', { class: 'prov-list' });
  const head = h('div', { class: 'panel-head' }, h('span', { class: 'grow', text: 'AI providers' }),
    h('button', { class: 'icon-btn', title: 'Refresh', onclick: () => load() }, icon('refresh')));
  const el = h('div', { class: 'col', style: { flex: 1, minHeight: 0 } }, head, h('div', { style: { padding: '0 10px 8px' } }, input), list);
  input.addEventListener('input', () => { query = input.value.trim().toLowerCase(); render(); });

  api.providers.onProgress(({ id, line }) => {
    progress.set(id, line);
    const t = list.querySelector(`[data-prov="${id}"] .prov-log`);
    if (t) t.textContent = line;
  });

  async function load() {
    try { items = await api.providers.status(); } catch (e) { items = []; toast(clean(e), { error: true }); }
    render();
  }

  async function act(p, kind) {
    working.set(p.id, kind); open.delete(p.id); progress.delete(p.id); render();
    try {
      await (kind === 'install' ? api.providers.install(p.id) : api.providers.signIn(p.id));
      toast(kind === 'install' ? `${p.name} installed` : `${p.name} signed in`);
    } catch (e) { toast(clean(e), { error: true, ms: 8000 }); }
    working.delete(p.id);
    await load();
    refreshCatalog({ mode: state.settings.mode }).catch(() => {});
  }

  function state_(p) {
    if (working.has(p.id)) return { dot: 'busy', text: working.get(p.id) === 'install' ? 'Installing…' : 'Waiting for sign-in in your browser…' };
    if (p.kind === 'cli') return p.ready ? { dot: 'ok', text: 'Ready' } : p.installed ? { dot: 'warn', text: 'Installed — sign in to use it' } : { dot: 'off', text: 'Not installed' };
    if (p.kind === 'api') return p.signedIn ? { dot: 'ok', text: 'Connected' } : { dot: 'off', text: 'Not connected' };
    return p.running ? { dot: 'ok', text: 'Running' } : p.installed ? { dot: 'ok', text: 'Installed' } : { dot: 'off', text: 'Not installed' };
  }

  function actions(p) {
    const busy = working.has(p.id);
    const btn = (label, onclick, primary = true, ic = null) => h('button', { class: 'btn small' + (primary ? ' primary' : ''), disabled: busy, onclick }, ic ? icon(ic) : null, label);
    if (p.kind === 'cli') {
      if (!p.installed) return [btn('Install', () => { open.set(p.id, 'confirm'); render(); }, true, 'download')];
      if (!p.signedIn) return [btn('Sign in', () => act(p, 'signin'))];
      return [];
    }
    if (p.kind === 'api') {
      if (!p.signedIn) return [btn('Connect', () => { open.set(p.id, 'key'); render(); }, true, 'key')];
      return [btn('Remove', async () => { state.settings = await api.settings.setKey(p.id, ''); await load(); refreshCatalog().catch(() => {}); }, false)];
    }
    return p.installed ? [] : [btn('Get', () => api.app.openExternal(p.site), false, 'download')];
  }

  function extra(p) {
    const mode = open.get(p.id);
    if (mode === 'confirm') {
      return h('div', { class: 'prov-extra' },
        h('div', { class: 'muted', text: 'This runs the command below on your computer.' }),
        h('code', { text: p.command }),
        h('div', { class: 'prov-btns' },
          h('button', { class: 'btn small primary', onclick: () => act(p, 'install') }, 'Run install'),
          h('button', { class: 'btn small ghost', onclick: () => { open.delete(p.id); render(); } }, 'Cancel')));
    }
    if (mode === 'key') {
      const key = h('input', { class: 'field', type: 'password', placeholder: 'Paste your API key', spellcheck: 'false' });
      const save = async () => {
        const v = key.value.trim(); if (!v) return;
        try { state.settings = await api.settings.setKey(p.id, v); open.delete(p.id); toast(`${p.name} connected`); await load(); refreshCatalog().catch(() => {}); }
        catch (e) { toast(clean(e), { error: true }); }
      };
      key.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
      setTimeout(() => key.focus(), 0);
      return h('div', { class: 'prov-extra' }, key,
        h('div', { class: 'prov-btns' },
          h('button', { class: 'btn small primary', onclick: save }, 'Save'),
          h('button', { class: 'btn small ghost', onclick: () => { open.delete(p.id); render(); } }, 'Cancel'),
          p.keyUrl ? h('a', { href: '#', 'data-href': p.keyUrl, class: 'md', text: 'Get a key' }) : null));
    }
    return null;
  }

  function card(p) {
    const st = state_(p);
    const log = working.has(p.id) ? h('div', { class: 'prov-log mono', text: progress.get(p.id) || '' }) : null;
    return h('div', { class: 'prov', 'data-prov': p.id },
      h('div', { class: 'prov-ico', style: { color: TONE[p.id] || '#ddd' }, text: p.name[0] }),
      h('div', { class: 'prov-main' },
        h('div', { class: 'prov-top' }, h('span', { class: 'prov-name', text: p.name }), p.by !== p.name ? h('span', { class: 'prov-by', text: p.by }) : null),
        h('div', { class: 'prov-blurb', text: p.blurb }),
        h('div', { class: 'prov-row' },
          h('span', { class: 'prov-state' }, h('i', { class: 'dot ' + st.dot }), st.text),
          h('span', { class: 'grow' }), ...actions(p)),
        log, extra(p)));
  }

  function section(title, rows) {
    if (!rows.length) return null;
    return h('div', {}, h('div', { class: 'prov-sec' }, h('span', { class: 'grow', text: title }), h('span', { class: 'prov-count', text: String(rows.length) })), ...rows.map(card));
  }

  function render() {
    const match = p => !query || `${p.name} ${p.by} ${p.blurb}`.toLowerCase().includes(query);
    const shown = items.filter(match);
    const ready = shown.filter(p => p.ready), rest = shown.filter(p => !p.ready);
    const parts = [section('Ready to use', ready), section(ready.length ? 'Available' : 'Set up an AI', rest)].filter(Boolean);
    list.replaceChildren(...(parts.length ? parts : [h('div', { class: 'muted', style: { padding: '8px 12px' }, text: 'No match' })]));
  }

  return { el, load, focus: () => input.focus() };
}
