'use strict';
// Tools for models that Caret Agent drives itself (local models, Grok,
// Gemini, OpenAI API). Claude Code and Codex bring their own tools.
const ws = require('./workspace');
const memory = require('./memory');
const terminals = require('./terminal');

const fn = (name, description, properties, required = []) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } });

const ALL = {
  list_dir: fn('list_dir', 'List files and folders. Path is relative to the project folder.', { path: { type: 'string', description: 'Folder, e.g. "." or "src"' } }),
  read_file: fn('read_file', 'Read a text file. Returns numbered lines.', { path: { type: 'string' }, start_line: { type: 'integer' }, end_line: { type: 'integer' } }, ['path']),
  search: fn('search', 'Find text in all project files (case-insensitive). Returns file:line matches.', { query: { type: 'string' } }, ['query']),
  write_file: fn('write_file', 'Create a file or replace its whole content.', { path: { type: 'string' }, content: { type: 'string' } }, ['path', 'content']),
  edit_file: fn('edit_file', 'Replace an exact piece of text in a file. old_text must appear exactly once unless replace_all is true.', { path: { type: 'string' }, old_text: { type: 'string' }, new_text: { type: 'string' }, replace_all: { type: 'boolean' } }, ['path', 'old_text', 'new_text']),
  delete_file: fn('delete_file', 'Move a file or folder to the recycle bin. Only use it when the user asked to remove something. Never delete a file in order to rewrite it: write_file already replaces the whole content.', { path: { type: 'string' } }, ['path']),
  run_command: fn('run_command', 'Run a shell command in the project folder, in a terminal the user can see. Use background:true for servers and watchers (returns after start-up with any local URL).', { command: { type: 'string' }, background: { type: 'boolean' } }, ['command']),
  open_preview: fn('open_preview', 'Open a local web address (http://localhost:PORT) in the app\'s preview window.', { url: { type: 'string' } }, ['url']),
  update_progress: fn('update_progress', 'Save the hand-off note for the next AI in .caret/HANDOFF.md. Call this before you finish.', { state: { type: 'string', description: 'What the project is, what is done, what is half-done' }, next_steps: { type: 'array', items: { type: 'string' } } }, ['state', 'next_steps']),
  update_tasks: fn('update_tasks', 'Show the user your task list. Call it first to split the request into short steps, and again whenever a step starts or finishes.', { tasks: { type: 'array', items: { type: 'object', properties: { content: { type: 'string', description: 'The step, a few words' }, status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] } }, required: ['content', 'status'] } } }, ['tasks']),
  write_plan: fn('write_plan', 'Save a plan to .caret/PLAN.md (Markdown).', { content: { type: 'string' } }, ['content']),
};

const BY_MODE = {
  plan: ['list_dir', 'read_file', 'search', 'write_plan', 'update_progress'],
  code: ['update_tasks', 'list_dir', 'read_file', 'search', 'write_file', 'edit_file', 'delete_file', 'run_command', 'update_progress'],
  agent: Object.keys(ALL),
};

function definitions(mode) { return (BY_MODE[mode] || BY_MODE.code).map(n => ALL[n]); }
function allowedIn(mode, name) { return (BY_MODE[mode] || BY_MODE.code).includes(name); }

const LOCAL_URL = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\]):\d{2,5}(\/[^\s]*)?$/i;

