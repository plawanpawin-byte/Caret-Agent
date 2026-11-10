// Small DOM helpers. Text is always set with textContent, never innerHTML,
// unless it has been escaped first — file names and AI output cannot inject markup.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const P = {
  files: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  terminal: '<path d="m5 7 5 5-5 5"/><path d="M12 19h7"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  folderOpen: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v1"/><path d="M3 7v10a2 2 0 0 0 2 2h12.5a2 2 0 0 0 1.9-1.4L21 12H7.5a2 2 0 0 0-1.9 1.4L3 19"/>',
  git: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="9" r="2.5"/><path d="M6 8.5v7M18 11.5c0 3-3 4-6 4.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  paperclip: '<path d="m21 11-8.6 8.6a5 5 0 0 1-7-7l8.5-8.6a3.3 3.3 0 0 1 4.7 4.7l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l7.9-7.9"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5L5 20"/>',
  plan: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',
  code: '<path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14"/>',
  agent: '<path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
  shield: '<path d="M12 3 5 6v6c0 4.4 3 7.6 7 9 4-1.4 7-4.6 7-9V6z"/>',
  shieldCheck: '<path d="M12 3 5 6v6c0 4.4 3 7.6 7 9 4-1.4 7-4.6 7-9V6z"/><path d="m9 12 2 2 4-4"/>',
  bolt: '<path d="M13 3 4 14h7l-1 7 9-11h-7z"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
  cloud: '<path d="M7 18a4.5 4.5 0 1 1 .9-8.9A6 6 0 0 1 19 11a3.5 3.5 0 0 1-.5 7z"/>',
  check: '<path d="m5 12 4.5 4.5L19 7"/>',
  alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  newFile: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M12 11v6M9 14h6"/>',
  newFolder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 10v6M9 13h6"/>',
  sidebar: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  sidebarRight: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 15h18"/>',
  layout: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M9 12h12"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5"/>',
  sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  link: '<path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
};

export function icon(name, cls = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'i ' + cls);
  svg.innerHTML = P[name] || P.files; // static, trusted path data only
  return svg;
}

export function logo(size = 20) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 32 32');
  svg.setAttribute('width', size); svg.setAttribute('height', size);
  svg.setAttribute('class', 'logo');
  svg.innerHTML = '<rect width="32" height="32" rx="8" fill="#f0a63a"/><path d="M9.5 20.5 16 10l6.5 10.5" fill="none" stroke="#1a1408" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 24.5h8" stroke="#1a1408" stroke-width="3.2" stroke-linecap="round"/>';
  return svg;
}

// ---------- popover menu ----------
let openMenu = null;
export function closeMenu() { if (openMenu) { openMenu.remove(); openMenu = null; document.removeEventListener('mousedown', outside, true); document.removeEventListener('keydown', onKey, true); } }
function outside(e) { if (openMenu && !openMenu.contains(e.target)) closeMenu(); }
function onKey(e) {
  if (!openMenu) return;
  const items = [...openMenu.querySelectorAll('.mi:not(.disabled)')];
  let i = items.findIndex(x => x.classList.contains('kb'));
  if (e.key === 'Escape') { closeMenu(); e.preventDefault(); }
  else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    items[i]?.classList.remove('kb');
    i = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
    items[i]?.classList.add('kb'); items[i]?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter' && i >= 0) { e.preventDefault(); items[i].click(); }
}

// items: [{label, sub, icon, checked, onClick, disabled, tag} | 'sep' | {group}]
export function menu(anchor, items, { align = 'left', above = false, x, y } = {}) {
  closeMenu();
  const el = h('div', { class: 'menu', role: 'menu' });
  for (const it of items) {
    if (it === 'sep') { el.append(h('div', { class: 'sep' })); continue; }
    if (it.group) { el.append(h('div', { class: 'group' }, h('span', { text: it.group }), it.right ? h('span', { text: it.right }) : null)); continue; }
    if (it.note) { el.append(h('div', { class: 'note', text: it.note })); continue; }
    const b = h('button', { class: 'mi' + (it.disabled ? ' disabled' : ''), role: 'menuitem', onclick: () => { if (it.disabled) return; closeMenu(); it.onClick?.(); } },
      it.icon ? icon(it.icon) : null,
      h('span', { class: 'grow' }, h('span', { text: it.label }), ...(it.tags || []).map(t => h('span', { class: 'tag' + (t.good ? ' good' : ''), text: t.text || t })), it.sub ? h('span', { class: 'sub', text: it.sub }) : null),
      it.checked ? icon('check', 'check') : null);
    el.append(b);
  }
  document.body.append(el);
  const r = anchor ? anchor.getBoundingClientRect() : { left: x, right: x, top: y, bottom: y };
  const mw = el.offsetWidth, mh = el.offsetHeight;
  let left = align === 'right' ? r.right - mw : r.left;
  let top = above ? r.top - mh - 6 : r.bottom + 6;
  if (top + mh > innerHeight - 8) top = Math.max(8, r.top - mh - 6);
  if (top < 8) top = 8;
  left = Math.max(8, Math.min(left, innerWidth - mw - 8));
  el.style.left = left + 'px'; el.style.top = top + 'px';
  openMenu = el;
  setTimeout(() => { document.addEventListener('mousedown', outside, true); document.addEventListener('keydown', onKey, true); });
  return el;
}

