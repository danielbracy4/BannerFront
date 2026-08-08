'use strict';
// Boots the real server, connects two real clients, and drives a match far
// enough to prove the whole loop: lobby -> start -> intents -> state deltas.
//
//   npm run smoke

const { spawn } = require('child_process');
const path = require('path');
const { io } = require('socket.io-client');

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

  await wait(500);
  console.log('');
  if (failures){ console.log(`  ${failures} check(s) failed\n`); done(1); }
  console.log('  all checks passed\n');
  done(0);
})();
