// Can a realm build without limit, and does the limit grow with the realm?
//
//   node tools/capacity.js
//
// The thing being checked is that the ceiling is *real*: not a number printed
// beside a building count, but a rule that refuses the purchase — for the AI on
// the same terms as for a player, since the AI is the one with the automated
// hands. Everything here reads the simulation rather than the screen.
const c = require('../shared/core.js');

let fails = 0;
const ok  = (cond, m) => { if (!cond) fails++; console.log((cond ? '  \x1b[32m✓\x1b[0m ' : '  \x1b[31m✗\x1b[0m ') + m); };
const pad = (v, n) => String(v).padStart(n);

// A lord with land and coin, and nothing else in the way.
function lordWith(tiles, ducats){
  const g = c.makeMatch({ bots: 2, humanSeats: 0, preset: 'continents', seed: 5 });
  const p = g.players[0];
  p.alive = true; p.tiles = tiles; p.ducats = ducats;
  return { g, p };
}

console.log('');
console.log('  BANNERFRONT — what a realm can run');
console.log('');
console.log('  ' + pad('fields', 8) + pad('towns', 7) + pad('ceiling', 9) + pad('farms', 7) +
            pad('forges', 8) + pad('castles', 9) + pad('first farm', 12) + pad('last farm', 11));
console.log('  ' + '-'.repeat(71));

const shape = [];
for (const [tiles, towns] of [[21,0],[100,1],[400,3],[1000,6],[2500,12],[5000,20],[10000,30]]){
  const { p } = lordWith(tiles, 0);
  p.st[c.B_TOWN] = new Set(Array.from({ length: towns }, (_, i) => i));
  const cap = p.capOf(c.B_FARM);
  p.st[c.B_FARM] = new Set();
  const first = p.costOf(c.B_FARM);
  p.st[c.B_FARM] = new Set(Array.from({ length: cap }, (_, i) => i + 5000));
  const last = p.costOf(c.B_FARM);
  p.st[c.B_FARM] = new Set();
  shape.push({ tiles, cap, total: Math.floor(p.worksCap) });
  console.log('  ' + pad(tiles.toLocaleString(), 8) + pad(towns, 7) + pad(Math.floor(p.worksCap), 9) +
              pad(cap, 7) + pad(p.capOf(c.B_FORGE), 8) + pad(p.capOf(c.B_CASTLE), 9) +
              pad(first.toLocaleString(), 12) + pad(last.toLocaleString(), 11));
}

console.log('');
ok(shape[0].cap <= 4, `a new holding can run ${shape[0].cap} farms, not hundreds`);
ok(shape.every((s, i) => i === 0 || s.cap >= shape[i-1].cap), 'the ceiling never falls as the realm grows');
ok(shape[shape.length-1].cap > shape[0].cap * 10, 'and a great realm runs many times what a small one can');
// growth has to be gradual — no single step may multiply the ceiling
const jumps = shape.slice(1).map((s, i) => s.cap / Math.max(1, shape[i].cap));
ok(Math.max(...jumps) < 4, `no step multiplies the ceiling by more than ${Math.max(...jumps).toFixed(1)}x`);

// ------------------------------------------------- coin alone cannot build
console.log('');
console.log('  coin is not capacity');
{
  // A realm with plenty of room to build on and an absurd purse. The land has
  // to be genuinely open, or the test measures the footprint rule instead of
  // the ceiling and passes for the wrong reason.
  const g = c.makeMatch({ bots: 2, humanSeats: 0, preset: 'continents', seed: 5 });
  const p = g.players[0];
  let seat = -1;
  for (let y = 30; y < g.H - 40 && seat < 0; y++){
    for (let x = 30; x < g.W - 40; x++){
      let clear = true;
      for (let dy = 0; dy < 30 && clear; dy++)
        for (let dx = 0; dx < 30; dx++)
          if (g.terrain[(y+dy)*g.W + (x+dx)] < 2){ clear = false; break; }
      if (clear){ seat = y * g.W + x; break; }
    }
  }
  g.seat(p, seat);
  for (let dy = 0; dy < 30; dy++)                 // a solid 30x30 holding
    for (let dx = 0; dx < 30; dx++) g.setOwner(seat + dy * g.W + dx, p.id);
  g.audit();
  p.ducats = 100000000;
  const cap = p.capOf(c.B_FARM);
  let built = 0, refusal = null;
  outer: for (let i = 0; i < 500; i++){
    for (let t = seat; t < seat + 30 * g.W; t++){
      if (g.owner[t] !== p.id) continue;
      const err = g.place(p.id, t, c.B_FARM);
      if (err === null){ built++; continue outer; }
      refusal = err;
    }
    break;
  }
  ok(built > 0, `it has room to build (${built} farms raised on 900 open fields)`);
  ok(built === cap, `with a hundred million ducats it built ${built} farms against a ceiling of ${cap}`);
  ok(p.ducats > 99000000, 'and most of the money is still in the treasury — there was nothing to spend it on');
  // Collect every distinct reason the ground gives back. Most fields refuse for
  // the footprint — a farm wants 3x3 clear — so taking the last one seen says
  // nothing. The ceiling has to be in there somewhere, and it is the reason
  // that matters.
  const reasons = new Set();
  for (let t = seat; t < seat + 30 * g.W; t++){
    if (g.owner[t] !== p.id) continue;
    const err = g.canPlace(p.id, t, c.B_FARM);
    if (err) reasons.add(err);
  }
  const ceiling = [...reasons].find(r => /can run no more/.test(r));
  ok(!!ceiling, `and the ground itself says why ("${ceiling || [...reasons][0]}")`);
}

