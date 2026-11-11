// File tree. Lazy-loads folders, keeps open folders across refreshes.
import { h, icon, fileBadge, menu, toast } from './ui.js';
import { api, state, on, emit } from './state.js';

// Thin vertical lines that show nesting, like VS Code's indent guides.
const guides = depth => Array.from({ length: depth }, (_, d) => `linear-gradient(var(--guide), var(--guide)) no-repeat ${15 + d * 12}px 0 / 1px 100%`).join(',') || 'none';

export function createExplorer({ title = 'Explorer', onOpen } = {}) {
  const expanded = new Set(['.']);
  let selected = null;
  const tree = h('div', { class: 'tree', tabindex: 0 });
  const head = h('div', { class: 'panel-head' },
    h('span', { class: 'grow', text: title }),
    h('button', { class: 'icon-btn', title: 'New file', onclick: () => startCreate(false) }, icon('newFile')),
    h('button', { class: 'icon-btn', title: 'New folder', onclick: () => startCreate(true) }, icon('newFolder')),
    h('button', { class: 'icon-btn', title: 'Refresh', onclick: () => render() }, icon('refresh')));
  const el = h('div', { class: 'col', style: { flex: 1 } }, head, tree);

  async function renderDir(dir, depth, into) {
    let items;
    try { items = await api.fs.list(dir); } catch (e) { into.append(h('div', { class: 'row dim', style: { paddingLeft: 8 + depth * 12 + 'px' } }, h('span', { class: 'name', text: e.message }))); return; }
    for (const it of items) {
      const open = it.dir && expanded.has(it.path);
      const row = h('div', {
        class: 'row' + (open ? ' open' : '') + (it.ignored || it.name.startsWith('.') ? ' dim' : '') + (selected === it.path ? ' sel' : ''),
        style: { paddingLeft: 8 + depth * 12 + 'px', backgroundImage: guides(depth) }, title: it.path, draggable: it.dir ? 'false' : 'true',
      },
        h('span', { class: 'chev' }, it.dir ? icon('chevron') : null),
        it.dir ? icon(open ? 'folderOpen' : 'folder') : fileBadge(it.name),
        h('span', { class: 'name', text: it.name }));
      row.dataset.path = it.path;
      // Drag a file onto the chat box to give it to the AI.
      if (!it.dir) row.addEventListener('dragstart', e => { e.dataTransfer.setData('application/x-caret-path', it.path); e.dataTransfer.setData('text/plain', it.path); e.dataTransfer.effectAllowed = 'copy'; });
      row.dataset.dir = it.dir ? '1' : '';
      row.onclick = () => {
        selected = it.path;
        tree.querySelectorAll('.row.sel').forEach(r => r.classList.remove('sel'));
        row.classList.add('sel');
        if (it.dir) { expanded.has(it.path) ? expanded.delete(it.path) : expanded.add(it.path); render(); }
        else (onOpen || (p => emit('open-file', p)))(it.path);
      };
      row.oncontextmenu = e => { e.preventDefault(); selected = it.path; contextMenu(it, e); };
      into.append(row);
      if (open) await renderDir(it.path, depth + 1, into);
    }
  }

  let renderSeq = 0;
  async function render() {
    const seq = ++renderSeq;
    if (!state.workspace) {
      tree.replaceChildren(h('div', { class: 'tree-empty' },
        h('p', { text: 'You have not opened a folder yet.' }),
        h('button', { class: 'btn primary', onclick: () => emit('cmd', 'open-folder') }, icon('folderOpen'), 'Open Folder'),
        h('button', { class: 'btn', onclick: () => emit('cmd', 'clone') }, icon('git'), 'Clone Repository')));
      return;
    }
    head.querySelector('.grow').textContent = state.workspace.name;
    const frag = document.createDocumentFragment();
    await renderDir('.', 0, frag);
    if (seq !== renderSeq) return;
    const top = tree.scrollTop;
    tree.replaceChildren(frag);
    tree.scrollTop = top;
  }

  function targetDir() {
    if (!selected) return '.';
    const row = tree.querySelector(`.row[data-path="${CSS.escape(selected)}"]`);
    if (row?.dataset.dir) return selected;
    return selected.includes('/') ? selected.slice(0, selected.lastIndexOf('/')) : '.';
  }

  function inlineInput(depthDir, initial, done) {
    const input = h('input', { class: 'tree-input', value: initial || '' });
    const wrap = h('div', { class: 'row', style: { paddingLeft: '24px' } }, input);
    const anchor = depthDir === '.' ? null : tree.querySelector(`.row[data-path="${CSS.escape(depthDir)}"]`);
    if (anchor) anchor.after(wrap); else tree.prepend(wrap);
    input.focus(); input.select();
    let finished = false;
    const finish = ok => { if (finished) return; finished = true; const v = input.value.trim(); wrap.remove(); if (ok && v) done(v); };
    input.onkeydown = e => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); };
    input.onblur = () => finish(true);
  }

  function startCreate(isDir) {
    if (!state.workspace) return;
    const dir = targetDir();
    if (dir !== '.') expanded.add(dir);
    render().then(() => inlineInput(dir, '', async name => {
      if (/[\\:*?"<>|]/.test(name) || name.includes('..')) return toast('That name has characters that are not allowed', { error: true });
      const p = dir === '.' ? name : `${dir}/${name}`;
      try { await api.fs.create(p, isDir); selected = p; await render(); if (!isDir) emit('open-file', p); }
      catch (e) { toast(e.message, { error: true }); }
    }));
  }

  function contextMenu(it, e) {
    menu(null, [
      ...(!it.dir ? [{ label: 'Open', icon: 'files', onClick: () => emit('open-file', it.path) }] : []),
      { label: 'New file here', icon: 'newFile', onClick: () => startCreate(false) },
      { label: 'New folder here', icon: 'newFolder', onClick: () => startCreate(true) },
      'sep',
      { label: 'Add to chat', icon: 'chat', onClick: () => emit('attach-file', it.path) },
      { label: 'Copy path', icon: 'copy', onClick: () => navigator.clipboard.writeText(it.path) },
      { label: 'Reveal in file manager', icon: 'folderOpen', onClick: () => api.fs.reveal(it.path) },
      'sep',
      { label: 'Rename', icon: 'edit', onClick: () => {
        const dir = it.path.includes('/') ? it.path.slice(0, it.path.lastIndexOf('/')) : '.';
        const row = tree.querySelector(`.row[data-path="${CSS.escape(it.path)}"]`);
        row?.classList.add('hidden');
        inlineInput(it.path, it.name, async name => {
          try { const to = await api.fs.rename(it.path, dir === '.' ? name : `${dir}/${name}`); emit('file-renamed', { from: it.path, to }); render(); }
          catch (err) { toast(err.message, { error: true }); render(); }
        });
      } },
      { label: 'Move to recycle bin', icon: 'trash', onClick: async () => {
        try { await api.fs.remove(it.path); emit('file-deleted', it.path); render(); } catch (err) { toast(err.message, { error: true }); }
      } },
    ], { x: e.clientX, y: e.clientY });
  }

  on('workspace', () => { expanded.clear(); expanded.add('.'); selected = null; render(); });
  let t;
  on('fs-changed', () => { clearTimeout(t); t = setTimeout(render, 150); });
  render();
  return { el, render };
}