// Give every HTML page a logo even if the model forgot (rule in DESIGN.md).
function ensureFavicon(html) {
  if (!/<head[^>]*>/i.test(html)) return html;
  if (/<link[^>]+rel\s*=\s*["']?(shortcut\s+)?icon/i.test(html)) return html;
  const title = (/<title>([^<]*)<\/title>/i.exec(html) || [])[1] || '';
  const ch = (title.trim().match(/[A-Za-z0-9]/) || ['C'])[0].toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#2f6fdb"/><text x="32" y="44" text-anchor="middle" font-family="system-ui,Segoe UI,sans-serif" font-size="34" font-weight="700" fill="#fff">${ch}</text></svg>`;
  const tag = `\n  <link rel="icon" href="data:image/svg+xml,${encodeURIComponent(svg)}">`;
  return html.replace(/<head[^>]*>/i, m => m + tag);
}

// After a model writes a plain .js file, tell it at once if the file cannot even be parsed, so it fixes it instead of moving on.
function syntaxNote(file, code) {
  if (!/\.(js|cjs)$/i.test(file) || /^\s*(import|export)\s/m.test(code)) return '';
  try { new (require('vm').Script)(code, { filename: file }); return ''; }
  catch (e) { return ` WARNING: ${file} has a JavaScript syntax error (${e.message}). Read the file and fix it now.`; }
}

function numbered(text, start = 1, end) {
  const lines = text.split(/\r?\n/);
  const s = Math.max(1, start || 1);
  const e = Math.min(lines.length, end || lines.length);
  let out = '';
  for (let i = s; i <= e; i++) out += `${String(i).padStart(5)}  ${lines[i - 1]}\n`;
  if (out.length > 60000) out = out.slice(0, 60000) + `\n…(truncated; read a smaller range with start_line/end_line — file has ${lines.length} lines)`;
  return out || '(empty file)';
}

// Executes one tool call. `run` holds per-turn state (changed files, terminal…).
async function execute(name, args, run) {
  args = args || {};
  switch (name) {
    case 'list_dir': {
      const items = await ws.listDir(args.path || '.');
      return items.map(i => `${i.dir ? '[dir] ' : '      '}${i.path}${i.ignored ? '  (dependencies/build — usually skip)' : ''}`).join('\n') || '(empty folder)';
    }
    case 'read_file': {
      const text = await ws.readFile(args.path, 2 * 1024 * 1024);
      return numbered(text, args.start_line, args.end_line);
    }
    case 'search': {
      const res = await ws.search(args.query, { max: 120 });
      return res.length ? res.map(r => `${r.path}:${r.line}: ${r.text}`).join('\n') : 'No matches.';
    }
    case 'write_file': {
      let content = String(args.content ?? '');
      if (/\.html?$/i.test(args.path)) content = ensureFavicon(content);
      // A small model often "rewrites" a file by writing a much shorter version and silently drops half of it. Ask once before allowing that.
      let old = null;
      try { old = await ws.readFile(args.path, 2 * 1024 * 1024); } catch {}
      if (old && old.length > 600 && content.length < old.length * 0.6) {
        run.shrinkWarned = run.shrinkWarned || new Set();
        if (!run.shrinkWarned.has(args.path)) {
          run.shrinkWarned.add(args.path);
          throw new Error(`write_file would replace ${old.length} characters of ${args.path} with only ${content.length}, so most of the existing code would be lost. To add or change something, use edit_file on just that part. If you really mean to shrink the file, call write_file again with the same content.`);
        }
      }
      const r = await ws.writeFile(args.path, content);
      run.files.push(r.path);
      run.onFileChanged(r.path);
      return `${r.created ? 'Created' : 'Updated'} ${r.path} (${content.split('\n').length} lines).` + syntaxNote(r.path, content);
    }
    case 'edit_file': {
      const text = await ws.readFile(args.path);
      const oldText = String(args.old_text ?? '');
      if (!oldText) throw new Error('old_text is empty. To add something, put one line that already exists in the file in old_text, and repeat that line in new_text together with your addition. To replace the whole file, use write_file instead.');
      const count = text.split(oldText).length - 1;
      if (count === 0) {
        // Point at the closest real line, so a small model can fix its copy instead of guessing again.
        const key = oldText.split('\n').map(l => l.trim()).find(l => l.length > 3);
        const lines = text.split('\n');
        const squash = x => x.replace(/\s+/g, ''); // models often get spacing wrong, so compare without whitespace
        const at = key ? lines.findIndex(l => squash(l).includes(squash(key))) : -1;
        const hint = at >= 0 ? ` A line containing "${key.slice(0, 60)}" does exist at line ${at + 1}: ${JSON.stringify(lines[at].slice(0, 160))} — copy it exactly, including the indentation.` : '';
        throw new Error('old_text was not found in the file. Read the file again and copy the text exactly (including spaces and indentation).' + hint);
      }
      if (count > 1 && !args.replace_all) throw new Error(`old_text appears ${count} times. Include more surrounding lines so it is unique, or set replace_all.`);
      let next = args.replace_all ? text.split(oldText).join(String(args.new_text ?? '')) : text.replace(oldText, () => String(args.new_text ?? ''));
      if (/\.html?$/i.test(args.path)) next = ensureFavicon(next);
      const r = await ws.writeFile(args.path, next);
      run.files.push(r.path);
      run.onFileChanged(r.path);
      return `Edited ${r.path} (${args.replace_all ? count : 1} change${count > 1 && args.replace_all ? 's' : ''}).` + syntaxNote(r.path, next);
    }
    case 'delete_file': {
      await ws.deleteEntry(args.path);
      run.files.push(String(args.path));
      run.onFileChanged(String(args.path));
      return `Moved ${args.path} to the recycle bin.`;
    }
    case 'run_command': {
      if (!ws.getRoot()) throw new Error('Open a folder first');
      const termId = run.terminalFor(!!args.background);
      run.commands++;
      const r = await terminals.run(termId, String(args.command || ''), { source: 'ai', background: !!args.background, timeoutMs: 180000 });
      let out = r.output.trim() || '(no output)';
      if (r.running) out += `\n[still running in the background${r.urls.length ? ` at ${r.urls.join(', ')}` : ''}]`;
      else out += `\n[exit code ${r.exitCode ?? '?'}]`;
      return out;
    }
    case 'open_preview': {
      const url = String(args.url || '').replace('0.0.0.0', 'localhost');
      if (!LOCAL_URL.test(url)) throw new Error('Only local addresses like http://localhost:3000 can be previewed');
      run.openPreview(url);
      return `Opened ${url} in the preview window.`;
    }
    case 'update_progress':
      await memory.updateState(args);
      return 'Hand-off note saved to .caret/HANDOFF.md.';
    case 'update_tasks':
      return 'Task list shown to the user.';
    case 'write_plan':
      await memory.writePlan(args.content);
      run.files.push('.caret/PLAN.md');
      run.onFileChanged('.caret/PLAN.md');
      return 'Plan saved to .caret/PLAN.md.';
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// What the approval card shows.
async function preview(name, args) {
  try {
    if (name === 'write_file') {
      let before = null;
      try { before = await ws.readFile(args.path, 400000); } catch {}
      return { path: args.path, before: before?.slice(0, 6000) ?? null, after: String(args.content ?? '').slice(0, 6000) };
    }
    if (name === 'edit_file') return { path: args.path, before: String(args.old_text ?? '').slice(0, 6000), after: String(args.new_text ?? '').slice(0, 6000) };
    if (name === 'delete_file') return { path: args.path };
    if (name === 'run_command') return { command: args.command, background: !!args.background };
  } catch {}
  return {};
}

module.exports = { definitions, allowedIn, execute, preview, ensureFavicon };
