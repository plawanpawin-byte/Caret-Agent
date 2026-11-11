'use strict';
// Built-in terminal. Each tab keeps its own working folder. Commands from the
// user and from the AI run in the same visible tabs, so nothing runs hidden.
const { spawn, execFile } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs');
const os = require('os');
const { StringDecoder } = require('string_decoder');
const path = require('path');

const IS_WIN = process.platform === 'win32';
const MARK = '__CARET_CWD__';
const LOCAL_URL = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):\d{2,5}[^\s'"<>)\]]*/g;

class Terminals extends EventEmitter {
  constructor() { super(); this.sessions = new Map(); this.seq = 0; }

  create({ cwd, title } = {}) {
    const id = 't' + (++this.seq);
    this.sessions.set(id, { id, cwd: cwd || process.cwd(), title: title || 'Terminal', proc: null, buffer: '' });
    this.emit('created', { id, title: title || 'Terminal', cwd });
    return id;
  }

  list() { return [...this.sessions.values()].map(s => ({ id: s.id, title: s.title, cwd: s.cwd, running: !!s.proc })); }

  setRootAll(cwd) { for (const s of this.sessions.values()) if (!s.proc) s.cwd = cwd; }

  _spawn(command, cwd) {
    if (!fs.existsSync(cwd)) cwd = process.cwd();
    if (IS_WIN) {
      const script = `[Console]::OutputEncoding=[Text.Encoding]::UTF8; $ProgressPreference='SilentlyContinue'\n` +
        `try {\n${command}\n} finally { [Console]::Out.Write("\`n${MARK}" + (Get-Location).ProviderPath + "\`n") }\n` +
        `if ($LASTEXITCODE) { exit $LASTEXITCODE }`;
      // A script file (UTF-8 with BOM) keeps non-English text intact and, unlike -EncodedCommand,
      // makes PowerShell print errors as readable text instead of CLIXML.
      const file = path.join(os.tmpdir(), `caret-run-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.ps1`);
      fs.writeFileSync(file, '﻿' + script, { encoding: 'utf8', mode: 0o600 });
      const proc = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file],
        { cwd, windowsHide: true, env: { ...process.env, FORCE_COLOR: '0' } });
      proc.once('close', () => { try { fs.unlinkSync(file); } catch {} });
      proc.once('error', () => { try { fs.unlinkSync(file); } catch {} });
      return proc;
    }
    const sh = process.env.SHELL || '/bin/bash';
    return spawn(sh, ['-lc', `${command}\n__s=$?; printf '\\n${MARK}%s\\n' "$PWD"; exit $__s`],
      { cwd, detached: true, env: { ...process.env, FORCE_COLOR: '0' } });
  }

  // Run a command in a tab. Resolves when it exits (or early, for servers).
  run(id, command, { source = 'user', background = false, timeoutMs = 120000 } = {}) {
    const s = this.sessions.get(id);
    if (!s) return Promise.reject(new Error('Terminal not found'));
    if (s.proc) return Promise.reject(new Error('This terminal is busy. Stop the running command first.'));
    if (typeof command !== 'string' || !command.trim() || command.length > 8000) return Promise.reject(new Error('Invalid command'));

    this.emit('data', { id, chunk: `\r\n${source === 'ai' ? '◆ ' : ''}${s.cwd}> ${command}\r\n`, kind: 'cmd' });
    const proc = this._spawn(command, s.cwd);
    s.proc = proc;
    let output = '';
    let pending = '';
    const seenUrls = new Set();

    return new Promise(resolve => {
      let settled = false;
      const finish = (result) => { if (!settled) { settled = true; resolve(result); } };

      // One decoder per stream: a multi-byte character (Thai, emoji) can be split between two chunks.
      const decoders = new Map();
      const decode = (stream, buf) => { if (!decoders.has(stream)) decoders.set(stream, new StringDecoder('utf8')); return decoders.get(stream).write(buf); };
      const onChunk = (text0) => {
        let text = pending + text0;
        pending = '';
        // Hold back a trailing partial line that could be the start of our marker.
        const lastNl = text.lastIndexOf('\n');
        const trailing = text.slice(lastNl + 1);
        if (trailing && (MARK.startsWith(trailing) || trailing.startsWith(MARK))) {
          pending = trailing;
          text = text.slice(0, lastNl + 1);
        }
        const lines = text.split('\n');
        const kept = [];
        for (const line of lines) {
          const m = line.indexOf(MARK);
          if (m >= 0) { s.cwd = line.slice(m + MARK.length).trim() || s.cwd; continue; }
          kept.push(line);
        }
        const clean = kept.join('\n');
        if (!clean) return;
        output += clean;
        if (output.length > 200000) output = output.slice(-100000);
        this.emit('data', { id, chunk: clean.replace(/\r?\n/g, '\r\n') });
        for (const m of clean.matchAll(LOCAL_URL)) {
          const url = m[0].replace('0.0.0.0', 'localhost');
          if (!seenUrls.has(url)) { seenUrls.add(url); this.emit('url', { id, url }); }
        }
        if (background && seenUrls.size && !settled) {
          setTimeout(() => finish({ running: true, output: tail(output), urls: [...seenUrls], cwd: s.cwd }), 800);
        }
      };
      proc.stdout.on('data', b => onChunk(decode('out', b)));
      proc.stderr.on('data', b => onChunk(decode('err', b)));
      proc.on('error', err => { this.emit('data', { id, chunk: `\r\n${err.message}\r\n` }); });
      proc.on('close', code => {
        if (pending.includes(MARK)) s.cwd = pending.slice(pending.indexOf(MARK) + MARK.length).trim() || s.cwd;
        else if (pending) { output += pending; this.emit('data', { id, chunk: pending }); }
        pending = '';
        s.proc = null;
        this.emit('exit', { id, code, cwd: s.cwd });
        finish({ running: false, exitCode: code, output: tail(output), urls: [...seenUrls], cwd: s.cwd });
      });

      if (background) {
        // Servers keep running; hand control back after a short warm-up.
        setTimeout(() => finish({ running: !!s.proc, output: tail(output), urls: [...seenUrls], cwd: s.cwd }), 12000);
      } else {
        setTimeout(() => {
          if (s.proc === proc) {
            this.kill(id);
            finish({ running: false, timedOut: true, output: tail(output) + '\n[stopped: took longer than ' + Math.round(timeoutMs / 1000) + 's — run servers in the background]', urls: [...seenUrls], cwd: s.cwd });
          }
        }, timeoutMs);
      }
    });
  }

  kill(id) {
    const s = this.sessions.get(id);
    if (!s || !s.proc) return;
    const pid = s.proc.pid;
    if (IS_WIN) execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => {});
    else { try { process.kill(-pid, 'SIGTERM'); } catch { try { s.proc.kill('SIGTERM'); } catch {} } }
  }

  close(id) { this.kill(id); this.sessions.delete(id); this.emit('closed', { id }); }

  killAll() { for (const id of this.sessions.keys()) this.kill(id); }
}

function tail(text, n = 30000) {
  return text.length > n ? '…' + text.slice(-n) : text;
}

module.exports = new Terminals();
