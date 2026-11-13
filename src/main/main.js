'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, session, nativeTheme, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const cli = require('./cli');
// Test hook: CARET_SIZE=900x600 opens the window at that size (never set in normal use).
// Test hooks (CARET_*) only work when the app is started from source, never in the installed app.
const DEV = !require('electron').app.isPackaged;
const ENV = new Proxy(process.env, { get: (t, k) => (DEV || typeof k !== 'string' || !k.startsWith('CARET_') ? t[k] : undefined) });
const TEST_SIZE = String(ENV.CARET_SIZE || '').split('x').map(Number).filter(n => n > 0);
cli.fixPath();
const settings = require('./settings');
const ws = require('./workspace');
const memory = require('./memory');
const terminals = require('./terminal');
const models = require('./models');
const providers = require('./providers');
const extensions = require('./extensions');
const auth = require('./auth');
const agent = require('./agent');

const SCHEME = 'caret';
const APP_ROOT = path.join(__dirname, '..', '..');
const RENDERER = path.join(APP_ROOT, 'src', 'renderer');
const MONACO = path.join(APP_ROOT, 'node_modules', 'monaco-editor', 'min');

// Separate profile for testing (CARET_USER_DATA=folder). Must run before anything reads userData.
if (ENV.CARET_USER_DATA) app.setPath('userData', path.resolve(ENV.CARET_USER_DATA));

protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } }]);

if (!app.requestSingleInstanceLock()) app.quit();

let win = null;
let preview = null;

const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "object-src 'none'",
].join('; ');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.map': 'application/json' };

// Reads the file itself (instead of net.fetch) so the type is always right
// and nothing outside the two allowed folders can be served.
async function serveFile(base, rel) {
  const target = path.normalize(path.join(base, rel));
  const inside = path.relative(base, target);
  if (inside.startsWith('..') || path.isAbsolute(inside)) return new Response('Not found', { status: 404 });
  try {
    const data = await fs.promises.readFile(target);
    const ext = path.extname(target).toLowerCase();
    const headers = { 'content-type': MIME[ext] || 'application/octet-stream', 'cache-control': 'no-cache' };
    if (ext === '.html') headers['content-security-policy'] = CSP;
    return new Response(data, { status: 200, headers });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

function createWindow() {
  const isMac = process.platform === 'darwin';
  win = new BrowserWindow({
    width: TEST_SIZE[0] || 1440, height: TEST_SIZE[1] || 900, minWidth: 900, minHeight: 560,
    backgroundColor: '#181818',
    title: 'Caret Agent',
    icon: path.join(APP_ROOT, 'resources', 'icon.png'),
    titleBarStyle: 'hidden',
    ...(isMac ? { trafficLightPosition: { x: 14, y: 12 } } : { titleBarOverlay: { color: '#0e0c0a', symbolColor: '#a0a0a0', height: 44 } }),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: false,
    },
  });
  // In the screenshot test the window must not steal focus or react to a real mouse or keyboard.
  win.once('ready-to-show', () => { if (ENV.CARET_SCREENSHOT) { win.setIgnoreMouseEvents(true); win.showInactive(); } else win.show(); });
  // Test hook: CARET_SCREENSHOT=file.png saves a picture of the window after start-up.
  if (ENV.CARET_SCREENSHOT) {
    win.webContents.on('console-message', (_e, level, message) => { if (level >= 2) console.log('[renderer]', message); });
    win.webContents.once('did-finish-load', () => setTimeout(async () => {
      if (ENV.CARET_EVAL) {
        try { console.log('[eval]', JSON.stringify(await win.webContents.executeJavaScript(ENV.CARET_EVAL))); } catch (e) { console.log('[eval error]', e.message); }
        await new Promise(r => setTimeout(r, Number(ENV.CARET_EVAL_WAIT || 800)));
      }
      const img = await win.webContents.capturePage();
      fs.writeFileSync(ENV.CARET_SCREENSHOT, img.toPNG());
      console.log('screenshot saved');
    }, Number(ENV.CARET_SCREENSHOT_DELAY || 5000)));
  }
  // Zoom (Ctrl +, Ctrl -, Ctrl 0): the app has no menu bar on Windows and Linux, so the usual shortcuts need to be handled here.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !(input.control || input.meta) || input.alt) return;
    const wc = win.webContents;
    if (input.key === '=' || input.key === '+') { wc.setZoomLevel(Math.min(3, wc.getZoomLevel() + 0.5)); event.preventDefault(); }
    else if (input.key === '-' || input.key === '_') { wc.setZoomLevel(Math.max(-3, wc.getZoomLevel() - 0.5)); event.preventDefault(); }
    else if (input.key === '0') { wc.setZoomLevel(0); event.preventDefault(); }
  });
  win.loadURL(`${SCHEME}://app/index.html`);

  // The app window never navigates away or opens other windows.
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => { openExternalSafe(url); return { action: 'deny' }; });
  win.on('closed', () => { win = null; });
}

