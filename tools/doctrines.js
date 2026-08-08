// Does the economy actually support four viable ways to play?
//
//   ./tools/doctrines.sh [matches] [lords]
//
// Every lord is assigned one of the four doctrines from ARCHETYPES. We run
// whole matches and report, per doctrine, how often it wins and how much of the
// realm it ends up holding. If one doctrine dominates, the trade-offs are fake.

function slurp(path){
  if (typeof readFile === 'function') return readFile(path);
  if (typeof read === 'function') return read(path);
  throw new Error('no file reader in this JS shell');
}
const api = new Function(slurp('shared/core.js') +
  '; return { Game, CFG, ECON, ARCHETYPES, makeMatch };')();

const argv = (typeof arguments !== 'undefined') ? arguments : [];
const MATCHES = +(argv[0] || 6);
const LORDS   = +(argv[1] || 24);
const MAX_MIN = 40;

const NAMES = Object.keys(api.ARCHETYPES);
const pad = (s, n, right) => {
  s = String(s);
  while (s.length < n) s = right ? s + ' ' : ' ' + s;
  return s;
};

const tally = {};
for (const n of NAMES) tally[n] = { played:0, wins:0, share:0, alive:0, peakSold:0, peakEquip:0, works:0 };

for (let m = 0; m < MATCHES; m++){
  const g = api.makeMatch({ bots: LORDS, preset: 'continents', seed: 4000 + m * 6151 });
  const minDist = Math.max(9, Math.sqrt(g.landCount / (LORDS + 2)) * 0.85);
  for (const p of g.players){ const t = g.pickSeat(minDist); if (t >= 0) g.seat(p, t); }
  g.audit(); g.phase = 'war';

  const step = 1 / api.CFG.TICK_HZ, limit = MAX_MIN * 60 / step;
  const peak = new Map();
  let ticks = 0;
  while (g.phase === 'war' && ticks < limit){
    g.tick(step); ticks++;
    if (ticks % 100 === 0){
      for (const p of g.players){
        if (!p.alive) continue;
        const cur = peak.get(p.id) || { sold:0, equip:0 };
        if (p.sold > cur.sold) cur.sold = p.sold;
        if (p.equip > cur.equip) cur.equip = p.equip;
        peak.set(p.id, cur);
      }
    }
  }

  for (const p of g.players){
    const t = tally[p.doctrine];
    t.played++;
    t.share += p.tiles / g.landCount;
    if (p.alive) t.alive++;
    if (g.winner === p.id) t.wins++;
    const pk = peak.get(p.id) || { sold:0, equip:0 };
    t.peakSold += pk.sold; t.peakEquip += pk.equip;
    let w = 0; for (const b of [1,2,3,4,5,6,7]) w += p.st[b].size;
    t.works += w;
  }
  const w = g.winner >= 0 ? g.players[g.winner] : null;
  print('  match ' + (m + 1) + ': ' + (w ? pad(w.doctrine, 12, true) + ' wins in ' +
        (g.time / 60).toFixed(1) + 'm with ' + (w.tiles / g.landCount * 100).toFixed(0) + '%'
        : 'undecided at the cap') + '   (' + g.aliveCount + ' left)');
}

print('');
print('  ' + pad('doctrine', 14, true) + pad('played', 8) + pad('wins', 6) + pad('win rate', 10) +
      pad('avg share', 11) + pad('survived', 10) + pad('peak host', 11) + pad('equip', 8) + pad('works', 7));
print('  ' + '-'.repeat(85));
const expected = 1 / NAMES.length;
for (const n of NAMES){
  const t = tally[n];
  if (!t.played) continue;
  const rate = t.wins / MATCHES;
  print('  ' + pad(n, 14, true) + pad(t.played, 8) + pad(t.wins, 6) +
        pad((rate * 100).toFixed(0) + '%', 10) +
        pad((t.share / t.played * 100).toFixed(1) + '%', 11) +
        pad((t.alive / t.played * 100).toFixed(0) + '%', 10) +
        pad(Math.round(t.peakSold / t.played), 11) +
        pad((t.peakEquip / t.played).toFixed(2), 8) +
        pad((t.works / t.played).toFixed(1), 7));
}
print('');
print('  A balanced set would sit near ' + (expected * 100).toFixed(0) +
      '% wins and equal share. "equip" is peak arms-per-soldier: below 1.00');
print('  means that doctrine fields men it cannot arm.');
print('');
