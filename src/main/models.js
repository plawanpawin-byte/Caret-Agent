'use strict';
// Finds every model the user can actually use — nothing locked, nothing to
// upgrade — and ranks local models for the machine they run on.
//
// How a local model is chosen ("Auto"):
//   1. Discover: Ollama (/api/tags + /api/show for capabilities) and any
//      OpenAI-compatible local server (LM Studio, llama.cpp, Jan).
//   2. Drop models that cannot chat (embedding-only).
//   3. Measure the machine: RAM, and GPU memory (nvidia-smi, or unified
//      memory on Apple Silicon).
//   4. Score each model for the current mode:
//        fits in GPU memory  +6   | fits in RAM only  +2 | too big → hidden from Auto
//        supports tool calls +5 for Code/Agent (required to edit files)
//        larger parameter count gives better reasoning (log-scaled, capped)
//        coding-tuned name   +1.5 for Code/Agent
//        long context ≥32k   +0.5
//        vision              required only when an image is attached
//   5. Auto picks the top score. If no local model can use tools, Auto falls
//      back to a signed-in cloud agent (Claude or Codex) when one exists.
const os = require('os');
const { execFile, spawn } = require('child_process');
const settings = require('./settings');
const { resolveCli, findOllama } = require('./cli');

const OLLAMA = 'http://127.0.0.1:11434';

async function getJson(url, { timeout = 1500, headers = {}, method = 'GET', body } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined, signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

// ---------- hardware ----------
let hwCache = null;
async function hardware() {
  if (hwCache && Date.now() - hwCache.at < 60000) return hwCache;
  const ramGB = os.totalmem() / 1e9;
  let vramGB = 0, gpu = null;
  if (process.platform === 'darwin' && os.arch() === 'arm64') {
    vramGB = ramGB * 0.7; gpu = 'Apple Silicon (unified memory)';
  } else {
    await new Promise(res => execFile('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'], { timeout: 3000, windowsHide: true }, (err, out) => {
      if (!err && out) {
        for (const line of out.trim().split('\n')) {
          const [name, mem] = line.split(',').map(s => s.trim());
          const g = Number(mem) / 1024;
          if (g > vramGB) { vramGB = g; gpu = name; }
        }
      }
      res();
    }));
  }
  hwCache = { at: Date.now(), ramGB, vramGB, gpu, cpus: os.cpus().length };
  return hwCache;
}

// ---------- Ollama ----------
let ollamaStarting = null;
async function ensureOllama() {
  try { await getJson(OLLAMA + '/api/version', { timeout: 800 }); return true; } catch {}
  const bin = findOllama();
  if (!bin) return false;
  if (!ollamaStarting) {
    ollamaStarting = (async () => {
      const p = spawn(bin, ['serve'], { detached: true, stdio: 'ignore', windowsHide: true });
      p.unref();
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 500));
        try { await getJson(OLLAMA + '/api/version', { timeout: 500 }); return true; } catch {}
      }
      return false;
    })().finally(() => { setTimeout(() => { ollamaStarting = null; }, 5000); });
  }
  return ollamaStarting;
}

async function ollamaModels() {
  const ok = await ensureOllama();
  if (!ok) return { installed: !!findOllama(), running: false, models: [] };
  const tags = await getJson(OLLAMA + '/api/tags').catch(() => ({ models: [] }));
  const models = await Promise.all((tags.models || []).map(async m => {
    let caps = [], ctx = 0;
    try {
      const info = await getJson(OLLAMA + '/api/show', { method: 'POST', body: { model: m.name }, timeout: 4000 });
      caps = info.capabilities || [];
      for (const [k, v] of Object.entries(info.model_info || {})) if (k.endsWith('.context_length')) ctx = v;
    } catch {}
    const d = m.details || {};
    const embedOnly = caps.length ? !caps.includes('completion') : /embed/i.test(m.name);
    return {
      id: m.name, sizeGB: (m.size || 0) / 1e9, params: parseParams(d.parameter_size), family: d.family || '',
      tools: caps.includes('tools'), vision: caps.includes('vision'), thinking: caps.includes('thinking'), ctx, embedOnly,
    };
  }));
  return { installed: true, running: true, models: models.filter(m => !m.embedOnly) };
}