function openExternalSafe(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:' || u.protocol === 'http:') shell.openExternal(u.toString());
  } catch {}
}

const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\]):\d{2,5}(\/.*)?$/i;
function openPreview(url) {
  if (!LOCAL.test(url)) return;
  if (preview && !preview.isDestroyed()) { preview.loadURL(url); preview.show(); preview.focus(); return; }
  preview = new BrowserWindow({
    width: 1100, height: 760, title: 'Preview', autoHideMenuBar: true, backgroundColor: '#ffffff',
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: 'preview' },
  });
  preview.webContents.setWindowOpenHandler(({ url: u }) => { if (LOCAL.test(u)) preview.loadURL(u); else openExternalSafe(u); return { action: 'deny' }; });
  preview.webContents.on('will-navigate', (e, u) => { if (!LOCAL.test(u)) { e.preventDefault(); openExternalSafe(u); } });
  preview.loadURL(url);
  preview.on('closed', () => { preview = null; });
}

const send = (channel, payload) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); };

// Only messages from our own page are answered.
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    const url = event.senderFrame?.url || '';
    if (!url.startsWith(`${SCHEME}://app/`)) throw new Error('Blocked');
    return fn(...args);
  });
}

async function openFolder(dir) {
  const root = ws.setRoot(dir);
  settings.addRecentFolder(root);
  await memory.ensure().catch(() => {});
  terminals.setRootAll(root);
  agent.loadTabs();
  watchRoot(root);
  return { root, name: path.basename(root) };
}

let watcher = null;
let watchTimer = null;
function watchRoot(root) {
  try { watcher?.close(); } catch {}
  try {
    watcher = fs.watch(root, { recursive: true }, (_e, file) => {
      if (!file || /(^|[\\/])(node_modules|\.git)([\\/]|$)/.test(file)) return;
      clearTimeout(watchTimer);
      watchTimer = setTimeout(() => send('fs:changed', {}), 300);
    });
  } catch { watcher = null; }
}

