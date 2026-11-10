'use strict';
// Shared project memory. Every AI — local or cloud — reads .caret/HANDOFF.md
// before it starts and writes to it when it stops, so switching from Claude
// to ChatGPT to a local model never loses track of the work.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const ws = require('./workspace');

const DIR = '.caret';
const HANDOFF = `${DIR}/HANDOFF.md`;
const DESIGN = `${DIR}/DESIGN.md`;
const PLAN = `${DIR}/PLAN.md`;
const START = '<!-- caret:state:start -->';
const END = '<!-- caret:state:end -->';
const LOG = '## Log';
const MAX_LOG = 40;

function resourcePath(name) {
  const base = app.isPackaged ? path.join(process.resourcesPath, 'resources') : path.join(__dirname, '..', '..', 'resources');
  return path.join(base, name);
}

function handoffTemplate() {
  return `# Project handoff

Caret Agent keeps this file so any AI can pick up where the last one stopped.
Read it first. Update the state section when you finish.

${START}
## Current state
Nothing has been done yet.

## Next steps
- (none yet)
${END}

${LOG}
`;
}

async function ensure() {
  const root = ws.getRoot();
  if (!root) return;
  // resolveSafe refuses a .caret that is a link pointing outside the project.
  const dir = ws.resolveSafe(DIR, { forWrite: true });
  fs.mkdirSync(path.join(dir, 'attachments'), { recursive: true });
  ws.resolveSafe(`${DIR}/attachments`, { forWrite: true });
  const gi = ws.resolveSafe(`${DIR}/.gitignore`, { forWrite: true });
  if (!fs.existsSync(gi)) fs.writeFileSync(gi, 'attachments/\n');
  const ho = ws.resolveSafe(HANDOFF, { forWrite: true });
  if (!fs.existsSync(ho)) fs.writeFileSync(ho, handoffTemplate());
  const de = ws.resolveSafe(DESIGN, { forWrite: true });
  if (!fs.existsSync(de)) fs.copyFileSync(resourcePath('DESIGN.md'), de);
}

const readSafe = async (p, limit) => { try { return await ws.readFile(p, limit); } catch { return ''; } };

// Everything an AI needs to know before it starts.
async function context() {
  await ensure();
  const [handoff, design, plan, agents, claudeMd] = await Promise.all([
    readSafe(HANDOFF, 200000), readSafe(DESIGN, 200000), readSafe(PLAN, 200000), readSafe('AGENTS.md', 100000), readSafe('CLAUDE.md', 100000),
  ]);
  return { handoff: trimLog(handoff), design, plan, rules: [agents, claudeMd].filter(Boolean).join('\n\n') };
}

function trimLog(text) {
  const i = text.indexOf(LOG);
  if (i < 0) return text;
  const lines = text.slice(i + LOG.length).split('\n').filter(l => l.startsWith('- '));
  return text.slice(0, i) + LOG + '\n' + lines.slice(-12).join('\n') + '\n';
}

// Replace the "current state" block (written by the AI).
async function updateState({ state, next_steps }) {
  await ensure();
  let text = await readSafe(HANDOFF) || handoffTemplate();
  const steps = (Array.isArray(next_steps) ? next_steps : [String(next_steps || '')]).filter(Boolean).map(s => `- ${String(s).trim()}`).join('\n') || '- (none)';
  const block = `${START}\n## Current state\n${String(state || '').trim()}\n\n## Next steps\n${steps}\n${END}`;
  const a = text.indexOf(START), b = text.indexOf(END);
  text = a >= 0 && b > a ? text.slice(0, a) + block + text.slice(b + END.length) : block + '\n\n' + text;
  await ws.writeFile(HANDOFF, text);
}

// Automatic log line after every turn, even if the AI forgot to update.
async function appendLog({ model, mode, prompt, files = [], commands = 0 }) {
  if (!ws.getRoot()) return;
  await ensure();
  let text = await readSafe(HANDOFF) || handoffTemplate();
  const when = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const ask = String(prompt || '').replace(/\s+/g, ' ').slice(0, 120);
  const did = [files.length ? `changed ${[...new Set(files)].slice(0, 6).join(', ')}${files.length > 6 ? '…' : ''}` : '', commands ? `ran ${commands} command${commands > 1 ? 's' : ''}` : ''].filter(Boolean).join('; ') || 'answered';
  const line = `- ${when} · ${model} · ${mode} · "${ask}" → ${did}`;
  if (!text.includes(LOG)) text += `\n${LOG}\n`;
  const i = text.indexOf(LOG);
  const head = text.slice(0, i + LOG.length);
  const lines = text.slice(i + LOG.length).split('\n').filter(l => l.startsWith('- '));
  lines.push(line);
  await ws.writeFile(HANDOFF, head + '\n' + lines.slice(-MAX_LOG).join('\n') + '\n');
}

async function writePlan(content) {
  await ensure();
  await ws.writeFile(PLAN, String(content || ''));
}

module.exports = { ensure, context, updateState, appendLog, writePlan, HANDOFF, DESIGN, PLAN, resourcePath };
