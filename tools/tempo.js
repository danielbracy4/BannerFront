// How fast does ground actually change hands, and does a bigger host take it
// faster? "Claiming is too slow" and "a larger army should attack faster" are
// both claims about tiles per second, so this measures exactly that: one lord,
// one assault, a fixed number of seconds, counted over a range of host sizes.
//
//   node tools/tempo.js
//
// The `per 1k` column is the whole point of the size test. If it is flat, host
// size buys nothing but a longer advance — the attack takes the same ground per
// second whether you send 500 men or 8000, which is what "scaled with army
// size" is asking to change.
const c = require('../shared/core.js');

// Rate has to be separated from stock, or this measures the wrong thing. A
// 500-man host can only ever buy ~24 fields of open ground at ~20 levy each, so
// over any window long enough to watch it, it spends itself and the tiles column
// reports its *purse* rather than its speed — which is how a 20s window once
// reported byte-identical figures for a rules change that had plainly altered
// the rate. So the host is held topped up: each tick its levy is restored, and
// the question becomes the one actually being asked — if a host of this size
// keeps being reinforced, how fast does its front move?
const SECS = 8;
const HOSTS = [500, 1000, 2000, 4000, 8000, 16000];

// A settled realm with room to expand: seat the lords, let the map breathe for
// a moment so borders and works exist, then hand one lord a host of known size.
function stage(seed){
  const g = c.makeMatch({ bots: 6, preset: 'europe', seed });
  for (const p of g.players){
    const t = p.home ? g.seatAtHome(p) : -1;
    const u = t >= 0 ? t : g.pickSeat(14);
    if (u >= 0) g.seat(p, u);
  }
  g.audit();
  g.phase = 'war';
  for (const p of g.players) p.bot = false;   // nobody else acts; we measure one attack
  for (let i = 0; i < 100; i++) g.tick(0.1);
  return g;
}

// Tiles taken by a single assault of `troops` men over SECS seconds.
function run(troops, seed){
  const g = stage(seed);
  const p = g.players[0];
  p.sold = troops; p.arms = troops;      // fully equipped, so quality is not the variable
  const a = g.launch(0, -1, troops);     // -1: open ground
  if (!a) return null;
  let levy = 0;
  for (let i = 0; i < SECS * c.CFG.TICK_HZ; i++){
    g.tick(1 / c.CFG.TICK_HZ);
    levy += troops - a.troops;
    a.troops = troops;                   // reinforced: we are measuring rate, not purse
  }
  return { taken: a.taken, front: a.heap.size, levy: levy / SECS, alive: a.dead ? 0 : 1 };
}

const pad = (v, n) => String(v).padStart(n);

console.log('');
console.log('  BANNERFRONT — tempo of an advance');
console.log('  open ground · ' + SECS + 's · reinforced · averaged over 3 seeds');
console.log('');
console.log('  ' + pad('host', 8) + pad('tiles', 9) + pad('tiles/s', 10) +
            pad('vs 1k host', 13) + pad('front', 8) + pad('levy/s', 10) +
            pad('still on', 10));
console.log('  ' + '-'.repeat(68));

const rate = {};
for (const h of HOSTS){
  const rs = [11, 23, 47].map(s => run(h, s)).filter(Boolean);
  if (!rs.length){ console.log('  ' + pad(h, 8) + '  no assault formed'); continue; }
  const avg = k => rs.reduce((s, r) => s + r[k], 0) / rs.length;
  const taken = avg('taken'), alive = avg('alive');
  rate[h] = taken / SECS;
  console.log('  ' + pad(h, 8) + pad(taken.toFixed(0), 9) +
              pad(rate[h].toFixed(2), 10) +
              pad((rate[h] / rate[1000]).toFixed(2) + '×', 13) +
              pad(avg('front').toFixed(0), 8) +
              pad(avg('levy').toFixed(0), 10) +
              pad(alive === 1 ? 'yes' : alive === 0 ? 'NO' : (alive * 100).toFixed(0) + '%', 10));
}
console.log('');
console.log('  "still on" must be yes on every row. "vs 1k host" is the size test:');
console.log('  if it stays near 1.00× then host size buys a longer war rather than');
console.log('  a faster one, whatever the tiles column says.');
console.log('');
