// Every field taken from another lord is a battle: both sides roll, arming
// loads the dice, both sides bleed, and the ground only moves if the attacker
// wins. This checks that the rule does what it claims — that arming is the
// thing that decides a war, and that a front stays joined to the realm behind
// it.
//
//   node tools/battle.js
//
// Two lords are given adjacent blocks of ground so the fight is controlled: no
// terrain luck, no supply, no geography, just the dice and the armouries.
const c = require('../shared/core.js');

const pad = (v, n) => String(v).padStart(n);
const pct = (a, b) => b ? (a / b * 100).toFixed(0) + '%' : '—';

// A solid block of land, split down the middle between two lords.
function field(seed){
  const g = c.makeMatch({ bots: 4, preset: 'continents', seed });
  g.phase = 'war';
  for (const p of g.players) p.bot = false;
  let x0 = -1, y0 = -1;
  for (let y = 20; y < g.H - 40 && x0 < 0; y++){
    for (let x = 20; x < g.W - 60; x++){
      let ok = true;
      for (let dy = 0; dy < 24 && ok; dy++)
        for (let dx = 0; dx < 48; dx++)
          if (g.terrain[(y + dy) * g.W + (x + dx)] < 2){ ok = false; break; }
      if (ok){ x0 = x; y0 = y; break; }
    }
  }
  if (x0 < 0) return null;
  const A = g.players[0], B = g.players[1];
  for (let dy = 0; dy < 24; dy++)
    for (let dx = 0; dx < 48; dx++)
      g.setOwner((y0 + dy) * g.W + (x0 + dx), dx < 24 ? A.id : B.id);
  for (const p of [A, B]){ p.alive = true; p.civ = 60000; p.levy = 0; }
  g.audit();
  return { g, A, B };
}

const nb = (g, t) => {
  const x = t % g.W, y = (t / g.W) | 0, o = [];
  for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]]){
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < g.W && ny < g.H) o.push(ny * g.W + nx);
  }
  return o;
};

// --------------------------------------------------- does arming decide wars?
console.log('');
console.log('  BANNERFRONT — the battle for a field');
console.log('');
console.log('  attacker  defender      fields taken   attacker lost   defender lost');
console.log('  ' + '-'.repeat(66));

for (const [ea, ed] of [[1.0,1.0],[1.0,0.5],[1.0,0.2],[0.5,1.0],[0.2,1.0]]){
  let taken = 0, aLost = 0, dLost = 0, runs = 0;
  for (const seed of [11, 23, 47]){
    const f = field(seed);
    if (!f) continue;
    runs++;
    const { g, A, B } = f;
    A.sold = 200000; A.arms = 200000 * ea;
    B.sold = 200000; B.arms = 200000 * ed;
    const a0 = A.sold, b0 = B.sold;
    const atk = g.launch(A.id, B.id, 100000);
    if (!atk) continue;
    for (let i = 0; i < 80; i++) g.tick(0.1);
    taken += atk.taken;
    aLost += a0 - (A.sold + atk.troops);
    dLost += b0 - B.sold;
  }
  if (!runs) continue;
  console.log('  ' + pad((ea*100).toFixed(0) + '% armed', 9) + pad((ed*100).toFixed(0) + '% armed', 14) +
              pad((taken/runs).toFixed(0), 14) + pad(Math.round(aLost/runs).toLocaleString(), 16) +
              pad(Math.round(dLost/runs).toLocaleString(), 16));
}

console.log('');
console.log('  Arming should move every column: a better-armed attacker takes more');
console.log('  ground and pays less for it, and a better-armed defender reverses that.');

// -------------------------------------------------- does the front stay joined?
console.log('');
const f = field(11);
let verdict = '  could not stage the field';
if (f){
  const { g, A, B } = f;
  A.sold = 200000; A.arms = 200000; B.sold = 200000; B.arms = 200000;
  const atk = g.launch(A.id, B.id, 120000);
  if (atk){
    for (let i = 0; i < 25; i++) g.tick(0.1);
    // the defender counter-attacks and retakes the whole contact strip
    let retaken = 0;
    for (let t = 0; t < g.N; t++)
      if (g.owner[t] === A.id && nb(g, t).some(n => g.owner[n] === B.id)){ g.setOwner(t, B.id); retaken++; }
    g.audit();
    let took = 0, cut = 0;
    for (let k = 0; k < 25; k++){
      const snap = [];
      for (let t = 0; t < g.N; t++) if (g.owner[t] === B.id) snap.push(t);
      g.tick(0.1);
      for (const t of snap){
        if (g.owner[t] !== A.id) continue;
        took++;
        if (!nb(g, t).some(n => g.owner[n] === A.id)) cut++;
      }
    }
    verdict = cut === 0
      ? '  \x1b[32m✓\x1b[0m a counter-push cut ' + retaken + ' fields from the attacker, and it took ' +
        took + ' more\n    with none of them behind enemy lines'
      : '  \x1b[31m✗\x1b[0m ' + cut + ' of ' + took + ' fields were captured with no ground of the ' +
        'attacker\'s adjacent —\n    the advance is running behind enemy lines';
  }
}
console.log('  a front must stay joined to the realm behind it');
console.log(verdict);
console.log('');
