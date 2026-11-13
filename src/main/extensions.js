'use strict';
// Extensions: a short, curated list of add-ons for the Claude Code app on this computer (MCP servers,
// skill packs, command-line tools). They are installed and removed here, never by sending the person
// to a web page. Everything is run through Claude Code's own `claude mcp` / `claude plugin` commands
// or npm, so nothing is written to Claude's settings by hand.
const fs = require('fs');
const os = require('os');
const path = require('path');
const cli = require('./cli');
const { stream } = require('./providers');

const HOME = os.homedir();
const IS_WIN = process.platform === 'win32';

const robloxBat = () => path.join(process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local'), 'Roblox', 'mcp.bat');

// Each entry says what it is, where it comes from, and how it is detected, installed and removed.
const CATALOG = [
  {
    id: 'github-mcp', name: 'GitHub', by: 'GitHub', category: 'MCP', group: 'Source control', repo: 'github/github-mcp-server', recommended: true,
    summary: 'Let the AI read repositories, open issues and pull requests, and check Actions runs.',
    about: [
      'The official GitHub MCP server. It connects the AI to GitHub so it can browse code, search files, create and update issues and pull requests, and look at workflow runs, without you copying anything by hand.',
      'It uses the GitHub account you signed in to Caret Agent with. Press Install, allow access on the GitHub page that opens (repo and read:org), and you are done: no token to create or paste. Caret Agent passes the access to Claude Code, which keeps it in its own settings file on this computer. Uninstall removes it.',
    ],
    features: ['Browse and search code in any repository you can see', 'Create and update issues and pull requests', 'Read GitHub Actions runs and logs', 'Hosted by GitHub, nothing to run locally'],
    needsToken: false, // uses the GitHub sign-in; a pasted token is still accepted
    detect: s => s.mcp.has('github'),
  },
  {
    id: 'superpowers', name: 'Superpowers', by: 'Jesse Vincent (obra)', category: 'Skills', group: 'Skills and tools', repo: 'obra/superpowers', recommended: true,
    summary: 'A development method for your agent: brainstorm, write a plan, then build it test-first with reviews.',
    about: [
      'Superpowers is a set of skills that make the AI work like a careful engineer. It asks what you really want, writes a design you can read in small pieces, turns it into a plan, and then builds it step by step with tests and reviews.',
      'The skills turn on by themselves; there is nothing to learn or type. It installs as a Claude Code plugin from the author\'s plugin catalog.',
    ],
    features: ['Asks questions and writes a spec before any code', 'Plans in small tasks, test-first', 'Reviews each step before moving on', 'MIT licensed'],
    detect: s => [...s.plugins].some(k => /^superpowers@/.test(k)),
  },
  {
    id: 'aislop', name: 'aislop', by: 'scanaislop', category: 'Skills', group: 'Skills and tools', repo: 'scanaislop/aislop', recommended: true,
    summary: 'Catches the leftovers AI agents write: dead code, swallowed errors, unsafe casts, duplicated helpers.',
    about: [
      'aislop is a fast checker for the patterns coding agents leave behind. It scores a change from 0 to 100 and needs no AI to run, so the same code always gives the same score.',
      'It installs as a command-line tool with npm and adds a hook, so Claude Code fixes the problems right after each edit. Node.js must be installed.',
    ],
    features: ['50+ rules for 11 languages', 'Scores every change from 0 to 100', 'Runs in under a second, no AI involved', 'MIT licensed'],
    needs: 'npm',
    detect: async () => !!cli.which('aislop'),
  },
  {
    id: 'rea', name: 'REA: Reverse Engineer Anything', by: 'morluto', category: 'Skills', group: 'Skills and tools', repo: 'morluto/rea', recommended: true,
    summary: 'Understand how an app works, from its behaviour down to the binary, and rebuild a similar feature.',
    about: [
      'REA gives the AI tools to inspect programs: native binaries, Electron and JavaScript apps, web pages and running processes. You describe a feature you like, and it gathers the evidence of how it works.',
      'It runs on this computer through npx, so Node.js must be installed. Use it only on software you are allowed to study.',
    ],
    features: ['Native, managed, Electron and web targets', 'Shows the evidence for each answer', 'Runs locally', 'MIT licensed'],
    needs: 'npm',
    detect: s => s.mcp.has('rea'),
  },
  {
    id: 'roblox-studio', name: 'Roblox Studio', by: 'Roblox', category: 'MCP', group: 'Game development', repo: 'create.roblox.com/docs/studio/mcp', recommended: true,
    summary: 'Let the AI build and edit a Roblox game inside Studio: scripts, parts, UI, and playtests.',
    about: [
      'Roblox Studio ships its own MCP server. Once connected, the AI can read and change what is open in Studio: scripts, the explorer tree, properties and assets, and it can start a playtest and read the console.',
      'Roblox Studio must be installed on this computer and open while you work. Caret Agent connects the server that Studio installed; it does not download anything.',
    ],
    features: ['Create and edit scripts and instances', 'Search the game tree and read properties', 'Start and stop playtests, read the console', 'Insert assets from the catalog'],
    needs: 'roblox',
    detect: s => s.mcp.has('roblox-studio') || s.mcp.has('Roblox_Studio'),
  },
];

// ---- Connectors that are plain MCP servers: described by data, installed by one generic routine. ----
// Versions of npm packages are pinned so a later release cannot change what runs on this computer.
// A connector that needs a key asks for the person's OWN key and checks its shape before anything is run;
// nothing here carries a key of ours, so every user connects their own account.
const mcp = o => ({ category: 'MCP', recommended: true, ...o });
CATALOG.push(
  mcp({ id: 'cloudflare', name: 'Cloudflare', by: 'Cloudflare', group: 'Cloud and hosting', repo: 'developers.cloudflare.com/agents/model-context-protocol',
    summary: 'Let the AI manage your Cloudflare account: Workers, DNS, KV, R2, D1 and more.',
    about: ['The official Cloudflare MCP server. The AI can look up and change resources in your Cloudflare account through the Cloudflare API.',
      'It uses an API token that YOU create, so it only ever acts on your own account and only with the permissions you give that token. Nobody else can use it, and Caret Agent never ships a token of its own.'],
    features: ['Deploy and inspect Workers', 'Manage DNS, KV, R2 and D1', 'Limited by the permissions of your token', 'Hosted by Cloudflare'],
    token: { label: 'Your Cloudflare API token', hint: 'Create one at dash.cloudflare.com/profile/api-tokens and give it only the permissions you want the AI to have.', re: /^[A-Za-z0-9_-]{30,80}$/ },
    http: { url: 'https://mcp.cloudflare.com/mcp', header: 'Authorization', prefix: 'Bearer ' } }),
  mcp({ id: 'cloudflare-docs', name: 'Cloudflare Docs', by: 'Cloudflare', group: 'Cloud and hosting', repo: 'docs.mcp.cloudflare.com',
    summary: 'Up to date Cloudflare documentation for the AI. No account or key needed.',
    about: ['Search the current Cloudflare developer documentation, so the AI does not guess how Workers, R2 or D1 work.'],
    features: ['Always current docs', 'No account, no key', 'Hosted by Cloudflare'],
    http: { url: 'https://docs.mcp.cloudflare.com/mcp' } }),
  mcp({ id: 'supabase', name: 'Supabase', by: 'Supabase', group: 'Cloud and hosting', repo: 'supabase-community/supabase-mcp', needs: 'npm',
    summary: 'Query and manage your Supabase projects: tables, SQL, migrations and logs.',
    about: ['The official Supabase MCP server runs on this computer and talks to your Supabase projects with a personal access token that you create.'],
    features: ['Design tables and run SQL', 'Apply migrations', 'Read logs and advisors'],
    token: { label: 'Your Supabase access token', hint: 'Create one under Account, Access Tokens in the Supabase dashboard.', re: /^sbp_[A-Za-z0-9]{20,100}$/ },
    local: { pkg: '@supabase/mcp-server-supabase@0.17.0', envKey: 'SUPABASE_ACCESS_TOKEN' } }),
  mcp({ id: 'firebase', name: 'Firebase', by: 'Google', group: 'Cloud and hosting', repo: 'firebase/firebase-tools', needs: 'npm',
    summary: 'Work with Firebase projects: Firestore, Auth, hosting and more.',
    about: ['The Firebase MCP server. It uses the account you are signed in with in the Firebase command line tool on this computer.'],
    features: ['Firestore, Auth and Functions', 'Uses your own Firebase login'],
    local: { pkg: 'firebase-tools@15.36.0', bin: ['mcp'] } }),
  mcp({ id: 'context7', name: 'Context7', by: 'Upstash', group: 'Docs and planning', repo: 'upstash/context7', needs: 'npm',
    summary: 'Fresh, version-correct library documentation for the AI, so it stops using outdated APIs.',
    about: ['Pulls the current docs and code examples for the library you are using straight into the conversation.'],
    features: ['Thousands of libraries', 'No key needed', 'Runs on this computer'],
    local: { pkg: '@upstash/context7-mcp@4.7.0' } }),
  mcp({ id: 'sequential-thinking', name: 'Sequential Thinking', by: 'Model Context Protocol', group: 'Docs and planning', repo: 'modelcontextprotocol/servers', needs: 'npm',
    summary: 'Helps the AI break a hard problem into steps and revise them as it goes.',
    about: ['A small reference server that gives the AI a structured way to think through multi-step problems.'],
    features: ['Step-by-step reasoning', 'Runs on this computer', 'No key needed'],
    local: { pkg: '@modelcontextprotocol/server-sequential-thinking@2.1.1' } }),
  mcp({ id: 'notion', name: 'Notion', by: 'Notion', group: 'Docs and planning', repo: 'makenotion/notion-mcp-server', needs: 'npm',
    summary: 'Read and write pages and databases in your Notion workspace.',
    about: ['The Notion MCP server runs on this computer with an integration token that YOU create. It can only see the pages you share with that integration.'],
    features: ['Search, read and edit pages', 'Query databases', 'Only the pages you share'],
    token: { label: 'Your Notion integration token', hint: 'Create an integration at notion.so/profile/integrations and share the pages you want with it.', re: /^(ntn|secret)_[A-Za-z0-9]{20,100}$/ },
    local: { pkg: '@notionhq/notion-mcp-server@2.6.1', envKey: 'NOTION_TOKEN' } }),
  mcp({ id: 'linear', name: 'Linear', by: 'Linear', group: 'Docs and planning', repo: 'linear.app/docs/mcp',
    summary: 'Find, create and update Linear issues and projects.',
    about: ['The hosted Linear MCP server. It uses a personal API key that YOU create, so it acts as you and nobody else.'],
    features: ['Search and update issues', 'Projects and cycles', 'Hosted by Linear'],
    token: { label: 'Your Linear API key', hint: 'Create one in Linear under Settings, Account, Security and access.', re: /^lin_api_[A-Za-z0-9]{30,80}$/ },
    http: { url: 'https://mcp.linear.app/mcp', header: 'Authorization', prefix: 'Bearer ' } }),
  mcp({ id: 'playwright', name: 'Playwright', by: 'Microsoft', group: 'Browser and testing', repo: 'microsoft/playwright-mcp', needs: 'npm',
    summary: 'Let the AI open a real browser, click through your app and check that it works.',
    about: ['Browser automation for the AI using Playwright. It sees the page the way a user does and can test the app it just built.'],
    features: ['Opens and drives a real browser', 'Reads pages and takes screenshots', 'No key needed'],
    local: { pkg: '@playwright/mcp@0.0.85' } }),
  mcp({ id: 'chrome-devtools', name: 'Chrome DevTools', by: 'Google', group: 'Browser and testing', repo: 'ChromeDevTools/chrome-devtools-mcp', needs: 'npm',
    summary: 'Debug and measure web pages in Chrome: console, network, performance.',
    about: ['Gives the AI the tools of Chrome DevTools to find why a page is slow or broken.'],
    features: ['Console and network inspection', 'Performance traces', 'No key needed'],
    local: { pkg: 'chrome-devtools-mcp@1.13.0' } }),
);
const mcpName = e => e.mcpName || (e.id === 'github-mcp' ? 'github' : e.id);

const find = id => CATALOG.find(e => e.id === id);

function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }

