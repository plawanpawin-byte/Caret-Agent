'use strict';
// One permission policy for every AI (local, Claude, API models).
//   ask  — every edit and every command waits for the user.
//   auto — reads, edits inside the project and ordinary commands run on their
//          own; anything destructive, remote-changing or outside the project
//          still asks.
//   full — nothing asks. File tools are still locked to the project folder.
const path = require('path');
const ws = require('./workspace');

const READ = new Set(['list_dir', 'read_file', 'search', 'update_progress', 'update_tasks', 'write_plan', 'open_preview',
  'Read', 'Glob', 'Grep', 'LS', 'TodoWrite', 'WebSearch', 'WebFetch', 'NotebookRead', 'ExitPlanMode']);
const WRITE = new Set(['write_file', 'edit_file', 'delete_file', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const EXEC = new Set(['run_command', 'Bash', 'PowerShell']);

const RISKY = [
  /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r|-r)\b/i, /\bRemove-Item\b.*-(Recurse|Force)/i, /\b(del|erase)\s+\/[sq]/i, /\brmdir\s+\/s/i, /\brd\s+\/s/i,
  /\bformat\s+[a-z]:/i, /\bmkfs\b/i, /\bdiskpart\b/i, /\bdd\s+if=/i, /\bshutdown\b/i, /\bRestart-Computer\b/i, /\bStop-Computer\b/i,
  /\breg\s+(delete|add)\b/i, /\bSet-ExecutionPolicy\b/i, /\bsudo\b/, /\bchmod\s+-R\b/i, /\bchown\s+-R\b/i,
  /\bgit\s+push\b/i, /\bgit\s+reset\s+--hard\b/i, /\bgit\s+clean\s+-[a-z]*f/i, /\bgit\s+branch\s+-D\b/,
  /\b(npm|pnpm|yarn)\s+publish\b/i, /\bnpm\s+(i|install)\s+-g\b/i,
  /(curl|wget)[^|]*\|\s*(ba|z)?sh\b/i, /\b(iwr|irm|Invoke-WebRequest|Invoke-RestMethod)\b[^|]*\|\s*(iex|Invoke-Expression)/i, /\bInvoke-Expression\b/i,
  /\b(kill|taskkill|Stop-Process)\b.*(-9|\/f|-Force)/i, /:\(\)\s*\{\s*:\|:&\s*\};:/,
  /\b(ssh|scp)\s/i, /\bcrontab\b/i, /\bschtasks\b/i, /\bNew-Service\b|\bsc\s+create\b/i,
  /[a-z]:\\windows\\/i, /\/etc\//, /~\/\.ssh|\.ssh[\\/]/i, /\.aws[\\/]|\.config[\\/]gcloud/i,
];

function isRiskyCommand(cmd) { return RISKY.some(r => r.test(String(cmd || ''))); }

function pathOutsideProject(p, forWrite = false) {
  if (!p || !ws.getRoot()) return false;
  try { ws.resolveSafe(p, { forWrite }); return false; } catch { return true; }
}

// Returns 'allow' | 'ask' | 'deny' and a reason the UI can show.
function decide({ permission, mode, tool, args = {}, alwaysAllowed = new Set() }) {
  const kind = READ.has(tool) ? 'read' : WRITE.has(tool) ? 'write' : EXEC.has(tool) ? 'exec' : 'other';
  if (mode === 'plan' && (kind === 'write' || kind === 'exec')) return { decision: 'deny', reason: 'Plan mode only reads. Switch to Code or Agent to make changes.' };
  if (kind === 'read') {
    const p = args.path || args.file_path;
    if (p && pathOutsideProject(p) && permission !== 'full') return { decision: 'ask', reason: 'Reads a file outside the project', kind };
    return { decision: 'allow', kind };
  }
  if (permission === 'full') return { decision: 'allow', kind };
  if (alwaysAllowed.has(kind)) return { decision: 'allow', kind };
  if (permission === 'ask') return { decision: 'ask', reason: kind === 'exec' ? 'Run a command' : kind === 'write' ? 'Change a file' : 'Use a tool', kind };
  // auto
  if (kind === 'exec') {
    const cmd = args.command || '';
    if (isRiskyCommand(cmd)) return { decision: 'ask', reason: 'This command can delete data, change your system or reach other machines', kind };
    return { decision: 'allow', kind };
  }
  if (kind === 'write') {
    const p = args.path || args.file_path || args.notebook_path;
    if (p && pathOutsideProject(p, true)) return { decision: 'ask', reason: 'Changes a file outside the project or inside .git', kind };
    return { decision: 'allow', kind };
  }
  return { decision: 'ask', reason: `Use ${tool}`, kind };
}

module.exports = { decide, isRiskyCommand };
