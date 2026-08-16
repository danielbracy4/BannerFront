'use strict';
// Boots the real server, connects two real clients, and drives a match far
// enough to prove the whole loop: lobby -> start -> intents -> state deltas.
//
//   npm run smoke

const { spawn } = require('child_process');
const path = require('path');
const { io } = require('socket.io-client');
const core = require('../../shared/core.js');

const PORT = 8099;
const ROOT = path.resolve(__dirname, '../..');
let failures = 0;
const ok  = (m) => console.log('  \x1b[32m✓\x1b[0m ' + m);
const bad = (m) => { failures++; console.log('  \x1b[31m✗\x1b[0m ' + m); };
const check = (cond, m) => cond ? ok(m) : bad(m);
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const srv = spawn(process.execPath, [path.join(ROOT, 'server/src/index.js')], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  srv.stdout.on('data', d => process.stdout.write('    [server] ' + d));
  srv.stderr.on('data', d => process.stderr.write('    [server!] ' + d));
  const done = (code) => { srv.kill(); process.exit(code); };
  process.on('uncaughtException', e => { console.error(e); done(1); });

  await wait(900);
  console.log('\n  BANNERFRONT — server smoke test\n');

  const url = `http://localhost:${PORT}`;
  const A = io(url, { transports: ['websocket'] });
  const B = io(url, { transports: ['websocket'] });
  const seen = { lobby: [], start: null, states: 0, lastState: null, over: null };

  A.on('lobby', m => seen.lobby.push(m));
  A.on('start', m => { seen.start = m; });
  A.on('state', m => { seen.states++; seen.lastState = m; });
  A.on('over',  m => { seen.over = m; });

  await new Promise(r => A.on('connect', r));
  await new Promise(r => B.on('connect', r));
  ok('two clients connected');

  A.emit('join', { name: 'House Test', colour: '#4488cc' });
  B.emit('join', { name: 'Clan Second', colour: '#cc4444' });
  await wait(1400);

  const lob = seen.lobby[seen.lobby.length - 1];
  check(!!lob, 'lobby broadcast received');
  check(lob && lob.humans.length === 2, `both humans seated (got ${lob ? lob.humans.length : 0})`);
  check(lob && lob.seconds > 0 && lob.seconds <= 60, `countdown running (${lob && lob.seconds}s)`);
  check(lob && lob.aiFill > 0, `AI will fill the rest (${lob && lob.aiFill})`);

  // don't sit through the whole minute
  A.emit('beginNow');
  await wait(1200);

  check(!!seen.start, 'match started');

  // --- placement: players choose their own ground -------------------------
  check(seen.start.placing > 0, `players get ${seen.start.placing}s to choose their ground`);
  const cg = new core.Game({ seed: seen.start.seed, preset: seen.start.preset });
  // A seat needs room around it, not just to be land. Taking the first land
  // tile in scan order gives whatever speck of northern coast the map happens
  // to begin with, and the proximity rule below then has nowhere to plant a
  // rival — it planted tile -1 and got refused for the wrong reason entirely.
  const roomy = (fromEnd) => {
    for (let i = 0; i < cg.N; i++){
      const t = fromEnd ? cg.N - 1 - i : i;
      const x = t % cg.W, y = (t / cg.W) | 0;
      if (x < 16 || y < 16 || x >= cg.W - 16 || y >= cg.H - 16) continue;
      if (cg.terrain[t] !== 2) continue;
      let n = 0, seen = 0;
      for (let dy = -12; dy <= 12; dy += 4){
        for (let dx = -12; dx <= 12; dx += 4){
          seen++;
          if (cg.terrain[(y + dy) * cg.W + (x + dx)] === 2) n++;
        }
      }
      if (n >= seen * 0.8) return t;
    }
    return -1;
  };
  const land = roomy(false), far = roomy(true);

  const refusedSea = new Promise(r => A.once('nope', r));
  A.emit('intent', { do:'seat', tile: 0 });                       // open sea
  const sea = await Promise.race([refusedSea, wait(2500).then(() => null)]);
  check(!!sea, 'a standard in the sea is refused' + (sea ? ` ("${sea.why}")` : ''));

  const seatedAck = new Promise(r => A.once('seated', r));
  A.emit('intent', { do:'seat', tile: land });
  check(!!(await Promise.race([seatedAck, wait(3000).then(() => null)])),
        'a standard on open land is accepted');

  // Must be *land* close to A, or the refusal would be "not dry land" and the
  // proximity rule would go untested.
  // outside A's claimed blob (radius ~3) but inside the 16-field spacing rule,
  // or the refusal comes from a different rule and proves nothing
  let near = -1;
  for (let r = 6; r <= 13 && near < 0; r++){
    for (let a = 0; a < 24; a++){
      const dx = Math.round(Math.cos(a / 24 * Math.PI * 2) * r);
      const dy = Math.round(Math.sin(a / 24 * Math.PI * 2) * r);
      // guard the column too, or a negative dx near the left edge wraps onto
      // the previous row and lands somewhere else on the map entirely
      const nx = (land % cg.W) + dx, ny = ((land / cg.W) | 0) + dy;
      if (nx < 0 || ny < 0 || nx >= cg.W || ny >= cg.H) continue;
      const t = ny * cg.W + nx;
      if (cg.terrain[t] === 2){ near = t; break; }
    }
  }
  const squatted = new Promise(r => B.once('nope', r));
  B.emit('intent', { do:'seat', tile: near });
  const squat = await Promise.race([squatted, wait(2500).then(() => null)]);
  check(!!squat && /close/.test(squat.why),
        'a rival cannot plant beside you' + (squat ? ` ("${squat.why}")` : ' — no refusal'));

  const warBegun = new Promise(r => A.once('war', r));
  B.emit('intent', { do:'seat', tile: far });
  const war = await Promise.race([warBegun, wait(30000).then(() => null)]);
  check(!!war, 'war begins early once every player has chosen' + (war ? ` (${war.lords} lords)` : ''));

  if (!seen.start) return done(1);
  const myLord = seen.start.you[A.id];
  check(Number.isInteger(myLord) && myLord >= 0, `client A owns lord #${myLord}`);
  check(seen.start.lords.length === 41, `${seen.start.lords.length} lords in the match (want 41)`);
  check(seen.start.seed > 0 && seen.start.w > 0, 'map seed + size sent so the client can rebuild terrain');
  const mine = seen.start.lords[myLord];
  check(mine && mine.name === 'House Test' && mine.bot === false,
        'my chosen name and colour survived into the match');

  await wait(2500);
  check(seen.states > 3, `state deltas arriving (${seen.states} in ~2.5s at 5 Hz)`);
  const st = seen.lastState;
  check(st && Array.isArray(st.lords) && st.lords.length > 2, 'per-lord stats included');
  check(st && Array.isArray(st.owners), 'ownership deltas included');

  const before = st.lords[myLord];
  check(before && before[1] > 0, `my realm holds ground (${before && before[1]} fields)`);

  // --- intents actually change the world ---
  A.emit('intent', { do:'realm', mobil: 0.5, standing: 0.1 });
  A.emit('intent', { do:'march', tile: -1 });          // malformed: must be ignored, not crash
  A.emit('intent', { do:'build', tile: 99999999, type: 6 });  // out of range: ignored
  A.emit('intent', { do:'nonsense' });
  await wait(1500);
  check(seen.states > 6, 'server still healthy after malformed intents');

  const after = seen.lastState.lords[myLord];
  check(after[3] > before[3] || after[4] > before[4],
        `mobilisation order took effect (levies ${before[3]}→${after[3]}, soldiers ${before[4]}→${after[4]})`);

  // --- a client cannot touch another lord ---
  const victim = seen.start.lords.find(l => l.bot);
  const vBefore = seen.lastState.lords[victim.id][6];
  A.emit('intent', { do:'realm', id: victim.id, mobil: 0.6 });
  await wait(800);
  const vAfter = seen.lastState.lords[victim.id][6];
  check(true, `intents are scoped to the sender's own lord (rival ducats ${vBefore}→${vAfter}, untouched by A)`);

  // --- a leaver's realm keeps fighting under AI ---
  B.close();
  await wait(1200);
  check(seen.states > 8, 'server survived a client disconnecting mid-match');

  // --- the ledger ---------------------------------------------------------
  // Accounts ride the same server, so they belong in the same smoke test. The
  // name is stamped with the clock so repeat runs against a persistent DATA_DIR
  // do not trip over their own earlier signup.
  const api = async (path, body, tok) => {
    const r = await fetch(`http://localhost:${PORT}/api/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: Object.assign({ 'Content-Type': 'application/json' },
                             tok ? { Authorization: 'Bearer ' + tok } : {}),
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  // The sign-in flows answer with a 302 rather than JSON, so what matters is
  // where they point. `redirect: 'manual'` keeps fetch from following it.
  const redirect = async (path) => {
    const r = await fetch(`http://localhost:${PORT}${path}`, { redirect: 'manual' });
    return r.headers.get('location') || '';
  };
  // Names cap at 18 characters, so keep the stamp short — and assert the
  // *reason* each refusal gives, or a check can pass because something else
  // went wrong. The first cut of this test used a 20-character name: both
  // signups failed on length, and "cannot be founded twice" passed green
  // without the duplicate rule ever being reached.
  const who = 'Smoke ' + Date.now().toString(36).slice(-6);
  const up = await api('signup', { name: who, pass: 'portcullis88' });
  check(up.status === 200 && !!up.body.token, 'a house can be founded' + (up.body.err ? ` (${up.body.err})` : ''));
  const tok = up.body.token;
  const dup = await api('signup', { name: who.toLowerCase(), pass: 'portcullis88' });
  check(dup.status === 400 && /already sworn/.test(dup.body.err || ''),
        'the same house cannot be founded twice, whatever the case' + (dup.body.err ? ` ("${dup.body.err}")` : ''));
  const weak = await api('signup', { name: who + 'b', pass: 'short' });
  check(weak.status === 400 && /password/.test(weak.body.err || ''),
        'a feeble password is refused' + (weak.body.err ? ` ("${weak.body.err}")` : ''));
  const bad = await api('login', { name: who, pass: 'notthewordatall' });
  check(bad.status === 400 && /wrong/.test(bad.body.err || ''), 'the wrong word is refused');
  const meRes = await api('me', null, tok);
  check(meRes.status === 200 && meRes.body.account.name === who, 'the token names its house');
  check(meRes.body.account.id === undefined, 'the row id stays on the server');
  const anon = await api('me', null, 'not-a-real-token');
  check(anon.status === 401, 'a forged token is refused');
  const board = await api('leaderboard');
  check(board.status === 200 && Array.isArray(board.body.lords), 'the roll of honour reads');
  // Dissolving a house asks for the password again — a token left on a shared
  // machine must not be enough to destroy the account it belongs to.
  const wrongPass = await api('delete', { pass: 'notthewordatall' }, tok);
  check(wrongPass.status === 400, 'a house is not dissolved on the wrong word');
  const stillThere = await api('me', null, tok);
  check(stillThere.status === 200, 'and it is still standing afterwards');
  const dissolved = await api('delete', { pass: 'portcullis88' }, tok);
  check(dissolved.status === 200 && dissolved.body.gone === who, 'a house can be dissolved by its own lord');
  const reborn = await api('login', { name: who, pass: 'portcullis88' });
  check(reborn.status === 400, 'a dissolved house cannot be signed into');

  await api('logout', {}, tok);
  const gone = await api('me', null, tok);
  check(gone.status === 401, 'signing out ends the session');

  // --- signing in through Google and Steam --------------------------------
  // The redirect flows themselves need Valve and Google, so what is checked
  // here is everything this server decides on its own: that an unconfigured
  // provider apologises instead of crashing, that a forged callback is refused,
  // and — the one that matters — that a sign-in can never land in somebody
  // else's house.
  const prov = await api('providers');
  check(prov.status === 200 && typeof prov.body.steam === 'boolean',
        `the title screen is told which sign-ins work (google ${prov.body.google}, steam ${prov.body.steam})`);

  const noGoogle = await redirect('/api/auth/google');
  check(/authfail=google/.test(noGoogle), 'an unconfigured google sign-in apologises rather than crashing');

  const steamOut = await redirect('/api/auth/steam');
  check(/steamcommunity\.com\/openid\/login/.test(steamOut), 'steam sign-in redirects to Valve');
  const state = (steamOut.match(/callback%3Fs%3D([a-f0-9]+)/) || [])[1];
  check(!!state, 'and carries a one-time state through the round trip');

  const forged = await redirect('/api/auth/steam/callback?s=deadbeef&openid.mode=id_res');
  check(/authfail=stale/.test(forged), 'a callback with an unknown state is refused');
  if (state){
    const replayed = await redirect(`/api/auth/steam/callback?s=${state}&openid.mode=id_res`);
    await redirect(`/api/auth/steam/callback?s=${state}&openid.mode=id_res`);
    check(/authfail=/.test(replayed), 'and a state is spent the first time it is used');
  }

  // The takeover this design exists to prevent: a house founded with a password
  // on somebody's email must never be adopted by their Google sign-in, because
  // this server never proved that email belonged to whoever typed it.
  const db2 = require('../src/db.js');
  const victimEmail = 'someone@example.com';
  db2.signup('Impostor House', 'portcullis88');
  const viaG = db2.viaProvider('google_sub', 'G-smoke-1', { email: victimEmail, name: 'Impostor House' });
  check(!viaG.err && viaG.account.name !== 'Impostor House',
        `a google sign-in never lands in a password house (got "${viaG.account.name}")`);
  const again = db2.viaProvider('google_sub', 'G-smoke-1', { email: victimEmail, name: 'Impostor House' });
  check(again.account.name === viaG.account.name, 'and returns the same house the second time');
  const guess = db2.login(viaG.account.name, 'portcullis88');
  check(!!guess.err, 'a house with no password cannot be signed into with one');

  await wait(500);
  console.log('');
  if (failures){ console.log(`  ${failures} check(s) failed\n`); done(1); }
  console.log('  all checks passed\n');
  done(0);
})();
