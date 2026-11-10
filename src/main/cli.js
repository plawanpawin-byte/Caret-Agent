'use strict';
// Finds command-line tools (claude, codex, ollama, node, git) on any machine.
// Desktop apps on macOS do not inherit the shell PATH, and on Windows npm
// installs .cmd shims that Node will not spawn directly, so both are handled.
const fs = require('fs');
const path = require('path');
const os = require('os');

const IS_WIN = process.platform === 'win32';
const HOME = os.homedir();

function extraDirs() {
  if (IS_WIN) {
    const la = process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local');
    const ad = process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming');
    return [path.join(ad, 'npm'), path.join(la, 'Programs', 'Ollama'), path.join(HOME, '.local', 'bin'), path.join(la, 'Microsoft', 'WinGet', 'Links')];
  }
  return ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', path.join(HOME, '.local', 'bin'), path.join(HOME, '.npm-global', 'bin'),
    path.join(HOME, '.volta', 'bin'), path.join(HOME, '.bun', 'bin'), '/Applications/Ollama.app/Contents/Resources'];
}

// Make the PATH the app (and its terminal) sees complete.
function fixPath() {
  const sep = IS_WIN ? ';' : ':';
  const parts = (process.env.PATH || '').split(sep).filter(Boolean);
  for (const d of extraDirs()) if (!parts.includes(d) && fs.existsSync(d)) parts.push(d);
  // nvm installs on macOS/Linux
  const nvm = path.join(HOME, '.nvm', 'versions', 'node');
  if (!IS_WIN && fs.existsSync(nvm)) {
    for (const v of fs.readdirSync(nvm).sort().reverse()) { const b = path.join(nvm, v, 'bin'); if (!parts.includes(b)) parts.push(b); }
  }
  process.env.PATH = parts.join(sep);
}

function which(name) {
  const sep = IS_WIN ? ';' : ':';
  const exts = IS_WIN ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of (process.env.PATH || '').split(sep)) {
    if (!dir) continue;
    for (const ext of exts) {
      const p = path.join(dir, name + ext);
      try { if (fs.statSync(p).isFile()) return p; } catch {}
    }
  }
  return null;
}

const cache = new Map();

// Returns { cmd, args, env } that can be passed to spawn() with shell:false.
function resolveCli(name) {
  if (cache.has(name)) return cache.get(name);
  let result = null;
  const found = which(name);
  if (found) {
    if (!IS_WIN || found.toLowerCase().endsWith('.exe')) result = { cmd: found, args: [] };
    else if (/\.(cmd|bat)$/i.test(found)) result = unwrapShim(found);
  }
  cache.set(name, result);
  return result;
}

// npm .cmd shims point at either a native .exe or a .js entry file.
function unwrapShim(shim) {
  let text;
  try { text = fs.readFileSync(shim, 'utf8'); } catch { return null; }
  const dir = path.dirname(shim);
  const targets = [...text.matchAll(/"%dp0%\\([^"]+?\.(?:exe|js|cjs|mjs))"/gi)].map(m => path.join(dir, m[1]));
  const exe = targets.find(t => /\.exe$/i.test(t) && !/node\.exe$/i.test(t) && fs.existsSync(t));
  if (exe) return { cmd: exe, args: [] };
  const js = targets.find(t => /\.(c|m)?js$/i.test(t) && fs.existsSync(t));
  if (!js) return null;
  const node = fs.existsSync(path.join(dir, 'node.exe')) ? path.join(dir, 'node.exe') : which('node');
  if (node) return { cmd: node, args: [js] };
  // No Node installed: Electron itself can act as Node.
  return { cmd: process.execPath, args: [js], env: { ELECTRON_RUN_AS_NODE: '1' } };
}

function findOllama() {
  const r = resolveCli('ollama');
  if (r) return r.cmd;
  const guesses = IS_WIN
    ? [path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe')]
    : ['/Applications/Ollama.app/Contents/Resources/ollama', '/usr/local/bin/ollama', '/usr/bin/ollama'];
  return guesses.find(g => g && fs.existsSync(g)) || null;
}

function clearCache() { cache.clear(); }

module.exports = { fixPath, which, resolveCli, findOllama, clearCache, IS_WIN };