function registerIpc() {
  handle('settings:get', () => settings.publicView());
  handle('settings:update', patch => settings.update(patch));
  handle('settings:setKey', (provider, key) => { settings.setKey(provider, key); return settings.publicView(); });

  handle('app:info', () => ({ platform: process.platform, version: app.getVersion(), user: require('os').userInfo().username }));
  handle('app:openExternal', url => openExternalSafe(url));
  // Looks at the newest GitHub release. Offline or no release yet counts as "nothing newer".
  handle('app:checkUpdate', async () => {
    const cur = app.getVersion();
    try {
      const r = await net.fetch('https://api.github.com/repos/plawanpawin-byte/Caret-Agent/releases/latest', { headers: { 'User-Agent': 'caret-agent' } });
      if (!r.ok) return { current: cur, latest: cur, newer: false };
      const j = await r.json();
      const latest = String(j.tag_name || '').replace(/^v/i, '') || cur;
      const n = s => s.split('.').map(x => parseInt(x, 10) || 0);
      const a = n(latest), b = n(cur);
      const newer = [0, 1, 2].some(i => { for (let k = 0; k < i; k++) if (a[k] !== b[k]) return false; return (a[i] || 0) > (b[i] || 0); });
      return { current: cur, latest, newer, url: j.html_url };
    } catch { return { current: cur, latest: cur, newer: false }; }
  });
  handle('app:preview', url => openPreview(url));

  handle('workspace:pick', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], title: 'Open Folder' });
    if (r.canceled || !r.filePaths[0]) return null;
    return openFolder(r.filePaths[0]);
  });
  handle('workspace:openRecent', async dir => {
    // Only folders the user already opened through the dialog can be reopened by path.
    if (!settings.load().recentFolders.includes(dir)) throw new Error('Unknown folder');
    if (!fs.existsSync(dir)) throw new Error('That folder no longer exists');
    return openFolder(dir);
  });
  handle('workspace:clone', async url => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], title: 'Choose where to clone', buttonLabel: 'Clone here' });
    if (r.canceled || !r.filePaths[0]) return null;
    const dest = await ws.cloneRepo(url, r.filePaths[0]);
    return openFolder(dest);
  });
  handle('workspace:current', () => ws.getRoot() ? { root: ws.getRoot(), name: path.basename(ws.getRoot()) } : null);
  handle('workspace:close', () => {
    try { watcher?.close(); } catch {}
    ws.closeRoot();
    settings.load().lastFolder = null;
    settings.update({});
    agent.loadTabs();
    return true;
  });
  handle('fs:list', p => ws.listDir(p));
  handle('fs:read', p => ws.readFile(p));
  handle('fs:readImage', p => ws.readImage(p));
  handle('fs:write', (p, c) => ws.writeFile(p, c).then(r => ({ path: r.path })));
  handle('fs:create', (p, isDir) => ws.createEntry(p, !!isDir));
  handle('fs:rename', (a, b) => ws.renameEntry(a, b));
  handle('fs:delete', p => ws.deleteEntry(p));
  handle('fs:search', q => ws.search(q));
  handle('fs:files', () => ws.listFiles());
  handle('fs:reveal', p => shell.showItemInFolder(ws.resolveSafe(p)));

  handle('term:create', () => terminals.create({ cwd: ws.getRoot() || require('os').homedir(), title: process.platform === 'win32' ? 'PowerShell' : path.basename(process.env.SHELL || 'bash') }));
  handle('term:list', () => terminals.list());
  handle('term:run', (id, cmd) => { terminals.run(id, cmd, { source: 'user', background: true, timeoutMs: 0 }).catch(e => send('term:data', { id, chunk: `\r\n${e.message}\r\n` })); return true; });
  handle('term:kill', id => terminals.kill(id));
  handle('term:close', id => terminals.close(id));

  handle('models:openrouter', async () => { const c = await models.openrouterCatalog(); return { featured: c.featured, all: c.all, enabled: await models.openrouterEnabled() }; });
  handle('providers:status', () => providers.status());
  handle('providers:install', id => providers.install(String(id), line => send('providers:progress', { id: String(id), line })).then(() => { models.catalog().catch(() => {}); return true; }));
  handle('providers:signIn', id => providers.signIn(String(id), line => send('providers:progress', { id: String(id), line })));
  handle('auth:account', () => auth.check());
  handle('auth:signIn', async () => { const a = await auth.signIn(); agent.loadTabs(); return a; });
  handle('auth:cancel', () => auth.cancel());
  handle('auth:signOut', async () => { const r = await auth.signOut(); agent.loadTabs(); return r; });
  handle('ext:status', () => extensions.status());
  handle('ext:install', (id, opts) => extensions.install(String(id), { token: String(opts?.token || '') }, line => send('ext:progress', { id: String(id), line })));
  handle('ext:uninstall', id => extensions.uninstall(String(id), line => send('ext:progress', { id: String(id), line })));
  handle('providers:checkKey', (apiId, key) => providers.checkKey(String(apiId), String(key || '')));
  handle('models:catalog', opts => models.catalog(opts || {}));
  handle('models:hardware', () => models.hardware());

  handle('agent:list', () => agent.listTabs());
  handle('agent:overview', () => agent.overview(settings.load().recentFolders));
  handle('agent:get', id => agent.getTab(id));
  handle('agent:new', () => agent.newTab());
  handle('agent:rename', (id, t) => agent.renameTab(id, t));
  handle('agent:delete', id => agent.deleteTab(id));
  handle('agent:send', req => { agent.send(req).catch(e => send('agent:event', { tab: req.tabId, type: 'error', text: e.message })); return true; });
  handle('agent:stop', id => agent.stop(id));
  handle('agent:approve', (reqId, decision) => agent.answerApproval(reqId, decision));

  terminals.on('created', t => send('term:created', t));
  terminals.on('data', d => send('term:data', d));
  terminals.on('exit', d => send('term:exit', d));
  terminals.on('closed', d => send('term:closed', d));
  terminals.on('url', d => send('term:url', d));
}

app.whenReady().then(async () => {
  nativeTheme.themeSource = 'dark';
  Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]) : null);

  protocol.handle(SCHEME, req => {
    const u = new URL(req.url);
    if (u.host !== 'app') return new Response('Not found', { status: 404 });
    const p = decodeURIComponent(u.pathname);
    if (p.startsWith('/monaco/')) return serveFile(MONACO, p.slice('/monaco/'.length));
    return serveFile(RENDERER, p.slice(1) || 'index.html');
  });

  // Deny camera, mic, location, notifications… except clipboard for pasting images.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'clipboard-sanitized-write' || permission === 'clipboard-read'));

  agent.init({ emit: ev => send('agent:event', ev), openPreview, onFileChanged: f => send('fs:changed', { file: f }) });
  registerIpc();

  const s = settings.load();
  if (s.lastFolder && fs.existsSync(s.lastFolder)) { try { await openFolder(s.lastFolder); } catch {} }
  else agent.loadTabs();

  createWindow();
});

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (!win) createWindow(); });
app.on('before-quit', () => { agent.shutdown(); terminals.killAll(); });
app.on('web-contents-created', (_e, wc) => {
  wc.on('will-attach-webview', e => e.preventDefault());
});