function parseParams(s) {
  const m = /([\d.]+)\s*([BM])/i.exec(s || '');
  if (!m) return 0;
  return m[2].toUpperCase() === 'M' ? Number(m[1]) / 1000 : Number(m[1]);
}

async function openaiCompatLocal(base) {
  try {
    const j = await getJson(base.replace(/\/$/, '') + '/models', { timeout: 700 });
    return (j.data || []).filter(m => !/embed/i.test(m.id)).map(m => ({ id: m.id, sizeGB: 0, params: guessParams(m.id), tools: true, vision: /vl|vision|llava/i.test(m.id), ctx: 0 }));
  } catch { return []; }
}
const guessParams = id => { const m = /(\d+(?:\.\d+)?)b\b/i.exec(id); return m ? Number(m[1]) : 0; };

// ---------- cloud ----------
// Each API belongs to a "family" in the AI list: Claude and Codex can be used as an app on this computer
// or through their company's API; Grok and Antigravity (Gemini) are API only.
const CLOUD_APIS = {
  anthropic: { name: 'Claude API', family: 'claude', base: 'https://api.anthropic.com/v1', filter: id => /claude/i.test(id),
    headers: key => ({ authorization: `Bearer ${key}`, 'x-api-key': key, 'anthropic-version': '2023-06-01' }) },
  openai: { name: 'OpenAI API', family: 'codex', base: 'https://api.openai.com/v1', filter: id => /^(gpt-|o\d|chatgpt)/i.test(id) && !/audio|realtime|image|tts|transcribe|search|instruct/i.test(id) },
  xai: { name: 'Grok', family: 'xai', base: 'https://api.x.ai/v1', filter: id => /grok/i.test(id) && !/image|imagine|vision-beta/i.test(id) },
  gemini: { name: 'Antigravity (Gemini)', family: 'gemini', base: 'https://generativelanguage.googleapis.com/v1beta/openai', filter: id => /^gemini-(3\.7|3\.8|4[-.]?argon|4[-.]?carbon)/i.test(id) && !/embed|image|tts|audio|live/i.test(id) },
  openrouter: { name: 'OpenRouter', family: 'openrouter', base: 'https://openrouter.ai/api/v1', filter: () => true,
    headers: key => ({ authorization: `Bearer ${key}`, 'x-title': 'Caret Agent' }) },
};
const apiHeaders = (provider, key) => (CLOUD_APIS[provider].headers ? CLOUD_APIS[provider].headers(key) : { authorization: `Bearer ${key}` });

// ---------- OpenRouter ----------
// OpenRouter has hundreds of models behind one key. The list is public (no key needed). 50 well-known, recent ones are
// featured; the person switches on the ones they want, and only those appear in the model menu.
const OR_VENDORS = ['anthropic', 'openai', 'google', 'x-ai', 'deepseek', 'meta-llama', 'mistralai', 'qwen', 'moonshotai', 'z-ai', 'cohere', 'nvidia', 'perplexity', 'amazon', 'microsoft', 'minimax'];
let orCache = null;
async function openrouterCatalog() {
  if (orCache && Date.now() - orCache.at < 60 * 60 * 1000) return orCache.value;
  const j = await getJson(CLOUD_APIS.openrouter.base + '/models', { timeout: 10000 });
  const all = (j.data || [])
    .filter(m => m && typeof m.id === 'string' && /^[\w.\-:/]{1,120}$/.test(m.id))
    .filter(m => !m.architecture || (Array.isArray(m.architecture.output_modalities) ? m.architecture.output_modalities.includes('text') && m.architecture.output_modalities.length === 1 : true))
    .filter(m => !/embed|moderation|guard|safety|:extended$|:online$|:nitro$|:floor$|:batch$/i.test(m.id))
    .map(m => ({ id: m.id, name: String(m.name || m.id).slice(0, 80), created: Number(m.created) || 0, ctx: Number(m.context_length) || 0,
      free: m.pricing && Number(m.pricing.prompt) === 0 && Number(m.pricing.completion) === 0 }));
  // Newest first, from the well-known makers, at most 4 per maker so one company cannot fill the list.
  const per = new Map();
  const featured = all.filter(m => OR_VENDORS.includes(m.id.split('/')[0]) && !m.free)
    .sort((a, b) => b.created - a.created)
    .filter(m => { const v = m.id.split('/')[0]; const n = per.get(v) || 0; if (n >= 4) return false; per.set(v, n + 1); return true; })
    .slice(0, 50);
  const value = { featured, all: all.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 600) };
  orCache = { at: Date.now(), value };
  return value;
}
const DEFAULT_OR_ON = 6;
async function openrouterEnabled() {
  const saved = settings.load().orModels;
  if (Array.isArray(saved)) return saved;
  try { return (await openrouterCatalog()).featured.slice(0, DEFAULT_OR_ON).map(m => m.id); } catch { return []; }
}

