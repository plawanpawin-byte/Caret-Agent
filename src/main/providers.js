'use strict';
// The AI providers Caret Agent can use, shown in the "AI" panel: what is
// installed, what is signed in, and a one-click install for the two command-line
// agents. Install commands are fixed here — the page can only pick an id.
const { spawn, execFile } = require('child_process');
const cli = require('./cli');
const settings = require('./settings');
const models = require('./models');

const CATALOG = [
  { id: 'claude', name: 'Claude Code', by: 'Anthropic', kind: 'cli', bin: 'claude', pkg: '@anthropic-ai/claude-code',
    blurb: 'Uses your Claude plan. Reads, edits and runs commands in your project.', login: ['auth', 'login'], statusArgs: ['auth', 'status'], site: 'https://claude.com/claude-code' },
  { id: 'codex', name: 'Codex', by: 'OpenAI', kind: 'cli', bin: 'codex', pkg: '@openai/codex',
    blurb: 'Uses your ChatGPT plan. Writes and changes code from your prompts.', login: ['login'], statusArgs: ['login', 'status'], site: 'https://developers.openai.com/codex' },
  { id: 'xai', name: 'Grok', by: 'xAI', kind: 'api', blurb: 'Grok models. Connect with an xAI API key.', keyUrl: 'https://console.x.ai' },
  { id: 'gemini', name: 'Antigravity', by: 'Google', kind: 'api', blurb: 'Gemini models. Connect with a Google AI Studio key.', keyUrl: 'https://aistudio.google.com/apikey' },
  { id: 'openai', name: 'ChatGPT', by: 'OpenAI', kind: 'api', blurb: 'GPT models. Connect with an OpenAI API key.', keyUrl: 'https://platform.openai.com/api-keys' },
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
  const s = settings.load();
  const probe = async base => { try { const j = await models.getJson(base.replace(/\/$/, '') + '/models', { timeout: 600 }); return Array.isArray(j.data); } catch { return false; } };
  const [lm, lcpp] = await Promise.all([probe(s.endpoints.lmstudio), probe(s.endpoints.llamacpp)]);
  const out = [];
  for (const p of CATALOG) {
    const item = { id: p.id, name: p.name, by: p.by, kind: p.kind, blurb: p.blurb, site: p.site || null, keyUrl: p.keyUrl || null, canInstall: !!p.pkg, command: p.pkg ? `npm install -g ${p.pkg}` : null, installed: false, ready: false, busy: busy.has(p.id) };
    if (p.kind === 'cli') Object.assign(item, await cliStatus(p), { ready: false });
    else if (p.kind === 'api') { item.installed = true; item.signedIn = !!settings.publicView().keysSet?.[p.id]; }
    else if (p.id === 'ollama') { item.installed = !!cli.findOllama(); }
    else if (p.id === 'lmstudio') { item.installed = lm; item.running = lm; }
    else if (p.id === 'llamacpp') { item.installed = lcpp; item.running = lcpp; }
    item.ready = item.installed && (p.kind === 'local' || item.signedIn);
    out.push(item);
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
  if (!p || p.kind !== 'cli') throw new Error('Nothing to sign in to.');
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

module.exports = { status, install, signIn, stream, CATALOG };
