'use strict';
// Points the same checks at the deployed server rather than a local one.
//   node server/test/live.js [url]
const { io } = require('socket.io-client');
const URL = process.argv[2] || 'https://bannerfront-production.up.railway.app';
const ok=(m)=>console.log('  \x1b[32m✓\x1b[0m '+m), bad=(m)=>console.log('  \x1b[31m✗\x1b[0m '+m);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async () => {
  console.log('\n  live server check — ' + URL + '\n');
  const good = io(URL, { transports:['websocket'], extraHeaders:{ Origin:'https://bannerfront.com' } });
  let started=null, states=0;
  good.on('start', m => started = m);
  good.on('state', () => states++);
  try {
    await new Promise((r,j)=>{ good.on('connect',r); good.on('connect_error',j); setTimeout(()=>j(new Error('timeout')),15000); });
    ok('bannerfront.com may connect');
  } catch(e){ bad('allowed origin could not connect: ' + e.message); process.exit(1); }
  good.emit('join',{ name:'House Live', colour:'#4488cc' });
  await wait(1200);
  good.emit('beginNow');
  await wait(3000);
  started ? ok(`match started live (${started.lords.length} lords, map seed ${started.seed})`) : bad('no match started');
  states>3 ? ok(`state deltas flowing (${states} received)`) : bad(`only ${states} state messages`);
  good.close();

  await wait(500);
  const evil = io(URL, { transports:['websocket'], extraHeaders:{ Origin:'https://evil.example.com' }, reconnection:false });
  let refused=false;
  evil.on('denied', () => refused = true);
  evil.on('connect_error', () => refused = true);
  evil.on('disconnect', () => refused = true);
  await wait(5000);
  refused ? ok('an unknown site is refused (ALLOWED_ORIGINS is doing its job)')
          : bad('an unknown site was NOT refused');
  evil.close();
  console.log('');
  process.exit(0);
})();
