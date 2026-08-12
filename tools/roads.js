// Do roads do anything? Checks that laying one joins the network, that trade
// rises with connection, that supply reaches from a town, and that taking the
// ground under a work severs what it held together.
const c = require('../shared/core.js');
const ok = m => console.log('  \x1b[32m✓\x1b[0m ' + m);
const bad = m => { fails++; console.log('  \x1b[31m✗\x1b[0m ' + m); };
const check = (cond, m) => cond ? ok(m) : bad(m);
let fails = 0;

const g = c.makeMatch({ bots: 4, preset: 'europe', seed: 2 });
for (const p of g.players){ const t = p.home ? g.seatAtHome(p) : -1; const u = t >= 0 ? t : g.pickSeat(14); if (u >= 0) g.seat(p, u); }
g.audit(); g.phase = 'war';
const p = g.players[0];
p.bot = false;                                   // stop the AI spending for us
for (let k = 0; k < 6; k++){ g.launch(0, -1, p.sold * 0.9); for (let i = 0; i < 300; i++) g.tick(0.1); }
p.ducats = 200000;

const W = g.W, far = (a, b) => Math.hypot(a % W - b % W, ((a / W) | 0) - ((b / W) | 0));
const owned = [];
for (let t = 0; t < g.N; t++) if (g.owner[t] === 0 && !g.build[t]) owned.push(t);

console.log('\n  BANNERFRONT — roads\n');

const a = owned[0];
const b = owned.find(t => far(a, t) > 8 && far(a, t) < 25);
const cFar = owned.find(t => far(a, t) > ECON_MAX());
function ECON_MAX(){ return 60; }
check(g.place(0, a, 1) === null && g.place(0, b, 1) === null, 'two towns raised');

const bonus0 = p.linkBonus;
const inc0 = (p.st[1].size * 9 + p.st[3].size * 15) * (1 + bonus0);
check(bonus0 === 0, 'unjoined works earn no network bonus');

const cost = g.roadCost(a, b).cost;
check(g.layRoad(0, a, b) === null, `a road joins them (${far(a,b).toFixed(0)} fields, ${cost} ducats)`);
const bonus1 = p.linkBonus;
check(bonus1 > bonus0, `trade rises once they are joined (+${(bonus1*100).toFixed(0)}%)`);

check(g.layRoad(0, a, b) !== null, 'the same road cannot be laid twice');
check(g.layRoad(0, a, owned[1]) !== null, 'a road must end on a work');
if (cFar) check(g.layRoad(0, a, cFar) !== null, 'a road cannot span the whole realm');

// supply
const ax = a % W, ay = (a / W) | 0;
check(p.supplied(ax, ay), 'ground beside a town is supplied');
check(!p.supplied(ax + 200, ay), 'ground far beyond the network is not');

// a third work joined to the pair should raise the bonus again
const d3 = owned.find(t => far(b, t) > 8 && far(b, t) < 25 && t !== a);
if (d3 && g.place(0, d3, 1) === null && g.layRoad(0, b, d3) === null){
  check(p.linkBonus > bonus1, `a third work on the network raises it further (+${(p.linkBonus*100).toFixed(0)}%)`);
}

// severing: hand the ground under one town to a rival and the network splits
const before = p.linkBonus;
g.setOwner(b, 1);
p.netDirty = true;
check(p.linkBonus < before, `losing the ground under a work cuts the network (+${(before*100).toFixed(0)}% -> +${(p.linkBonus*100).toFixed(0)}%)`);
check(p.roads.length < 2, 'roads to a lost work are dropped');

console.log('');
console.log(fails ? `  ${fails} check(s) failed\n` : '  all checks passed\n');
process.exit(fails ? 1 : 0);
