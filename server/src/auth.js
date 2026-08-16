'use strict';
// Signing in through Google and through Steam.
//
// No dependencies: Google is OAuth 2.0 over `fetch`, Steam is OpenID 2.0 over
// `fetch`, and both are a redirect out and a redirect back. Each provider is
// inert unless its credentials are in the environment, so a server with neither
// set runs exactly as it did before and simply offers no buttons.
//
// The session token comes home in the URL *fragment* (`#token=…`) rather than
// the query string: fragments are never sent to a server, so the token stays
// out of access logs, proxy logs and Referer headers. The client reads it and
// wipes it from the address bar.

const crypto = require('crypto');
const db = require('./db.js');

const GOOGLE_ID     = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const STEAM_KEY     = process.env.STEAM_API_KEY || '';
const STEAM_ON      = process.env.STEAM_LOGIN !== '0';   // needs no key to work

// Where the player is sent back to, and where we tell providers to call back.
// Both are settable because they differ between localhost and production.
const CLIENT = (process.env.CLIENT_ORIGIN || 'https://bannerfront.com').replace(/\/$/, '');
const SELF   = (process.env.PUBLIC_ORIGIN ||
                'https://bannerfront-production.up.railway.app').replace(/\/$/, '');

const google = { get on(){ return !!(GOOGLE_ID && GOOGLE_SECRET); } };
const steam  = { get on(){ return STEAM_ON; } };

// --------------------------------------------------------------- CSRF state
// A short-lived nonce proves the callback belongs to a flow we started, rather
// than to a link somebody sent the player. Held in memory: the round trip takes
// seconds, and a restart mid-sign-in costs one retry rather than a wrong login.
const states = new Map();
function mintState(){
  const s = crypto.randomBytes(16).toString('hex');
  states.set(s, Date.now() + 10 * 60e3);
  if (states.size > 5000) for (const [k, v] of states) if (v < Date.now()) states.delete(k);
  return s;
}
function burnState(s){
  const exp = states.get(s);
  states.delete(s);
  return !!exp && exp > Date.now();
}

const done = (res, token) => {
  res.writeHead(302, { Location: CLIENT + '/#token=' + encodeURIComponent(token) });
  res.end();
};
const failed = (res, why) => {
  res.writeHead(302, { Location: CLIENT + '/#authfail=' + encodeURIComponent(why) });
  res.end();
};

// -------------------------------------------------------------------- Google
function googleStart(res){
  const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: GOOGLE_ID,
    redirect_uri: SELF + '/api/auth/google/callback',
    response_type: 'code',
    scope: 'openid email profile',
    state: mintState(),
    prompt: 'select_account',
  });
  res.writeHead(302, { Location: url });
  res.end();
}

async function googleBack(res, q){
  if (q.get('error')) return failed(res, q.get('error'));
  if (!burnState(q.get('state') || '')) return failed(res, 'stale sign-in, try again');
  const code = q.get('code');
  if (!code) return failed(res, 'no code returned');

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: GOOGLE_ID, client_secret: GOOGLE_SECRET,
      redirect_uri: SELF + '/api/auth/google/callback', grant_type: 'authorization_code',
    }),
  });
  const tok = await r.json().catch(() => ({}));
  if (!tok.id_token) return failed(res, 'google refused the exchange');

  // The id_token arrived over TLS straight from Google's token endpoint in
  // response to our own client secret, so its signature does not need checking
  // here — but the audience does. A token minted for a *different* client is a
  // valid Google token and must not be accepted as one of ours.
  let claims;
  try {
    claims = JSON.parse(Buffer.from(tok.id_token.split('.')[1], 'base64url').toString('utf8'));
  } catch (e) { return failed(res, 'unreadable token'); }
  if (claims.aud !== GOOGLE_ID) return failed(res, 'token was not meant for this game');
  if (!claims.sub) return failed(res, 'google named nobody');

  const out = db.viaProvider('google_sub', claims.sub, {
    email: claims.email_verified ? claims.email : null,
    name: claims.name || claims.given_name || 'A Lord',
  });
  return out.err ? failed(res, out.err) : done(res, out.token);
}

// --------------------------------------------------------------------- Steam
// OpenID 2.0, which Valve never moved off. We send the player to Steam, and
// Steam sends back a signed assertion that we hand straight back to Steam to
// check — the one call that makes the whole thing trustworthy.
function steamStart(res){
  const url = 'https://steamcommunity.com/openid/login?' + new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'checkid_setup',
    'openid.return_to': SELF + '/api/auth/steam/callback?s=' + mintState(),
    'openid.realm': SELF,
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
  });
  res.writeHead(302, { Location: url });
  res.end();
}

async function steamBack(res, q){
  if (!burnState(q.get('s') || '')) return failed(res, 'stale sign-in, try again');

  // Hand every openid.* parameter back to Steam verbatim with the mode switched
  // to check_authentication. Anything less is trusting the browser.
  const body = new URLSearchParams();
  for (const [k, v] of q) if (k.startsWith('openid.')) body.set(k, v);
  body.set('openid.mode', 'check_authentication');

  const r = await fetch('https://steamcommunity.com/openid/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const text = await r.text().catch(() => '');
  if (!/is_valid\s*:\s*true/i.test(text)) return failed(res, 'steam did not vouch for that');

  const claimed = q.get('openid.claimed_id') || '';
  const id = (claimed.match(/\/id\/(\d{17})$/) || [])[1];
  if (!id) return failed(res, 'steam named nobody');

  // The display name is a nicety and needs a Web API key. Without one the
  // player simply gets a generated house name, which is no worse than typing.
  let name = 'Steam Lord';
  if (STEAM_KEY){
    try {
      const p = await fetch('https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?'
        + new URLSearchParams({ key: STEAM_KEY, steamids: id }));
      const j = await p.json();
      name = (j.response && j.response.players && j.response.players[0]
              && j.response.players[0].personaname) || name;
    } catch (e) { /* a missing nickname is not worth failing a sign-in over */ }
  }

  const out = db.viaProvider('steam_id', id, { email: null, name });
  return out.err ? failed(res, out.err) : done(res, out.token);
}

// ------------------------------------------------------------------- routing
// Returns true if it handled the request.
function route(req, res, url){
  const q = new URL(req.url, 'http://x').searchParams;
  try {
    if (url === '/api/auth/google')          { if (!google.on) return failed(res, 'google sign-in is not set up'), true; googleStart(res); return true; }
    if (url === '/api/auth/google/callback') { if (!google.on) return failed(res, 'google sign-in is not set up'), true; googleBack(res, q).catch(e => failed(res, 'google sign-in failed')); return true; }
    if (url === '/api/auth/steam')           { if (!steam.on)  return failed(res, 'steam sign-in is not set up'), true;  steamStart(res); return true; }
    if (url === '/api/auth/steam/callback')  { if (!steam.on)  return failed(res, 'steam sign-in is not set up'), true;  steamBack(res, q).catch(e => failed(res, 'steam sign-in failed')); return true; }
  } catch (e) { failed(res, 'sign-in failed'); return true; }
  return false;
}

module.exports = { route, get providers(){ return { google: google.on, steam: steam.on }; } };