// --------------------------------------------------------- and nor can the AI
console.log('');
console.log('  the AI is held to the same ceiling');
{
  const g = c.makeMatch({ bots: 40, humanSeats: 0, preset: 'europe', seed: 202 });
  const spots = g.pickSeats(g.players.length);
  g.players.forEach((p, i) => { if (i < spots.length) g.seat(p, spots[i]); });
  g.audit(); g.phase = 'war';
  // hand every bot a fortune: if the ceiling is real, it changes nothing
  for (const p of g.players) p.ducats = 5000000;

  // Watch the purchase itself. A lifetime count of what a lord has bought is
  // *not* the test — a realm that loses land, or loses works to an enemy, may
  // legitimately build again, and comparing a lifetime tally against a ceiling
  // that moves would fail on correct behaviour. What must never happen is a
  // work being raised by a lord already at its limit for that kind.
  let violations = 0, purchases = 0;
  const realPlace = g.place.bind(g);
  g.place = (owner, tile, type) => {
    const p = g.players[owner];
    const wasAt = p.st[type].size >= p.capOf(type);
    const err = realPlace(owner, tile, type);
    if (err === null){ purchases++; if (wasAt) violations++; }
    return err;
  };

  const log = [];
  for (let m = 1; m <= 12 && g.phase === 'war'; m++){
    for (let i = 0; i < 600 && g.phase === 'war'; i++){
      g.tick(0.1);
      if (i % 120 === 0) for (const p of g.players) if (p.alive) p.ducats = Math.max(p.ducats, 5000000);
    }
    const alive = g.players.filter(p => p.alive);
    const most = Math.max(...alive.map(p => c.B_ALL.reduce((s, b) => s + p.bought[b], 0)));
    log.push({ m, most });
  }
  ok(violations === 0,
     `no work was ever raised by a lord already at its ceiling (${purchases.toLocaleString()} purchases watched)`);
  console.log(`    most works any one bot bought in twelve minutes: ${log[log.length-1].most}`);
  ok(log[log.length-1].most < 200, 'and none of them bought hundreds');

  // the ceiling should still be *reached* — a cap nobody meets is not a cap
  const alive = g.players.filter(p => p.alive);
  const atCap = alive.filter(p => c.B_ALL.some(b => p.st[b].size >= p.capOf(b))).length;
  ok(atCap > 0, `${atCap} of ${alive.length} lords are at their ceiling in some kind of work`);
}

// ------------------------------------------------------------ arms and levies
console.log('');
console.log('  arms reach the levy, even though the levy cannot arm itself');
{
  const { p } = lordWith(500, 0);
  p.sold = 1000; p.levy = 4000;
  const rows = [];
  for (const arms of [0, 1000, 3000, 5000, 20000]){
    p.arms = arms;
    rows.push({ arms, eq: p.equip, lq: p.levyEquip, lqual: p.levyQuality, dens: p.density });
  }
  console.log('  ' + pad('arms', 8) + pad('soldiers armed', 16) + pad('levy armed', 12) +
              pad('levy quality', 14) + pad('holding power', 15));
  for (const r of rows)
    console.log('  ' + pad(r.arms.toLocaleString(), 8) + pad((r.eq*100).toFixed(0)+'%', 16) +
                pad((r.lq*100).toFixed(0)+'%', 12) + pad(r.lqual.toFixed(2), 14) +
                pad(r.dens.toFixed(2), 15));
  ok(rows[0].lq === 0, 'an empty armoury arms none of the levy');
  ok(rows[1].lq === 0, 'and arms enough for only the soldiers still leaves the levy with nothing');
  ok(rows[3].lq > rows[2].lq && rows[2].lq > 0, 'what is left over after the soldiers arms the levy');
  ok(rows[4].lq === 1, 'a full armoury arms all of it');
  ok(rows[4].dens > rows[0].dens * 1.5,
     `and a well-armed host holds ground far harder (${rows[0].dens.toFixed(2)} -> ${rows[4].dens.toFixed(2)})`);
  ok(p.levyQuality <= p.quality || p.levyEquip >= p.equip, 'a levy is never worth more than a soldier of the same kit');
}

console.log('');
console.log(fails ? `  ${fails} check(s) failed\n` : '  all capacity checks passed\n');
process.exit(fails ? 1 : 0);
