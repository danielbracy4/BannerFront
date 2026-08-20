// Are the lords actually different from one another, and is a poor one poor?
//
//   node tools/lords.js [matches]
//
// A grade that changes nothing is worse than no grades at all: the lobby says
// the field is varied and the player still meets ninety identical warlords. So
// this runs whole matches and asks whether the four grades finish in different
// places, and whether the four bents *play* differently — a settler taking open
// ground, a raider going at its neighbours early.
//
// Grades must never carry a hidden subsidy. The last section checks that: every
// lord starts a match with the same men, coin and arms, whatever it was dealt.
const c = require('../shared/core.js');

const MATCHES = +(process.argv[2] || 3);
const MINUTES = 16;
let fails = 0;
const ok  = (cond, m) => { if (!cond) fails++; console.log((cond ? '  \x1b[32m✓\x1b[0m ' : '  \x1b[31m✗\x1b[0m ') + m); };
const pad = (v, n) => String(v).padStart(n);

const GRADES = ['raw', 'ordinary', 'seasoned', 'formidable'];
// The skills the core deals, mirrored here so a field can be levelled to one.
const SKILL = { raw: 0.22, ordinary: 0.48, seasoned: 0.72, formidable: 0.95 };
const BENTS  = ['settler', 'builder', 'raider', 'warlord'];

const byGrade = {}, byBent = {};
for (const g of GRADES) byGrade[g] = { n:0, alive:0, land:0, wars:0, works:0 };
for (const b of BENTS)  byBent[b]  = { n:0, alive:0, land:0, wars:0, openGround:0 };

for (let m = 0; m < MATCHES; m++){
  const g = c.makeMatch({ bots: 60, humanSeats: 0, preset: 'europe', seed: 700 + m * 131 });
  const spots = g.pickSeats(g.players.length);
  g.players.forEach((p, i) => { if (i < spots.length) g.seat(p, spots[i]); });
  g.audit(); g.phase = 'war';

  // count what each lord actually does, rather than what it was labelled
  const wars = new Map(), open = new Map();
  const orig = g.launch.bind(g);
  g.launch = (o, t, tr) => {
    const a = orig(o, t, tr);
    if (a){
      if (t >= 0) wars.set(o, (wars.get(o) || 0) + 1);
      else open.set(o, (open.get(o) || 0) + 1);
    }
    return a;
  };

  for (let i = 0; i < MINUTES * 60 * 10 && g.phase === 'war'; i++) g.tick(0.1);

  for (const p of g.players){
    const G = byGrade[p.grade], B = byBent[p.bent];
    if (!G || !B) continue;
    G.n++; B.n++;
    if (p.alive){ G.alive++; B.alive++; }
    G.land += p.tiles / g.landCount; B.land += p.tiles / g.landCount;
    G.wars += wars.get(p.id) || 0;   B.wars += wars.get(p.id) || 0;
    G.works += c.B_ALL.reduce((s, b) => s + p.cnt[b], 0);
    B.openGround += open.get(p.id) || 0;
  }
}

console.log('');
console.log('  BANNERFRONT — are the lords different lords?');
console.log('  ' + MATCHES + ' matches · 60 lords · ' + MINUTES + ' minutes');
console.log('');
console.log('  ' + pad('grade', 13) + pad('dealt', 7) + pad('survived', 10) +
            pad('avg land', 10) + pad('wars each', 11) + pad('works each', 12));
console.log('  ' + '-'.repeat(63));
const share = [];
for (const name of GRADES){
  const G = byGrade[name];
  if (!G.n) continue;
  const land = G.land / G.n;
  share.push({ name, land, alive: G.alive / G.n });
  console.log('  ' + pad(name, 13) + pad(G.n, 7) + pad((G.alive / G.n * 100).toFixed(0) + '%', 10) +
              pad((land * 100).toFixed(2) + '%', 10) + pad((G.wars / G.n).toFixed(1), 11) +
              pad((G.works / G.n).toFixed(1), 12));
}

console.log('');
console.log('  ' + pad('bent', 13) + pad('dealt', 7) + pad('survived', 10) +
            pad('avg land', 10) + pad('wars each', 11) + pad('claims each', 13));
