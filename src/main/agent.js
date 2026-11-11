'use strict';
// Chat tabs and the agent loop. Any number of tabs can run at once; each has
// its own model, mode and permission, and they all share .caret/HANDOFF.md.
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { app } = require('electron');

const ws = require('./workspace');
const memory = require('./memory');
const settings = require('./settings');
const models = require('./models');
const tools = require('./tools');
const prompt = require('./prompt');
const permissions = require('./permissions');
const terminals = require('./terminal');
const llm = require('./llm');
const runners = require('./runners');

let emit = () => {};
let openPreview = () => {};
let onFileChanged = () => {};
function init(hooks) { emit = hooks.emit; openPreview = hooks.openPreview; onFileChanged = hooks.onFileChanged; }

const MAX_STEPS = { plan: 14, code: 30, agent: 80 };

// ---------- storage ----------
let tabs = new Map();
let storeFile = null;
let saveTimer = null;

function storePath() {
  const key = crypto.createHash('sha1').update(ws.getRoot() || '(no folder)').digest('hex').slice(0, 16);
  return path.join(app.getPath('userData'), 'chats', key + '.json');
}

function loadTabs() {
  for (const id of running.keys()) stop(id);
  storeFile = storePath();
  tabs = new Map();
  try {
    const data = JSON.parse(fs.readFileSync(storeFile, 'utf8'));
    for (const t of data.tabs || []) tabs.set(t.id, t);
  } catch {}
}

function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(storeFile), { recursive: true });
      const list = [...tabs.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 100);
      fs.writeFileSync(storeFile + '.tmp', JSON.stringify({ tabs: list }));
      fs.renameSync(storeFile + '.tmp', storeFile);
    } catch {}
  }, 400);
}

function summary(t) { return { id: t.id, title: t.title, updatedAt: t.updatedAt, running: running.has(t.id), model: t.lastModel || null }; }
function listTabs() { return [...tabs.values()].sort((a, b) => b.updatedAt - a.updatedAt).map(summary); }
function getTab(id) { const t = tabs.get(id); return t ? { ...summary(t), transcript: t.transcript } : null; }

function newTab() {
  const t = { id: 'c' + crypto.randomBytes(5).toString('hex'), title: 'New chat', createdAt: Date.now(), updatedAt: Date.now(), transcript: [], history: [], claudeSession: null, lastProvider: null, lastModel: null };
  tabs.set(t.id, t);
  persist();
  return summary(t);
}
function renameTab(id, title) { const t = tabs.get(id); if (t && typeof title === 'string') { t.title = title.slice(0, 80) || t.title; persist(); } }
function deleteTab(id) { stop(id); tabs.delete(id); persist(); }

// ---------- approvals ----------
const approvals = new Map(); // reqId -> { resolve, tabId }
function requestApproval(tabId, tool, args, reason, previewData) {
  return new Promise(resolve => {
    const reqId = crypto.randomBytes(8).toString('hex');
    approvals.set(reqId, { resolve, tabId });
    emit({ tab: tabId, type: 'approval', reqId, tool, args: sanitizeArgs(args), reason, preview: previewData });
  });
}
function answerApproval(reqId, decision) {
  const a = approvals.get(reqId);
  if (!a) return;
  approvals.delete(reqId);
  a.resolve(['allow', 'always', 'deny'].includes(decision) ? decision : 'deny');
}
function cancelApprovals(tabId) {
  for (const [id, a] of approvals) if (a.tabId === tabId) { approvals.delete(id); a.resolve('deny'); emit({ tab: tabId, type: 'approval-closed', reqId: id }); }
}
const sanitizeArgs = a => { try { return JSON.parse(JSON.stringify(a ?? {}, (k, v) => typeof v === 'string' && v.length > 8000 ? v.slice(0, 8000) + '…' : v)); } catch { return {}; } };

async function gate(run, tool, args) {
  const d = permissions.decide({ permission: run.permission, mode: run.mode, tool, args, alwaysAllowed: run.always });
  if (d.decision === 'allow') return { ok: true };
  if (d.decision === 'deny') return { ok: false, message: d.reason };
  const answer = await requestApproval(run.tabId, tool, args, d.reason, await tools.preview(tool, args));
  if (answer === 'always') { run.always.add(d.kind); return { ok: true }; }
  if (answer === 'allow') return { ok: true };
  return { ok: false, message: 'The user declined this. Ask what they want instead, or try a different approach.' };
}

