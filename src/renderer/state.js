// Shared app state and a tiny event bus.
export const api = window.caret;

export const state = {
  settings: null,
  info: null,
  workspace: null,     // { root, name }
  catalog: null,       // models.catalog() result
  layout: 'studio',
};

const bus = new EventTarget();
export const on = (name, fn) => { const h = e => fn(e.detail); bus.addEventListener(name, h); return () => bus.removeEventListener(name, h); };
export const emit = (name, detail) => bus.dispatchEvent(new CustomEvent(name, { detail }));

export async function saveSettings(patch) {
  state.settings = await api.settings.update(patch);
  emit('settings', state.settings);
  return state.settings;
}

let catalogPromise = null;
export function refreshCatalog(opts = {}) {
  catalogPromise = api.models.catalog({ mode: state.settings?.mode || 'code', ...opts }).then(c => { state.catalog = c; emit('catalog', c); return c; })
    .catch(() => state.catalog).finally(() => { setTimeout(() => { catalogPromise = null; }, 100); });
  return catalogPromise;
}
export function getCatalog() { return state.catalog ? Promise.resolve(state.catalog) : (catalogPromise || refreshCatalog()); }

export function modelLabel(key) {
  if (!key || key === 'auto') return 'Auto';
  const i = key.indexOf(':');
  const prov = key.slice(0, i), id = key.slice(i + 1);
  const p = state.catalog?.providers.find(x => x.id === prov);
  const m = p?.models.find(x => x.id === id);
  if (m?.label) return m.label;
  return id;
}