console.log('  ' + '-'.repeat(64));
for (const name of BENTS){
  const B = byBent[name];
  if (!B.n) continue;
  console.log('  ' + pad(name, 13) + pad(B.n, 7) + pad((B.alive / B.n * 100).toFixed(0) + '%', 10) +
              pad((B.land / B.n * 100).toFixed(2) + '%', 10) + pad((B.wars / B.n).toFixed(1), 11) +
              pad((B.openGround / B.n).toFixed(1), 13));
}

console.log('');
ok(share.length === 4, 'all four grades appear in a field of sixty');

// Comparing grades *inside* one match cannot answer whether skill is worth
// anything: where a lord spawns swings its fortunes several times harder than
// how well it plays — Rome seats thirteen rivals within 8°, Moscow seats two —
// and that noise swamps the signal at any sample size worth waiting for. So
// hold the map and the seats still and change only the calibre of the field:
// the same world, played once by raw lords and once by formidable ones.
console.log('  the same world, played by fields of one calibre');
console.log('');
console.log('  ' + pad('field', 13) + pad('claimed', 10) + pad('works', 9) +
            pad('wars', 8) + pad('biggest realm', 15) + pad('still alive', 13));
console.log('  ' + '-'.repeat(66));
const level = {};
for (const name of GRADES){
  const G = GRADES.find(x => x === name);
  let claimed = 0, works = 0, wars = 0, biggest = 0, alive = 0, n = 0;
  for (let m = 0; m < MATCHES; m++){
    const g = c.makeMatch({ bots: 50, humanSeats: 0, preset: 'europe', seed: 4100 + m * 97 });
    // one calibre for the whole field; nothing else about them changes
    for (const p of g.players) if (p.bot){ p.grade = name; p.skill = SKILL[name]; }
    const spots = g.pickSeats(g.players.length);
    g.players.forEach((p, i) => { if (i < spots.length) g.seat(p, spots[i]); });
    g.audit(); g.phase = 'war';
    let w = 0;
    const orig = g.launch.bind(g);
    g.launch = (o, t, tr) => { const a = orig(o, t, tr); if (a && t >= 0) w++; return a; };
    for (let i = 0; i < MINUTES * 60 * 10 && g.phase === 'war'; i++) g.tick(0.1);
    const live = g.players.filter(p => p.alive);
    claimed += live.reduce((s, p) => s + p.tiles, 0) / g.landCount;
    works += live.reduce((s, p) => s + c.B_ALL.reduce((t, b) => t + p.cnt[b], 0), 0);
    wars += w; alive += live.length; n++;
    biggest += Math.max(...g.players.map(p => p.tiles)) / g.landCount;
  }
  level[name] = { claimed: claimed/n, works: works/n, wars: wars/n, biggest: biggest/n, alive: alive/n };
  const L = level[name];
  console.log('  ' + pad(name, 13) + pad((L.claimed*100).toFixed(1) + '%', 10) +
              pad(L.works.toFixed(0), 9) + pad(L.wars.toFixed(0), 8) +
              pad((L.biggest*100).toFixed(1) + '%', 15) + pad(L.alive.toFixed(0), 13));
}
console.log('');
// This table is information, not a claim. A field where every lord is equally
// good is not a field where anyone gets ahead — they have each other to contend
// with, so the totals come out much the same whatever the calibre. It is worth
// printing because a *wild* divergence here would mean a grade had broken the
// economy rather than changed how well it is played: at one point a raw field
// finished with a twentieth of the works, and that is what that looks like.
// Whether calibre is worth anything is settled by the duel below, where the two
// actually meet.
const spread = Math.max(...GRADES.map(n => level[n].works)) / Math.min(...GRADES.map(n => level[n].works));
ok(spread < 1.5, `no calibre breaks the economy outright (widest field is ${spread.toFixed(2)}x the narrowest)`);

