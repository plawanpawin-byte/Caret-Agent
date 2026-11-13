// Self-tests for the parts that keep users safe. Runs with plain Node.
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ws = require('../src/main/workspace');
const permissions = require('../src/main/permissions');
const { ensureFavicon } = require('../src/main/tools');
const { thinkSplitter, openaiChat } = require('../src/main/llm');
const http = require('http');

let pass = 0;
async function t(name, fn) {
  try { await fn(); pass++; console.log('pass', name); }
  catch (e) { console.log('FAIL', name, '\n   ', e.message); process.exitCode = 1; }
}

(async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'caret-test-'));
  const proj = path.join(base, 'proj');
  const outside = path.join(base, 'outside');
  fs.mkdirSync(path.join(proj, '.git'), { recursive: true });
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
  try { fs.symlinkSync(outside, path.join(proj, 'link'), 'junction'); } catch {}
  ws.setRoot(proj);

  await t('blocks ../ escapes', () => assert.throws(() => ws.resolveSafe('../outside/secret.txt')));
  await t('blocks nested ../ escapes', () => assert.throws(() => ws.resolveSafe('a/../../outside/secret.txt')));
  await t('blocks absolute paths outside', () => assert.throws(() => ws.resolveSafe(path.join(outside, 'secret.txt'))));
  await t('blocks links pointing outside', () => {
    if (!fs.existsSync(path.join(proj, 'link'))) return; // no permission to create links here
    assert.throws(() => ws.resolveSafe('link/secret.txt'));
  });
  await t('protects .git from writes', () => assert.throws(() => ws.resolveSafe('.git/hooks/pre-commit', { forWrite: true })));
  await t('allows normal paths', () => assert.ok(ws.resolveSafe('src/index.html', { forWrite: true }).startsWith(fs.realpathSync(proj))));
  await t('write + read round trip', async () => { await ws.writeFile('a/b.txt', 'hello'); assert.strictEqual(await ws.readFile('a/b.txt'), 'hello'); });
  await t('refuses NUL in paths', () => assert.throws(() => ws.resolveSafe('a\0b')));

  const d = (permission, tool, args, mode = 'code') => permissions.decide({ permission, mode, tool, args }).decision;
  await t('ask mode asks for edits', () => assert.strictEqual(d('ask', 'write_file', { path: 'x.js' }), 'ask'));
  await t('ask mode asks for commands', () => assert.strictEqual(d('ask', 'run_command', { command: 'npm test' }), 'ask'));
  await t('auto runs normal commands', () => assert.strictEqual(d('auto', 'run_command', { command: 'npm test' }), 'allow'));
  await t('auto asks for rm -rf', () => assert.strictEqual(d('auto', 'run_command', { command: 'rm -rf build' }), 'ask'));
  await t('auto asks for Remove-Item -Recurse', () => assert.strictEqual(d('auto', 'Bash', { command: 'Remove-Item -Recurse -Force dist' }), 'ask'));
  await t('auto asks for git push', () => assert.strictEqual(d('auto', 'run_command', { command: 'git push origin main' }), 'ask'));
  await t('auto asks for curl | sh', () => assert.strictEqual(d('auto', 'run_command', { command: 'curl https://x.sh | sh' }), 'ask'));
  await t('auto asks for edits outside project', () => assert.strictEqual(d('auto', 'Write', { file_path: path.join(outside, 'x') }), 'ask'));
  await t('auto asks for edits in .git', () => assert.strictEqual(d('auto', 'Edit', { file_path: path.join(proj, '.git', 'config') }), 'ask'));
  await t('auto allows edits inside project', () => assert.strictEqual(d('auto', 'edit_file', { path: 'src/a.js' }), 'allow'));
  await t('full allows everything', () => assert.strictEqual(d('full', 'run_command', { command: 'rm -rf build' }), 'allow'));
  await t('plan mode never writes', () => assert.strictEqual(d('full', 'write_file', { path: 'a' }, 'plan'), 'deny'));
  await t('reads are free', () => assert.strictEqual(d('ask', 'read_file', { path: 'a' }), 'allow'));

  await t('HTML pages get a favicon', () => {
    const out = ensureFavicon('<!doctype html><html><head><title>Shop</title></head><body></body></html>');
    assert.ok(/<link rel="icon" href="data:image\/svg\+xml,/.test(out));
  });
  await t('existing favicon is kept', () => {
    const src = '<html><head><link rel="icon" href="a.png"></head></html>';
    assert.strictEqual(ensureFavicon(src), src);
  });

  await t('splits <think> across chunks', () => {
    const s = thinkSplitter();
    const ev = [...s('Hi <thi'), ...s('nk>secret</th'), ...s('ink> there')];
    const text = ev.filter(e => e.type === 'text').map(e => e.text).join('');
    const think = ev.filter(e => e.type === 'thinking').map(e => e.text).join('');
    assert.strictEqual(text, 'Hi  there'); assert.strictEqual(think, 'secret');
  });

  for (const bad of ['--upload-pack=touch /tmp/x', 'ext::sh -c touch% /tmp/pwned', 'file:///etc', 'https://github.com/a/b;rm -rf /', '-c core.sshCommand=x']) {
    await t(`clone refuses ${bad.slice(0, 24)}`, () => ws.cloneRepo(bad, base).then(() => { throw new Error('accepted'); }, e => assert.ok(/https:\/\/|git@/.test(e.message))));
  }

  // OpenAI-compatible servers (LM Studio, llama.cpp, Grok, Gemini, OpenAI): a mock that streams text and a tool call in fragments.
  await t('openai-compatible stream: text, split tool call, key sent, error surfaced', async () => {
    let seen = null;
    const srv = http.createServer((req, res) => {
      let b = ''; req.on('data', d => { b += d; });
      req.on('end', () => {
        seen = { url: req.url, auth: req.headers.authorization, body: JSON.parse(b) };
        if (seen.body.model === 'bad') { res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: 'Invalid key' } })); return; }
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        const send = o => res.write('data: ' + JSON.stringify(o) + '\n\n');
        send({ choices: [{ delta: { content: 'Hel' } }] });
        send({ choices: [{ delta: { content: 'lo <think>hm</think>' } }] });
        send({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'write_file', arguments: '{"path":"a.t' } }] } }] });
        send({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'xt","content":"hi"}' } }] } }] });
        res.end('data: [DONE]\n\n');
      });
    });
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${srv.address().port}/v1`;
    try {
      const ev = []; for await (const e of openaiChat({ base, key: 'sk-test', model: 'm', messages: [{ role: 'user', content: 'x' }], tools: [{ type: 'function', function: { name: 'write_file', parameters: { type: 'object' } } }] })) ev.push(e);
      assert.strictEqual(seen.url, '/v1/chat/completions'); assert.strictEqual(seen.auth, 'Bearer sk-test'); assert.strictEqual(seen.body.stream, true);
      assert.strictEqual(ev.filter(e => e.type === 'text').map(e => e.text).join(''), 'Hello ');
      assert.strictEqual(ev.filter(e => e.type === 'thinking').map(e => e.text).join(''), 'hm');
      const calls = ev.find(e => e.type === 'tool_calls').calls;
      assert.strictEqual(calls.length, 1); assert.strictEqual(calls[0].function.name, 'write_file');
      assert.deepStrictEqual(JSON.parse(calls[0].function.arguments), { path: 'a.txt', content: 'hi' });
      await assert.rejects(async () => { for await (const _ of openaiChat({ base, key: 'x', model: 'bad', messages: [] })); }, /401: Invalid key/);
    } finally { srv.close(); }
  });

  // The "AI" panel installs only what is in its fixed list, and shows command output as it arrives.
  await t('providers: install runs only listed packages; output streams; failures reported', async () => {
    const providers = require('../src/main/providers');
    await assert.rejects(() => providers.install('not-a-provider', () => {}), /cannot be installed/);
    await assert.rejects(() => providers.install('xai', () => {}), /cannot be installed/);
    const lines = [];
    const ok = await providers.stream(process.execPath, ['-e', 'console.log("one"); console.error("\u001b[31mtwo\u001b[0m")'], l => lines.push(l), 10000);
    assert.strictEqual(ok.ok, true); assert.deepStrictEqual(lines.sort(), ['one', 'two']);
    const bad = await providers.stream(process.execPath, ['-e', 'process.exit(3)'], () => {}, 10000);
    assert.strictEqual(bad.ok, false); assert.match(bad.error, /code 3/);
    assert.ok(require('../src/main/cli').resolveNpm(), 'npm should be found on a machine with Node');
  });

  await t('picture preview: stays inside the project, pictures only, size limit', async () => {
    ws.setRoot(proj);
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    fs.writeFileSync(path.join(proj, 'dot.png'), png);
    fs.writeFileSync(path.join(outside, 'leak.png'), png);
    const ok = await ws.readImage('dot.png');
    assert.ok(ok.url.startsWith('data:image/png;base64,')); assert.strictEqual(ok.size, png.length);
    await assert.rejects(() => ws.readImage('../outside/leak.png'));
    await assert.rejects(() => ws.readImage(path.join(outside, 'leak.png')));
    fs.writeFileSync(path.join(proj, 'notes.txt'), 'hi');
    await assert.rejects(() => ws.readImage('notes.txt'), /not a picture/);
  });

  // The terminal (used by the user and by every AI) must show real text, including Thai, and readable errors.
  await t('terminal: Thai text survives, errors are plain text, exit code and folder are kept', async () => {
    const terminals = require('../src/main/terminal');
    ws.setRoot(proj);
    const id = terminals.create({ cwd: proj, title: 't' });
    const thai = process.platform === 'win32' ? 'Write-Output "สวัสดี ตัวอย่าง"' : 'echo "สวัสดี ตัวอย่าง"';
    const a = await terminals.run(id, thai, { source: 'ai', timeoutMs: 20000 });
    assert.ok(a.output.includes('สวัสดี ตัวอย่าง'), 'Thai output: ' + JSON.stringify(a.output));
    const bad = process.platform === 'win32' ? 'Get-Item .\definitely-missing-file.txt' : 'cat ./definitely-missing-file.txt';
    const b = await terminals.run(id, bad, { source: 'ai', timeoutMs: 20000 });
    assert.ok(!/CLIXML|<Objs/.test(b.output), 'no CLIXML: ' + b.output.slice(0, 120));
    assert.ok(/definitely-missing-file/.test(b.output), 'error names the file');
    const c = await terminals.run(id, process.platform === 'win32' ? 'exit 3' : 'exit 3', { source: 'ai', timeoutMs: 20000 });
    assert.strictEqual(c.exitCode, 3);
    terminals.close(id);
  });

  await t('terminal: a server started in the background reports its address (also http://[::]:port)', async () => {
    const terminals = require('../src/main/terminal');
    ws.setRoot(proj);
    fs.writeFileSync(path.join(proj, 'srv.js'), "const s = require('http').createServer((q, r) => r.end('ok')).listen(0, () => console.log('Serving on http://[::]:' + s.address().port + '/'));");
    const id = terminals.create({ cwd: proj, title: 'srv' });
    const r = await terminals.run(id, 'node srv.js', { source: 'ai', background: true });
    assert.ok(r.running, 'still running');
    assert.ok(r.urls.some(u => /^http:\/\/localhost:\d+\/?$/.test(u)), 'urls: ' + JSON.stringify(r.urls) + ' out: ' + r.output);
    terminals.kill(id);
    await new Promise(res => setTimeout(res, 1500));
    terminals.close(id);
  });

  await t('long agent runs: old tool output shrinks first, instructions and latest steps stay whole', async () => {
    const { compactMessages } = require('../src/main/agent');
    const big = 'x'.repeat(5000);
    const messages = [{ role: 'system', content: 'SYSTEM RULES' }, { role: 'user', content: 'do the task' }];
    for (let i = 0; i < 10; i++) { messages.push({ role: 'assistant', content: '', tool_calls: [{ id: 'c' + i, function: { name: 'read_file', arguments: '{}' } }] }); messages.push({ role: 'tool', tool_call_id: 'c' + i, name: 'read_file', content: big }); }
    const before = messages.reduce((n, m) => n + (m.content || '').length, 0);
    assert.ok(before > 50000);
    assert.strictEqual(compactMessages(messages, 30000), true);
    const after = messages.reduce((n, m) => n + (m.content || '').length, 0);
    assert.ok(after < before);
    assert.strictEqual(messages[0].content, 'SYSTEM RULES');
    const toolMsgs = messages.filter(m => m.role === 'tool');
    assert.strictEqual(toolMsgs[toolMsgs.length - 1].content, big, 'the newest result is untouched');
    assert.ok(/shortened/.test(toolMsgs[0].content), 'the oldest result was shortened');
    const small = [{ role: 'system', content: 's' }, { role: 'tool', content: big }];
    assert.strictEqual(compactMessages(small, 100000), false, 'nothing to do under budget');
  });

  await t('Thai and spaced folder and file names work everywhere (list, read, write, search, safety)', async () => {
    const thaiRoot = path.join(base, 'โปรเจกต์ ทดสอบ');
    fs.mkdirSync(path.join(thaiRoot, 'หน้าเว็บ'), { recursive: true });
    fs.mkdirSync(path.join(thaiRoot, '.git'));
    ws.setRoot(thaiRoot);
    await ws.writeFile('หน้าเว็บ/สวัสดี ชาวโลก.html', '<h1>สวัสดี</h1>');
    const items = await ws.listDir('หน้าเว็บ');
    assert.deepStrictEqual(items.map(i => i.name), ['สวัสดี ชาวโลก.html']);
    assert.strictEqual(await ws.readFile('หน้าเว็บ/สวัสดี ชาวโลก.html'), '<h1>สวัสดี</h1>');
    const found = await ws.search('สวัสดี');
    assert.ok(found.some(f => f.path.endsWith('สวัสดี ชาวโลก.html')), JSON.stringify(found));
    await assert.rejects(() => ws.writeFile('../escape ไทย.txt', 'x'));
    ws.setRoot(proj);
  });

  await t('edit_file errors tell the model how to fix the call (empty text, wrong spacing)', async () => {
    const tools = require('../src/main/tools');
    ws.setRoot(proj);
    const NL = String.fromCharCode(10);
    fs.writeFileSync(path.join(proj, 'a.js'), ['function hello() {', '    return 1;', '}', ''].join(NL));
    const run = { files: [], onFileChanged() {}, commands: 0 };
    await assert.rejects(() => tools.execute('edit_file', { path: 'a.js', old_text: '', new_text: 'x' }, run), /write_file/);
    await assert.rejects(() => tools.execute('edit_file', { path: 'a.js', old_text: 'function hello(){', new_text: 'x' }, run), e => e.message.includes('line 1: "function hello() {"'));
    assert.match(await tools.execute('edit_file', { path: 'a.js', old_text: 'return 1;', new_text: 'return 2;' }, run), /Edited/);
  });

  await t('AI families: Claude and Codex can use the app or an API key; every API belongs to one family; bad keys are refused before saving', async () => {
    const providers = require('../src/main/providers');
    const models = require('../src/main/models');
    const settings = require('../src/main/settings');
    const byId = Object.fromEntries(providers.CATALOG.map(p => [p.id, p]));
    assert.deepStrictEqual(Object.keys(byId), ['claude', 'codex', 'xai', 'openrouter', 'gemini']);
    assert.ok(byId.claude.bin && byId.claude.apiId === 'anthropic', 'Claude: app and API');
    assert.ok(byId.codex.bin && byId.codex.apiId === 'openai', 'Codex: app and API');
    assert.ok(!byId.xai.bin && !byId.gemini.bin && !byId.openrouter.bin, 'Grok, OpenRouter and Antigravity are API only');
    for (const p of providers.CATALOG) assert.strictEqual(models.CLOUD_APIS[p.apiId].family, p.id, p.id + ' API points back to its family');
    assert.ok(settings.publicView().keysSet.anthropic === false || settings.publicView().keysSet.anthropic === true, 'an Anthropic key can be stored');
    const h = models.apiHeaders('anthropic', 'sk-ant-x');
    assert.strictEqual(h['x-api-key'], 'sk-ant-x');
    assert.ok(h['anthropic-version']);
    assert.strictEqual(models.apiHeaders('xai', 'k1234567').authorization, 'Bearer k1234567');
    for (const bad of ['', 'short', 'has a space inside it', 'two\nlines of key text']) {
      const r = await providers.checkKey('xai', bad);
      assert.strictEqual(r.ok, false, JSON.stringify(bad) + ' is refused without calling the service');
    }
    await assert.rejects(() => providers.checkKey('nope', 'abcdefghijkl'), /Unknown provider/);
  });

  await t('breaker stops an AI that keeps re-running failing commands, but not one that is fixing things', async () => {
    const { createBreaker, stopMessage, lockMessage } = require('../src/main/breaker');
    // the same command, again and again
    let b = createBreaker();
    assert.strictEqual(b.record('npm start', true, 0), null);
    assert.strictEqual(b.record('NPM   start', true, 0), null, 'spacing and case do not make it a new command');
    assert.deepStrictEqual(b.record('npm start', true, 0), { reason: 'same', count: 3 });
    // small variations still add up
    b = createBreaker();
    for (const c of ['node a.js', 'node ./a.js', 'node a.js --x']) assert.strictEqual(b.record(c, true, 0), null);
    assert.deepStrictEqual(b.record('node a.js --y', true, 0), { reason: 'streak', count: 4 });
    // a success, or a file that changed in between, starts the count again
    b = createBreaker();
    for (const c of ['a', 'b', 'c']) b.record(c, true, 0);
    assert.strictEqual(b.record('d', false, 0), null);
    for (const c of ['e', 'f', 'g']) assert.strictEqual(b.record(c, true, 0), null);
    b = createBreaker();
    for (const c of ['a', 'b', 'c']) b.record(c, true, 0);
    assert.strictEqual(b.record('d', true, 1), null, 'the AI edited a file, so this is a fresh attempt');
    assert.match(stopMessage({ reason: 'same', count: 3 }), /same command failed 3 times/);
    assert.match(lockMessage({ reason: 'streak', count: 4 }), /Do not run any more commands/);
  });

  await t('a Codex that endlessly re-runs a failing command is stopped by the runner', async () => {
    // A stand-in for the codex program: prints the same failing command again and again, then would wait a long time.
    const stub = path.join(os.tmpdir(), 'caret-stub-codex-' + process.pid + '.js');
    fs.writeFileSync(stub, `
      const ev = n => JSON.stringify({ type: 'item.completed', item: { id: 'c' + n, type: 'command_execution', command: 'node nothere.js', exit_code: 1, aggregated_output: 'Error: Cannot find module' } });
      let n = 0;
      const timer = setInterval(() => console.log(ev(++n)), 100);
      setTimeout(() => clearInterval(timer), 60000);
    `);
    const cliPath = require.resolve('../src/main/cli');
    const runnersPath = require.resolve('../src/main/runners');
    const realCli = require(cliPath).resolveCli;
    require(cliPath).resolveCli = () => ({ cmd: process.execPath, args: [stub], env: { ELECTRON_RUN_AS_NODE: '1' } });
    delete require.cache[runnersPath];                     // load runners again so it picks up the stand-in
    try {
      const { runCodex } = require('../src/main/runners');
      const seen = [];
      const h = runCodex({ model: 'default', mode: 'agent', permission: 'full', prompt: 'x', system: 's', images: [], on: { text() {}, thinking() {}, fileChanged() {}, tool: e => seen.push(e) } });
      const started = Date.now();
      const r = await Promise.race([h.done, new Promise(res => setTimeout(() => res({ error: 'NOT STOPPED' }), 20000))]);
      h.stop();
      assert.match(r.error, /Stopped: the same command failed 3 times/);
      assert.ok(Date.now() - started < 15000, 'stopped quickly');
      assert.ok(seen.filter(e => e.status === 'error').length <= 4, 'it did not keep going');
    } finally {
      require(cliPath).resolveCli = realCli;
      delete require.cache[runnersPath];
      fs.rmSync(stub, { force: true });
    }
  });

  await t('a Claude Code that keeps re-running failing commands is stopped by the runner', async () => {
    // A stand-in for the claude program: a Bash command, its failed result, again and again.
    const stub = path.join(os.tmpdir(), 'caret-stub-claude-' + process.pid + '.js');
    fs.writeFileSync(stub, `
      let n = 0;
      const timer = setInterval(() => {
        n++;
        console.log(JSON.stringify({ type: 'assistant', session_id: 's1', message: { content: [{ type: 'tool_use', id: 't' + n, name: 'Bash', input: { command: 'npm run build -- --try ' + n } }] } }));
        console.log(JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't' + n, is_error: true, content: 'Exit code 1' }] } }));
      }, 100);
      setTimeout(() => clearInterval(timer), 60000);
    `);
    const cliPath = require.resolve('../src/main/cli');
    const runnersPath = require.resolve('../src/main/runners');
    const realCli = require(cliPath).resolveCli;
    require(cliPath).resolveCli = () => ({ cmd: process.execPath, args: [stub], env: { ELECTRON_RUN_AS_NODE: '1' } });
    // Claude's runner writes its settings files under the app's data folder; under plain Node there is no app, so lend it one.
    const electronPath = require.resolve('electron');
    const realElectron = require.cache[electronPath];
    require.cache[electronPath] = { id: electronPath, filename: electronPath, loaded: true, exports: { app: { getPath: () => os.tmpdir() } } };
    delete require.cache[runnersPath];
    try {
      const { runClaude } = require('../src/main/runners');
      const seen = [];
      const h = runClaude({ tabId: 'stubtab', model: 'default', mode: 'agent', permission: 'full', prompt: 'x', system: 's', sessionId: null, bridge: null, images: [], on: { text() {}, thinking() {}, fileChanged() {}, tool: e => seen.push(e) } });
      const r = await Promise.race([h.done, new Promise(res => setTimeout(() => res({ error: 'NOT STOPPED' }), 20000))]);
      h.stop();
      // each try is a different command, so it is the "4 failures in a row" rule that stops it
      assert.match(r.error, /Stopped: 4 commands in a row failed/);
      assert.ok(seen.filter(e => e.status === 'error').length <= 5, 'it did not keep going');
    } finally {
      if (realElectron) require.cache[electronPath] = realElectron; else delete require.cache[electronPath];
      require(cliPath).resolveCli = realCli;
      delete require.cache[runnersPath];
      fs.rmSync(stub, { force: true });
    }
  });

  await t('write_file refuses once when it would drop most of a file; failed commands are recognised', async () => {
    const tools = require('../src/main/tools');
    const { failedRun } = require('../src/main/agent');
    ws.setRoot(proj);
    fs.writeFileSync(path.join(proj, 'big.js'), 'const x = 1;\n'.repeat(100));
    const run = { files: [], onFileChanged() {}, commands: 0 };
    await assert.rejects(() => tools.execute('write_file', { path: 'big.js', content: 'const x = 1;\n' }, run), /most of the existing code/);
    assert.match(await tools.execute('write_file', { path: 'big.js', content: 'const x = 1;\n' }, run), /Updated/, 'second identical call is allowed');
    assert.strictEqual(failedRun('npm ERR! missing script\n[exit code 1]'), true);
    assert.strictEqual(failedRun('ok\n[exit code ?]'), true, 'a timed-out command counts as failed');
    assert.strictEqual(failedRun('done\n[exit code 0]'), false);
    assert.strictEqual(failedRun('ready\n[still running in the background at http://localhost:3000]'), false);
  });

  await t('connectors: keys are checked before anything runs, go only into the right argument, and are never ours', async () => {
    const prov = require('../src/main/providers');
    const cli = require('../src/main/cli');
    const extPath = require.resolve('../src/main/extensions');
    const realStream = prov.stream, realClaude = cli.resolveCli, realNpm = cli.resolveNpm;
    const calls = [];
    prov.stream = async (cmd, args) => { calls.push(args); return { ok: true }; };
    cli.resolveCli = () => ({ cmd: 'claude-stub', args: [], env: {} });
    cli.resolveNpm = () => ({ cmd: 'npm-stub', args: [], env: {} });
    delete require.cache[extPath];
    try {
      const ext = require(extPath);
      const none = () => {};
      await assert.rejects(() => ext.install('cloudflare', { token: 'short' }, none), /valid Cloudflare API token/);
      await assert.rejects(() => ext.install('linear', { token: 'lin_api_' + 'a'.repeat(32) + '" & calc' }, none), /valid Linear API key/);
      await assert.rejects(() => ext.install('supabase', { token: 'sbp_x' }, none), /valid Supabase access token/);
      assert.strictEqual(calls.filter(a => a.includes('add')).length, 0, 'nothing ran for a bad key');
      const tok = 'A'.repeat(40);
      await ext.install('cloudflare', { token: tok }, none);
      const add = calls.find(a => a.includes('add'));
      assert.ok(add.includes('https://mcp.cloudflare.com/mcp') && add.includes('Authorization: Bearer ' + tok) && add.includes('http'), 'header carries the persons own key');
      await ext.install('context7', {}, none);
      assert.ok(calls.some(a => a.includes('add') && a.includes('@upstash/context7-mcp@4.7.0') && a.includes('--')), 'pinned package after --');
      await ext.install('supabase', { token: 'sbp_' + 'b'.repeat(30) }, none);
      assert.ok(calls.some(a => a.includes('-e') && a.some(x => x.startsWith('SUPABASE_ACCESS_TOKEN=sbp_'))), 'env key');
      const st = JSON.stringify(await ext.status());
      assert.ok(!/"http"|"local"|"re"|Bearer /.test(st), 'status hands the page no endpoints or patterns');
      for (const e of ext.CATALOG) if (e.local) assert.match(e.local.pkg, /@\d+\.\d+\.\d+$/, e.id + ' is pinned to a version');
    } finally {
      prov.stream = realStream; cli.resolveCli = realClaude; cli.resolveNpm = realNpm;
      delete require.cache[extPath];
    }
  });

  fs.rmSync(base, { recursive: true, force: true });
  console.log(`\n${pass} checks passed${process.exitCode ? ', some FAILED' : ''}`);
})();
