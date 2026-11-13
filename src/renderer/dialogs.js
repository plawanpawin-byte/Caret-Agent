// First-run setup, Settings and the Clone dialog.
import { h, icon, logo, toast } from './ui.js';
import { brand } from './brands.js';
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

// First launch: one way in, GitHub. "Log In" opens the Carnet website in the browser, where the person picks
// "Continue as <name>", "Use another account" or signs in for the first time; the app is signed in when they finish.
export function loginGate() {
  return new Promise(resolve => {
    const status = h('div', { class: 'login-status muted' });
    const btn = h('button', { class: 'login-btn', text: 'Log In' });
    const cancel = h('button', { class: 'login-cancel hidden', text: 'Cancel' });
    const box = h('div', { class: 'login' },
      h('div', { class: 'login-logo' }, logo(88)),
      h('div', { class: 'login-name', text: 'CARET AGENT' }),
      h('div', { class: 'login-tag', text: 'The free IDE. No subscription.' }),
      btn, h('p', { class: 'login-note', text: 'You sign in on the website with GitHub.' }), status, cancel);
    const o = overlay(box, { dismiss: false });
    btn.onclick = async () => {
      btn.disabled = true; cancel.classList.remove('hidden');
      status.textContent = 'Finish signing in in your browser…'; status.classList.remove('err');
      try {
        const a = await api.auth.signIn();
        state.settings = await api.settings.get();
        o.remove(); resolve(a);
      } catch (e) {
        btn.disabled = false; cancel.classList.add('hidden');
        status.textContent = String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') || 'Sign-in did not finish.';
        status.classList.add('err');
      }
    };
    cancel.onclick = () => api.auth.cancel();
  });
}

export function onboarding() {
  return new Promise(resolve => {
    const data = { name: state.settings.name || state.info?.user || '', role: state.settings.role || '', layout: state.settings.layout || 'studio' };
    let step = 0;
    const box = h('div', { class: 'modal onboard' });
    const o = overlay(box, { dismiss: false });

    // Saves the answers and closes the dialog; with openModels, the Models page opens right after.
    async function finish(openModels) {
      await saveSettings({ name: data.name.trim().slice(0, 60), role: data.role, layout: data.layout, onboarded: true });
      o.remove(); resolve();
      if (openModels) emit('cmd', 'providers');
    }

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
              h('div', { class: 't', text: 'IDE' }), h('div', { class: 'd', text: 'A code editor with files, a terminal and the AI side by side.' })),
            h('button', { class: 'layout-card' + (data.layout === 'agent' ? ' on' : ''), onclick: () => { data.layout = 'agent'; render(); } }, miniAgent(),
              h('div', { class: 't', text: 'Agent' }), h('div', { class: 'd', text: 'Chat first. Describe what you want and watch the AI build it.' }))));
      } else {
        const list = h('div', { class: 'model-list' }, h('div', { class: 'muted', text: 'Checking what is set up…' }));
        body = h('div', { class: 'body' },
          h('h1', { text: 'Your AI' }),
          h('p', { class: 'lead', text: 'Caret Agent works through the AI accounts you already have. The app itself is free.' }),
          list);
        refreshCatalog({ mode: 'code' }).then(cat => renderModels(list, cat, () => finish(true)));
      }
      const foot = h('div', { class: 'foot' },
        step > 0 ? h('button', { class: 'btn ghost', onclick: () => { step--; render(); } }, 'Back') : h('span'),
        h('button', { class: 'btn primary', disabled: !canNext, onclick: async () => {
          if (step < 2) { step++; render(); return; }
          await finish(false);
        } }, step < 2 ? 'Continue' : 'Start building'));
      box.replaceChildren(steps, body, foot);
    }
    render();
  });
}

function renderModels(list, cat, onSetup) {
  if (!cat) { list.replaceChildren(h('div', { class: 'muted', text: 'Could not check for models.' })); return; }
  const hw = cat.hardware;
  const rows = [];
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
      rows.push(h('div', { class: 'model-line' }, brand(p.id, 30), h('span', { class: 'grow' }, h('div', { class: 'n', text: p.name }), h('div', { class: 's', text: 'Found on this computer — uses your own sign-in' })), h('span', { class: 'status-ok', text: 'Ready' })));
    }
  }
  if (!rows.length) rows.push(h('div', { class: 'model-line' }, icon('alert'), h('span', { class: 'grow' }, h('div', { class: 'n', text: 'No AI found yet' }), h('div', { class: 's', text: 'Set up Claude, Codex, Grok or Antigravity from the model menu after setup.' }))));
  rows.push(h('div', { class: 'muted', style: { fontSize: '12px', marginTop: '4px' }, text: cat.auto.key ? `Auto will use ${(cat.providers.find(p => p.id === cat.auto.key.split(':')[0]) || {}).name || cat.auto.key}.` : cat.auto.reason }));
  rows.push(h('div', { class: 'muted', style: { fontSize: '12px' }, text: 'Set up Claude, Codex, Grok or Antigravity any time from the model menu in the prompt bar.' }));
  if (onSetup) rows.push(h('div', { style: { marginTop: '8px' } }, h('button', { class: 'btn', onclick: onSetup }, icon('key'), 'Set up an AI')));
  list.replaceChildren(...rows);
}