// Whether skill is worth anything head-to-head cannot be read off a field of
// sixty: spawn luck is several times louder than calibre. So put them in a room
// together — same map, same two seats, mirrored, and the only difference
// between the two lords is how well they play.
console.log('');
console.log('  a duel: same ground, same start, different calibre');
{
  let rawWon = 0, bestWon = 0, drawn = 0, rawLand = 0, bestLand = 0;
  const rounds = Math.max(6, MATCHES * 3);
  for (let m = 0; m < rounds; m++){
    const g = c.makeMatch({ bots: 4, humanSeats: 0, preset: 'continents', seed: 3300 + m * 71 });
    // a solid block, split so each has identical room
    let x0 = -1, y0 = -1;
    for (let y = 24; y < g.H - 44 && x0 < 0; y++){
      for (let x = 24; x < g.W - 64; x++){
        let clear = true;
        for (let dy = 0; dy < 26 && clear; dy++)
          for (let dx = 0; dx < 52; dx++)
            if (g.terrain[(y+dy)*g.W + (x+dx)] < 2){ clear = false; break; }
        if (clear){ x0 = x; y0 = y; break; }
      }
    }
    if (x0 < 0) continue;
    const A = g.players[0], B = g.players[1];
    // alternate which side gets which calibre, so the ground cannot favour one
    const flip = m % 2 === 0;
    A.grade = flip ? 'raw' : 'formidable'; A.skill = SKILL[A.grade];
    B.grade = flip ? 'formidable' : 'raw'; B.skill = SKILL[B.grade];
    A.bent = B.bent = 'builder'; A.expand = B.expand = 1.2;
    A.aggr = B.aggr = 0.6;
    g.seat(A, (y0 + 13) * g.W + (x0 + 8));
    g.seat(B, (y0 + 13) * g.W + (x0 + 43));
    g.audit(); g.phase = 'war';
    for (let i = 0; i < 14 * 60 * 10 && g.phase === 'war'; i++) g.tick(0.1);
    const rawSide = flip ? A : B, bestSide = flip ? B : A;
    rawLand += rawSide.tiles; bestLand += bestSide.tiles;
    if (Math.abs(rawSide.tiles - bestSide.tiles) < 40) drawn++;
    else if (rawSide.tiles > bestSide.tiles) rawWon++;
    else bestWon++;
  }
  console.log(`    formidable ahead ${bestWon} · raw ahead ${rawWon} · level ${drawn}  (of ${rounds})`);
  console.log(`    ground held across all duels: formidable ${bestLand.toLocaleString()}, raw ${rawLand.toLocaleString()}`);
  // Counting duels won throws away how *much* they were won by, and caution
  // occasionally loses a realm outright — a lord waiting for a full armoury can
  // be overrun by a neighbour who did not wait, which is a real weakness of
  // playing well rather than a fault in the grade. Ground held across every
  // duel uses all of the result instead of just its sign, and is what the
  // difference actually amounts to.
  ok(bestLand > rawLand * 1.15,
     `a formidable lord takes more ground than a raw one on equal terms ` +
     `(${(bestLand / Math.max(1, rawLand)).toFixed(2)}x)`);
}
const raider = byBent.raider, settler = byBent.settler;
ok(raider.wars / raider.n > settler.wars / settler.n,
   `a raider starts more wars than a settler (${(raider.wars/raider.n).toFixed(1)} vs ${(settler.wars/settler.n).toFixed(1)})`);
ok(settler.openGround / settler.n > raider.openGround / raider.n,
   `and a settler claims more empty ground (${(settler.openGround/settler.n).toFixed(1)} vs ${(raider.openGround/raider.n).toFixed(1)})`);

// ------------------------------------------------------ no hidden subsidies
console.log('');
console.log('  a grade is competence, never a subsidy');
{
  const g = c.makeMatch({ bots: 200, humanSeats: 0, preset: 'europe', seed: 9 });
  const seen = {};
  for (const p of g.players){
    const k = p.grade;
    seen[k] = seen[k] || { sold: new Set(), arms: new Set(), duc: new Set(), civ: new Set() };
    seen[k].sold.add(Math.round(p.sold)); seen[k].arms.add(Math.round(p.arms));
    seen[k].duc.add(Math.round(p.ducats)); seen[k].civ.add(Math.round(p.civ));
  }
  const all = (f) => new Set(Object.values(seen).flatMap(v => [...v[f]]));
  ok(all('sold').size === 1, `every lord starts with the same soldiers (${[...all('sold')].join(', ')})`);
  ok(all('arms').size === 1, `the same arms (${[...all('arms')].join(', ')})`);
  ok(all('duc').size  === 1, `the same coin (${[...all('duc')].join(', ')})`);
  ok(all('civ').size  === 1, `and the same people (${[...all('civ')].join(', ')})`);
}

console.log('');
console.log(fails ? `  ${fails} check(s) failed\n` : '  the field is genuinely varied\n');
process.exit(fails ? 1 : 0);
