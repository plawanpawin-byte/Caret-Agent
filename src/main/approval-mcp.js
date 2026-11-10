'use strict';
// Tiny MCP server (stdio) that Claude Code calls before using a tool.
// It forwards the request to Caret Agent, which applies the user's
// permission setting and, when needed, shows Allow / Deny in the app.
const http = require('http');

const PORT = Number(process.env.CARET_BRIDGE_PORT);
const TOKEN = process.env.CARET_BRIDGE_TOKEN || '';
const TAB = process.env.CARET_TAB || '';

function ask(toolName, input) {
  return new Promise(resolve => {
    const body = JSON.stringify({ tab: TAB, tool: toolName, input });
    const req = http.request({ host: '127.0.0.1', port: PORT, path: '/approve', method: 'POST',
      headers: { 'content-type': 'application/json', 'x-caret-token': TOKEN, 'content-length': Buffer.byteLength(body) } }, res => {
      let data = '';
      res.on('data', d => { data += d; });
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({ behavior: 'deny', message: 'Caret Agent did not answer' }); } });
    });
    req.on('error', () => resolve({ behavior: 'deny', message: 'Caret Agent is not reachable' }));
    req.end(body);
  });
}

function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', async chunk => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    handle(msg);
  }
});

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === 'initialize') {
    return send({ jsonrpc: '2.0', id, result: { protocolVersion: params?.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'caret', version: '1.0.0' } } });
  }
  if (method === 'tools/list') {
    return send({ jsonrpc: '2.0', id, result: { tools: [{
      name: 'approve',
      description: 'Ask Caret Agent whether a tool may run.',
      inputSchema: { type: 'object', properties: { tool_name: { type: 'string' }, input: { type: 'object' }, tool_use_id: { type: 'string' } }, required: ['tool_name', 'input'] },
    }] } });
  }
  if (method === 'tools/call') {
    const { tool_name, input } = params?.arguments || {};
    const answer = await ask(tool_name, input || {});
    const result = answer.behavior === 'allow'
      ? { behavior: 'allow', updatedInput: input || {} }
      : { behavior: 'deny', message: answer.message || 'The user declined this action' };
    return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(result) }] } });
  }
  if (id !== undefined) send({ jsonrpc: '2.0', id, result: {} });
}
