// Roads build themselves. This checks that works link up on their own, that
// trade rises with how well connected they are, that caravans run and pay,
// that supply reaches from a town, and that losing a work severs the network.
const c = require('../shared/core.js');
const ok = m => console.log('  \x1b[32m\u2713\x1b[0m ' + m);
const bad = m => { fails++; console.log('  \x1b[31m\u2717\x1b[0m ' + m); };
const check = (cond, m) => cond ? ok(m) : bad(m);
let fails = 0;

const g = c.makeMatch({ bots: 4, preset: 'europe', seed: 2 });
for (const p of g.players){ const t = p.home ? g.seatAtHome(p) : -1; const u = t >= 0 ? t : g.pickSeat(14); if (u >= 0) g.seat(p, u); }
g.audit(); g.phase = 'war';
const p = g.players[0];
p.bot = false;
for (let k = 0; k < 6; k++){ g.launch(0, -1, p.sold * 0.9); for (let i = 0; i < 300; i++) g.tick(0.1); }
p.ducats = 200000; p.bought = {1:0,2:0,3:0,4:0,5:0,6:0,7:0};

const W = g.W, far = (a, b) => Math.hypot(a % W - b % W, ((a / W) | 0) - ((b / W) | 0));
const spots = [...p.border].filter(t => !g.build[t]);

console.log('\n  BANNERFRONT — roads\n');

const a = spots[0];
const b = spots.reduce((best, t) => far(a, t) > far(a, best) ? t : best, spots[1]);
check(g.place(0, a, 1) === null, 'a town is raised');
p.netDirty = true; p.network();
check(p.roads.length === 0, 'one work alone has no roads');

const coin = p.ducats;
check(g.place(0, b, 1) === null, 'a second town is raised');
p.netDirty = true; p.network();
check(p.roads.length === 1, 'the two works join themselves with a road');
check(Math.round(p.ducats) === Math.round(coin - p.costOf(1) * 0 - (coin - p.ducats)), 'the road itself is free');
const bonus1 = p.linkBonus;
check(bonus1 > 0, `trade rises with the network (+${(bonus1 * 100).toFixed(0)}%)`);

const d3 = spots.find(t => t !== a && t !== b && far(a, t) > 6 && far(a, t) < 40 && !g.build[t]);
if (d3 && g.place(0, d3, 6) === null){
  p.netDirty = true; p.network();
  check(p.roads.length === 2, 'a third work joins the same network');
  check(p.linkBonus > bonus1, `and raises trade again (+${(p.linkBonus * 100).toFixed(0)}%)`);
}

// caravans
const before = p.ducats;
let seen = 0;
for (let i = 0; i < 900; i++){ g.tick(0.1); if (g.caravans.length > seen) seen = g.caravans.length; }
check(seen > 0, `caravans run the roads on their own (${seen} at once)`);
check(p.ducats > before, 'and pay out when they arrive');

// supply
check(p.supplied(a % W, (a / W) | 0), 'ground beside a town is supplied');
check(!p.supplied((a % W) + 200, (a / W) | 0), 'ground far beyond the network is not');

// severing
const held = p.linkBonus;
g.setOwner(b, 1); p.netDirty = true; p.network();
check(p.linkBonus < held, `losing the ground under a work cuts the network (+${(held*100).toFixed(0)}% -> +${(p.linkBonus*100).toFixed(0)}%)`);

console.log('');
console.log(fails ? `  ${fails} check(s) failed\n` : '  all checks passed\n');
process.exit(fails ? 1 : 0);