async function state() {
  const mcp = new Set(Object.keys(readJson(path.join(HOME, '.claude.json'))?.mcpServers || {}));
  const plugins = new Set(Object.keys(readJson(path.join(HOME, '.claude', 'plugins', 'installed_plugins.json'))?.plugins || {}));
  return { mcp, plugins };
}

async function status() {
  const s = await state();
  const claude = !!cli.resolveCli('claude');
  const out = [];
  for (const e of CATALOG) {
    let installed = false;
    try { installed = e.detect ? !!(await e.detect(s)) : s.mcp.has(mcpName(e)); } catch {}
    const { detect, http, local, token, ...pub } = e;
    out.push({ ...pub, needsToken: !!token || !!e.needsToken, tokenLabel: token?.label, tokenHint: token?.hint, installed, blocked: blocker(e, claude) });
  }
  return { claude, items: out };
}

// Why an extension cannot be installed right now (shown instead of a failing button), or null.
function blocker(e, claude) {
  if (e.id !== 'aislop' && !claude) return 'Claude Code is not installed yet. Set it up from the model menu first.';
  if (e.needs === 'npm' && !cli.resolveNpm()) return 'Node.js is needed for this. Get it from nodejs.org, then try again.';
  if (e.needs === 'roblox' && !fs.existsSync(robloxBat())) return 'Roblox Studio was not found on this computer. Install and open Roblox Studio first.';
  return null;
}