// Local bridge so Claude Code's tool requests go through the same gate.
let bridge = null;
function startBridge() { return bridge || (bridge = makeBridge().catch(e => { bridge = null; throw e; })); }
async function makeBridge() {
  const token = crypto.randomBytes(24).toString('hex');
  const server = http.createServer((req, res) => {
    const given = Buffer.from(String(req.headers['x-caret-token'] || ''));
    const want = Buffer.from(token);
    if (req.method !== 'POST' || req.url !== '/approve' || given.length !== want.length || !crypto.timingSafeEqual(given, want)) { res.writeHead(403).end(); return; }
    let body = '';
    req.on('data', d => { body += d; if (body.length > 2e6) req.destroy(); });
    req.on('end', async () => {
      let j; try { j = JSON.parse(body); } catch { res.writeHead(400).end(); return; }
      const run = running.get(j.tab);
      let out = { behavior: 'deny', message: 'This chat is no longer running' };
      if (run) {
        const g = await gate(run, String(j.tool || ''), j.input || {});
        out = g.ok ? { behavior: 'allow' } : { behavior: 'deny', message: g.message };
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out));
    });
  });
  await new Promise((res, rej) => { server.once('error', rej); server.listen(0, '127.0.0.1', res); });
  return { server, token, port: server.address().port };
}

// ---------- running ----------
const running = new Map(); // tabId -> run

function stop(tabId) {
  const run = running.get(tabId);
  if (!run) return;
  run.stopped = true;
  run.abort.abort();
  run.stopCli?.();
  cancelApprovals(tabId);
}

let autoCache = { key: '', at: 0, value: null };
async function resolveModel(choice, mode, needVision) {
  if (choice && choice !== 'auto') {
    const i = choice.indexOf(':');
    return { provider: choice.slice(0, i), model: choice.slice(i + 1), reason: null };
  }
  const ck = `${mode}|${needVision}`;
  let auto;
  if (autoCache.key === ck && Date.now() - autoCache.at < 60000) auto = autoCache.value;
  else { auto = (await models.catalog({ mode, needVision })).auto; autoCache = { key: ck, at: Date.now(), value: auto }; }
  if (!auto.key) throw new Error(auto.reason);
  const i = auto.key.indexOf(':');
  return { provider: auto.key.slice(0, i), model: auto.key.slice(i + 1), reason: auto.reason };
}