let toastTimer;
export function toast(text, { error = false, ms = 3500 } = {}) {
  document.querySelector('.toast')?.remove();
  const t = h('div', { class: 'toast' + (error ? ' err' : ''), text });
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), ms);
}

// window.prompt() does not exist in Electron, so this is our own.
export function askText(title, value = '') {
  return new Promise(resolve => {
    const input = h('input', { class: 'field', value, maxlength: 80 });
    const done = v => { o.remove(); resolve(v); };
    const o = h('div', { class: 'overlay', onmousedown: e => { if (e.target === o) done(null); } },
      h('div', { class: 'modal', style: { width: 'min(420px, 100%)' } },
        h('div', { class: 'modal-head' }, h('h2', { text: title })),
        h('div', { class: 'modal-body' }, input),
        h('div', { class: 'modal-foot' }, h('button', { class: 'btn ghost', onclick: () => done(null) }, 'Cancel'), h('button', { class: 'btn primary', onclick: () => done(input.value.trim() || null) }, 'Save'))));
    input.onkeydown = e => { if (e.key === 'Enter') done(input.value.trim() || null); if (e.key === 'Escape') done(null); };
    document.body.append(o);
    setTimeout(() => { input.focus(); input.select(); });
  });
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function timeAgo(t) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

// Coloured badge for a file type in the tree and tabs.
const FT = {
  js: ['JS', '#e8c547'], mjs: ['JS', '#e8c547'], cjs: ['JS', '#e8c547'], jsx: ['JSX', '#6cc4e0'], ts: ['TS', '#5b9be6'], tsx: ['TSX', '#5b9be6'],
  json: ['{}', '#c8a85a'], md: ['MD', '#9aa0a8'], html: ['<>', '#e57a4e'], htm: ['<>', '#e57a4e'], css: ['#', '#7b8fe8'], scss: ['#', '#d06c9f'],
  py: ['PY', '#6c9fd4'], go: ['GO', '#5ec8d8'], rs: ['RS', '#d9905e'], java: ['JV', '#d4805e'], kt: ['KT', '#a685e8'], swift: ['SW', '#ef7d4e'],
  c: ['C', '#7f9fcc'], h: ['H', '#7f9fcc'], cpp: ['C+', '#6f8fd0'], cs: ['C#', '#8a6fd0'], php: ['PHP', '#8b8fd6'], rb: ['RB', '#d75a5a'],
  lua: ['LUA', '#6a7fd8'], luau: ['LU', '#6a7fd8'], sh: ['$', '#8fbf73'], ps1: ['PS', '#5f8fd8'], yml: ['YML', '#c97a7a'], yaml: ['YML', '#c97a7a'],
  toml: ['TOM', '#9a8f7a'], svg: ['SVG', '#e0a84e'], png: ['IMG', '#8fbf73'], jpg: ['IMG', '#8fbf73'], jpeg: ['IMG', '#8fbf73'], gif: ['IMG', '#8fbf73'], webp: ['IMG', '#8fbf73'],
  txt: ['TXT', '#8a8a92'], env: ['ENV', '#c9b45a'], lock: ['LCK', '#77777f'], sql: ['SQL', '#d8a35e'], vue: ['V', '#5ec48f'], svelte: ['S', '#e8663e'], dart: ['DT', '#4fb7e0'],
};
export function fileBadge(name) {
  const ext = (name.toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || (name.startsWith('.') ? name.slice(1).toLowerCase() : '');
  const [t, c] = FT[ext] || ['', '#77777f'];
  if (!t) return icon('files');
  return h('span', { class: 'ficon', style: { color: c }, text: t });
}
