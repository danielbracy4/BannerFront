// Headless balance harness for Bannerfront.
//
//   ./tools/sim.sh [matches] [bots] [preset]
//
// There is no Node on this machine, so this runs under macOS's built-in
// JavaScriptCore. It loads shared/core.js — the same simulation the browser
// client and the game server run — so the numbers it reports are the numbers a
// player gets. There is no second copy of the rules to drift out of sync.

function slurp(path){
  if (typeof readFile === 'function') return readFile(path);
  if (typeof read === 'function') return read(path);
  throw new Error('no file reader in this JS shell');
}

const api = new Function(slurp('shared/core.js') + `
  return { Game, CFG, makeMatch, BUILDS, SIEGE, PALETTE, makeHouseName,
           B_TOWN:1, B_CASTLE:2, B_HARBOR:3, B_SIEGE:4, B_TOWER:5 };
`)();

const argv = (typeof arguments !== 'undefined') ? arguments : [];
const MATCHES = +(argv[0] || 5);
const BOTS    = +(argv[1] || 40);
const PRESET  = argv[2] || 'continents';
const MAX_MIN = 45;

function pad(s, n, right){
  s = String(s);
  while (s.length < n) s = right ? s + ' ' : ' ' + s;
  return s;
}
function pct(x){ return (x * 100).toFixed(1) + '%'; }

function run(seed){
  const g = api.makeMatch({ bots: BOTS, preset: PRESET, seed });
  // seat every lord
  const minDist = Math.max(9, Math.sqrt(g.landCount / (BOTS + 2)) * 0.85);
  for (const p of g.players){
    const t = g.pickSeat(minDist);
    if (t >= 0) g.seat(p, t);
  }
  g.audit();
  g.phase = 'war';

  const step = 1 / api.CFG.TICK_HZ;
  const limit = MAX_MIN * 60 / step;
  const snap = [];            // land claimed over time
  let ticks = 0, stall = 0, lastClaimed = 0;
  while (g.phase === 'war' && ticks < limit){
    g.tick(step);
    ticks++;
    if (ticks % 300 === 0){    // every 30s
      let claimed = 0, biggest = 0;
      for (const p of g.players){ claimed += p.tiles; if (p.tiles > biggest) biggest = p.tiles; }
      snap.push({ t: g.time, claimed: claimed / g.landCount, lead: biggest / g.landCount, alive: g.aliveCount });
      if (Math.abs(claimed - lastClaimed) < g.landCount * 0.002) stall++;
      lastClaimed = claimed;
    }
  }

  const w = g.winner >= 0 ? g.players[g.winner] : null;
  let towns = 0, castles = 0, harbors = 0, sieges = 0, towers = 0;
  for (const p of g.players){
    towns += p.st[1].size; castles += p.st[2].size;
    harbors += p.st[3].size; sieges += p.st[4].size; towers += p.st[5].size;
  }
  const first = snap.find(s => s.alive < BOTS);
  return {
    seed, mins: g.time / 60, decided: g.phase === 'done',
    lead: w ? w.tiles / g.landCount : 0,
    alive: g.aliveCount, land: g.landCount, landPct: g.landCount / g.N,
    claimed: snap.length ? snap[snap.length - 1].claimed : 0,
    firstDeath: first ? first.t / 60 : null,
    stall, snap, towns, castles, harbors, sieges, towers,
  };
}

print('');
print('  BANNERFRONT — balance run');
print('  ' + MATCHES + ' matches · ' + BOTS + ' lords · ' + PRESET + ' · cap ' + MAX_MIN + 'm');
print('  ' + '-'.repeat(74));
print('  ' + pad('seed', 12) + pad('mins', 7) + pad('winner', 9) + pad('claimed', 9) +
      pad('alive', 7) + pad('1st fall', 10) + pad('land', 8) + pad('stalls', 8));

const rows = [];
for (let i = 0; i < MATCHES; i++){
  const r = run(1000 + i * 7919);
  rows.push(r);
  print('  ' + pad(r.seed, 12) + pad(r.mins.toFixed(1), 7) +
        pad(r.decided ? pct(r.lead) : '—', 9) + pad(pct(r.claimed), 9) +
        pad(r.alive, 7) + pad(r.firstDeath == null ? '—' : r.firstDeath.toFixed(1) + 'm', 10) +
        pad(pct(r.landPct), 8) + pad(r.stall, 8));
}

const avg = k => rows.reduce((s, r) => s + r[k], 0) / rows.length;
print('  ' + '-'.repeat(74));
print('  decided:      ' + rows.filter(r => r.decided).length + '/' + rows.length +
      '   avg length ' + avg('mins').toFixed(1) + 'm');
print('  land claimed: ' + pct(avg('claimed')) + '   lords left ' + avg('alive').toFixed(1));
print('  works built:  ' + [
  'towns ' + (avg('towns')).toFixed(0), 'castles ' + avg('castles').toFixed(0),
  'harbours ' + avg('harbors').toFixed(0), 'siege works ' + avg('sieges').toFixed(0),
  'towers ' + avg('towers').toFixed(0)].join(' · '));

print('');
print('  shape of the first match (every 30s):');
print('  ' + pad('t', 7) + pad('claimed', 10) + pad('leader', 9) + pad('alive', 7));
for (const s of rows[0].snap){
  if (Math.round(s.t) % 120 > 1) continue;
  print('  ' + pad((s.t / 60).toFixed(0) + 'm', 7) + pad(pct(s.claimed), 10) +
        pad(pct(s.lead), 9) + pad(s.alive, 7));
}
print('');