async function saveAttachments(images) {
  const saved = [];
  for (const [n, img] of (images || []).slice(0, 8).entries()) {
    const m = /^data:(image\/(png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(img.dataUrl || '');
    if (!m) continue;
    const ext = m[2] === 'jpeg' ? 'jpg' : m[2];
    const entry = { mime: m[1], b64: m[3], path: null };
    if (ws.getRoot()) {
      await memory.ensure();
      entry.path = await ws.writeBinary(`.caret/attachments/${Date.now()}-${n}.${ext}`, m[3]);
    } else {
      const dir = path.join(app.getPath('temp'), 'caret-attachments');
      fs.mkdirSync(dir, { recursive: true });
      entry.path = path.join(dir, `${Date.now()}-${n}.${ext}`);
      fs.writeFileSync(entry.path, Buffer.from(m[3], 'base64'));
    }
    saved.push(entry);
  }
  return saved;
}

async function send({ tabId, text, images, mode, permission, model }) {
  const tab = tabs.get(tabId);
  if (!tab) throw new Error('Chat not found');
  if (running.has(tabId)) throw new Error('This chat is still working');
  text = String(text || '').slice(0, 100000);
  if (!text.trim() && !images?.length) return;
  mode = ['plan', 'code', 'agent'].includes(mode) ? mode : 'code';
  permission = ['ask', 'auto', 'full'].includes(permission) ? permission : 'ask';

  const run = { tabId, mode, permission, abort: new AbortController(), always: new Set(), files: [], commands: 0, stopped: false, terms: [] };
  running.set(tabId, run);
  emit({ tab: tabId, type: 'running', running: true });

  const attachments = await saveAttachments(images).catch(() => []);
  const userItem = { role: 'user', text, images: attachments.map(a => a.path).filter(Boolean), mode, at: Date.now() };
  tab.transcript.push(userItem);
  if (tab.title === 'New chat') tab.title = text.replace(/\s+/g, ' ').trim().slice(0, 48) || 'Image';
  tab.updatedAt = Date.now();
  const reply = { role: 'assistant', parts: [], at: Date.now() };
  tab.transcript.push(reply);
  persist();
  emit({ tab: tabId, type: 'user', item: userItem, title: tab.title });

  const lastPart = (type) => { const p = reply.parts[reply.parts.length - 1]; return p && p.type === type ? p : null; };
  const on = {
    text: t => { const p = lastPart('text') || (reply.parts.push({ type: 'text', text: '' }), lastPart('text')); p.text += t; emit({ tab: tabId, type: 'text', text: t }); },
    thinking: t => { const p = lastPart('thinking') || (reply.parts.push({ type: 'thinking', text: '' }), lastPart('thinking')); p.text += t; emit({ tab: tabId, type: 'thinking', text: t }); },
    tool: ev => {
      let p = reply.parts.find(x => x.type === 'tool' && x.id === ev.id);
      if (!p) { p = { type: 'tool', id: ev.id, name: ev.name, args: sanitizeArgs(ev.args), status: ev.status }; reply.parts.push(p); }
      else { Object.assign(p, { status: ev.status }); if (ev.result !== undefined) p.result = String(ev.result).slice(0, 4000); if (ev.name) p.name = ev.name; }
      emit({ tab: tabId, type: 'tool', part: p });
    },
    fileChanged: f => onFileChanged(f),
  };
  run.terminalFor = (background) => {
    const free = run.terms.find(id => !terminals.list().find(t => t.id === id)?.running);
    if (free && !background) return free;
    const id = terminals.create({ cwd: ws.getRoot(), title: `AI · ${tab.title.slice(0, 18)}` });
    run.terms.push(id);
    return id;
  };
  run.openPreview = url => { openPreview(url); emit({ tab: tabId, type: 'url', url }); };
  run.onFileChanged = f => onFileChanged(f);

  let label = '';
  try {
    const pick = await resolveModel(model, mode, attachments.length > 0);
    label = `${pick.provider}:${pick.model}`;
    reply.model = label;
    tab.lastModel = label;
    emit({ tab: tabId, type: 'model', model: label, reason: pick.reason });

    const ctx = ws.getRoot() ? await memory.context() : null;
    const overview = ws.getRoot() ? await ws.overview(250) : '';

    if (pick.provider === 'claude') {
      const system = prompt.build({ mode, permission, ctx, overview, forCli: true });
      let userText = text;
      // Switching to Claude mid-chat: give it the conversation so far.
      const resume = tab.lastProvider === 'claude' ? tab.claudeSession : null;
      if (!resume && tab.history.length) userText = recentHistory(tab) + '\n\nNEW REQUEST:\n' + text;
      const h = runners.runClaude({ tabId, model: pick.model, mode, permission, prompt: userText, system, sessionId: resume, bridge: await startBridge(), images: attachments.map(a => a.path), on });
      run.stopCli = h.stop;
      const r = await h.done;
      if (r.sessionId) tab.claudeSession = r.sessionId;
      run.files.push(...r.files); run.commands += r.commands;
      if (r.error && !run.stopped) throw new Error(r.error);
    } else if (pick.provider === 'codex') {
      const system = prompt.build({ mode, permission, ctx, overview, forCli: true });
      const userText = tab.history.length ? recentHistory(tab) + '\n\nNEW REQUEST:\n' + text : text;
      const h = runners.runCodex({ model: pick.model, mode, permission, prompt: userText, system, images: attachments.map(a => a.path && path.resolve(ws.getRoot() || '', a.path)), on });
      run.stopCli = h.stop;
      const r = await h.done;
      run.files.push(...r.files); run.commands += r.commands;
      if (r.error && !run.stopped) throw new Error(r.error);
    } else {
      await toolLoop({ run, tab, pick, ctx, overview, text, attachments, on });
    }
    tab.lastProvider = pick.provider;
  } catch (e) {
    if (!run.stopped) {
      const msg = friendlyError(e, label);
      reply.parts.push({ type: 'error', text: msg });
      emit({ tab: tabId, type: 'error', text: msg });
    }
  } finally {
    if (run.stopped) { reply.parts.push({ type: 'note', text: 'Stopped.' }); emit({ tab: tabId, type: 'note', text: 'Stopped.' }); }
    const answer = reply.parts.filter(p => p.type === 'text').map(p => p.text).join('').trim();
    tab.history.push({ role: 'user', content: text });
    tab.history.push({ role: 'assistant', content: answer || '(worked on files)' });
    tab.history = tab.history.slice(-30);
    tab.updatedAt = Date.now();
    running.delete(tabId);
    persist();
    if (label && ws.getRoot()) memory.appendLog({ model: label, mode, prompt: text, files: run.files, commands: run.commands }).catch(() => {});
    emit({ tab: tabId, type: 'done', files: [...new Set(run.files)] });
    emit({ tab: tabId, type: 'running', running: false });
  }
}

function recentHistory(tab) {
  return 'CONVERSATION SO FAR (from earlier in this chat, possibly with a different AI):\n' +
    tab.history.slice(-10).map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.slice(0, 2000)}`).join('\n');
}

function friendlyError(e, label) {
  const m = String(e?.message || e);
  if (/ECONNREFUSED|fetch failed|ENOTFOUND|ETIMEDOUT/i.test(m)) {
    const provider = String(label || '').split(':')[0];
    if (provider === 'ollama') return 'Ollama is not running. Start Ollama and try again.';
    if (provider === 'lmstudio') return 'Cannot reach LM Studio. Open LM Studio, load a model and turn on its local server, then try again.';
    if (provider === 'llamacpp') return 'Cannot reach llama.cpp. Start llama-server and try again, or check the address in Settings.';
    if (models.CLOUD_APIS[provider]) return `Cannot reach ${models.CLOUD_APIS[provider].name}. Check your internet connection and try again.`;
  }
  if (/does not support tools/i.test(m)) return `${label} cannot use tools. Pick a model marked "can edit files", or switch to Plan mode.`;
  if (/401|403|invalid api key|unauthorized/i.test(m)) return `The service refused the key or sign-in for ${label}. Check it in Settings.`;
  if (/not installed or not on PATH/i.test(m)) return m;
  return m;
}

// A long agent run piles up file contents and command output. When the conversation outgrows what the model can hold,
// shrink the oldest tool results first so the instructions and the latest steps are never the part that gets cut off.
function compactMessages(messages, budget) {
  const size = () => messages.reduce((n, m) => n + (typeof m.content === 'string' ? m.content.length : 0) + (m.tool_calls ? JSON.stringify(m.tool_calls).length : 0), 0);
  if (size() <= budget) return false;
  const tools = messages.map((m, i) => (m.role === 'tool' ? i : -1)).filter(i => i >= 0);
  for (const i of tools.slice(0, -4)) {            // keep the four most recent results intact
    if (messages[i].content.length > 300) messages[i] = { ...messages[i], content: messages[i].content.slice(0, 200) + '\n[older output shortened to save space]' };
    if (size() <= budget) return true;
  }
  return size() <= budget;
}

async function toolLoop({ run, tab, pick, ctx, overview, text, attachments, on }) {
  const s = settings.load();
  const system = prompt.build({ mode: run.mode, permission: run.permission, ctx, overview });
  const defs = ws.getRoot() ? tools.definitions(run.mode) : [];
  const messages = [{ role: 'system', content: system }, ...tab.history.slice(-12)];
  messages.push({ role: 'user', content: text || 'See the attached image.', images: attachments.map(a => ({ mime: a.mime, b64: a.b64 })) });

  let transport;
  let budget = 400000; // characters the conversation may use; local models get far less
  if (pick.provider === 'ollama') {
    const cat = await models.catalog({ mode: run.mode }).catch(() => null);
    const info = cat?.providers.find(p => p.id === 'ollama')?.models.find(m => m.id === pick.model);
    let numCtx = Math.max(8192, Math.min(info?.ctx || 16384, 32768));
    // A bigger context needs more GPU memory. When it no longer fits, part of the model runs on the CPU and everything gets several times slower.
    const hw = cat?.hardware;
    if (hw?.vramGB && info?.sizeGB && hw.gpu && !/apple/i.test(hw.gpu)) {
      const spare = hw.vramGB * 0.92 - info.sizeGB * 1.1;
      numCtx = Math.min(numCtx, spare >= 2 ? 32768 : spare >= 0.6 ? 16384 : 8192);
    }
    budget = Math.floor(numCtx * 2.6); // about 4 characters per token, with room left for the answer
    transport = (msgs, tl) => llm.ollamaChat({ base: models.OLLAMA, model: pick.model, messages: msgs, tools: tl, signal: run.abort.signal, numCtx, think: info?.thinking ? run.mode === 'plan' : undefined });
  } else {
    const base = pick.provider === 'lmstudio' ? s.endpoints.lmstudio : pick.provider === 'llamacpp' ? s.endpoints.llamacpp : models.CLOUD_APIS[pick.provider]?.base;
    if (!base) throw new Error(`Unknown provider ${pick.provider}`);
    const key = models.CLOUD_APIS[pick.provider] ? settings.getKey(pick.provider) : null;
    if (models.CLOUD_APIS[pick.provider] && !key) throw new Error(`Add your ${models.CLOUD_APIS[pick.provider].name} key in Settings first.`);
    transport = (msgs, tl) => llm.openaiChat({ base, key, model: pick.model, messages: msgs, tools: tl, signal: run.abort.signal });
  }

  let toolsOn = defs.length > 0;
  let saidSomething = false; // has the model written any text during this run?
  let nudged = false;        // we ask a silent model to carry on at most once
  const repeats = new Map(); // how often the same call (with the same files changed so far) was made
  let badCalls = 0;         // times a model wrote a tool call that could not be parsed
  for (let step = 0; step < MAX_STEPS[run.mode]; step++) {
    if (run.stopped) return;
    compactMessages(messages, budget);
    let content = '';
    let calls = null;
    try {
      for await (const ev of transport(messages, toolsOn ? defs : undefined)) {
        if (run.stopped) return;
        if (ev.type === 'text') { content += ev.text; on.text(ev.text); }
        else if (ev.type === 'thinking') on.thinking(ev.text);
        else if (ev.type === 'tool_calls') calls = ev.calls;
      }
    } catch (e) {
      if (run.stopped || e.name === 'AbortError') return;
      // A model without tool support can still answer questions.
      if (toolsOn && /does not support tools|tool.*not supported/i.test(e.message)) {
        toolsOn = false;
        on.text(`_${pick.model} cannot use tools, so it can only answer — it cannot edit files. Choose a model marked "can edit files" for changes._\n\n`);
        step--; continue;
      }
      // A small model sometimes writes a tool call the server cannot parse (broken XML/JSON). Ask it to try again instead of failing the whole run.
      if (toolsOn && badCalls < 4 && /syntax error|error parsing tool call|invalid character|unexpected end of JSON|unmarshal/i.test(e.message)) {
        badCalls++;
        messages.push({ role: 'user', content: 'Your last tool call was malformed and could not be read. Call the tool again with simple, valid arguments. Keep it small: change one short piece at a time with edit_file, and do not put tags such as </parameter> or <function> inside the text.' });
        continue;
      }
      throw e;
    }
    if (content.trim()) saidSomething = true;
    if (!calls?.length && !content.trim() && !nudged && step > 0 && run.mode !== 'plan' && !run.files.length && !run.commands) {
      // It read the project and then went quiet. One push to actually make the change usually gets a small model going.
      nudged = true;
      messages.push({ role: 'user', content: 'You have looked at the files but have not made the change yet. Make it now with edit_file or write_file, then give a short summary of what you did.' });
      continue;
    }
    if (!calls?.length) {
      // A small model sometimes ends its turn with nothing at all. Say so instead of leaving a blank reply.
      if (!content.trim() && !saidSomething && !run.files.length && !run.commands) on.text('_The model stopped without doing anything or replying. Send the request again, or pick a larger model from the model menu._');
      return;
    }
    messages.push({ role: 'assistant', content, tool_calls: calls });
    for (const call of calls) {
      if (run.stopped) return;
      const name = call.function.name;
      const args = llm.safeParse(call.function.arguments);
      on.tool({ id: call.id, name, args, status: 'running' });
      let result;
      if (!tools.allowedIn(run.mode, name)) {
        result = `Error: ${name} is not available in ${run.mode} mode.`;
        on.tool({ id: call.id, status: 'denied', result });
      } else {
        // A small model can get stuck repeating the same call. Answer a repeat without doing it again, and tell it to move on.
        const readOnly = name === 'read_file' || name === 'list_dir' || name === 'search';
        const isWrite = name === 'write_file' || name === 'edit_file';
        const sig = name + '|' + JSON.stringify(args);
        let again = false;
        if (readOnly) { const k = sig + '|' + run.files.length; again = repeats.has(k); repeats.set(k, 1); } // a read is a repeat only if nothing changed meanwhile
        else if (isWrite) again = repeats.get('w:' + args.path) === sig;                                      // the last successful write to this file was identical
        const tooMany = isWrite && !again && (repeats.get('n:' + args.path) || 0) >= 5; // a model that keeps rewriting one file is going round in circles
        // The same command that already failed, unchanged: refuse it so the model has to look at the error instead of looping.
        const cmdKey = name === 'run_command' ? 'f:' + String(args.command || '').trim() + '|' + run.files.length : null;
        if (cmdKey && repeats.has(cmdKey)) {
          result = `This exact command already failed and nothing has changed since. Do not run it again. Read its error output above, find the cause and fix it (or try a different approach), then explain to the user what went wrong.`;
          on.tool({ id: call.id, status: 'denied', result });
          messages.push({ role: 'tool', tool_call_id: call.id, name, content: result });
          continue;
        }
        if (again || tooMany) {
          result = tooMany
            ? `You have already changed ${args.path} ${repeats.get('n:' + args.path)} times in this run. Stop editing it. Reply with a short summary of what you did and what is left.`
            : readOnly
            ? 'You already did exactly this and nothing has changed since. Use what you already have, and make the change now with edit_file or write_file.'
            : 'You already made exactly this change; the file is already in that state. Do not repeat it. If the task is done, reply with a short summary.';
          on.tool({ id: call.id, status: 'done', result });
          messages.push({ role: 'tool', tool_call_id: call.id, name, content: result });
          continue;
        }
        const g = await gate(run, name, args);
        if (run.stopped) return;
        if (!g.ok) { result = `Not allowed: ${g.message}`; on.tool({ id: call.id, status: 'denied', result: g.message }); }
        else {
          try { result = await tools.execute(name, args, run); on.tool({ id: call.id, status: 'done', result }); if (cmdKey && failedRun(result)) repeats.set(cmdKey, 1); if (isWrite) { repeats.set('w:' + args.path, sig); repeats.set('n:' + args.path, (repeats.get('n:' + args.path) || 0) + 1); } }
          catch (e) { result = `Error: ${e.message}`; on.tool({ id: call.id, status: 'error', result: e.message }); }
        }
      }
      messages.push({ role: 'tool', tool_call_id: call.id, name, content: String(result).slice(0, Math.min(40000, Math.floor(budget / 4))) });
    }
  }
  on.text(`\n\n_Reached the step limit for ${run.mode} mode. Say "continue" to keep going._`);
}

// run_command results end with "[exit code N]" (or "[still running …]" for a background server).
function failedRun(result) {
  const m = /\[exit code ([^\]]+)\]\s*$/.exec(String(result));
  return !!m && m[1].trim() !== '0';
}

function shutdown() { for (const id of running.keys()) stop(id); bridge?.then(b => b.server.close(), () => {}); }

module.exports = { compactMessages, failedRun, init, loadTabs, listTabs, getTab, newTab, renameTab, deleteTab, send, stop, answerApproval, shutdown };
