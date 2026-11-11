// First-run setup, Settings and the Clone dialog.
import { h, icon, logo, toast } from './ui.js';
import { api, state, emit, saveSettings, refreshCatalog } from './state.js';

const ROLES = [
  ['Software engineer', 'I write and ship code for a living'],
  ['Vibe coder', 'I describe what I want and let AI build it'],
  ['Designer', 'I care about how things look and feel'],
  ['Student', 'I am learning to code'],
  ['Data / ML', 'Notebooks, data and models'],
  ['Founder / PM', 'I build products and prototypes'],
  ['Game developer', 'Roblox, Unity, Godot and more'],
  ['Just exploring', 'Show me around'],
];

function overlay(content, { dismiss = true } = {}) {
  const o = h('div', { class: 'overlay' }, content);
  if (dismiss) {
    o.addEventListener('mousedown', e => { if (e.target === o) o.remove(); });
    const esc = e => { if (e.key === 'Escape') { o.remove(); document.removeEventListener('keydown', esc); } };
    document.addEventListener('keydown', esc);
  }
  document.body.append(o);
  return o;
}

function miniStudio() { return h('div', { class: 'mini' }, h('i', { style: { width: '8%' } }), h('i', { style: { width: '20%' } }), h('div', { style: { flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' } }, h('i', { style: { flex: 3 } }), h('i', { style: { flex: 1 } })), h('i', { style: { width: '26%', background: '#3a2f1e' } })); }
function miniAgent() { return h('div', { class: 'mini' }, h('i', { style: { width: '22%' } }), h('div', { style: { flex: 1, display: 'grid', placeItems: 'center' } }, h('i', { style: { width: '80%', height: '22%', background: '#3a2f1e' } })), h('i', { style: { width: '20%' } })); }

export function onboarding() {
  return new Promise(resolve => {
    const data = { name: state.settings.name || state.info?.user || '', role: state.settings.role || '', layout: state.settings.layout || 'studio' };
    let step = 0;
    const box = h('div', { class: 'modal onboard' });
    const o = overlay(box, { dismiss: false });

    function render() {
      const steps = h('div', { class: 'steps' }, ...[0, 1, 2].map(i => h('i', { class: i <= step ? 'on' : '' })));
      let body, canNext = true;
      if (step === 0) {
        const name = h('input', { class: 'field', value: data.name, maxlength: 60, placeholder: 'Your name', oninput: e => { data.name = e.target.value; } });
        body = h('div', { class: 'body' },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' } }, logo(28), h('strong', { text: 'Caret Agent' })),
          h('h1', { text: 'Welcome. What do you do?' }),
          h('p', { class: 'lead', text: 'This sets sensible defaults. You can change everything later.' }),
          h('label', { class: 'muted', style: { display: 'block', marginBottom: '6px' }, text: 'What should we call you?' }), name,
          h('div', { style: { height: '16px' } }),
          h('div', { class: 'choices' }, ...ROLES.map(([t, d]) => h('button', { class: 'choice' + (data.role === t ? ' on' : ''), onclick: () => { data.role = t; if (t === 'Vibe coder' || t === 'Founder / PM' || t === 'Just exploring') data.layout = 'agent'; else data.layout = 'studio'; render(); } },
            h('span', {}, h('div', { class: 't', text: t }), h('div', { class: 'd', text: d }))))));
        canNext = !!data.role;
        setTimeout(() => name.focus());
      } else if (step === 1) {
        body = h('div', { class: 'body' },
          h('h1', { text: 'Pick your default view' }),
          h('p', { class: 'lead', text: 'Switch any time from the top bar.' }),
          h('div', { class: 'layout-cards' },
            h('button', { class: 'layout-card' + (data.layout === 'studio' ? ' on' : ''), onclick: () => { data.layout = 'studio'; render(); } }, miniStudio(),
              h('div', { class: 't', text: 'Studio' }), h('div', { class: 'd', text: 'A full code editor like VS Code, with files, terminal and AI chat side by side.' })),
            h('button', { class: 'layout-card' + (data.layout === 'agent' ? ' on' : ''), onclick: () => { data.layout = 'agent'; render(); } }, miniAgent(),
              h('div', { class: 't', text: 'Agent' }), h('div', { class: 'd', text: 'Chat first. Describe what you want and watch the AI build it.' }))));
      } else {
        const list = h('div', { class: 'model-list' }, h('div', { class: 'muted', text: 'Looking for AI on this computer…' }));
        body = h('div', { class: 'body' },
          h('h1', { text: 'Your AI, free' }),
          h('p', { class: 'lead', text: 'Caret Agent uses models already on this computer, plus any AI you are signed in to. Nothing to buy, nothing to upgrade.' }),
          list);
        refreshCatalog({ mode: 'code' }).then(cat => renderModels(list, cat));
      }
      const foot = h('div', { class: 'foot' },
        step > 0 ? h('button', { class: 'btn ghost', onclick: () => { step--; render(); } }, 'Back') : h('span'),
        h('button', { class: 'btn primary', disabled: !canNext, onclick: async () => {
          if (step < 2) { step++; render(); return; }
          await saveSettings({ name: data.name.trim().slice(0, 60), role: data.role, layout: data.layout, onboarded: true });
          o.remove(); resolve();
        } }, step < 2 ? 'Continue' : 'Start building'));
      box.replaceChildren(steps, body, foot);
    }
    render();
  });
}

function renderModels(list, cat) {
  if (!cat) { list.replaceChildren(h('div', { class: 'muted', text: 'Could not check for models.' })); return; }
  const hw = cat.hardware;
  const rows = [h('div', { class: 'model-line' }, icon('laptop'), h('span', { class: 'grow' },
    h('div', { class: 'n', text: 'This computer' }),
    h('div', { class: 's', text: `${Math.round(hw.ramGB)} GB memory${hw.gpu ? ` · ${hw.gpu}${hw.vramGB ? ` (${Math.round(hw.vramGB)} GB)` : ''}` : ' · no dedicated GPU found'}` })))];
  for (const p of cat.providers) {
    if (p.kind === 'local') {
      if (p.id === 'ollama' && !p.models.length) {
        rows.push(h('div', { class: 'model-line' }, icon('alert'), h('span', { class: 'grow' }, h('div', { class: 'n', text: 'Local models (Ollama)' }),
          h('div', { class: 's', text: p.installed ? 'Installed, but no chat models yet. Run "ollama pull qwen3:8b" later in the terminal.' : 'Not installed. Install Ollama (free) to run AI fully offline.' })),
          !p.installed ? h('button', { class: 'btn', onclick: () => api.app.openExternal('https://ollama.com/download') }, 'Get Ollama') : null));
        continue;
      }
      const best = p.models[0];
      rows.push(h('div', { class: 'model-line' }, icon('laptop'), h('span', { class: 'grow' },
        h('div', { class: 'n', text: `${p.name} — ${p.models.length} model${p.models.length > 1 ? 's' : ''}` }),
        h('div', { class: 's', text: best ? `Best fit: ${best.id} (${(best.why || []).join(' · ')})` : '' })), h('span', { class: 'status-ok', text: 'Ready' })));
    } else if (p.kind === 'cli') {
      rows.push(h('div', { class: 'model-line' }, icon('cloud'), h('span', { class: 'grow' }, h('div', { class: 'n', text: p.name }), h('div', { class: 's', text: 'Found on this computer — uses your own sign-in' })), h('span', { class: 'status-ok', text: 'Ready' })));
    }
  }
  rows.push(h('div', { class: 'muted', style: { fontSize: '12px', marginTop: '4px' }, text: `Auto will use: ${cat.auto.key ? cat.auto.key.split(':').slice(1).join(':') : 'nothing yet'}. ${cat.auto.reason}` }));
  rows.push(h('div', { class: 'muted', style: { fontSize: '12px' }, text: 'Grok, Gemini and ChatGPT can be connected with your own key in Settings.' }));
  list.replaceChildren(...rows);
}

export function openSettings(section) {
  const box = h('div', { class: 'modal' });
  const o = overlay(box);
  const s = state.settings;

  const name = h('input', { class: 'field', value: s.name || '', maxlength: 60 });
  const role = h('select', { class: 'field' }, ...ROLES.map(([t]) => h('option', { value: t, selected: s.role === t }, t)));
  const layout = h('select', { class: 'field' }, h('option', { value: 'studio', selected: s.layout === 'studio' }, 'Studio (code editor)'), h('option', { value: 'agent', selected: s.layout === 'agent' }, 'Agent (chat first)'));

  const keyRow = (id, label, hint, url) => {
    const input = h('input', { class: 'field', type: 'password', placeholder: s.keysSet?.[id] ? 'Saved — paste a new key to replace' : 'Paste your API key', autocomplete: 'off', spellcheck: 'false' });
    const st = h('div', { class: s.keysSet?.[id] ? 'status-ok' : 'muted', style: { fontSize: '12px', marginTop: '4px' }, text: s.keysSet?.[id] ? 'Connected' : 'Not connected' });
    return h('div', { class: 'setting' },
      h('div', { class: 'l' }, label, h('small', { text: hint })),
      h('div', {},
        h('div', { class: 'key-row' }, input,
          h('button', { class: 'btn', onclick: async () => {
            try { state.settings = await api.settings.setKey(id, input.value.trim()); input.value = ''; st.textContent = 'Connected'; st.className = 'status-ok'; toast(`${label} connected`); refreshCatalog(); }
            catch (e) { toast(e.message, { error: true }); }
          } }, 'Save'),
          s.keysSet?.[id] ? h('button', { class: 'btn ghost danger', onclick: async () => { state.settings = await api.settings.setKey(id, ''); st.textContent = 'Not connected'; st.className = 'muted'; refreshCatalog(); } }, 'Remove') : null),
        st,
        h('a', { href: '#', 'data-href': url, style: { fontSize: '12px' }, class: 'md', text: 'Where do I get a key?' })));
  };

  const body = h('div', { class: 'modal-body' },
    h('div', { class: 'section-title', text: 'You' }),
    h('div', { class: 'setting' }, h('div', { class: 'l', text: 'Name' }), name),
    h('div', { class: 'setting' }, h('div', { class: 'l', text: 'Role' }), role),
    h('div', { class: 'setting' }, h('div', { class: 'l' }, 'Default view', h('small', { text: 'Which layout opens first' })), layout),
    h('div', { class: 'section-title', id: 'models-section', text: 'AI connections' }),
    h('div', { class: 'setting' }, h('div', { class: 'l' }, 'AI providers', h('small', { text: 'Install, sign in, connect' })),
      h('div', {}, h('div', { class: 'muted', style: { marginBottom: '8px' }, text: 'Install Claude Code or Codex with one click, sign in, or connect an API key.' }),
        h('button', { class: 'btn', onclick: () => { o.remove(); emit('cmd', 'providers'); } }, icon('extensions'), 'Open AI providers'))),
    h('div', { class: 'setting' }, h('div', { class: 'l' }, 'Local models', h('small', { text: 'Ollama, LM Studio, llama.cpp' })),
      h('div', { class: 'muted', text: 'Found automatically. Models you install appear in the model menu — no setup.' })),
    h('div', { class: 'setting' }, h('div', { class: 'l' }, 'Claude and Codex', h('small', { text: 'Uses your own sign-in' })),
      h('div', { class: 'muted', text: 'Install Claude Code or Codex and sign in once in the terminal ("claude" or "codex"). Caret Agent picks them up automatically.' })),
    keyRow('xai', 'Grok', 'xAI API key', 'https://console.x.ai'),
    keyRow('gemini', 'Gemini (Antigravity)', 'Google AI Studio key', 'https://aistudio.google.com/apikey'),
    keyRow('openai', 'ChatGPT (API)', 'OpenAI API key', 'https://platform.openai.com/api-keys'),
    h('div', { class: 'section-title', text: 'Project' }),
    h('div', { class: 'setting' }, h('div', { class: 'l' }, 'Design guide', h('small', { text: '.caret/DESIGN.md' })),
      h('div', {}, h('div', { class: 'muted', style: { marginBottom: '8px' }, text: 'Every AI reads this before building an interface — colours, spacing, what to avoid. Edit it to match your taste.' }),
        h('button', { class: 'btn', disabled: !state.workspace, onclick: () => { o.remove(); emit('open-file', '.caret/DESIGN.md'); } }, 'Edit design guide'))),
    h('div', { class: 'setting' }, h('div', { class: 'l' }, 'Project memory', h('small', { text: '.caret/HANDOFF.md' })),
      h('div', {}, h('div', { class: 'muted', style: { marginBottom: '8px' }, text: 'Where AIs record progress so a different AI can continue the work.' }),
        h('button', { class: 'btn', disabled: !state.workspace, onclick: () => { o.remove(); emit('open-file', '.caret/HANDOFF.md'); } }, 'Open project memory'))),
    h('div', { class: 'muted', style: { fontSize: '12px', marginTop: '16px' }, text: `Caret Agent ${state.info?.version || ''} · free and open source` }));

  box.append(
    h('div', { class: 'modal-head' }, icon('settings'), h('h2', { text: 'Settings' }), h('button', { class: 'icon-btn', onclick: () => o.remove() }, icon('x'))),
    body,
    h('div', { class: 'modal-foot' },
      h('button', { class: 'btn ghost', onclick: () => o.remove() }, 'Cancel'),
      h('button', { class: 'btn primary', onclick: async () => {
        await saveSettings({ name: name.value.trim(), role: role.value, layout: layout.value });
        emit('cmd', { layout: layout.value });
        o.remove();
      } }, 'Save')));
  if (section === 'models') setTimeout(() => body.querySelector('#models-section')?.scrollIntoView());
}

export function cloneDialog() {
  const input = h('input', { class: 'field', placeholder: 'https://github.com/owner/repo', spellcheck: 'false' });
  const err = h('div', { class: 'muted', style: { fontSize: '12px', marginTop: '8px', minHeight: '18px' } });
  const go = h('button', { class: 'btn primary' }, 'Choose folder and clone');
  const box = h('div', { class: 'modal', style: { width: 'min(520px, 100%)' } },
    h('div', { class: 'modal-head' }, icon('git'), h('h2', { text: 'Clone Repository' })),
    h('div', { class: 'modal-body' }, h('label', { class: 'muted', style: { display: 'block', marginBottom: '6px' }, text: 'Repository address' }), input, err),
    h('div', { class: 'modal-foot' }, h('button', { class: 'btn ghost', onclick: () => o.remove() }, 'Cancel'), go));
  const o = overlay(box);
  setTimeout(() => input.focus());
  const run = async () => {
    const url = input.value.trim();
    if (!url) return;
    go.disabled = true; err.textContent = 'Cloning…'; err.style.color = '';
    try {
      const ws = await api.workspace.clone(url);
      if (ws) { o.remove(); emit('workspace-opened', ws); } else { go.disabled = false; err.textContent = ''; }
    } catch (e) { go.disabled = false; err.textContent = e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); err.style.color = 'var(--danger)'; }
  };
  go.onclick = run;
  input.onkeydown = e => { if (e.key === 'Enter') run(); };
}
