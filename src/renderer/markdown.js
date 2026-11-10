// Minimal, safe Markdown → HTML. Everything is escaped first; only the
// tags produced here can appear. Links open in the system browser.
import { escapeHtml as esc } from './ui.js';

function inline(s) {
  // s is already escaped
  const codes = [];
  s = s.replace(/`([^`\n]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>');
  s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, t, u) => `<a href="#" data-href="${u}">${t}</a>`);
  s = s.replace(/(^|\s)(https?:\/\/[^\s<]+[^\s<.,)])/g, (_, p, u) => `${p}<a href="#" data-href="${u}">${u}</a>`);
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[Number(i)]}</code>`);
  return s;
}

export function renderMarkdown(src) {
  const out = [];
  const lines = String(src || '').replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  let para = [];
  const flush = () => { if (para.length) { out.push(`<p>${inline(esc(para.join('\n'))).replace(/\n/g, '<br>')}</p>`); para = []; } };
  while (i < lines.length) {
    const line = lines[i];
    const fence = /^\s*```\s*([\w+-]*)/.exec(line);
    if (fence) {
      flush();
      const body = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
      i++;
      out.push(`<pre data-lang="${esc(fence[1] || '')}"><code>${esc(body.join('\n'))}</code></pre>`);
      continue;
    }
    const hd = /^(#{1,4})\s+(.*)$/.exec(line);
    if (hd) { flush(); const n = Math.min(3, hd[1].length); out.push(`<h${n}>${inline(esc(hd[2]))}</h${n}>`); i++; continue; }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      flush();
      const ordered = /^\s*\d/.test(line);
      const items = [];
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*+]|\d+[.)])\s+/, ''));
        i++;
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) items[items.length - 1] += ' ' + lines[i++].trim();
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map(t => `<li>${inline(esc(t)).replace(/^\[ \]\s*/, '☐ ').replace(/^\[x\]\s*/i, '☑ ')}</li>`).join('')}</${tag}>`);
      continue;
    }
    if (/^>\s?/.test(line)) {
      flush();
      const q = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote>${inline(esc(q.join('\n'))).replace(/\n/g, '<br>')}</blockquote>`);
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      flush();
      const row = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => inline(esc(c.trim())));
      const head = row(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(row(lines[i++]));
      out.push(`<table><tr>${head.map(c => `<th>${c}</th>`).join('')}</tr>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</table>`);
      continue;
    }
    if (!line.trim()) { flush(); i++; continue; }
    para.push(line);
    i++;
  }
  flush();
  return out.join('');
}

export function mountMarkdown(el, src) {
  el.innerHTML = renderMarkdown(src);
  for (const pre of el.querySelectorAll('pre')) {
    const b = document.createElement('button');
    b.className = 'btn ghost copy';
    b.textContent = 'Copy';
    b.style.height = '22px'; b.style.fontSize = '11px';
    b.onclick = () => { navigator.clipboard.writeText(pre.querySelector('code').textContent); b.textContent = 'Copied'; setTimeout(() => (b.textContent = 'Copy'), 1200); };
    pre.append(b);
  }
}

document.addEventListener('click', e => {
  const a = e.target.closest('a[data-href]');
  if (!a) return;
  e.preventDefault();
  window.caret.app.openExternal(a.dataset.href);
});
