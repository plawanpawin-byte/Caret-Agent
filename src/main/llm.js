'use strict';
// Streaming chat with tool calls, for Ollama (native API, so we can set the
// context size) and any OpenAI-compatible server (LM Studio, llama.cpp, Grok,
// Gemini, OpenAI). Messages use the OpenAI shape internally.

// Node's built-in fetch gives up when a response is silent for 5 minutes, which a slow local model on a weak computer can easily
// exceed while it reads a long prompt. Inside the app, use Chromium's network stack instead (no such limit).
function appFetch(url, opts) {
  let net = null;
  try { net = require('electron').net; } catch {}
  return net && typeof net.fetch === 'function' ? net.fetch(url, opts) : fetch(url, opts);
}

// Splits <think>…</think> that some local models put inside normal text.
function thinkSplitter() {
  let inThink = false, carry = '';
  return (chunk) => {
    const out = [];
    let s = carry + chunk;
    carry = '';
    while (s) {
      const tag = inThink ? '</think>' : '<think>';
      const i = s.indexOf(tag);
      if (i < 0) {
        // keep a possible partial tag for the next chunk
        let keep = 0;
        for (let k = Math.min(tag.length - 1, s.length); k > 0; k--) if (tag.startsWith(s.slice(-k))) { keep = k; break; }
        const body = s.slice(0, s.length - keep);
        if (body) out.push({ type: inThink ? 'thinking' : 'text', text: body });
        carry = s.slice(s.length - keep);
        break;
      }
      if (i > 0) out.push({ type: inThink ? 'thinking' : 'text', text: s.slice(0, i) });
      s = s.slice(i + tag.length);
      inThink = !inThink;
    }
    return out;
  };
}

async function* readLines(body) {
  const decoder = new TextDecoder();
  let buf = '';
  for await (const part of body) {
    buf += decoder.decode(part, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) yield line; }
  }
  if (buf.trim()) yield buf.trim();
}

async function httpError(r) {
  let text = '';
  try { text = await r.text(); } catch {}
  try { const j = JSON.parse(text); text = j.error?.message || j.error || j.message || text; } catch {}
  return new Error(`${r.status}: ${String(text).slice(0, 400)}`);
}

// ---------- Ollama native ----------
function toOllamaMessages(messages) {
  return messages.map(m => {
    if (m.role === 'tool') return { role: 'tool', content: m.content, tool_name: m.name };
    const out = { role: m.role, content: m.content || '' };
    if (m.images?.length) out.images = m.images.map(i => i.b64);
    if (m.tool_calls) out.tool_calls = m.tool_calls.map(tc => ({ function: { name: tc.function.name, arguments: safeParse(tc.function.arguments) } }));
    return out;
  });
}

async function* ollamaChat({ base, model, messages, tools, signal, numCtx = 16384, think }) {
  const r = await appFetch(base + '/api/chat', {
    method: 'POST', signal, headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, messages: toOllamaMessages(messages), tools: tools?.length ? tools : undefined, stream: true, think, keep_alive: '30m', options: { num_ctx: numCtx } }),
  });
  if (!r.ok) {
    const err = await httpError(r);
    // Some models reject "think"; retry once without it.
    if (think !== undefined && /think/i.test(err.message)) { yield* ollamaChat({ base, model, messages, tools, signal, numCtx, think: undefined }); return; }
    throw err;
  }
  const split = thinkSplitter();
  const calls = [];
  for await (const line of readLines(r.body)) {
    let j; try { j = JSON.parse(line); } catch { continue; }
    if (j.error) throw new Error(j.error);
    const msg = j.message || {};
    if (msg.thinking) yield { type: 'thinking', text: msg.thinking };
    if (msg.content) for (const ev of split(msg.content)) yield ev;
    for (const tc of msg.tool_calls || []) {
      calls.push({ id: 'call_' + Math.random().toString(36).slice(2, 10), type: 'function', function: { name: tc.function?.name, arguments: JSON.stringify(tc.function?.arguments ?? {}) } });
    }
    if (j.done) break;
  }
  if (calls.length) yield { type: 'tool_calls', calls };
}

// ---------- OpenAI-compatible ----------
function toOpenAIMessages(messages) {
  return messages.map(m => {
    if (m.role === 'user' && m.images?.length) {
      return { role: 'user', content: [{ type: 'text', text: m.content || '' }, ...m.images.map(i => ({ type: 'image_url', image_url: { url: `data:${i.mime};base64,${i.b64}` } }))] };
    }
    const out = { role: m.role, content: m.content ?? '' };
    if (m.tool_calls) { out.tool_calls = m.tool_calls; if (!out.content) out.content = null; }
    if (m.role === 'tool') out.tool_call_id = m.tool_call_id;
    return out;
  });
}

async function* openaiChat({ base, key, model, messages, tools, signal }) {
  const headers = { 'content-type': 'application/json' };
  if (key) headers.authorization = `Bearer ${key}`;
  const r = await appFetch(base.replace(/\/$/, '') + '/chat/completions', {
    method: 'POST', signal, headers,
    body: JSON.stringify({ model, messages: toOpenAIMessages(messages), tools: tools?.length ? tools : undefined, stream: true }),
  });
  if (!r.ok) throw await httpError(r);
  const split = thinkSplitter();
  const acc = new Map();
  for await (const line of readLines(r.body)) {
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (data === '[DONE]') break;
    let j; try { j = JSON.parse(data); } catch { continue; }
    if (j.error) throw new Error(j.error.message || String(j.error));
    const d = j.choices?.[0]?.delta || {};
    const reasoning = d.reasoning_content || d.reasoning;
    if (reasoning) yield { type: 'thinking', text: reasoning };
    if (d.content) for (const ev of split(d.content)) yield ev;
    for (const tc of d.tool_calls || []) {
      const idx = tc.index ?? acc.size;
      const cur = acc.get(idx) || { id: tc.id || 'call_' + idx + '_' + Date.now(), type: 'function', function: { name: '', arguments: '' } };
      if (tc.id) cur.id = tc.id;
      if (tc.function?.name) cur.function.name += tc.function.name;
      if (tc.function?.arguments) cur.function.arguments += tc.function.arguments;
      acc.set(idx, cur);
    }
  }
  if (acc.size) yield { type: 'tool_calls', calls: [...acc.values()] };
}

function safeParse(s) {
  if (s && typeof s === 'object') return s;
  try { return JSON.parse(s || '{}'); } catch { return {}; }
}

module.exports = { ollamaChat, openaiChat, safeParse, thinkSplitter };