const busy = new Set();

function runClaude(args, onLine, timeout = 5 * 60 * 1000) {
  const c = cli.resolveCli('claude');
  if (!c) return Promise.resolve({ ok: false, error: 'Claude Code is not installed.' });
  return stream(c.cmd, [...c.args, ...args], onLine, timeout, c.env);
}
function runNpm(args, onLine, timeout = 10 * 60 * 1000) {
  const n = cli.resolveNpm();
  if (!n) return Promise.resolve({ ok: false, error: 'Node.js is needed for this.' });
  return stream(n.cmd, [...n.args, ...args], onLine, timeout, n.env);
}

// A token goes to Claude Code as a header value. It must be a plain token: no spaces, quotes or line breaks.
const TOKEN_OK = /^[A-Za-z0-9_\-.]{20,255}$/;

async function install(id, opts, onLine) {
  const e = find(id);
  if (!e) throw new Error('Unknown extension.');
  if (busy.has(id)) throw new Error('Already working on it.');
  const claude = !!cli.resolveCli('claude');
  const why = blocker(e, claude);
  if (why) throw new Error(why);
  busy.add(id);
  try {
    let r;
    const step = async (res, fail) => { if (!res.ok) throw new Error(fail || res.error || 'The install failed.'); };
    if (id === 'github-mcp') {
      let token = String(opts?.token || '').trim();
      if (!token) { // no pasted token: use the GitHub account the person signed in with (they approve it on the website)
        if (!require('./settings').publicView().account) throw new Error('Sign in to Caret Agent first.');
        onLine('Waiting for you to allow GitHub access in the browser…');
        token = (await require('./auth').grantGithub()).githubToken;
      }
      if (!TOKEN_OK.test(token)) throw new Error('That does not look like a GitHub token. Paste the whole token, with no spaces.');
      onLine('claude mcp add github');
      await run(runClaude(['mcp', 'remove', '--scope', 'user', 'github'], () => {}), true);
      r = await runClaude(['mcp', 'add', '--scope', 'user', '--transport', 'http', 'github', 'https://api.githubcopilot.com/mcp/', '-H', `Authorization: Bearer ${token}`], line => onLine(line.replace(token, '••••')));
      await step(r);
    } else if (e.http || e.local) {
      const name = mcpName(e);
      let tok = '';
      if (e.token) {
        tok = String(opts?.token || '').trim();
        if (!e.token.re.test(tok)) throw new Error(`That does not look like a valid ${e.token.label.replace(/^Your /, '')}. Paste the whole value, with no spaces.`);
      }
      onLine(`claude mcp add ${name}`);
      await run(runClaude(['mcp', 'remove', '--scope', 'user', name], () => {}), true);
      const hide = line => (tok ? String(line).split(tok).join('••••') : line);
      if (e.http) {
        const args = ['mcp', 'add', '--scope', 'user', '--transport', 'http', name, e.http.url];
        if (tok) args.push('-H', `${e.http.header}: ${e.http.prefix || ''}${tok}`);
        r = await runClaude(args, line => onLine(hide(line)));
      } else {
        const npx = IS_WIN ? ['cmd', '/c', 'npx'] : ['npx'];
        const args = ['mcp', 'add', '--scope', 'user'];
        if (tok && e.local.envKey) args.push('-e', `${e.local.envKey}=${tok}`);
        args.push(name, '--', ...npx, '-y', e.local.pkg, ...(e.local.bin || []));
        r = await runClaude(args, line => onLine(hide(line)));
      }
      await step(r);
    } else if (id === 'superpowers') {
      onLine('Adding the Superpowers catalog…');
      await run(runClaude(['plugin', 'marketplace', 'add', 'obra/superpowers-marketplace'], onLine), true);
      onLine('Installing the plugin…');
      r = await runClaude(['plugin', 'install', 'superpowers@superpowers-marketplace'], onLine);
      await step(r);
    } else if (id === 'aislop') {
      onLine('npm install -g aislop');
      r = await runNpm(['install', '-g', 'aislop'], onLine);
      await step(r);
      cli.clearCache(); cli.fixPath();
      if (!cli.which('aislop')) throw new Error('Installed, but "aislop" was not found on PATH. Restart Caret Agent and try again.');
      onLine('Adding the Claude Code hook…');
      const a = cli.resolveCli('aislop');
      if (a) await run(stream(a.cmd, [...a.args, 'hook', 'install', '--claude'], onLine, 60 * 1000, a.env), true);
    } else if (id === 'rea') {
      onLine('claude mcp add rea');
      await run(runClaude(['mcp', 'remove', '--scope', 'user', 'rea'], () => {}), true);
      const npx = IS_WIN ? ['cmd', '/c', 'npx'] : ['npx'];
      r = await runClaude(['mcp', 'add', '--scope', 'user', 'rea', '--', ...npx, '-y', 'rea-agents@6.9.0', 'mcp'], onLine);
      await step(r);
    } else if (id === 'roblox-studio') {
      onLine('claude mcp add roblox-studio');
      await run(runClaude(['mcp', 'remove', '--scope', 'user', 'roblox-studio'], () => {}), true);
      r = await runClaude(['mcp', 'add', '--scope', 'user', 'roblox-studio', '--', robloxBat()], onLine);
      await step(r);
    }
    return true;
  } finally { busy.delete(id); }
}

