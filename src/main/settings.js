'use strict';
// Per-user settings. Lives in the OS user-data folder, never in the project.
// API keys are encrypted with the OS keychain (DPAPI / Keychain / libsecret)
// through Electron's safeStorage and never leave the main process.
const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

const DEFAULTS = {
  onboarded: false,
  name: '',
  role: '',
  layout: 'studio',            // 'studio' | 'agent'
  mode: 'code',                // 'plan' | 'code' | 'agent'
  permission: 'ask',           // 'ask' | 'auto' | 'full'
  model: 'auto',               // 'auto' or '<provider>:<model>'
  recentFolders: [],
  lastFolder: null,
  endpoints: {                 // extra local OpenAI-compatible servers (LM Studio, llama.cpp, Jan…)
    lmstudio: 'http://127.0.0.1:1234/v1',
    llamacpp: 'http://127.0.0.1:8080/v1',
  },
  keys: {},                    // provider -> encrypted base64
  account: null,               // { login, token } of the GitHub sign-in; the token is encrypted
};

const ALLOWED_KEYS = new Set(['xai', 'gemini', 'openai', 'anthropic', 'openrouter']);

let cache = null;
const file = () => path.join(app.getPath('userData'), 'settings.json');

function load() {
  if (cache) return cache;
  try {
    const raw = JSON.parse(fs.readFileSync(file(), 'utf8'));
    cache = { ...DEFAULTS, ...raw, endpoints: { ...DEFAULTS.endpoints, ...(raw.endpoints || {}) } };
  } catch {
    cache = structuredClone(DEFAULTS);
  }
  return cache;
}

function save() {
  const tmp = file() + '.tmp';
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
  fs.renameSync(tmp, file()); // atomic replace: a crash never leaves half a file
}

// Only these fields may be changed from the renderer.
const PUBLIC_FIELDS = {
  onboarded: v => typeof v === 'boolean',
  name: v => typeof v === 'string' && v.length <= 60,
  role: v => typeof v === 'string' && v.length <= 40,
  layout: v => v === 'studio' || v === 'agent',
  mode: v => ['plan', 'code', 'agent'].includes(v),
  permission: v => ['ask', 'auto', 'full'].includes(v),
  model: v => typeof v === 'string' && v.length <= 200,
  orModels: v => Array.isArray(v) && v.length <= 200 && v.every(x => typeof x === 'string' && /^[\w.\-:/]{1,120}$/.test(x)),   // OpenRouter models switched on
};

function publicView() {
  const s = load();
  const out = {};
  for (const k of Object.keys(PUBLIC_FIELDS)) out[k] = s[k];
  out.recentFolders = s.recentFolders;
  out.lastFolder = s.lastFolder;
  out.account = s.account && s.account.login ? { login: s.account.login, avatar: s.account.avatar || null } : null;
  out.keysSet = Object.fromEntries([...ALLOWED_KEYS].map(k => [k, !!s.keys[k]]));
  return out;
}

function update(patch) {
  const s = load();
  for (const [k, v] of Object.entries(patch || {})) {
    if (PUBLIC_FIELDS[k] && PUBLIC_FIELDS[k](v)) s[k] = v;
  }
  save();
  return publicView();
}

function setKey(provider, key) {
  if (!ALLOWED_KEYS.has(provider)) throw new Error('Unknown provider');
  const s = load();
  if (!key) { delete s.keys[provider]; save(); return; }
  if (typeof key !== 'string' || key.length > 400) throw new Error('Invalid key');
  if (!safeStorage.isEncryptionAvailable()) throw new Error('This system has no secure key storage, so keys cannot be saved.');
  s.keys[provider] = safeStorage.encryptString(key.trim()).toString('base64');
  save();
}

function getKey(provider) {
  const enc = load().keys[provider];
  if (!enc) return null;
  try { return safeStorage.decryptString(Buffer.from(enc, 'base64')); } catch { return null; }
}

const AVATAR_OK = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]{20,150000}$/;
function setAccount({ login, token, avatar }) {
  if (typeof login !== 'string' || typeof token !== 'string' || !login || token.length > 200) throw new Error('Invalid account');
  if (!safeStorage.isEncryptionAvailable()) throw new Error('This system has no secure storage, so the sign-in cannot be saved.');
  const s = load();
  s.account = { login: login.slice(0, 80), token: safeStorage.encryptString(token).toString('base64'), avatar: AVATAR_OK.test(avatar || '') ? avatar : null };
  save();
}
function getAccountToken() {
  const enc = load().account && load().account.token;
  if (!enc) return null;
  try { return safeStorage.decryptString(Buffer.from(enc, 'base64')); } catch { return null; }
}
function setAccountAvatar(avatar) { const s = load(); if (s.account && AVATAR_OK.test(avatar || '')) { s.account.avatar = avatar; save(); } }
function clearAccount() { const s = load(); s.account = null; save(); }

function addRecentFolder(dir) {
  const s = load();
  s.recentFolders = [dir, ...s.recentFolders.filter(d => d !== dir)].slice(0, 10);
  s.lastFolder = dir;
  save();
}

module.exports = { load, update, publicView, setKey, getKey, addRecentFolder, setAccount, setAccountAvatar, getAccountToken, clearAccount };
