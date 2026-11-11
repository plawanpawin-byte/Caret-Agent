// Headless end-to-end check: runs the real agent loop against a local model.
// Usage: set E2E_MODEL=ollama:qwen3:8b (and optionally E2E_MODE, E2E_PERM, E2E_PROMPT, E2E_LOG), then run electron on this file.
// The model key goes in an env var: a command-line value like "ollama:x" makes Electron fail to start.
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const LOGF = process.env.E2E_LOG; const log = (...a) => { const s = a.join(' '); console.log(s); if (LOGF) fs.appendFileSync(LOGF, s + '\n'); };
process.on('uncaughtException', e => { log('UNCAUGHT', e.stack); app.exit(1); });
log('boot', process.argv.join(' | '));
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'caret-e2e-')));
app.on('window-all-closed', e => e.preventDefault());
app.whenReady().then(async () => {
  log('ready');
  const ws = require('../src/main/workspace');
  const agent = require('../src/main/agent');
  const cli = require('../src/main/cli'); cli.fixPath();
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'caret-proj-'));
  if (process.env.E2E_COPY) fs.cpSync(process.env.E2E_COPY, proj, { recursive: true, filter: src => !/[\/](\.git|node_modules)([\/]|$)/.test(src) }); // start from a copy of a real project
  ws.setRoot(proj);
  const events = [];
  agent.init({ emit: ev => { events.push(ev); if (ev.type === 'tool' && ev.part.status !== 'running') log('tool', ev.part.name, ev.part.status, JSON.stringify(ev.part.args).slice(0, 90), ev.part.status === 'error' ? '=> ' + String(ev.part.result || '').slice(0, 200) : ''); if (ev.type === 'approval') { const ok = ['write_file', 'edit_file', 'Write', 'Edit', 'MultiEdit'].includes(ev.tool); log('approval requested:', ev.tool, ok ? '-> allowed' : '-> DENIED (test only allows file writes)'); require('../src/main/agent').answerApproval(ev.reqId, ok ? 'allow' : 'deny'); } if (ev.type === 'error') log('ERROR', ev.text); }, openPreview: u => log('preview', u), onFileChanged: () => {} });
  agent.loadTabs();
  const tab = agent.newTab();
  const model = process.env.E2E_MODEL; const mode = process.env.E2E_MODE || 'code'; const perm = process.env.E2E_PERM || 'ask'; // safe by default: files only, commands are denied
  const t0 = Date.now();
  await new Promise(res => { const orig = events.push.bind(events); events.push = e => { orig(e); if (e.type === 'done') res(); return 1; }; agent.send({ tabId: tab.id, text: process.env.E2E_PROMPT || 'Create a file kfes.html: a one-page site for a coffee shop called Kfes with a header and a short menu.', images: [], mode, permission: perm, model }); });
  log('finished in', Math.round((Date.now() - t0) / 1000), 's');
  for (const f of fs.readdirSync(proj, { recursive: true })) log('file:', f);
  const html = path.join(proj, 'kfes.html');
  if (fs.existsSync(html)) { const t = fs.readFileSync(html, 'utf8'); log('has favicon link:', /rel=["']icon["']/.test(t), '| bytes:', t.length); }
  const h = path.join(proj, '.caret', 'HANDOFF.md'); if (fs.existsSync(h)) log('--- HANDOFF ---\n' + fs.readFileSync(h, 'utf8').slice(0, 900));
  app.exit(0);
}).catch(e => { log('FAIL', e.stack); app.exit(1); });
