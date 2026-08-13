// Do the bots behave like someone thinking? Not "do they win" — whether the
// decisions they make hold together: works that form a network, armies that
// are equipped before they march, garrisons kept when invaded, realms that
// feed themselves.
const c = require('../shared/core.js');
const pad = (v, n) => String(v).padStart(n);

function run(seed, mins){
  const g = c.makeMatch({ bots: 24, preset: 'europe', seed });
  for (const p of g.players){ const t = p.home ? g.seatAtHome(p) : -1; const u = t >= 0 ? t : g.pickSeat(14); if (u >= 0) g.seat(p, u); }
  g.audit(); g.phase = 'war';

  let marches = 0, armedMarches = 0, rabbleMarches = 0, whileInvaded = 0;
  const origLaunch = g.launch.bind(g);
  g.launch = (o, t, tr) => {
    // was this lord already being invaded when it chose to march out?
    const beset = g.attacks.some(a => !a.dead && a.target === o);
    const a = origLaunch(o, t, tr);
    if (a && t >= 0){
      marches++;
      const p = g.players[o];
      if (p.quality > 0.75) armedMarches++;
      if (p.quality < 0.5) rabbleMarches++;
      if (beset && tr > p.sold * 1.5) whileInvaded++;
    }
    return a;
  };

  let starving = 0, samples = 0, overCommit = 0, commitSamples = 0;
  for (let i = 0; i < mins * 600; i++){
    g.tick(0.1);
    if (i % 600 === 0){
      for (const p of g.players){
        if (!p.alive) continue;
        samples++;
        if (p.food < 0) starving++;
        
      }
    }
  }
  const live = g.players.filter(p => p.alive);
  const linked = live.filter(p => p.linkBonus > 0.1).length;
  const avgBonus = live.reduce((n, p) => n + p.linkBonus, 0) / Math.max(1, live.length);
  const avgEquip = live.reduce((n, p) => n + p.equip, 0) / Math.max(1, live.length);
  return {
    decided: g.phase === 'done', mins: g.time / 60, alive: g.aliveCount,
    linkedPct: Math.round(linked / Math.max(1, live.length) * 100),
    avgBonus, avgEquip,
    rabblePct: marches ? Math.round(rabbleMarches / marches * 100) : 0,
    armedPct: marches ? Math.round(armedMarches / marches * 100) : 0,
    starvePct: samples ? Math.round(starving / samples * 100) : 0,
    overCommitPct: marches ? Math.round(whileInvaded / marches * 100) : 0,
  };
}

console.log('\n  BANNERFRONT — do the bots make sense?\n');
console.log('  seed   decided  mins  alive  networked  trade+  armed  armed-marches  rabble  starving  reckless');
const rows = [];
for (const seed of [3, 14, 25]){
  const r = run(seed, 18);
  rows.push(r);
  console.log('  ' + pad(seed,4) + pad(r.decided ? 'yes' : 'no', 9) + pad(r.mins.toFixed(0),6) +
    pad(r.alive,7) + pad(r.linkedPct + '%',11) + pad('+' + Math.round(r.avgBonus*100) + '%',7) +
    pad(Math.round(r.avgEquip*100) + '%',7) + pad(r.armedPct + '%',15) +
    pad(r.rabblePct + '%',8) + pad(r.starvePct + '%',10) + pad(r.overCommitPct + '%',16));
}
const avg = k => rows.reduce((n, r) => n + r[k], 0) / rows.length;
console.log('');
console.log('  networked lords   ' + Math.round(avg('linkedPct')) + '%   (works joined into a trading network)');
console.log('  marches armed     ' + Math.round(avg('armedPct')) + '%   rabble marches ' + Math.round(avg('rabblePct')) + '%');
console.log('  lords starving    ' + Math.round(avg('starvePct')) + '%');
console.log('  reckless marches  ' + Math.round(avg('overCommitPct')) + '%   (marched out heavily while already invaded)');
console.log('');
