// Self-tests for the parts that keep users safe. Runs with plain Node.
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ws = require('../src/main/workspace');
const permissions = require('../src/main/permissions');
const { ensureFavicon } = require('../src/main/tools');
const { thinkSplitter } = require('../src/main/llm');

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

  fs.rmSync(base, { recursive: true, force: true });
  console.log(`\n${pass} checks passed${process.exitCode ? ', some FAILED' : ''}`);
})();
