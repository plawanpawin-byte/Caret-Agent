// Syntax-checks every source file (main = CommonJS, renderer = ES modules)
// and runs the self-tests for the security-critical helpers.
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const root = path.join(__dirname, '..');
let failed = 0;

function check(file, asModule) {
  let target = file;
  if (asModule) {
    target = path.join(os.tmpdir(), 'caret-check-' + path.basename(file, '.js') + '.mjs');
    fs.copyFileSync(file, target);
  }
  try { execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' }); console.log('ok  ', path.relative(root, file)); }
  catch (e) { failed++; console.log('FAIL', path.relative(root, file), '\n' + e.stderr.toString()); }
  finally { if (asModule) fs.rmSync(target, { force: true }); }
}

for (const dir of ['src/main', 'src/preload']) for (const f of fs.readdirSync(path.join(root, dir))) if (f.endsWith('.js')) check(path.join(root, dir, f), false);
for (const f of fs.readdirSync(path.join(root, 'src/renderer'))) if (f.endsWith('.js')) check(path.join(root, 'src/renderer', f), true);
check(path.join(root, 'scripts', 'selftest.js'), false);

if (!failed) {
  try { execFileSync(process.execPath, [path.join(__dirname, 'selftest.js')], { stdio: 'inherit' }); }
  catch { failed++; }
}
process.exit(failed ? 1 : 0);