// Used for clean-up steps whose failure does not matter (nothing there to remove yet).
async function run(promise, ignore) { const r = await promise; if (!ignore && !r.ok) throw new Error(r.error); return r; }

async function uninstall(id, onLine) {
  const e = find(id);
  if (!e) throw new Error('Unknown extension.');
  if (busy.has(id)) throw new Error('Already working on it.');
  busy.add(id);
  try {
    let r;
    if (id === 'superpowers') {
      const s = await state();
      const key = [...s.plugins].find(k => /^superpowers@/.test(k)) || 'superpowers@superpowers-marketplace';
      r = await runClaude(['plugin', 'uninstall', key], onLine);
    } else if (id === 'aislop') {
      const a = cli.resolveCli('aislop');
      if (a) await run(stream(a.cmd, [...a.args, 'hook', 'uninstall', '--claude'], onLine, 60 * 1000, a.env), true);
      r = await runNpm(['uninstall', '-g', 'aislop'], onLine);
      cli.clearCache();
    } else {
      r = await runClaude(['mcp', 'remove', '--scope', 'user', mcpName(e)], onLine);
    }
    if (!r.ok) throw new Error(r.error || 'Could not remove it.');
    return true;
  } finally { busy.delete(id); }
}

module.exports = { status, install, uninstall, CATALOG };
