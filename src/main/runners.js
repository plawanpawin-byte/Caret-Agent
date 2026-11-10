'use strict';
// Drives the Claude Code and Codex command-line agents with the user's own
// sign-in. Caret Agent adds the shared memory, the design rules and its
// permission policy around them.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execFile } = require('child_process');
const { app } = require('electron');
const { resolveCli } = require('./cli');
const ws = require('./workspace');

function killTree(proc) {
  if (!proc || proc.exitCode !== null) return;
  if (process.platform === 'win32') execFile('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true }, () => {});
  else { try { proc.kill('SIGTERM'); } catch {} }
}

function startCli(name, args, { cwd, env, stdin }) {
  const cli = resolveCli(name);
  if (!cli) throw new Error(`${name} is not installed or not on PATH`);
  const proc = spawn(cli.cmd, [...cli.args, ...args], {
    cwd, windowsHide: true, env: { ...process.env, ...(cli.env || {}), ...(env || {}) },
  });
  if (stdin != null) { proc.stdin.on('error', () => {}); proc.stdin.end(stdin); }
  return proc;
}

function lines(stream, onLine) {
  let buf = '';
  stream.setEncoding('utf8');
  stream.on('data', d => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (l) onLine(l); }
  });
  stream.on('end', () => { if (buf.trim()) onLine(buf.trim()); });
}

const short = (v, n = 4000) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s && s.length > n ? s.slice(0, n) + '…' : s; };

function tmpFile(name, content) {
  const dir = path.join(app.getPath('userData'), 'run');
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, name);
  fs.writeFileSync(p, content, { mode: 0o600 });
  return p;
}

// ---------- Claude Code ----------
function runClaude({ tabId, model, mode, permission, prompt, system, sessionId, bridge, images, on }) {
  const args = ['-p', '--output-format', 'stream-json', '--verbose'];
  if (model && model !== 'default') args.push('--model', model);
  if (sessionId) args.push('--resume', sessionId);
  args.push('--append-system-prompt-file', tmpFile(`claude-system-${tabId}.md`, system));
  if (mode === 'plan') args.push('--permission-mode', 'plan');
  else if (permission === 'full') args.push('--permission-mode', 'bypassPermissions');
  else {
    // ask / auto: every tool request comes back to Caret Agent for a decision.
    const helper = path.join(__dirname, 'approval-mcp.js');
    const cfg = { mcpServers: { caret: { command: process.execPath, args: [helper], env: {
      ELECTRON_RUN_AS_NODE: '1', CARET_BRIDGE_PORT: String(bridge.port), CARET_BRIDGE_TOKEN: bridge.token, CARET_TAB: tabId } } } };
    args.push('--permission-mode', 'default', '--mcp-config', tmpFile(`claude-mcp-${tabId}.json`, JSON.stringify(cfg)), '--permission-prompt-tool', 'mcp__caret__approve');
  }
  let text = prompt;
  if (images?.length) text += '\n\nAttached images (read them):\n' + images.map(p => `- ${p}`).join('\n');

  const proc = startCli('claude', args, { cwd: ws.getRoot() || os.homedir(), stdin: text });
  const result = { sessionId: null, files: [], commands: 0, error: null };
  let stderr = '';
  proc.stderr.on('data', d => { stderr += d; if (stderr.length > 20000) stderr = stderr.slice(-10000); });
  lines(proc.stdout, line => {
    let ev; try { ev = JSON.parse(line); } catch { return; }
    if (ev.session_id) result.sessionId = ev.session_id;
    if (ev.type === 'assistant') {
      for (const b of ev.message?.content || []) {
        if (b.type === 'text' && b.text) on.text(b.text);
        else if (b.type === 'thinking' && b.thinking) on.thinking(b.thinking);
        else if (b.type === 'tool_use') {
          on.tool({ id: b.id, name: b.name, args: b.input, status: 'running' });
          const fp = b.input?.file_path || b.input?.notebook_path;
          if (fp && /^(Edit|Write|MultiEdit|NotebookEdit)$/.test(b.name)) { result.files.push(fp); on.fileChanged(fp); }
          if (b.name === 'Bash' || b.name === 'PowerShell') result.commands++;
        }
      }
    } else if (ev.type === 'user') {
      for (const b of ev.message?.content || []) {
        if (b.type === 'tool_result') {
          const content = Array.isArray(b.content) ? b.content.map(c => c.text || '').join('\n') : b.content;
          on.tool({ id: b.tool_use_id, status: b.is_error ? 'error' : 'done', result: short(content) });
        }
      }
    } else if (ev.type === 'result') {
      if (ev.is_error) result.error = ev.result || ev.subtype || 'Claude stopped with an error';
    }
  });
  const done = new Promise(resolve => {
    proc.on('error', e => { result.error = e.message; resolve(result); });
    proc.on('close', code => {
      if (code && !result.error) result.error = (stderr.trim().split('\n').slice(-3).join('\n')) || `Claude exited with code ${code}`;
      resolve(result);
    });
  });
  return { stop: () => killTree(proc), done };
}

