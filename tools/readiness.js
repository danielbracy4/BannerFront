// Do lords prepare before they go to war?
//
//   node tools/readiness.js [matches] [lords]
//
// There are no doctrines any more. The thing that separates one realm from
// another is whether it troubled to get ready: men called up and come in, arms
// forged for them, and coin in hand to keep them in the field. So this watches
// every march and asks what state the lord was in when it gave the order.
//
// Claiming open ground is deliberately exempt — empty land has no defenders and
// gating the opening scramble behind a war chest would stop the map ever being
// settled. The `open ground` row is the control: it *should* be unprepared, and
// if it starts matching the war row then the gate has leaked into the scramble.
const c = require('../shared/core.js');

const MATCHES = +(process.argv[2] || 4);
const LORDS   = +(process.argv[3] || 24);
const MAX_MIN = 30;

const pad = (v, n, right) => {
  let s = String(v);
  while (s.length < n) s = right ? s + ' ' : ' ' + s;
  return s;
};
const pct = (a, b) => b ? (a / b * 100).toFixed(0) + '%' : '—';

// Opening a war and reinforcing one are different acts, and only the first is
// what the rule is about — a lord already in the field, whose treasury the war
// has since drained, is not "marching unprepared" by sending the next wave.
// Counting them together understated compliance by a tenth.
const tally = {
  open_war: { n:0, mobilised:0, armed:0, funded:0, ready:0 },
  reinforce:{ n:0, mobilised:0, armed:0, funded:0, ready:0 },
  open:     { n:0, mobilised:0, armed:0, funded:0, ready:0 },
};
let firstWarAt = [], warsOpened = 0, decided = 0;

for (let m = 0; m < MATCHES; m++){
  const g = c.makeMatch({ bots: LORDS, preset: 'europe', seed: 3000 + m * 7717 });
  for (const p of g.players){
    const t = p.home ? g.seatAtHome(p) : -1;
    const u = t >= 0 ? t : g.pickSeat(14);
    if (u >= 0) g.seat(p, u);
  }
  g.audit(); g.phase = 'war';

  const sawWar = new Set();
  const orig = g.launch.bind(g);
  g.launch = (o, t, tr) => {
    const p = g.players[o];
    const already = t >= 0 && g.attacks.some(a => !a.dead && a.owner === o && a.target === t);
    const row = t < 0 ? tally.open : already ? tally.reinforce : tally.open_war;
    row.n++;
    if (p.sold   >= c.ECON.WAR_HOST * p.pop) row.mobilised++;
    if (p.equip  >= c.ECON.WAR_EQUIP)        row.armed++;
    if (p.ducats >= c.ECON.WAR_CHEST)        row.funded++;
    if (g.warReady(p))                       row.ready++;
    if (t >= 0 && !sawWar.has(o)){
      sawWar.add(o); warsOpened++;
      firstWarAt.push(g.time);
    }
    return orig(o, t, tr);
  };

  const step = 1 / c.CFG.TICK_HZ, limit = MAX_MIN * 60 / step;
  let ticks = 0;
  while (g.phase === 'war' && ticks < limit){ g.tick(step); ticks++; }
  if (g.phase === 'done') decided++;
  process.stdout.write('  match ' + (m + 1) + ': ' + (g.phase === 'done' ? 'decided' : 'undecided') +
    ' at ' + (g.time / 60).toFixed(1) + 'm, ' + g.aliveCount + ' left\n');
}

const med = a => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };

console.log('');
console.log('  BANNERFRONT — do lords prepare before they fight?');
console.log('  ' + MATCHES + ' matches · ' + LORDS + ' lords');
console.log('');
console.log('  ' + pad('marches on', 14, true) + pad('count', 8) + pad('mobilised', 12) +
            pad('armed', 9) + pad('funded', 9) + pad('all three', 12));
console.log('  ' + '-'.repeat(64));
for (const [name, row] of [['opens a war', tally.open_war],
                           ['reinforces', tally.reinforce],
                           ['open ground', tally.open]]){
  console.log('  ' + pad(name, 14, true) + pad(row.n, 8) + pad(pct(row.mobilised, row.n), 12) +
              pad(pct(row.armed, row.n), 9) + pad(pct(row.funded, row.n), 9) +
              pad(pct(row.ready, row.n), 12));
}
console.log('');
console.log('  wars opened      ' + warsOpened +
            ', first one a median ' + (med(firstWarAt) / 60).toFixed(1) + ' minutes in');
console.log('  matches decided  ' + decided + '/' + MATCHES);
console.log('');
console.log('  "opens a war" should be near 100% on all three — that is the whole rule.');
console.log('  "reinforces" may be lower: a war drains the treasury that started it.');
console.log('  "open ground" is the control and should stay well below both; if it');
console.log('  climbs to meet them, preparation has leaked into the land grab and the');
console.log('  opening scramble will stall.');
console.log('');
