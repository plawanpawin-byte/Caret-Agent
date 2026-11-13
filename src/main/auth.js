'use strict';
// Signing in to Caret Agent with GitHub, through the Carnet website.
// The app opens the website in the browser with a random state and a PKCE challenge, and waits on a port that only
// this computer can reach. The website sends the browser back here with a one-time code; the app trades it
// (with the PKCE verifier it kept to itself) for an app token. The token is stored encrypted, never shown to the page.
const http = require('http');
const crypto = require('crypto');
const { shell, net } = require('electron');
const settings = require('./settings');

const DEFAULT_SITE = 'https://carnet.scratch-2026-11-04-b765df.workers.dev';
// CARET_SITE is a test hook for a local copy of the website (wrangler dev).
// In the installed app the address is fixed; the override only works when started from source.
const OVERRIDE = require('electron').app.isPackaged ? '' : (process.env.CARET_SITE || '');
const SITE = /^(https:\/\/[a-z0-9.-]+|http:\/\/127\.0\.0\.1:\d+)$/i.test(OVERRIDE) ? OVERRIDE : DEFAULT_SITE;
const WAIT_MS = 5 * 60 * 1000;

const b64u = buf => Buffer.from(buf).toString('base64url');
let pending = null;

function page(ok, text) {
  const target = ok ? `<meta http-equiv="refresh" content="2;url=${SITE}/dashboard">` : '';
  return `<!doctype html><meta charset="utf-8"><title>Caret Agent</title>${target}
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#141414;color:#ededed;font:16px system-ui,sans-serif">
<div style="text-align:center;max-width:420px;padding:24px"><h1 style="font-size:22px;margin:0 0 10px">${ok ? 'You are signed in' : 'Sign-in did not finish'}</h1>
<p style="color:#9a9a9a;margin:0">${text}</p></div>`;
}

// A small copy of the GitHub avatar (png or jpeg, under 100 KB) as a data URL, or null.
async function fetchAvatar(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.hostname !== 'avatars.githubusercontent.com') return null;
    u.searchParams.set('s', '96');
    const r = await net.fetch(u.toString());
    const type = String(r.headers.get('content-type') || '').split(';')[0];
    if (!r.ok || !/^image\/(png|jpeg)$/.test(type)) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    return buf.length < 100000 ? `data:${type};base64,${buf.toString('base64')}` : null;
  } catch { return null; }
}

// grant = true: the person is already signed in and now lets the app use their GitHub access (for the GitHub
// extension). The GitHub token goes back to the caller in memory only; it is not saved by this module.
function signIn(grant = false) {
  if (pending) pending.cancel(new Error('A new sign-in was started.'));
  const verifier = b64u(crypto.randomBytes(32));
  const state = b64u(crypto.randomBytes(32));
  const challenge = b64u(crypto.createHash('sha256').update(verifier).digest());
  return new Promise((resolve, reject) => {
    let done = false, timer = null, port = 0;
    const server = http.createServer(async (req, res) => {
      const reply = (status, body) => { res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(body); };
      try {
        // Only requests addressed to 127.0.0.1:<port> count (guards against DNS rebinding).
        if (req.headers.host !== `127.0.0.1:${port}`) return reply(400, 'Bad request');
        const u = new URL(req.url, 'http://127.0.0.1');
        if (req.method !== 'GET' || u.pathname !== '/cb') return reply(404, 'Not found');
        const got = u.searchParams.get('state') || '';
        if (got.length !== state.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(state))) return reply(403, page(false, 'This sign-in request is not the one Caret Agent started. Close this tab and try again from the app.'));
        const code = u.searchParams.get('code') || '';
        const r = await net.fetch(SITE + '/api/app/exchange', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, verifier }) });
        const j = await r.json().catch(() => ({}));
        if (grant) {
          const mine = settings.publicView().account?.login || '';
          if (!r.ok || typeof j.githubToken !== 'string' || !/^[A-Za-z0-9_\-.]{20,255}$/.test(j.githubToken)) { reply(400, page(false, 'GitHub access was not given. Go back to the app and try again.')); return finish(new Error('GitHub access was not given.')); }
          if (String(j.login || '').toLowerCase() !== mine.toLowerCase()) { reply(400, page(false, 'You approved a different GitHub account. Use the same account you signed in to Caret Agent with.')); return finish(new Error('That was a different GitHub account than the one you are signed in with.')); }
          reply(200, page(true, 'GitHub is connected. You can close this tab and go back to Caret Agent.').replace(/<meta http-equiv[^>]*>/, ''));
          return finish(null, { githubToken: j.githubToken });
        }
        if (!r.ok || typeof j.token !== 'string' || typeof j.login !== 'string') { reply(400, page(false, 'The website did not accept the sign-in. Go back to the app and try again.')); return finish(new Error('The website did not accept the sign-in.')); }
        settings.setAccount({ login: j.login, token: j.token, avatar: j.avatar ? await fetchAvatar(j.avatar) : null });
        reply(200, page(true, 'Caret Agent is ready. Taking you to your dashboard…'));
        finish(null, { login: j.login });
      } catch (e) { reply(500, page(false, 'Something went wrong. Go back to the app and try again.')); finish(new Error('Sign-in failed.')); }
    });
    function finish(err, value) {
      if (done) return;
      done = true;
      clearTimeout(timer); pending = null;
      setTimeout(() => { try { server.close(); } catch {} }, 500);
      err ? reject(err) : resolve(value);
    }
    pending = { cancel: e => finish(e) };
    server.on('error', e => finish(new Error('Could not listen on this computer: ' + e.message)));
    server.listen(0, '127.0.0.1', () => {
      port = server.address().port;
      timer = setTimeout(() => finish(new Error('Sign-in timed out. Try again.')), WAIT_MS);
      const url = grant ? `${SITE}/auth/app/github?port=${port}&state=${state}&challenge=${challenge}&grant=github` : `${SITE}/auth/app?port=${port}&state=${state}&challenge=${challenge}`;
      shell.openExternal(url).catch(() => finish(new Error('Could not open the browser.')));
    });
  });
}

function cancel() { if (pending) pending.cancel(new Error('Cancelled.')); }

// Who is signed in. A token the website no longer accepts signs the person out; no network keeps them signed in.
async function check() {
  const token = settings.getAccountToken();
  if (!token) return settings.publicView().account;
  try {
    const r = await net.fetch(SITE + '/api/app/me', { headers: { authorization: 'Bearer ' + token } });
    if (r.status === 401) settings.clearAccount();
    else if (r.ok && !settings.publicView().account?.avatar) {
      const j = await r.json().catch(() => ({}));
      if (j.avatar) settings.setAccountAvatar(await fetchAvatar(j.avatar));
    }
  } catch {}
  return settings.publicView().account;
}

async function signOut() {
  const token = settings.getAccountToken();
  settings.clearAccount();
  if (token) { try { await net.fetch(SITE + '/api/app/logout', { method: 'POST', headers: { authorization: 'Bearer ' + token } }); } catch {} }
  return true;
}

const grantGithub = () => signIn(true);

module.exports = { grantGithub, signIn, cancel, check, signOut, SITE };
