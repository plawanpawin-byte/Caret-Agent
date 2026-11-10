'use strict';
// Every file operation — from the UI or from an AI — goes through here.
// All paths are confined to the open folder, including through symlinks,
// and the .git folder is read-only so nothing can plant git hooks.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { execFile } = require('child_process');

const IGNORED = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', '.cache', '__pycache__', '.venv', 'venv', 'target', '.idea', '.turbo', 'coverage']);
const MAX_READ = 10 * 1024 * 1024;
const MAX_WRITE = 5 * 1024 * 1024;

let root = null;
let rootReal = null;

function setRoot(dir) {
  const real = fs.realpathSync(dir);
  if (!fs.statSync(real).isDirectory()) throw new Error('Not a folder');
  root = real;
  rootReal = real;
  return root;
}
function getRoot() { return root; }
function closeRoot() { root = null; rootReal = null; }

function isInside(base, target) {
  const rel = path.relative(base, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// Resolve a workspace-relative (or absolute) path and prove it stays inside the folder.
function resolveSafe(p, { forWrite = false } = {}) {
  if (!root) throw new Error('No folder is open');
  if (typeof p !== 'string' || p.length > 1024 || p.includes('\0')) throw new Error('Invalid path');
  const abs = path.resolve(root, p);
  if (!isInside(root, abs)) throw new Error(`Path is outside the open folder: ${p}`);
  // Follow symlinks on the deepest part that exists.
  let probe = abs;
  while (!fs.existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  const real = fs.realpathSync(probe);
  if (!isInside(rootReal, real)) throw new Error(`Path escapes the open folder through a link: ${p}`);
  if (forWrite) {
    const rel = path.relative(root, abs).split(path.sep);
    if (rel[0] === '.git') throw new Error('The .git folder is protected');
  }
  return abs;
}

const rel = abs => path.relative(root, abs).split(path.sep).join('/');

async function listDir(p = '.') {
  const abs = resolveSafe(p);
  const entries = await fsp.readdir(abs, { withFileTypes: true });
  return entries
    .filter(e => !(e.isDirectory() && e.name === '.git'))
    .map(e => ({ name: e.name, path: rel(path.join(abs, e.name)), dir: e.isDirectory(), ignored: IGNORED.has(e.name) }))
    .sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name, undefined, { numeric: true }));
}

async function readFile(p, limit = MAX_READ) {
  const abs = resolveSafe(p);
  const st = await fsp.stat(abs);
  if (st.isDirectory()) throw new Error(`${p} is a folder`);
  if (st.size > limit) throw new Error(`${p} is too large (${Math.round(st.size / 1024)} KB)`);
  const buf = await fsp.readFile(abs);
  if (buf.subarray(0, 8000).includes(0)) throw new Error(`${p} is a binary file`);
  return buf.toString('utf8');
}

async function writeFile(p, content) {
  if (typeof content !== 'string') throw new Error('Content must be text');
  if (Buffer.byteLength(content) > MAX_WRITE) throw new Error('File is too large to write');
  const abs = resolveSafe(p, { forWrite: true });
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  const existed = fs.existsSync(abs);
  const before = existed ? await fsp.readFile(abs, 'utf8').catch(() => null) : null;
  await fsp.writeFile(abs, content, 'utf8');
  return { path: rel(abs), created: !existed, before };
}

async function writeBinary(p, base64) {
  const abs = resolveSafe(p, { forWrite: true });
  const buf = Buffer.from(base64, 'base64');
  if (buf.length > 20 * 1024 * 1024) throw new Error('File is too large');
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, buf);
  return rel(abs);
}

async function createEntry(p, isDir) {
  const abs = resolveSafe(p, { forWrite: true });
  if (fs.existsSync(abs)) throw new Error('Already exists');
  if (isDir) await fsp.mkdir(abs, { recursive: true });
  else { await fsp.mkdir(path.dirname(abs), { recursive: true }); await fsp.writeFile(abs, ''); }
  return rel(abs);
}

async function renameEntry(from, to) {
  const a = resolveSafe(from, { forWrite: true });
  const b = resolveSafe(to, { forWrite: true });
  if (fs.existsSync(b)) throw new Error('Target already exists');
  await fsp.rename(a, b);
  return rel(b);
}

async function deleteEntry(p) {
  const abs = resolveSafe(p, { forWrite: true });
  if (abs === root) throw new Error('Cannot delete the open folder');
  const { shell } = require('electron');
  await shell.trashItem(abs); // recycle bin, never a hard delete
}

// Plain-text search across the folder (skips heavy and binary folders).
async function search(query, { max = 200 } = {}) {
  if (!query || typeof query !== 'string') return [];
  const q = query.toLowerCase();
  const results = [];
  async function walk(dir) {
    if (results.length >= max) return;
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (results.length >= max) return;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { if (!IGNORED.has(e.name) && !e.isSymbolicLink()) await walk(abs); continue; }
      if (!e.isFile()) continue;
      if (e.name.toLowerCase().includes(q)) results.push({ path: rel(abs), line: 0, text: '(file name)' });
      let st; try { st = await fsp.stat(abs); } catch { continue; }
      if (st.size > 1024 * 1024) continue;
      let text; try { text = await fsp.readFile(abs, 'utf8'); } catch { continue; }
      if (text.slice(0, 8000).includes('\0')) continue;
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length && results.length < max; i++) {
        if (lines[i].toLowerCase().includes(q)) results.push({ path: rel(abs), line: i + 1, text: lines[i].trim().slice(0, 200) });
      }
    }
  }
  await walk(root);
  return results;
}

// Compact tree for the AI's context (depth-limited, ignores heavy folders).
async function overview(maxEntries = 300) {
  const lines = [];
  async function walk(dir, depth) {
    if (lines.length >= maxEntries || depth > 4) return;
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name));
    for (const e of entries) {
      if (lines.length >= maxEntries) { lines.push('  '.repeat(depth) + '…'); return; }
      if (e.name === '.git') continue;
      lines.push('  '.repeat(depth) + e.name + (e.isDirectory() ? '/' : ''));
      if (e.isDirectory() && !IGNORED.has(e.name) && !e.isSymbolicLink()) await walk(path.join(dir, e.name), depth + 1);
    }
  }
  await walk(root, 0);
  return lines.join('\n');
}

const GIT_URL = /^(https:\/\/[A-Za-z0-9.-]+(:\d+)?\/[A-Za-z0-9._~\/-]+?(\.git)?\/?|git@[A-Za-z0-9.-]+:[A-Za-z0-9._~\/-]+?(\.git)?)$/;

function cloneRepo(url, parentDir) {
  return new Promise((resolve, reject) => {
    url = String(url || '').trim();
    if (!GIT_URL.test(url)) return reject(new Error('Use an https:// or git@ repository address'));
    const name = url.replace(/\.git\/?$/, '').replace(/\/$/, '').split(/[/:]/).pop().replace(/[^A-Za-z0-9._-]/g, '') || 'repo';
    const dest = path.join(parentDir, name);
    if (fs.existsSync(dest)) return reject(new Error(`A folder named "${name}" already exists there`));
    // "--" stops the URL from ever being read as a git option.
    execFile('git', ['clone', '--', url, dest], {
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      timeout: 10 * 60 * 1000,
      windowsHide: true,
    }, (err, _out, stderr) => {
      if (err) return reject(new Error((stderr || err.message).trim().split('\n').pop()));
      resolve(dest);
    });
  });
}

module.exports = { setRoot, getRoot, closeRoot, resolveSafe, listDir, readFile, writeFile, writeBinary, createEntry, renameEntry, deleteEntry, search, overview, cloneRepo, rel };