// A round profile picture: the GitHub avatar when we have it, otherwise the first letter of the name.
export function avatarEl(size = 28) {
  const a = state.settings?.account;
  const nm = a?.login || state.settings?.name || '?';
  const el = a?.avatar ? h('img', { class: 'avatar', src: a.avatar, alt: '' }) : h('span', { class: 'avatar ph', text: nm.slice(0, 1).toUpperCase() });
  el.style.width = el.style.height = size + 'px';
  if (!a?.avatar) el.style.fontSize = Math.round(size * .45) + 'px';
  return el;
}

// Settings: a list of sections on the left, the chosen one on the right.
export function openSettings(section) {
  const box = h('div', { class: 'modal settings' });
  const o = overlay(box);
  let page = section === 'models' || section === 'model' ? 'model' : section === 'customize' ? 'customize' : 'account';
  const content = h('div', { class: 'set-content' });
  const SECTIONS = [['account', 'Account', 'user'], ['model', 'Model', 'sparkle'], ['customize', 'Customize', 'wand']];
  const navBtns = {};
  const nav = h('nav', { class: 'set-nav' });
  const row = (label, hint, control) => h('div', { class: 'set-row' }, h('div', { class: 'set-l' }, h('div', { text: label }), hint ? h('small', { text: hint }) : null), h('div', { class: 'set-r' }, control));

  // ----- Account -----
  function account() {
    const s = state.settings;
    const name = h('input', { class: 'field', value: s.name || '', maxlength: 60 });
    const role = h('select', { class: 'field' }, ...ROLES.map(([t]) => h('option', { value: t, selected: s.role === t }, t)));
    const layout = h('select', { class: 'field' }, h('option', { value: 'studio', selected: s.layout === 'studio' }, 'IDE (code editor)'), h('option', { value: 'agent', selected: s.layout === 'agent' }, 'Agent (desktop agent)'));
    const save = h('button', { class: 'btn primary', text: 'Save', onclick: async () => {
      await saveSettings({ name: name.value.trim(), role: role.value, layout: layout.value });
      emit('cmd', { layout: layout.value });
      toast('Saved');
    } });
    return [
      h('h2', { text: 'Profile' }),
      row('Profile photo', 'Your GitHub picture', avatarEl(44)),
      row('GitHub account', 'You signed in with this', h('span', { class: 'set-val', text: s.account?.login || 'Not signed in' })),
      row('Full name', null, name),
      row('What best describes your work?', null, role),
      row('Default view', 'Which layout opens first', layout),
      h('div', { class: 'set-actions' }, save,
        s.account ? h('button', { class: 'btn ghost', text: 'Log out', onclick: async () => { o.remove(); await api.auth.signOut(); location.reload(); } }) : null),
    ];
  }

  // ----- Model: 50 OpenRouter models, each with a switch. Switched-on ones appear in the model menu. -----
  function model() {
    const list = h('div', { class: 'mdl-list' });
    const search = h('input', { class: 'mdl-search', placeholder: 'Add or search model', spellcheck: 'false' });
    const note = h('div', { class: 'muted mdl-note' });
    let data = null, enabled = new Set();
    const keyOn = () => !!state.settings.keysSet?.openrouter;

    async function persist() {
      await saveSettings({ orModels: [...enabled] });
      refreshCatalog({ mode: state.settings.mode }).catch(() => {});
    }
    function draw() {
      if (!data) return;
      const q = search.value.trim().toLowerCase();
      const byId = new Map([...data.featured, ...data.all].map(m => [m.id, m]));
      for (const id of enabled) if (!byId.has(id)) byId.set(id, { id, name: id });
      let rows;
      if (q) rows = [...byId.values()].filter(m => (m.name + ' ' + m.id).toLowerCase().includes(q)).slice(0, 60);
      else rows = [...data.featured, ...[...enabled].filter(id => !data.featured.some(f => f.id === id)).map(id => byId.get(id))];
      const els = rows.map(m => h('label', { class: 'mdl-row' },
        h('span', { class: 'mdl-name', title: m.id }, m.name.replace(/^[^:]+:\s*/, ''), h('small', { text: m.id })),
        h('span', { class: 'switch' + (enabled.has(m.id) ? ' on' : '') }, h('input', { type: 'checkbox', checked: enabled.has(m.id), onchange: e => { e.target.checked ? enabled.add(m.id) : enabled.delete(m.id); e.target.parentNode.classList.toggle('on', e.target.checked); persist(); } }), h('i'))));
      if (q && /^[\w.-]+\/[\w.:-]+$/.test(search.value.trim()) && !byId.has(search.value.trim())) {
        const id = search.value.trim();
        els.unshift(h('button', { class: 'mdl-add', onclick: () => { enabled.add(id); persist(); search.value = ''; draw(); } }, icon('plus'), `Add ${id}`));
      }
      list.replaceChildren(...(els.length ? els : [h('div', { class: 'muted', style: { padding: '14px 4px' }, text: 'No model matches.' })]));
      note.replaceChildren(keyOn() ? h('span', { text: `${enabled.size} model${enabled.size === 1 ? '' : 's'} on. They appear in the model menu.` })
        : h('span', {}, 'These run through OpenRouter. ', h('button', { class: 'link', text: 'Add your OpenRouter key', onclick: () => { o.remove(); emit('cmd', { providers: 'openrouter' }); } }), ' to use them.'));
    }
    async function load(force) {
      list.replaceChildren(h('div', { class: 'muted', style: { padding: '14px 4px' }, text: 'Loading models…' }));
      try { data = await api.models.openrouter(); enabled = new Set(data.enabled); draw(); }
      catch { list.replaceChildren(h('div', { class: 'muted', style: { padding: '14px 4px' }, text: 'Could not load the model list. Check your internet connection.' })); }
    }
    search.oninput = draw;
    load();
    return [
      h('h2', { text: 'Model' }),
      h('p', { class: 'muted set-lead', text: 'Choose which OpenRouter models show up in the model menu. One key gives you all of them. Claude and Codex run on your own sign-in, and Grok and Gemini use their own keys, all set up under "Models and API keys".' }),
      h('div', { class: 'mdl-bar' }, search, h('button', { class: 'icon-btn', title: 'Refresh', onclick: () => load(true) }, icon('refresh'))),
      list, note,
      h('div', { class: 'set-actions' }, h('button', { class: 'btn', onclick: () => { o.remove(); emit('cmd', 'providers'); } }, icon('key'), 'Models and API keys')),
    ];
  }

  // ----- Customize -----
  function customize() {
    return [
      h('h2', { text: 'Customize' }),
      row('Design guide', '.caret/DESIGN.md', h('div', {}, h('div', { class: 'muted', style: { marginBottom: '8px' }, text: 'Every AI reads this before building an interface: colours, spacing, what to avoid. Edit it to match your taste.' }),
        h('button', { class: 'btn', disabled: !state.workspace, onclick: () => { o.remove(); emit('open-file', '.caret/DESIGN.md'); } }, 'Edit design guide'))),
      row('Project memory', '.caret/HANDOFF.md', h('div', {}, h('div', { class: 'muted', style: { marginBottom: '8px' }, text: 'Where AIs record progress so a different AI can continue the work.' }),
        h('button', { class: 'btn', disabled: !state.workspace, onclick: () => { o.remove(); emit('open-file', '.caret/HANDOFF.md'); } }, 'Open project memory'))),
      h('div', { class: 'muted', style: { fontSize: '12px', marginTop: '18px' }, text: `Caret Agent ${state.info?.version || ''} · free and open source` }),
    ];
  }

  function show(p) {
    page = p;
    for (const [id, btn] of Object.entries(navBtns)) btn.classList.toggle('on', id === p);
    content.replaceChildren(...(p === 'model' ? model() : p === 'customize' ? customize() : account()));
    content.scrollTop = 0;
  }
  for (const [id, label, ic] of SECTIONS) { navBtns[id] = h('button', { class: 'set-nav-item', onclick: () => show(id) }, icon(ic), label); nav.append(navBtns[id]); }
  box.append(h('div', { class: 'set-head' }, h('h1', { text: 'Settings' }), h('button', { class: 'icon-btn', title: 'Close', onclick: () => o.remove() }, icon('x'))),
    h('div', { class: 'set-body' }, nav, content));
  show(page);
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