// ---------- Codex ----------
function runCodex({ model, mode, permission, prompt, system, images, on }) {
  const root = ws.getRoot() || os.homedir();
  const args = ['exec', '--json', '--skip-git-repo-check', '-C', root];
  if (model && model !== 'default') args.push('-m', model);
  // Codex cannot pause to ask inside the app, so "Ask" runs read-only and
  // proposes changes instead of making them.
  if (mode === 'plan' || permission === 'ask') args.push('--sandbox', 'read-only');
  else if (permission === 'auto') args.push('--sandbox', 'workspace-write');
  else args.push('--dangerously-bypass-approvals-and-sandbox');
  for (const img of images || []) args.push('-i', img);
  args.push('-');
  const note = permission === 'ask' && mode !== 'plan' ? '\n\n(The user chose "Ask first". You are read-only: describe the exact changes and commands you propose, and the user will approve them.)' : '';
  const proc = startCli('codex', args, { cwd: root, stdin: `${system}\n\n---\n\nUSER REQUEST:\n${prompt}${note}` });
  const result = { files: [], commands: 0, error: null };
  let stderr = '';
  proc.stderr.on('data', d => { stderr += d; if (stderr.length > 20000) stderr = stderr.slice(-10000); });
  lines(proc.stdout, line => {
    let ev; try { ev = JSON.parse(line); } catch { return; }
    const item = ev.item || {};
    if (ev.type === 'item.started' && item.type === 'command_execution') {
      result.commands++;
      on.tool({ id: item.id, name: 'run_command', args: { command: item.command }, status: 'running' });
    } else if (ev.type === 'item.completed') {
      if (item.type === 'agent_message' && item.text) on.text(item.text + '\n');
      else if (item.type === 'reasoning' && item.text) on.thinking(item.text);
      else if (item.type === 'command_execution') on.tool({ id: item.id, name: 'run_command', args: { command: item.command }, status: item.exit_code ? 'error' : 'done', result: short(item.aggregated_output || '') });
      else if (item.type === 'file_change') {
        for (const c of item.changes || []) { result.files.push(c.path); on.fileChanged(c.path); }
        on.tool({ id: item.id, name: 'edit_file', args: { path: (item.changes || []).map(c => c.path).join(', ') }, status: 'done', result: (item.changes || []).map(c => `${c.kind} ${c.path}`).join('\n') });
      } else if (item.type === 'error' && item.message) result.error = item.message;
    } else if (ev.type === 'error' || ev.type === 'turn.failed') {
      result.error = ev.message || ev.error?.message || 'Codex failed';
    } else if (ev.msg) { // older Codex event format
      const m = ev.msg;
      if (m.type === 'agent_message' && m.message) on.text(m.message + '\n');
      if (m.type === 'error') result.error = m.message;
    }
  });
  const done = new Promise(resolve => {
    proc.on('error', e => { result.error = e.message; resolve(result); });
    proc.on('close', code => {
      if (code && !result.error) result.error = stderr.trim().split('\n').slice(-3).join('\n') || `Codex exited with code ${code}`;
      resolve(result);
    });
  });
  return { stop: () => killTree(proc), done };
}

module.exports = { runClaude, runCodex };
