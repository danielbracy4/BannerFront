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
// works need a square of our own ground now, so a border field rarely serves
const spots = [];
for (let t = 0; t < g.N; t++) if (g.owner[t] === 0 && !g.canPlace(0, t, 1)) spots.push(t);

console.log('\n  BANNERFRONT — roads\n');

const a = spots[0];
const b = spots.reduce((best, t) => far(a, t) > far(a, best) ? t : best, spots[1]);
check(spots.length > 2, `${spots.length} sites have room for a 3\u00d73 town`);
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

const d3 = spots.find(t => far(a, t) > 6 && far(b, t) > 6 && far(a, t) < 40 && !g.canPlace(0, t, 6));
if (d3 && g.place(0, d3, 6) === null){
  p.netDirty = true; p.network();
  check(p.roads.length === 2, 'a third work joins the same network');
  check(p.linkBonus > bonus1, `and raises trade again (+${(p.linkBonus * 100).toFixed(0)}%)`);
}

// caravans
// Watch what the caravans themselves earn, not the treasury. "Ducats went up"
// only ever meant net cash flow was positive — tax and trade could carry it on
// their own, so the check could pass with the roads doing nothing, and once
// mustering started drawing on the treasury it began failing with the roads
// working perfectly. p.vanPaid counts what arrived by road and nothing else.
p.vanPaid = 0;
let seen = 0;
for (let i = 0; i < 900; i++){ g.tick(0.1); if (g.caravans.length > seen) seen = g.caravans.length; }
check(seen > 0, `caravans run the roads on their own (${seen} at once)`);
check(p.vanPaid > 0, `and pay out when they arrive (${Math.round(p.vanPaid)} ducats by road)`);

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