async function cloudApiModels(provider) {
  const key = settings.getKey(provider);
  if (!key) return null;
  if (provider === 'openrouter') {
    let names = new Map();
    try { for (const m of (await openrouterCatalog()).all) names.set(m.id, m.name); } catch {}
    return (await openrouterEnabled()).map(id => ({ id, label: names.get(id) || id }));
  }
  const cfg = CLOUD_APIS[provider];
  try {
    const j = await getJson(cfg.base + '/models' + (provider === 'anthropic' ? '?limit=100' : ''), { headers: apiHeaders(provider, key), timeout: 6000 });
    return (j.data || []).map(m => String(m.id).replace(/^models\//, '')).filter(cfg.filter).sort().reverse();
  } catch (e) { return { error: e.message }; }
}

// ---------- scoring ----------
function score(m, hw, mode, needVision) {
  const why = [];
  let s = 0;
  const need = m.sizeGB * 1.2;
  if (m.sizeGB) {
    if (hw.vramGB && need <= hw.vramGB) { s += 6; why.push('fits GPU'); }
    else if (need <= hw.ramGB * 0.6) { s += 2; why.push('runs on CPU (slower)'); }
    else return { score: -Infinity, why: ['too large for this computer'] };
  }
  if (mode !== 'plan') {
    if (m.tools) { s += 5; why.push('can edit files'); } else { s -= 8; why.push('cannot use tools'); }
  }
  if (m.params) { s += Math.min(6, Math.log2(m.params + 1) * 1.5); why.push(`${m.params}B`); }
  if (mode !== 'plan' && /coder|code|devstral|starcoder/i.test(m.id)) { s += 1.5; why.push('code-tuned'); }
  if (m.ctx >= 32768) s += 0.5;
  if (mode === 'plan' && m.thinking) { s += 1; why.push('reasons'); }
  if (needVision && !m.vision) return { score: -Infinity, why: ['cannot see images'] };
  return { score: s, why };
}

const LOCAL_MODELS = false;

// Models of the Claude Code and Codex apps, in the order they appear. Each one was run through the app and
// answered; models the app rejects ("not supported with a ChatGPT account") are left out. API lists come
// straight from the company's API, so only models that really exist for that key are shown.
const CURATED = {
  claude: [
    { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' }, { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' }, { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
    { id: 'claude-fable-5', label: 'Fable 5' }, { id: 'claude-fable-5-1', label: 'Fable 5.1' }, { id: 'claude-fable-5-2', label: 'Fable 5.2' },
  ],
  codex: [
    { id: 'gpt-6-astra', label: 'GPT 6 Astra' }, { id: 'gpt-6-sol', label: 'GPT 6 Sol' }, { id: 'gpt-6-luna', label: 'GPT 6 Luna' }, { id: 'gpt-5.6-sol', label: 'GPT 5.6 Sol' },
  ],
};
function curated(prov, list, defaultLabel) {
  const first = { id: 'default', key: `${prov}:default`, label: defaultLabel, tools: true, vision: true };
  return [first, ...list.map(m => ({ id: m.id, key: `${prov}:${m.id}`, label: m.label, tools: true, vision: true }))];
}

// Everything the model menu shows. Only usable models are listed.
async function catalog({ mode = 'code', needVision = false } = {}) {
  const hw = await hardware();
  const s = settings.load();
  // Models that run on this computer are switched off for now: small ones were too unreliable at editing code.
  const [ollama, lms, lcpp] = LOCAL_MODELS ? await Promise.all([
    ollamaModels(), openaiCompatLocal(s.endpoints.lmstudio), openaiCompatLocal(s.endpoints.llamacpp),
  ]) : [{ installed: false, running: false, models: [] }, [], []];
  const providers = [];
  const rank = (list, prov) => list.map(m => ({ ...m, provider: prov, key: `${prov}:${m.id}`, ...score(m, hw, mode, needVision) }))
    .sort((a, b) => b.score - a.score);

  if (LOCAL_MODELS) providers.push({ id: 'ollama', name: 'Local · Ollama', kind: 'local', installed: ollama.installed, running: ollama.running, models: rank(ollama.models, 'ollama') });
  if (lms.length) providers.push({ id: 'lmstudio', name: 'Local · LM Studio', kind: 'local', running: true, models: rank(lms, 'lmstudio') });
  if (lcpp.length) providers.push({ id: 'llamacpp', name: 'Local · llama.cpp', kind: 'local', running: true, models: rank(lcpp, 'llamacpp') });

  if (resolveCli('claude')) providers.push({ id: 'claude', family: 'claude', method: 'app', name: 'Claude Code', kind: 'cli', models: curated('claude', CURATED.claude, 'Claude (your default)') });
  if (resolveCli('codex')) providers.push({ id: 'codex', family: 'codex', method: 'app', name: 'Codex', kind: 'cli', models: curated('codex', CURATED.codex, 'Codex (your default)') });

  // Ask every service that has a key at the same time, so a slow one does not hold up the menu.
  const apiIds = Object.keys(CLOUD_APIS);
  const lists = await Promise.all(apiIds.map(p => cloudApiModels(p)));
  for (const [i, p] of apiIds.entries()) {
    const list = lists[i];
    if (list === null) continue;
    const base = { id: p, family: CLOUD_APIS[p].family, method: 'api', name: CLOUD_APIS[p].name, kind: 'api' };
    if (list.error) providers.push({ ...base, error: list.error, models: [] });
    else providers.push({ ...base, models: list.map(m => typeof m === 'string' ? { id: m, key: `${p}:${m}`, tools: true, vision: true } : { id: m.id, label: m.label, key: `${p}:${m.id}`, tools: true, vision: true }) });
  }

  const auto = pickAuto(providers, mode, needVision);
  return { hardware: hw, providers, auto };
}

function pickAuto(providers, mode, needVision) {
  const local = providers.filter(p => p.kind === 'local').flatMap(p => p.models).filter(m => m.score > -Infinity);
  local.sort((a, b) => b.score - a.score);
  const best = local[0];
  const usable = best && (mode === 'plan' || best.tools) && (!needVision || best.vision);
  if (usable) return { key: best.key, reason: `Best local model for this computer: ${best.why.join(' · ')}` };
  const cloud = providers.find(p => p.kind === 'cli' && p.models.length) || providers.find(p => p.kind === 'api' && p.models.length);
  if (cloud) return { key: cloud.models[0].key, reason: LOCAL_MODELS ? `No local model can ${needVision ? 'see images' : 'edit files'} — using ${cloud.name}` : `Uses ${cloud.name}` };
  if (best) return { key: best.key, reason: 'Only local model available (limited tools)' };
  return { key: null, reason: 'No AI is set up yet. Open the model menu to set up Claude, Codex, Grok or Antigravity.' };
}

module.exports = { catalog, hardware, ensureOllama, CLOUD_APIS, apiHeaders, OLLAMA, getJson, openrouterCatalog, openrouterEnabled };
