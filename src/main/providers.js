'use strict';
// The AI providers Caret Agent can use, shown in the "AI" panel: what is
// installed, what is signed in, and a one-click install for the two command-line
// agents. Install commands are fixed here — the page can only pick an id.
const { spawn, execFile } = require('child_process');
const cli = require('./cli');
const settings = require('./settings');
const models = require('./models');

// One entry per AI "family". Claude and Codex can be used as an app on this computer (bin, pkg) or through the
// company's API (apiId); Grok and Antigravity (Gemini) are API only.
const CATALOG = [
  { id: 'claude', name: 'Claude', by: 'Anthropic', blurb: 'Use the Claude app on this computer, or your own API key.',
    bin: 'claude', pkg: '@anthropic-ai/claude-code', login: ['auth', 'login'], statusArgs: ['auth', 'status'], site: 'https://claude.com/claude-code',
    apiId: 'anthropic', keyUrl: 'https://console.anthropic.com/settings/keys', keyHint: 'sk-ant-…' },
  { id: 'codex', name: 'Codex', by: 'OpenAI', blurb: 'Use the Codex app on this computer, or your own OpenAI API key.',
    bin: 'codex', pkg: '@openai/codex', login: ['login'], statusArgs: ['login', 'status'], site: 'https://developers.openai.com/codex',
    apiId: 'openai', keyUrl: 'https://platform.openai.com/api-keys', keyHint: 'sk-…' },
  { id: 'xai', name: 'Grok', by: 'xAI', blurb: 'Grok models with an xAI API key.', apiId: 'xai', keyUrl: 'https://console.x.ai', keyHint: 'xai-…' },
  { id: 'openrouter', name: 'OpenRouter', by: 'OpenRouter', blurb: 'Hundreds of models with one key. Switch on the ones you want in Settings, Model.', apiId: 'openrouter', keyUrl: 'https://openrouter.ai/keys', keyHint: 'sk-or-…' },
  { id: 'gemini', name: 'Antigravity', by: 'Google', blurb: 'Gemini models with a Google AI Studio key.', apiId: 'gemini', keyUrl: 'https://aistudio.google.com/apikey', keyHint: 'AIza…' },
];

const busy = new Set();
const find = id => CATALOG.find(p => p.id === id);

function run(file, args, timeoutMs = 8000) {
  return new Promise(resolve => {
    try {
      execFile(file, args, { timeout: timeoutMs, windowsHide: true, env: process.env }, (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout || '') + String(stderr || '') }));
    } catch (e) { resolve({ ok: false, out: e.message }); }
  });
}

async function cliStatus(p) {
  const r = cli.resolveCli(p.bin);
  if (!r) return { installed: false, signedIn: false };
  const res = await run(r.cmd, [...r.args, ...p.statusArgs]);
  let signedIn = false;
  if (p.id === 'claude') { try { signedIn = !!JSON.parse(res.out).loggedIn; } catch { signedIn = false; } }
  else signedIn = res.ok && /logged in/i.test(res.out) && !/not logged in/i.test(res.out);
  return { installed: true, signedIn };
}

async function status() {
  const keysSet = settings.publicView().keysSet || {};
  const out = [];
  for (const p of CATALOG) {
    const app = p.bin ? { ...(await cliStatus(p)), canInstall: !!p.pkg, command: p.pkg ? `npm install -g ${p.pkg}` : null } : null;
    if (app) app.ready = app.installed && app.signedIn;
    const apiInfo = p.apiId ? { id: p.apiId, hasKey: !!keysSet[p.apiId], keyUrl: p.keyUrl, keyHint: p.keyHint } : null;
    out.push({ id: p.id, name: p.name, by: p.by, blurb: p.blurb, site: p.site || null, app, api: apiInfo,
      ready: !!(app?.ready || apiInfo?.hasKey), busy: busy.has(p.id) });
  }
  return out;
}

// Runs a fixed command and reports its output lines as they arrive.
function stream(file, args, onLine, timeoutMs, extraEnv) {
  return new Promise(resolve => {
    let proc;
    try { proc = spawn(file, args, { windowsHide: true, env: { ...process.env, ...(extraEnv || {}) } }); } catch (e) { resolve({ ok: false, error: e.message }); return; }
    const timer = setTimeout(() => { try { proc.kill(); } catch {} }, timeoutMs);
    const feed = d => String(d).split(/\r?\n/).map(l => l.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').trim()).filter(Boolean).forEach(onLine);
    proc.stdout.on('data', feed); proc.stderr.on('data', feed);
    proc.on('error', e => { clearTimeout(timer); resolve({ ok: false, error: e.message }); });
    proc.on('close', code => { clearTimeout(timer); resolve({ ok: code === 0, error: code === 0 ? null : `Exited with code ${code}` }); });
  });
}

async function install(id, onLine) {
  const p = find(id);
  if (!p || !p.pkg) throw new Error('This cannot be installed from here.');
  if (busy.has(id)) throw new Error('Already working on it.');
  const npm = cli.resolveNpm();
  if (!npm) throw new Error('Node.js is needed to install this. Get it from nodejs.org, then try again.');
  busy.add(id);
  try {
    onLine(`npm install -g ${p.pkg}`);
    const r = await stream(npm.cmd, [...npm.args, 'install', '-g', p.pkg], onLine, 10 * 60 * 1000, npm.env);
    cli.clearCache(); cli.fixPath();
    if (!r.ok) throw new Error(r.error || 'The install failed.');
    if (!cli.resolveCli(p.bin)) throw new Error(`Installed, but "${p.bin}" was not found on PATH. Restart Caret Agent and try again.`);
    return true;
  } finally { busy.delete(id); }
}

// Opens the provider's own browser sign-in.
async function signIn(id, onLine) {
  const p = find(id);
  if (!p || !p.bin) throw new Error('Nothing to sign in to.');
  const r = cli.resolveCli(p.bin);
  if (!r) throw new Error(`${p.name} is not installed yet.`);
  if (busy.has(id)) throw new Error('Already working on it.');
  busy.add(id);
  try {
    const res = await stream(r.cmd, [...r.args, ...p.login], onLine, 5 * 60 * 1000, r.env);
    if (!res.ok) throw new Error(res.error || 'Sign-in did not finish.');
    return true;
  } finally { busy.delete(id); }
}

// Tries a key against the provider before it is saved: lists the models it can use.
async function checkKey(apiId, key) {
  const cfg = models.CLOUD_APIS[apiId];
  if (!cfg) throw new Error('Unknown provider');
  key = key.trim();
  if (!key || key.length < 8 || /\s/.test(key)) return { ok: false, error: 'That does not look like an API key. Paste the whole key, with no spaces.' };
  try {
    const j = await models.getJson(cfg.base + '/models' + (apiId === 'anthropic' ? '?limit=100' : ''), { headers: models.apiHeaders(apiId, key), timeout: 8000 });
    const n = (j.data || []).map(m => String(m.id).replace(/^models\//, '')).filter(cfg.filter).length;
    return { ok: true, count: n };
  } catch (e) {
    const m = String(e.message || e);
    if (/HTTP (400|401|403)/.test(m)) return { ok: false, error: `${cfg.name} did not accept this key. Check that you copied all of it.` };
    if (/abort|fetch failed|ENOTFOUND|ECONN/i.test(m)) return { ok: false, error: 'Could not reach the service. Check your internet connection.' };
    return { ok: false, error: m };
  }
}

module.exports = { status, install, signIn, checkKey, stream, CATALOG };
