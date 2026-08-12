"use strict";
// Bannerfront — the simulation. No DOM, no window, no rendering.
//
// This is the authoritative game. It runs in three places and must behave
// identically in all of them:
//   * the browser client (single-player, and rendering during online play)
//   * the Node game server (authoritative for online matches)
//   * the jsc harnesses in tools/
// It is deterministic given a seed, which is what makes both an authoritative
// server and a reproducible balance test possible at all.
const CFG = {
  TICK_HZ: 10,

  // --- population ---
  START_POP:      900,
  START_ARMS:     600,
  START_SOLD:     260,
  // --- coin ---
  TRADE_VALUE:    340,     // per trade run delivered

  // --- war ---
  ATTACK_RATE:    0.030,   // share of an attack's remaining levy spent per tick
  ATTACK_FLOOR:   20,      // ...but at least this many per tick
  TILE_RATE:      0.045,   // tiles converted per tick, as a share of front width.
                           // The front therefore advances ~0.45 tiles of depth a
                           // second whatever its length — slow enough to watch,
                           // and slow enough that a defender can answer it.
  TILE_FLOOR:     2,       // a narrow front still creeps forward
  NEUTRAL_COST:   24,      // levy per tile of open ground...
  NEUTRAL_BASE:   0.62,    // ...at your first holdings, and rising from there:
  NEUTRAL_SCALE:  850,     // + NEUTRAL_COST per this many fields already held,
  NEUTRAL_CAP:    2.0,     // never past this. Uncapped, a large realm could not
                           // afford to retake its own ground after a plague
                           // cart emptied it, and the map slowly went feral.
                           // Flat pricing makes the land grab exponential — men
                           // grow with land, land costs the same, so the map
                           // empties in one burst. Charging for reach spreads
                           // the scramble out and keeps latecomers in it.
  DEF_BASE:       6,       // flat levy per tile taken from a lord
  DEF_CAP:        26,      // ...counting no more men-per-field than this. A
                           // realm squeezed small packs its levy tight, which
                           // otherwise makes the last holdouts *dearer* per
                           // field than a great power and drags out every endgame.
  DEF_DENSITY:    3.2,    // + this much per man-per-tile the defender holds.
                           // Lower than it looks it should be: a front has to
                           // grind through hills and fortified ground that the
                           // old cherry-picking advance simply walked around,
                           // so the cost actually paid per field went up ~1.5x
                           // on its own when the advance became a front.
  DEF_LOSS:       0.85,    // defender's losses, as a share of the attacker's
                           // spend. This is what makes a war decisive: ground
                           // lost bleeds the levy that would retake it, so a
                           // breakthrough compounds. Open ground has no
                           // defender, so the opening scramble is untouched.
  CASTLE_STEP:    0.5,     // defence multiplier added per overlapping castle,
  CASTLE_STACK:   2,       // counting at most this many. Compounds along the
                           // whole depth of an advance now that cost
                           // accumulates, so held ground really holds — which
                           // is also why it cannot stack far, or a ring of
                           // castles makes a realm simply untakeable.
  CASTLE_R:       8,
  HUNT_R:         26,      // how far a galley will chase a rival's ship
  PATROL_R:       3.5,     // the circuit it walks when the sea is empty
  PRIZE:          260,     // ducats plundered from a captured trader
  SIEGE_REACH:    7,       // how far from your own frontier a siege may be laid
  BREACH_STEP:    0.13,    // ground under siege is this much cheaper, per tier
  SIEGE_BLEED:    0.015,   // garrison lost per second, per invested field
  MAX_ATTACKS:    5,       // simultaneous, per lord
  TERRAIN_DEF:    [1, 1, 1.0, 1.30, 1.60, 2.4], // sea shallow plain wood hill peak

  WIN_PCT:        0.65,
};

const T_SEA = 0, T_SHOAL = 1, T_PLAIN = 2, T_WOOD = 3, T_HILL = 4, T_PEAK = 5;
const B_NONE = 0, B_TOWN = 1, B_CASTLE = 2, B_HARBOR = 3, B_SIEGE = 4, B_TOWER = 5,
      B_FARM = 6, B_FORGE = 7;
const B_ALL = [B_TOWN, B_CASTLE, B_HARBOR, B_SIEGE, B_TOWER, B_FARM, B_FORGE];

const BUILDS = {
  [B_TOWN]:   { key:'town',   name:'Town',       cost:620,  step:1.18, needCoast:false },
  [B_CASTLE]: { key:'castle', name:'Castle',     cost:700,  step:1.12, needCoast:false },
  [B_HARBOR]: { key:'harbor', name:'Harbour',    cost:650,  step:1.15, needCoast:true  },
  [B_SIEGE]:  { key:'siege',  name:'Siege Works',cost:2400, step:1.30, needCoast:false },
  [B_TOWER]:  { key:'tower',  name:'Watchtower', cost:1300, step:1.20, needCoast:false },
  [B_FARM]:   { key:'farm',   name:'Farm',       cost:340,  step:1.10, needCoast:false },
  [B_FORGE]:  { key:'forge',  name:'Blacksmith', cost:560,  step:1.14, needCoast:false },
};

// ------------------------------------------------------------------- economy
// Military strength is earned, never granted. Civilians work; soldiers fight;
// a soldier is a civilian taken out of the economy and handed a set of arms
// that somebody else had to forge. Every one of these numbers exists to make
// that chain of consequences bite.
const SECTORS = ['farm', 'forge', 'trade', 'works'];
const ECON = {
  // Workers needed to fully staff one work, and what that work yields at full
  // staffing. Output is per BUILDING scaled by staffing — never per worker.
  // Per-worker food is a trap: each new mouth then feeds a hundred more, the
  // population explodes, outruns the land and starves back down in a cycle.
  JOBS_FARM:     6000,  YIELD_FARM_FOOD:  16,
  JOBS_FORGE:    5000,  YIELD_FORGE_ARMS: 16,
  JOBS_TOWN:     4500,  YIELD_TOWN_TRADE:  9,
  JOBS_HARBOR:   6000,  YIELD_HARBOR_TRADE: 15,
  JOBS_WORKS:    3000,

  // food: the land feeds a little on its own, farms do the rest
  FOOD_PER_TILE:   0.050,
  FOOD_PER_HEAD:   0.00090,
  GROW_RATE:       0.040,   // of the surplus-supported headroom, per second
  STARVE_RATE:     0.035,

  // Arms equip soldiers rather than gating them. A realm with no forges can
  // still put men in the field — they are simply a rabble, and pay for every
  // field in blood. Blocking training outright instead deadlocks the game: no
  // ducats to build a forge, so no arms, so no army, forever.
  UNARMED:          0.30,   // fighting quality of a wholly unequipped host

  // ducats
  TAX_PER_CIV:      0.0012,
  DUCAT_PER_TILE:   0.004,
  UPKEEP_SOLDIER:   0.0025,
  UPKEEP_LEVY:      0.0010,
  UPKEEP_BUILD:     0.060,

  // works: idle construction capacity discounts what you build
  WORKS_DISCOUNT:   0.35,   // at full employment

  TRAIN_TIME:       42,     // seconds for a levy to become a soldier
  DEMOB_RETURN:     0.6,    // share of arms recovered when disbanding
};

// Four ways to run a realm. These are the AI's priorities, and the balance
// question the harness exists to answer: none of them should dominate.
const ARCHETYPES = {
  mercantile:   { w:{farm:0.28, forge:0.14, trade:0.50, works:0.08}, standing:0.06, mobil:0.45 },
  military:     { w:{farm:0.34, forge:0.30, trade:0.24, works:0.12}, standing:0.22, mobil:0.70 },
  industrial:   { w:{farm:0.30, forge:0.46, trade:0.16, works:0.08}, standing:0.10, mobil:0.60 },
  agricultural: { w:{farm:0.56, forge:0.18, trade:0.18, works:0.08}, standing:0.07, mobil:0.65 },
};

// A siege is laid, not launched. Each of these is a camp raised on your own
// frontier that invests the ground in front of it: walls come down, the
// garrison starves, and the ground is breached for the assault that follows.
// Nothing here flies across the map — that was a missile with a medieval name.
const SIEGE = {
  ram:  { name:'Battering Ram', cost:800,  r:3,  dur:16, bite:0.5, breach:1 },
  treb: { name:'Trebuchet',     cost:2000, r:6,  dur:24, bite:0.9, breach:2 },
  camp: { name:'Siege Camp',    cost:5000, r:11, dur:36, bite:1.4, breach:3 },
};

// ---------------------------------------------------------------- randomness
function mulberry32(a){
  return function(){
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function hash2(x, y, s){
  let n = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 362437);
  n = Math.imul(n ^ n >>> 13, 1274126177);
  return ((n ^ n >>> 16) >>> 0) / 4294967295;
}
function vnoise(x, y, s){
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, s),     b = hash2(xi + 1, yi, s);
  const c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}
function fbm(x, y, s, oct, gain){
  let sum = 0, amp = 1, norm = 0, f = 1;
  for (let i = 0; i < oct; i++){
    sum += amp * vnoise(x * f, y * f, s + i * 977);
    norm += amp; amp *= (gain || 0.5); f *= 2;
  }
  return sum / norm;
}

// ------------------------------------------------------------------- min-heap
// Frontier queue for spreading attacks. Keyed on terrain cost so an assault
// naturally pours through plains and stalls against peaks.
class Heap {
  constructor(){ this.t = []; this.k = []; }
  get size(){ return this.t.length; }
  peek(){ return this.t.length ? this.t[0] : -1; }
  peekKey(){ return this.t.length ? this.k[0] : Infinity; }
  push(tile, key){
    const t = this.t, k = this.k;
    t.push(tile); k.push(key);
    let i = t.length - 1;
    while (i > 0){
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      [t[p], t[i]] = [t[i], t[p]]; [k[p], k[i]] = [k[i], k[p]]; i = p;
    }
  }
  pop(){
    const t = this.t, k = this.k, n = t.length;
    if (!n) return -1;
    const top = t[0];
    const lt = t.pop(), lk = k.pop();
    if (n > 1){
      t[0] = lt; k[0] = lk;
      let i = 0;
      for (;;){
        const l = i * 2 + 1, r = l + 1; let m = i;
        if (l < t.length && k[l] < k[m]) m = l;
        if (r < t.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [t[m], t[i]] = [t[i], t[m]]; [k[m], k[i]] = [k[i], k[m]]; i = m;
      }
    }
    return top;
  }
}

// ------------------------------------------------------------------ heraldry
const HOUSE_A = ['Val','Mar','Cor','Dun','Bran','Eld','Grim','Hal','Ker','Loth','Mor','Nor',
  'Oster','Pell','Ravon','Sar','Thorn','Ulf','Vane','Wold','Ash','Black','Storm','Fen','Gray',
  'Har','Ised','Jor','Kald','Lys','Mer','Ost','Bry','Cas','Dral','Ean'];
const HOUSE_B = ['mont','wyn','dor','holt','march','ford','vale','crag','mere','stead','burn',
  'gard','stone','ridge','fell','hall','wick','moor','shire','watch','reach','helm','bury','cliff'];
const TITLES = ['House','House','House','the','Clan','the','House','the'];
const REALMS = ['Kingdom of','Duchy of','March of','Free City of','County of','Barony of','Principality of'];

function makeHouseName(rand){
  const stem = HOUSE_A[(rand() * HOUSE_A.length) | 0] + HOUSE_B[(rand() * HOUSE_B.length) | 0];
  const r = rand();
  if (r < 0.5)  return 'House ' + stem[0].toUpperCase() + stem.slice(1);
  if (r < 0.72) return REALMS[(rand() * REALMS.length) | 0] + ' ' + stem[0].toUpperCase() + stem.slice(1);
  if (r < 0.86) return 'the ' + stem[0].toUpperCase() + stem.slice(1) + ' Host';
  return 'Clan ' + stem[0].toUpperCase() + stem.slice(1);
}

function hslHex(h, s, l){
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return '#' + [f(0), f(8), f(4)].map(v => v.toString(16).padStart(2, '0')).join('');
}

// Banners are drawn from heraldry rather than a colour wheel: gules, azure,
// vert, purpure, or, tenné, murrey and their neighbours, each in several
// shades. Muted and earthy — these are painted on a map, not lit on a screen.
const TINCTURES = [
  [  6, 56], [212, 50], [128, 36], [286, 29], [ 42, 62], [ 22, 52],
  [340, 34], [188, 34], [ 95, 31], [258, 32], [166, 33], [ 15, 28],
];
const PALETTE = (() => {
  const out = [], shades = [43, 33, 53, 38, 48, 28];
  for (let i = 0; i < 72; i++){
    const t = TINCTURES[i % TINCTURES.length];
    out.push(hslHex(t[0], t[1], shades[((i / TINCTURES.length) | 0) % shades.length]));
  }
  return out;
})();
// ---------------------------------------------------------------- Europe map
// Real geography, as coastline polygons and mountain spines in degrees. Point
// sampling per tile, with the sample point warped by noise first so coasts come
// out ragged rather than showing the straight edges of the polygons.
const EU = {
  lon0: -12, lon1: 42, lat0: 34.0, lat1: 71.5,
  land: [
    // Iberia
    [[-9.5,43.8],[-4.5,43.6],[-1.8,43.4],[0.9,41.2],[3.3,41.9],[0.7,40.6],[-0.3,39.4],[-0.9,37.6],
     [-2.2,36.7],[-5.6,36.0],[-7.4,37.2],[-9.3,38.4],[-9.6,39.4],[-8.9,41.9]],
    // the Pyrenean march — same gap the Alps had, between Iberia and France
    [[-1.95,43.5],[0.9,42.95],[3.3,42.5],[3.25,41.8],[0.75,41.1],[-1.85,43.2]],
    // France, the Low Countries and the Rhine
    [[-4.8,48.4],[-1.5,49.7],[1.6,51.0],[4.3,51.6],[6.0,52.0],[6.2,50.5],[7.6,49.0],[7.6,47.6],
     [6.0,46.2],[7.0,44.0],[5.5,43.2],[3.0,43.0],[0.9,42.8],[-1.8,43.4],[-1.2,45.8],[-2.2,47.2]],
    // Germany, Poland, Bohemia, Austria, Hungary
    [[6.0,52.0],[7.0,53.6],[8.5,54.9],[10.0,54.4],[12.0,54.5],[14.3,54.0],[16.5,54.6],[19.0,54.4],
     [21.0,54.4],[23.5,54.0],[23.9,52.1],[24.2,50.6],[23.3,49.3],[22.6,48.5],[22.9,47.9],[21.5,46.2],
     [19.6,45.9],[17.0,45.8],[16.0,46.5],[13.7,46.5],[12.4,46.6],[11.0,47.0],[9.6,47.5],[7.6,47.6],
     [7.6,49.0],[6.2,50.5]],
    // Ruthenia and the western Rus
    [[23.5,54.0],[26.0,55.8],[28.2,57.2],[30.5,59.2],[33.0,59.8],[36.0,59.0],[40.0,57.6],[42.0,55.0],
     [42.0,50.0],[40.0,48.0],[38.0,47.2],[36.0,46.5],[33.5,46.2],[32.0,46.6],[30.5,46.0],[28.5,45.4],
     [28.8,47.0],[26.6,48.3],[24.0,50.5],[23.9,52.1]],
    // the Balkans and Greece
    [[16.0,46.5],[19.6,45.9],[21.5,46.2],[22.9,47.9],[25.0,45.5],[27.5,44.2],[28.6,43.7],[27.5,42.1],
     [26.5,41.3],[24.0,40.6],[23.5,40.2],[23.0,39.0],[23.7,38.0],[23.0,36.4],[22.0,37.0],[21.3,37.7],
     [20.9,39.0],[19.4,40.3],[19.0,41.8],[18.0,42.7],[16.5,43.4],[15.2,44.3],[13.6,45.5]],
    // the Alpine arc — bridges the gap between the German lands and Italy
    [[5.9,46.3],[7.5,47.6],[10.0,47.7],[13.6,46.9],[13.4,45.6],[11.0,45.7],[8.0,45.0],[6.4,45.1]],
    // Italy
    [[7.6,44.1],[9.2,45.5],[11.0,45.6],[12.4,45.5],[13.6,44.9],[14.2,42.6],[15.2,41.9],[16.5,41.9],
     [18.0,40.7],[18.5,40.1],[17.9,39.9],[16.9,39.5],[17.1,38.9],[16.0,37.9],[15.6,38.2],[15.8,40.0],
     [14.0,40.8],[13.0,41.2],[11.2,42.4],[10.5,43.0],[9.8,44.0],[8.8,44.4]],
    // Great Britain
    [[-5.0,58.6],[-3.0,58.6],[-2.0,57.5],[-1.8,56.0],[-1.5,54.5],[0.3,53.5],[1.7,52.7],[1.0,51.4],
     [0.5,50.8],[-2.0,50.6],[-4.2,50.3],[-5.7,50.1],[-4.5,51.6],[-3.0,51.5],[-3.0,53.3],[-4.8,53.4],
     [-4.0,54.9],[-5.0,55.9],[-5.6,57.0]],
    // Ireland
    [[-10.0,54.3],[-8.0,55.3],[-6.0,55.2],[-5.9,54.0],[-6.2,52.2],[-8.0,51.5],[-9.9,51.6],[-10.3,53.4]],
    // Norway and Sweden
    [[4.5,58.1],[5.5,60.5],[7.5,63.0],[11.0,64.5],[14.0,66.5],[18.0,68.5],[21.0,70.0],[25.0,71.1],
     [28.0,70.5],[30.5,69.7],[27.0,68.5],[24.0,66.0],[21.5,64.0],[19.2,63.0],[18.3,61.0],[19.4,59.6],[17.2,58.4],
     [16.6,57.0],[14.5,55.4],[12.6,56.2],[11.5,58.5],[8.0,58.2]],
    // Finland and Karelia
    [[21.5,64.0],[24.0,65.8],[27.0,68.0],[29.5,69.5],[31.0,68.0],[30.0,66.0],[31.5,64.0],[31.0,62.0],
     [28.0,60.5],[25.0,60.0],[22.5,60.3],[21.0,62.0]],
    // Jutland
    [[8.1,54.9],[8.0,57.1],[10.6,57.7],[10.8,56.0],[9.9,54.8]],
    // Anatolia
    [[26.0,40.2],[29.0,41.2],[33.0,42.0],[36.0,41.7],[40.0,41.5],[42.0,41.4],[42.0,37.5],[40.0,37.0],
     [36.0,36.0],[32.5,36.2],[30.0,36.3],[28.0,36.7],[26.3,38.4]],
    // the Maghreb coast
    [[-6.0,35.9],[-2.0,35.5],[3.0,36.9],[8.0,37.1],[11.0,37.2],[11.5,33.4],[5.0,34.0],[-2.0,33.8],[-6.0,33.6]],
    // Crimea
    [[33.5,46.2],[36.6,45.4],[35.4,44.4],[33.4,44.4],[32.5,45.3]],
    // islands
    [[12.4,38.1],[15.6,38.3],[15.1,36.7],[12.4,37.8]],                     // Sicily
    [[8.2,41.3],[9.8,41.2],[9.6,38.9],[8.4,39.0]],                         // Sardinia
    [[8.6,43.0],[9.5,42.7],[9.4,41.4],[8.6,42.0]],                         // Corsica
    [[23.5,35.6],[26.3,35.3],[26.0,34.9],[23.5,35.2]],                     // Crete
    [[32.3,35.2],[34.6,35.7],[34.0,34.6],[32.5,34.6]],                     // Cyprus
  ],
  // mountain spines: polyline in degrees, plus how wide the range runs
  ranges: [
    { r:1.0, pts:[[6.0,45.9],[8.0,46.4],[11.0,47.0],[13.5,47.0]] },        // Alps
    { r:0.5, pts:[[-1.6,43.0],[1.5,42.6],[3.2,42.4]] },                    // Pyrenees
    { r:0.8, pts:[[18.9,49.3],[22.5,49.0],[25.5,47.5],[24.5,45.4]] },      // Carpathians
    { r:0.6, pts:[[10.0,44.2],[13.0,42.5],[15.5,41.0],[16.4,39.6]] },      // Apennines
    { r:1.3, pts:[[6.5,60.0],[10.0,63.0],[15.0,66.5],[20.0,68.5]] },       // the Keel
    { r:0.8, pts:[[14.5,45.5],[18.0,43.5],[20.5,42.0],[22.0,41.5]] },      // Dinarics
    { r:0.5, pts:[[23.0,42.8],[26.5,42.8]] },                              // Stara Planina
    { r:0.9, pts:[[29.5,37.2],[33.0,37.0],[37.0,37.8],[41.0,38.6]] },      // Taurus
    { r:0.5, pts:[[-6.5,43.1],[-3.0,43.1]] },                              // Cantabrians
    { r:0.30, pts:[[-5.4,41.0],[-2.9,41.4]] },                             // Sistema Central
    { r:0.5, pts:[[-3.5,37.2],[-1.9,37.5]] },                              // Sierra Nevada
    { r:0.6, pts:[[2.0,45.2],[3.5,44.8]] },                                // Massif Central
    { r:0.5, pts:[[12.5,49.6],[15.5,49.9]] },                              // Bohemian rim
  ],
};

function inPoly(px, py, poly){
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++){
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}
function segDist(px, py, ax, ay, bx, by){
  const dx = bx - ax, dy = by - ay;
  const L = dx * dx + dy * dy;
  let t = L ? ((px - ax) * dx + (py - ay) * dy) / L : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

const EU_BOX = EU.land.map(poly => {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const [x, y] of poly){ if (x<x0)x0=x; if (x>x1)x1=x; if (y<y0)y0=y; if (y>y1)y1=y; }
  return [x0, y0, x1, y1];
});


// The powers of Latin Christendom and its neighbours around 1300, each with the
// seat of its power. Bots are placed at home; players choose their own ground.
const POWERS = [
  ['Kingdom of France',        2.3, 48.9], ['Kingdom of England',      -0.1, 51.5],
  ['Crown of Castile',        -3.7, 40.4], ['Crown of Aragon',          2.2, 41.4],
  ['Kingdom of Portugal',     -9.1, 38.7], ['Kingdom of Navarre',      -1.6, 42.8],
  ['Emirate of Granada',      -3.6, 37.2], ['Kingdom of Scotland',     -3.2, 55.9],
  ['Lordship of Ireland',     -6.3, 53.3], ['Duchy of Brittany',       -1.7, 48.1],
  ['Duchy of Burgundy',        5.0, 47.3], ['County of Flanders',       3.2, 51.2],
  ['County of Savoy',          6.1, 45.6], ['Swiss Confederacy',        8.2, 46.9],
  ['Duchy of Bavaria',        11.6, 48.1], ['Duchy of Austria',        16.4, 48.2],
  ['Duchy of Saxony',         11.6, 51.3], ['Kingdom of Bohemia',      14.4, 50.1],
  ['Archbishopric of Mainz',   8.3, 50.0], ['County of Holland',        4.9, 52.4],
  ['Republic of Venice',      12.3, 45.4], ['Republic of Genoa',        8.9, 44.4],
  ['Republic of Florence',    11.3, 43.8], ['Duchy of Milan',           9.2, 45.5],
  ['Papal States',            12.5, 41.9], ['Kingdom of Naples',       14.3, 40.8],
  ['Kingdom of Sicily',       13.4, 38.1], ['Kingdom of Hungary',      19.0, 47.5],
  ['Kingdom of Poland',       19.9, 50.1], ['Kingdom of Denmark',      12.6, 55.7],
  ['Kingdom of Norway',       10.8, 59.9], ['Kingdom of Sweden',       18.1, 59.3],
  ['Teutonic Order',          19.0, 54.0], ['Grand Duchy of Lithuania',25.3, 54.7],
  ['Novgorod Republic',       31.3, 58.5], ['Grand Duchy of Muscovy',  37.6, 55.8],
  ['Principality of Galicia', 24.0, 49.8], ['Byzantine Empire',        29.0, 41.0],
  ['Second Bulgarian Empire', 23.3, 42.7], ['Kingdom of Serbia',       20.9, 44.0],
  ['Ottoman Beylik',          30.0, 40.4], ['Golden Horde',            34.0, 45.3],
  ['Hafsid Sultanate',        10.2, 36.8], ['Marinid Sultanate',       -5.0, 34.6],
  ['Kingdom of Cyprus',       33.4, 35.1], ['Kingdom of Croatia',      16.4, 45.8],
];

// ------------------------------------------------------------------- a lord
class Lord {
  constructor(g, id, name, color, bot){
    this.g = g; this.id = id; this.name = name; this.color = color; this.bot = bot;
    this.alive = false; this.dieAt = 0;
    // Population is not a single number. Civilians work, levies are training,
    // soldiers fight — and moving people between those states is the central
    // economic decision of the game.
    this.civ = 0; this.levy = 0; this.sold = 0; this.trained = 0;
    this.arms = 0; this.ducats = bot ? 300 : 500;
    this.food = 0; this.starving = false;
    this.jobs = { farm:0, forge:0, trade:0, works:0 };   // civilians actually employed
    this.w = { farm:0.40, forge:0.22, trade:0.28, works:0.10 };  // priorities
    this.standing = 0.08;   // share of population kept as a professional army
    this.mobil = 0;         // extra mobilisation ordered on top of that
    this.tiles = 0; this.peak = 0; this.sumX = 0; this.sumY = 0;
    this.border = new Set();   // own land touching foreign/open land
    this.coast  = new Set();   // own land touching water
    this.st = { 1:new Set(), 2:new Set(), 3:new Set(), 4:new Set(), 5:new Set(), 6:new Set(), 7:new Set() };
    this.bought = { 1:0, 2:0, 3:0, 4:0, 5:0, 6:0, 7:0 };  // for price escalation
    this.allies = new Set();
    this.pact = new Map();     // id -> the hour the oath lapses
    this.grudge = new Map();   // id -> heat; decays. drives bot target choice
    this.attacks = [];
    this.traitor = 0;
    this.nextThink = 0;
    this.tradeAt = 0;
    this.home = null;      // seat of power on the Europe map, if any
    this.siegeAt = 0;
    // bot temperament
    const r = g.rand;
    this.aggr  = 0.25 + r() * 0.7;   // how readily it attacks
    this.greed = 0.25 + r() * 0.7;   // build vs. levy
    this.loyal = 0.2  + r() * 0.75;  // alliance behaviour
    // ...and an economic doctrine, which decides how it runs its realm
    const names = Object.keys(ARCHETYPES);
    this.doctrine = names[(r() * names.length) | 0];
    const A = ARCHETYPES[this.doctrine];
    this.w = { farm:A.w.farm, forge:A.w.forge, trade:A.w.trade, works:A.w.works };
    this.standing = A.standing;
    this.warMobil = A.mobil;
  }
  get cx(){ return this.tiles ? this.sumX / this.tiles : 0; }
  get cy(){ return this.tiles ? this.sumY / this.tiles : 0; }
  get pop(){ return this.civ + this.levy + this.sold; }
  // What holds ground: soldiers, plus levies who can at least stand on a wall,
  // scaled by how well the host is equipped.
  get density(){ return this.tiles ? (this.sold + this.levy * 0.35) * this.quality / this.tiles : 0; }
  get equip(){ return this.sold > 0 ? Math.min(1, this.arms / this.sold) : 1; }
  get quality(){ return ECON.UNARMED + (1 - ECON.UNARMED) * this.equip; }
  get jobCap(){
    const t = this.st[B_TOWN].size, h = this.st[B_HARBOR].size;
    return {
      farm:  this.st[B_FARM].size  * ECON.JOBS_FARM,
      forge: this.st[B_FORGE].size * ECON.JOBS_FORGE,
      trade: t * ECON.JOBS_TOWN + h * ECON.JOBS_HARBOR,
      works: t * ECON.JOBS_WORKS,
    };
  }
  // 0..1 — how well a sector's works are manned. Everything is produced at
  // this fraction of its full yield.
  staffing(sector){
    const cap = this.jobCap[sector];
    return cap > 0 ? Math.min(1, (this.jobs[sector] || 0) / cap) : 0;
  }
  get committed(){ let s = 0; for (const a of this.attacks) s += a.troops; return s; }
  costOf(type){ return Math.round(BUILDS[type].cost * Math.pow(BUILDS[type].step, this.bought[type])); }
}

// ------------------------------------------------------------------ an assault
// A running attack. Owns a frontier of enemy tiles ordered by terrain cost and
// converts them one at a time until its levy is spent.
class Attack {
  constructor(g, ownerId, targetId, troops){
    this.g = g; this.owner = ownerId; this.target = targetId;
    this.troops = troops; this.taken = 0; this.pool = 0;
    this.heap = new Heap(); this.queued = new Set(); this.dead = false;
    this.reseed();
  }
  // Reinforcements join the wave where it currently stands, rather than
  // restarting it at the home border.
  reseed(){
    const p = this.g.players[this.owner];
    const base = this.heap.size ? this.heap.peekKey() : 0;
    for (const t of p.border) this.probe(t, base);
  }
  // Keys are the cost accumulated from where the assault started, so the heap
  // pops in order of depth-into-enemy-ground, not cheapness. That is what makes
  // the advance a front: everything at one contour falls before anything past
  // it. Keying on a tile's own cost instead made this a greedy best-first
  // search that threaded through plains and stranded the hills behind it.
  probe(t, base){
    const g = this.g, W = g.W;
    const x = t % W, y = (t / W) | 0;
    for (let i = 0; i < 4; i++){
      const nx = x + (i === 0 ? -1 : i === 1 ? 1 : 0);
      const ny = y + (i === 2 ? -1 : i === 3 ? 1 : 0);
      if (nx < 0 || ny < 0 || nx >= W || ny >= g.H) continue;
      const n = ny * W + nx;
      if (g.terrain[n] < T_PLAIN) continue;
      if (g.owner[n] !== this.target) continue;
      if (this.queued.has(n)) continue;
      this.queued.add(n);
      this.heap.push(n, base + this.cost(n) * (0.94 + g.rand() * 0.12));
    }
  }
  cost(t){
    const g = this.g;
    const terr = CFG.TERRAIN_DEF[g.terrain[t]];
    const fort = (1 + Math.min(CFG.CASTLE_STACK, g.castleField[t]) * CFG.CASTLE_STEP)
                 * (1 - Math.min(3, g.breachField[t]) * CFG.BREACH_STEP);
    const o = g.owner[t];
    if (o < 0){
      const reach = Math.min(CFG.NEUTRAL_CAP,
                             CFG.NEUTRAL_BASE + g.players[this.owner].tiles / CFG.NEUTRAL_SCALE);
      return CFG.NEUTRAL_COST * reach * terr * fort / g.players[this.owner].quality;
    }
    return (CFG.DEF_BASE + Math.min(CFG.DEF_CAP, g.players[o].density) * CFG.DEF_DENSITY)
           * terr * fort / g.players[this.owner].quality;
  }
  tick(){
    const g = this.g, me = g.players[this.owner];
    if (!me.alive){ this.dead = true; return; }
    // Two separate limits. The levy pool is how much force is available to
    // spend; the tile allowance is how fast a front of that width can actually
    // advance. A huge host funnelled through a narrow border still crawls.
    this.pool = Math.min(this.pool + Math.max(CFG.ATTACK_FLOOR, this.troops * CFG.ATTACK_RATE),
                         this.troops * 0.5 + 400);
    let allow = Math.max(CFG.TILE_FLOOR, Math.ceil(this.heap.size * CFG.TILE_RATE));
    let guard = 6000;
    while (allow > 0 && guard-- > 0){
      const t = this.heap.peek();
      if (t < 0){ this.finish(); return; }
      const key = this.heap.peekKey();
      const held = g.owner[t];
      // ground we already hold: step over it and keep the wave rolling, or the
      // tiles behind it never get queued and the advance leaves holes
      if (held === this.owner){ this.heap.pop(); this.probe(t, key); continue; }
      if (held !== this.target){ this.heap.pop(); continue; }        // stale
      const c = this.cost(t);
      if (c > this.troops){ this.finish(); return; }                 // spent
      if (c > this.pool) return;                                     // next tick
      this.heap.pop();
      this.troops -= c; this.pool -= c; allow--; this.taken++;
      if (this.target >= 0){
        const d = g.players[this.target];
        g.bleed(d, c * CFG.DEF_LOSS);
        d.grudge.set(this.owner, (d.grudge.get(this.owner) || 0) + 1.5);
      }
      g.setOwner(t, this.owner);
      this.probe(t, key);
    }
  }
  finish(){
    if (this.dead) return;
    this.dead = true;
    const me = this.g.players[this.owner];
    if (me.alive) me.sold += this.troops;   // survivors march home
    this.troops = 0;
  }
}

// --------------------------------------------------------------------- world
class Game {
  constructor(opts){
    const o = opts || {};
    this.seedInt = (o.seed == null ? (Math.random() * 1e9) | 0 : o.seed | 0);
    this.rand = mulberry32(this.seedInt);
    this.preset = o.preset || 'continents';
    // Europe is ~47% land against the procedural maps' ~34%, so at the same
    // grid it carries a third more ground and no war could finish inside the
    // cap. The coastline is sampled from polygons, so a coarser grid costs
    // nothing in geography — it just restores the pacing.
    const fine = this.preset === 'europe' ? [456, 248] : [528, 288];
    this.W = o.w || fine[0]; this.H = o.h || fine[1];
    // Europe is cut up by seas, so taking ground means repeated crossings and a
    // continental 65% is out of reach — as it was for every real power of the
    // age. Half the map is the mark of a dominant one.
    this.winPct = this.preset === 'europe' ? 0.50 : CFG.WIN_PCT;
    this.N = this.W * this.H;
    this.time = 0; this.ticks = 0;
    this.phase = 'place';                 // place -> war -> done
    this.players = []; this.humanId = -1;
    this.attacks = []; this.boats = []; this.sieges = [];
    this.events = []; this.dirty = []; this.dirtyAll = true; this.asks = [];
    this.buildDirty = [];   // works raised or razed since the last broadcast
    this.winner = -1; this.leader = -1; this.leadShare = 0; this.aliveCount = 0;
    this.terrain = new Uint8Array(this.N);
    this.owner   = new Int16Array(this.N).fill(-1);
    this.build   = new Uint8Array(this.N);
    this.elev    = new Uint8Array(this.N);
    this.castleField = new Uint8Array(this.N);
    this.breachField = new Uint8Array(this.N);
    this._bfs = new Int32Array(this.N);    // BFS parent, reused
    this._bfsStamp = new Int32Array(this.N);
    this._stampId = 0;
    this.genMap();
  }

  idx(x, y){ return y * this.W + x; }
  isLand(t){ return this.terrain[t] >= T_PLAIN; }
  isWater(t){ return this.terrain[t] <= T_SHOAL; }

  // ---------------------------------------------------------------- map gen
  // Real Europe: sample the coastline polygons, but warp the sample point with
  // noise first so the coast is ragged instead of showing polygon edges, and
  // raise ground near the mountain spines.
  genEurope(){
    const W = this.W, H = this.H, s = this.seedInt & 0xffff;
    const spanLon = EU.lon1 - EU.lon0, spanLat = EU.lat1 - EU.lat0;
    let land = 0;
    for (let y = 0; y < H; y++){
      for (let x = 0; x < W; x++){
        const t = y * W + x;
        // warp in degrees — about a third of a degree of wobble
        const wx = (fbm(x / 26, y / 26, s + 17, 4, 0.5) - 0.5) * 0.9;
        const wy = (fbm(x / 26, y / 26, s + 91, 4, 0.5) - 0.5) * 0.9;
        const lon = EU.lon0 + (x + 0.5) / W * spanLon + wx;
        const lat = EU.lat1 - (y + 0.5) / H * spanLat + wy;

        let isLand = false;
        for (let i = 0; i < EU.land.length && !isLand; i++){
          const b = EU_BOX[i];
          if (lon < b[0] - 0.2 || lon > b[2] + 0.2 || lat < b[1] - 0.2 || lat > b[3] + 0.2) continue;
          if (inPoly(lon, lat, EU.land[i])) isLand = true;
        }

        if (!isLand){
          // how far offshore, so shelf and deep ocean read differently
          let near = 9;
          for (let i = 0; i < EU.land.length; i++){
            const b = EU_BOX[i];
            if (lon < b[0] - 3 || lon > b[2] + 3 || lat < b[1] - 3 || lat > b[3] + 3) continue;
            const poly = EU.land[i];
            for (let j = 0, k = poly.length - 1; j < poly.length; k = j++){
              const d = segDist(lon, lat, poly[k][0], poly[k][1], poly[j][0], poly[j][1]);
              if (d < near) near = d;
            }
          }
          this.terrain[t] = near < 0.45 ? T_SHOAL : T_SEA;
          this.elev[t] = Math.max(0, 70 - near * 8) | 0;
          continue;
        }

        land++;
        // height from the nearest mountain spine
        let rise = 0;
        for (const rg of EU.ranges){
          for (let j = 1; j < rg.pts.length; j++){
            const d = segDist(lon, lat, rg.pts[j-1][0], rg.pts[j-1][1], rg.pts[j][0], rg.pts[j][1]);
            if (d < rg.r * 1.6){
              const v = Math.max(0, 1 - d / (rg.r * 1.6));
              if (v > rise) rise = v;
            }
          }
        }
        // Ranges are spines, not plateaus: square the falloff so the high ground
        // is a narrow crest with foothills, instead of a wide white dome.
        const rough = fbm(x / 30, y / 30, s + 555, 4, 0.55);
        const h = rise * rise * 0.80 + rise * 0.16 + rough * 0.26;
        this.elev[t] = Math.max(90, Math.min(250, (108 + h * 132) | 0));
        if (h > 0.66)      this.terrain[t] = T_PEAK;
        else if (h > 0.33) this.terrain[t] = T_HILL;
        else {
          // woods thicken north and east, thin around the Mediterranean
          const wet = fbm(x / 34, y / 34, s + 4321, 4, 0.55)
                    + Math.max(0, (lat - 45) / 26) * 0.30
                    + Math.max(0, (lon - 12) / 30) * 0.16
                    - Math.max(0, (42 - lat) / 10) * 0.22;
          this.terrain[t] = wet > 0.56 ? T_WOOD : T_PLAIN;
        }
      }
    }
    this.landCount = land;
    this.peakByte = 215;
  }

  genMap(){
    if (this.preset === 'europe') return this.genEurope();
    const W = this.W, H = this.H, s = this.seedInt & 0xffff;
    const P = {
      continents: { sc: 56,  edge: 0.58, mid: 0.05, land: 0.34 },
      pangaea:    { sc: 118, edge: 0.44, mid: 0.26, land: 0.44 },
      isles:      { sc: 34,  edge: 0.52, mid: 0.03, land: 0.25 },
      valley:     { sc: 60,  edge: 0.30, mid: 0.00, land: 0.46 },
    }[this.preset] || { sc: 56, edge: 0.58, mid: 0.05, land: 0.34 };

    // Pass one: raw elevation.
    const E = new Float32Array(this.N);
    let lo = Infinity, hi = -Infinity;
    for (let y = 0; y < H; y++){
      for (let x = 0; x < W; x++){
        const t = y * W + x;
        const nx = (x / W) * 2 - 1, ny = (y / H) * 2 - 1;
        // domain warp keeps coastlines ragged instead of blobby
        const wx = (fbm(x / 150, y / 150, s + 701, 3, 0.5) - 0.5) * 2.4;
        const wy = (fbm(x / 150, y / 150, s + 929, 3, 0.5) - 0.5) * 2.4;
        let e = fbm(x / P.sc + wx, y / P.sc + wy, s, 6, 0.53);
        e -= Math.pow(Math.max(Math.abs(nx), Math.abs(ny)), 3) * P.edge;
        if (P.mid) e += (1 - Math.min(1, Math.hypot(nx, ny * 1.25))) * P.mid;
        if (this.preset === 'valley') e += (1 - Math.pow(Math.abs(ny), 1.4)) * 0.30 - 0.12;
        E[t] = e;
        if (e < lo) lo = e;
        if (e > hi) hi = e;
      }
    }

    // Pass two: pick the waterline from the histogram rather than a fixed
    // constant, so every seed yields roughly the same amount of playable
    // ground. Raw thresholds swung between 12% and 34% land across seeds.
    const BINS = 512, hist = new Int32Array(BINS), span = Math.max(1e-6, hi - lo);
    for (let t = 0; t < this.N; t++) hist[Math.min(BINS - 1, ((E[t] - lo) / span * BINS) | 0)]++;
    // Highlands are quantiles of the land too, not fixed slices of the
    // elevation range — otherwise a flat seed is all plains and a peaky one is
    // a wall of mountains.
    const want = Math.round(this.N * P.land);
    let acc = 0, seaBin = 1, peakBin = -1, hillBin = -1;
    for (let bin = BINS - 1; bin > 0; bin--){
      acc += hist[bin];
      if (peakBin < 0 && acc >= want * 0.10) peakBin = bin;
      if (hillBin < 0 && acc >= want * 0.32) hillBin = bin;
      if (acc >= want){ seaBin = bin; break; }
    }
    const lv = b => lo + span * (b / BINS);
    const sea = lv(seaBin), shoal = sea - span * 0.05;
    const peakAt = peakBin < 0 ? hi + 1 : lv(peakBin);
    const hillAt = hillBin < 0 ? hi + 1 : lv(hillBin);

    let land = 0;
    for (let t = 0; t < this.N; t++){
      const e = E[t];
      this.elev[t] = Math.max(0, Math.min(255, ((e - lo) / span * 255) | 0));
      if (e < shoal)     this.terrain[t] = T_SEA;
      else if (e < sea)  this.terrain[t] = T_SHOAL;
      else {
        land++;
        const x = t % W, y = (t / W) | 0;
        if (e >= peakAt)      this.terrain[t] = T_PEAK;
        else if (e >= hillAt) this.terrain[t] = T_HILL;
        else if (fbm(x / 55, y / 55, s + 4321, 4, 0.55) > 0.545) this.terrain[t] = T_WOOD;
        else                  this.terrain[t] = T_PLAIN;
      }
    }
    this.landCount = land;
    this.peakByte = Math.max(0, Math.min(255, ((peakAt - lo) / span * 255) | 0));
  }

  // ------------------------------------------------------------- tile ledger
  neighbors(t, out){
    const W = this.W, x = t % W, y = (t / W) | 0; let n = 0;
    if (x > 0)          out[n++] = t - 1;
    if (x < W - 1)      out[n++] = t + 1;
    if (y > 0)          out[n++] = t - W;
    if (y < this.H - 1) out[n++] = t + W;
    return n;
  }

  setOwner(t, to){
    const from = this.owner[t];
    if (from === to) return;
    const b = this.build[t];
    if (from >= 0){
      const p = this.players[from];
      p.tiles--; p.sumX -= t % this.W; p.sumY -= (t / this.W) | 0;
      p.border.delete(t); p.coast.delete(t);
      if (b) p.st[b].delete(t);
    }
    this.owner[t] = to;
    if (to >= 0){
      const p = this.players[to];
      p.tiles++; p.sumX += t % this.W; p.sumY += (t / this.W) | 0;
      if (b) p.st[b].add(t);
    }
    this.dirty.push(t);
    const nb = this._nb || (this._nb = new Int32Array(4));
    const n = this.neighbors(t, nb);
    this.refresh(t);
    for (let i = 0; i < n; i++) this.refresh(nb[i]);
  }

  refresh(t){
    const o = this.owner[t];
    if (o < 0) return;
    const p = this.players[o];
    const W = this.W, x = t % W, y = (t / W) | 0;
    let isB = false, isC = false;
    for (let i = 0; i < 4; i++){
      const nx = x + (i === 0 ? -1 : i === 1 ? 1 : 0);
      const ny = y + (i === 2 ? -1 : i === 3 ? 1 : 0);
      if (nx < 0 || ny < 0 || nx >= W || ny >= this.H) continue;
      const n = ny * W + nx;
      if (this.terrain[n] < T_PLAIN) isC = true;
      else if (this.owner[n] !== o) isB = true;
    }
    const hadB = p.border.has(t), hadC = p.coast.has(t);
    if (isB !== hadB){ isB ? p.border.add(t) : p.border.delete(t); this.dirty.push(t); }
    if (isC !== hadC){ isC ? p.coast.add(t) : p.coast.delete(t); }
  }

  stampCastle(t, delta){
    const R = CFG.CASTLE_R, W = this.W, cx = t % W, cy = (t / W) | 0;
    for (let y = Math.max(0, cy - R); y <= Math.min(this.H - 1, cy + R); y++){
      for (let x = Math.max(0, cx - R); x <= Math.min(W - 1, cx + R); x++){
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy > R * R) continue;
        const i = y * W + x;
        this.castleField[i] = Math.max(0, this.castleField[i] + delta);
        this.dirty.push(i);           // fortified ground is drawn darker
      }
    }
  }

  // ------------------------------------------------------------------ lords
  addLord(name, color, bot){
    const p = new Lord(this, this.players.length, name, color, bot);
    this.players.push(p);
    return p;
  }

  seat(p, tile, radius){
    const R = radius == null ? 2.6 : radius;
    const W = this.W, cx = tile % W, cy = (tile / W) | 0;
    let got = 0;
    for (let y = Math.max(0, cy - 4); y <= Math.min(this.H - 1, cy + 4); y++){
      for (let x = Math.max(0, cx - 4); x <= Math.min(W - 1, cx + 4); x++){
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy > R * R) continue;
        const i = y * W + x;
        if (this.terrain[i] < T_PLAIN || this.owner[i] >= 0) continue;
        this.setOwner(i, p.id); got++;
      }
    }
    if (!got){ this.setOwner(tile, p.id); got = 1; }
    p.alive = true;
    p.civ = CFG.START_POP; p.levy = 0; p.sold = CFG.START_SOLD;
    p.arms = CFG.START_ARMS; p.trained = 0;
    return got;
  }

  // The tile nearest a lord's historical seat that is actually free ground.
  // Spirals outward, because a seat can easily fall on water or a peak once the
  // coastline has been roughened.
  seatAtHome(p){
    if (!p.home) return -1;
    const spanLon = EU.lon1 - EU.lon0, spanLat = EU.lat1 - EU.lat0;
    const cx = Math.round((p.home[0] - EU.lon0) / spanLon * this.W);
    const cy = Math.round((EU.lat1 - p.home[1]) / spanLat * this.H);
    for (let r = 0; r < 40; r++){
      let best = -1, bestD = 1e9;
      for (let y = cy - r; y <= cy + r; y++){
        for (let x = cx - r; x <= cx + r; x++){
          if (r > 0 && Math.abs(y - cy) !== r && Math.abs(x - cx) !== r) continue;
          if (x < 0 || y < 0 || x >= this.W || y >= this.H) continue;
          const t = y * this.W + x;
          if (this.terrain[t] < T_PLAIN || this.terrain[t] === T_PEAK) continue;
          if (this.owner[t] >= 0) continue;
          let clash = false;
          for (const q of this.players){
            if (!q.alive || !q.tiles || q === p) continue;
            if (Math.hypot(x - q.cx, y - q.cy) < 11){ clash = true; break; }
          }
          if (clash) continue;
          const d = (x - cx) ** 2 + (y - cy) ** 2;
          if (d < bestD){ bestD = d; best = t; }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  // Somewhere on land, ideally far from every banner already planted.
  pickSeat(minDist){
    const tries = 900;
    let best = -1, bestD = -1;
    for (let k = 0; k < tries; k++){
      const t = (this.rand() * this.N) | 0;
      if (this.terrain[t] < T_PLAIN || this.terrain[t] === T_PEAK) continue;
      if (this.owner[t] >= 0) continue;
      const x = t % this.W, y = (t / this.W) | 0;
      let d = 1e9;
      for (const q of this.players){
        if (!q.alive) continue;
        const dd = Math.hypot(x - q.cx, y - q.cy);
        if (dd < d) d = dd;
      }
      if (d > bestD){ bestD = d; best = t; }
      if (d >= minDist) return t;
    }
    return best;
  }

  // Casualties fall on the men under arms first, and only reach the civilian
  // population once an army has been destroyed outright.
  bleed(p, n){
    const fromSold = Math.min(p.sold, n);
    p.arms = Math.max(0, p.arms - fromSold * p.equip);   // kit is lost with the men
    p.sold -= fromSold; n -= fromSold;
    if (n > 0){ const fromLevy = Math.min(p.levy, n); p.levy -= fromLevy; n -= fromLevy; }
    if (n > 0) p.civ = Math.max(0, p.civ - n);
  }

  log(text, kind, who){
    this.events.push({ t: this.time, text, kind: kind || '', who: who == null ? -1 : who });
    if (this.events.length > 400) this.events.shift();
  }
  // ---------------------------------------------------------------- warfare
  launch(ownerId, targetId, troops){
    const p = this.players[ownerId];
    if (!p.alive || this.phase !== 'war') return null;
    if (targetId === ownerId) return null;
    if (targetId >= 0 && p.allies.has(targetId)) return null;
    troops = Math.floor(Math.min(troops, p.sold));
    if (troops < 10) return null;
    for (const a of p.attacks){
      if (a.target === targetId && !a.dead){        // reinforce the same push
        p.sold -= troops; a.troops += troops; a.reseed(); return a;
      }
    }
    if (p.attacks.length >= CFG.MAX_ATTACKS) return null;
    const a = new Attack(this, ownerId, targetId, troops);
    if (a.heap.size === 0) return null;             // nowhere to attack from
    p.sold -= troops;
    p.attacks.push(a); this.attacks.push(a);
    if (targetId >= 0){
      const d = this.players[targetId];
      d.grudge.set(ownerId, (d.grudge.get(ownerId) || 0) + 5);
      if (targetId === this.humanId) this.log(`${p.name} marches on your lands`, 'war', ownerId);
      // An oath that binds nobody to anything is not an alliance. Whoever is
      // sworn to the victim now has a grievance against the aggressor, which
      // is what makes their bots turn and march.
      for (const aid of d.allies){
        if (aid === ownerId) continue;
        const friend = this.players[aid];
        if (!friend.alive) continue;
        friend.grudge.set(ownerId, (friend.grudge.get(ownerId) || 0) + 9);
        if (aid === this.humanId){
          this.log(`${p.name} attacks your ally ${d.name}`, 'war', ownerId);
          continue;   // never spend the player's treasury without asking
        }
        // A grievance only helps if the friend shares a border with the
        // aggressor. Coin travels anywhere, so an ally who cannot march can
        // still pay — which is the whole point of a wealthy, small realm.
        if (this.time >= (friend.aidAt || 0) && friend.ducats > 400){
          const aidSum = Math.min(friend.ducats * 0.18, 2500);
          friend.ducats -= aidSum; d.ducats += aidSum;
          friend.aidAt = this.time + 30;
          if (targetId === this.humanId)
            this.log(`${friend.name} sends ${Math.round(aidSum)} ducats to aid you`, 'good', aid);
        }
      }
    }
    return a;
  }

  // Does `a` share a land border with `b` (b may be -1 for open ground)?
  touches(aId, bId){
    const p = this.players[aId];
    const nb = new Int32Array(4);
    for (const t of p.border){
      const n = this.neighbors(t, nb);
      for (let i = 0; i < n; i++){
        const m = nb[i];
        if (this.terrain[m] >= T_PLAIN && this.owner[m] === bId) return true;
      }
    }
    return false;
  }

  // -------------------------------------------------------------- buildings
  place(ownerId, tile, type){
    const p = this.players[ownerId];
    if (this.owner[tile] !== ownerId) return 'that ground is not yours';
    if (this.build[tile]) return 'something already stands there';
    if (BUILDS[type].needCoast && !p.coast.has(tile)) return 'a harbour must sit on the shore';
    const cost = p.costOf(type);
    if (p.ducats < cost) return 'not enough coin';
    p.ducats -= cost; p.bought[type]++;
    this.build[tile] = type; p.st[type].add(tile);
    if (type === B_CASTLE) this.stampCastle(tile, 1);
    this.dirty.push(tile); this.buildDirty.push(tile);
    return null;
  }

  raze(tile){
    const b = this.build[tile];
    if (!b) return;
    const o = this.owner[tile];
    if (o >= 0) this.players[o].st[b].delete(tile);
    if (b === B_CASTLE) this.stampCastle(tile, -1);
    this.build[tile] = 0;
    this.dirty.push(tile); this.buildDirty.push(tile);
  }

  // ------------------------------------------------------------------ ships
  adjWater(tile){
    const nb = new Int32Array(4), n = this.neighbors(tile, nb);
    for (let i = 0; i < n; i++) if (this.isWater(nb[i])) return nb[i];
    return -1;
  }

  waterPath(src, dst){
    if (src < 0 || dst < 0 || this.isLand(src) || this.isLand(dst)) return null;
    const stamp = ++this._stampId;
    const st = this._bfsStamp, pv = this._bfs, nb = new Int32Array(4);
    const q = [src]; st[src] = stamp; pv[src] = -1;
    let head = 0, ok = false;
    while (head < q.length){
      const t = q[head++];
      if (t === dst){ ok = true; break; }
      const n = this.neighbors(t, nb);
      for (let i = 0; i < n; i++){
        const m = nb[i];
        if (st[m] === stamp || this.isLand(m)) continue;
        st[m] = stamp; pv[m] = t; q.push(m);
      }
    }
    if (!ok) return null;
    const path = [];
    for (let c = dst; c !== -1; c = pv[c]) path.push(c);
    path.reverse();
    const thin = [];
    for (let i = 0; i < path.length; i += 3) thin.push(path[i]);
    if (thin[thin.length - 1] !== dst) thin.push(dst);
    return thin;
  }

  sail(kind, ownerId, fromTile, toTile, troops){
    if (this.boats.length > 150) return 'too many ships at sea';
    const sw = this.adjWater(fromTile), dw = this.adjWater(toTile);
    if (sw < 0) return 'launch from your own shore';
    if (dw < 0) return 'that shore cannot be reached by sea';
    const path = this.waterPath(sw, dw);
    if (!path) return 'no sea lane leads there';
    const b = {
      kind, owner: ownerId, path, i: 0, dest: toTile, troops: troops || 0,
      x: sw % this.W, y: (sw / this.W) | 0, dead: false,
      hp: kind === 'galley' ? 120 : 40,
      speed: kind === 'galley' ? 8.5 : kind === 'trade' ? 7 : 6,
      station: false,
    };
    this.boats.push(b);
    return null;
  }

  stepBoats(dt){
    const W = this.W;
    for (const b of this.boats){
      if (b.dead) continue;
      const p = this.players[b.owner];
      if (!p.alive && b.kind !== 'trade'){ b.dead = true; continue; }
      if (!b.station){
        const next = b.path[b.i + 1];
        if (next == null){ this.landfall(b); continue; }
        const tx = next % W, ty = (next / W) | 0;
        const dx = tx - b.x, dy = ty - b.y, d = Math.hypot(dx, dy);
        const step = b.speed * dt;
        if (d <= step){ b.x = tx; b.y = ty; b.i++; }
        else { b.x += dx / d * step; b.y += dy / d * step; }
      }
    }
    // Galleys hunt. A galley that has reached its station looks for the nearest
    // ship it is not sworn to protect, and gives chase — it does not sit on a
    // point waiting for prey to blunder into it.
    for (const g of this.boats){
      if (g.dead || g.kind !== 'galley' || !g.station) continue;
      const mine = this.players[g.owner];
      if (!mine.alive){ g.dead = true; continue; }

      let prey = null, best = CFG.HUNT_R;
      for (const o of this.boats){
        if (o.dead || o === g) continue;
        if (o.owner === g.owner || mine.allies.has(o.owner)) continue;
        const d = Math.hypot(o.x - g.x, o.y - g.y);
        if (d < best){ best = d; prey = o; }
      }

      if (prey){
        if (best > 1.4){
          // give chase, but only over water — a galley cannot cross a headland
          const dx = prey.x - g.x, dy = prey.y - g.y, d = Math.hypot(dx, dy) || 1;
          const step = g.speed * dt;
          const nx = g.x + dx / d * step, ny = g.y + dy / d * step;
          const t = (Math.round(ny) * W) + Math.round(nx);
          if (t >= 0 && t < this.N && this.isWater(t)){ g.x = nx; g.y = ny; }
          else {                                  // slide along the coast instead
            const sx2 = g.x + dx / d * step, sy2 = g.y;
            const st = (Math.round(sy2) * W) + Math.round(sx2);
            if (st >= 0 && st < this.N && this.isWater(st)){ g.x = sx2; }
            else g.y = ny;
          }
        } else if (prey.kind === 'galley'){
          prey.hp -= 26 * dt; g.hp -= 26 * dt;
          if (prey.hp <= 0){ prey.dead = true; this.log(`${this.players[prey.owner].name} loses a war galley`, 'war', prey.owner); }
          if (g.hp <= 0){ g.dead = true; this.log(`${this.players[g.owner].name} loses a war galley`, 'war', g.owner); }
        } else {
          prey.dead = true;
          if (prey.kind === 'trade'){
            // a taken trader is plunder, not just a sinking
            mine.ducats += CFG.PRIZE;
            this.log(`A galley of ${mine.name} takes a trader of ${this.players[prey.owner].name}`, 'war', g.owner);
          } else {
            this.log(`A galley of ${mine.name} sinks a longship of ${this.players[prey.owner].name}`, 'war', g.owner);
          }
        }
      } else {
        // nothing to chase: patrol a slow circuit so the sea lane is visibly held
        g.patrol = (g.patrol || 0) + dt * 0.5;
        const px = g.hx + Math.cos(g.patrol) * CFG.PATROL_R;
        const py = g.hy + Math.sin(g.patrol) * CFG.PATROL_R;
        const t = (Math.round(py) * W) + Math.round(px);
        if (t >= 0 && t < this.N && this.isWater(t)){ g.x = px; g.y = py; }
      }
    }
    if (this.boats.length) this.boats = this.boats.filter(b => !b.dead);
  }

  landfall(b){
    const p = this.players[b.owner];
    if (b.kind === 'galley'){ b.station = true; b.hx = b.x; b.hy = b.y; b.patrol = 0; return; }
    b.dead = true;
    if (!p.alive && b.kind !== 'trade') return;
    if (b.kind === 'trade'){
      const host = this.owner[b.dest];
      p.ducats += CFG.TRADE_VALUE;
      if (host >= 0 && host !== p.id) this.players[host].ducats += CFG.TRADE_VALUE * 0.5;
      return;
    }
    // longship: seize the beach, then push inland with whatever survives
    const victim = this.owner[b.dest];
    if (!this.isLand(b.dest)) return;
    let troops = b.troops;
    if (victim !== b.owner){
      const toll = victim < 0 ? CFG.NEUTRAL_COST * 2 : (CFG.DEF_BASE + this.players[victim].density) * 3;
      if (troops < toll){ this.log(`A landing by ${p.name} is thrown back into the sea`, 'war', b.owner); return; }
      troops -= toll;
      if (!p.alive){ p.alive = true; p.civ = 0; p.levy = 0; p.sold = 0; }
      this.setOwner(b.dest, b.owner);
    }
    p.sold += troops;
    this.log(`${p.name} makes landfall${victim >= 0 ? ' on ' + this.players[victim].name : ''}`, 'war', b.owner);
    if (victim >= 0 && victim !== b.owner) this.launch(b.owner, victim, troops * 0.9);
    else this.launch(b.owner, -1, troops * 0.9);
  }

  trade(dt){
    this._tradeT = (this._tradeT || 0) + dt;
    if (this._tradeT < 1) return;
    this._tradeT = 0;
    for (const p of this.players){
      if (!p.alive || p.st[B_HARBOR].size === 0) continue;
      if (this.time < p.tradeAt) continue;
      p.tradeAt = this.time + 14 / Math.min(4, p.st[B_HARBOR].size) + this.rand() * 6;
      const partners = this.players.filter(q =>
        q.alive && q.id !== p.id && q.st[B_HARBOR].size > 0 && !this.atWar(p.id, q.id));
      if (!partners.length) continue;
      const q = partners[(this.rand() * partners.length) | 0];
      this.sail('trade', p.id, pickFrom(p.st[B_HARBOR], this.rand), pickFrom(q.st[B_HARBOR], this.rand), 0);
    }
  }

  atWar(a, b){
    for (const at of this.players[a].attacks) if (at.target === b && !at.dead) return true;
    for (const at of this.players[b].attacks) if (at.target === a && !at.dead) return true;
    return (this.players[a].grudge.get(b) || 0) > 6 || (this.players[b].grudge.get(a) || 0) > 6;
  }

  // ------------------------------------------------------------------ siege
  stampBreach(tile, R, delta){
    const W = this.W, cx = tile % W, cy = (tile / W) | 0;
    for (let y = Math.max(0, cy - R); y <= Math.min(this.H - 1, cy + R); y++){
      for (let x = Math.max(0, cx - R); x <= Math.min(W - 1, cx + R); x++){
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy > R * R) continue;
        const i = y * W + x;
        this.breachField[i] = Math.max(0, this.breachField[i] + delta);
        this.dirty.push(i);
      }
    }
  }

  // Laid on your own frontier, never launched at a map coordinate. It invests
  // the ground in front of it: walls come down, the garrison bleeds, and the
  // fields are breached for the assault that has to follow.
  raise(ownerId, kind, tile){
    const p = this.players[ownerId], S = SIEGE[kind];
    if (!p.st[B_SIEGE].size) return 'you have no Siege Works';
    if (p.ducats < S.cost) return 'not enough coin';
    if (this.owner[tile] !== ownerId) return 'a siege is laid from your own ground';
    if (!p.border.has(tile)) return 'lay it on your frontier, facing the enemy';
    if (this.sieges.some(s => !s.dead && s.tile === tile)) return 'a camp already stands there';
    p.ducats -= S.cost;
    this.sieges.push({ owner: ownerId, kind, tile, t: 0, dur: S.dur, pulse: 0, dead: false });
    this.stampBreach(tile, S.r, S.breach);
    this.log(`${p.name} lays a ${S.name.toLowerCase()}`, 'war', ownerId);
    return null;
  }

  endSiege(s, why){
    if (s.dead) return;
    s.dead = true;
    this.stampBreach(s.tile, SIEGE[s.kind].r, -SIEGE[s.kind].breach);
    if (why) this.log(`${this.players[s.owner].name}'s ${SIEGE[s.kind].name.toLowerCase()} ${why}`,
                      why === 'is overrun' ? 'good' : '', s.owner);
  }

  stepSieges(dt){
    for (const s of this.sieges){
      if (s.dead) continue;
      // the camp falls with the ground it stands on — sally out and burn it
      if (this.owner[s.tile] !== s.owner || !this.players[s.owner].alive){
        this.endSiege(s, 'is overrun'); continue;
      }
      const S = SIEGE[s.kind];
      // a watchtower in sight lets the garrison harry the besiegers
      let wear = 1;
      for (const q of this.players){
        if (!q.alive || q.id === s.owner || !q.st[B_TOWER].size) continue;
        for (const tw of q.st[B_TOWER]){
          if (Math.hypot(tw % this.W - s.tile % this.W,
                         ((tw / this.W) | 0) - ((s.tile / this.W) | 0)) < S.r + 8){ wear = 2; break; }
        }
        if (wear > 1) break;
      }
      s.t += dt * wear;
      s.pulse += dt;
      if (s.pulse >= 1){ s.pulse = 0; this.siegePulse(s, S); }
      if (s.t >= s.dur) this.endSiege(s, 'breaks camp');
    }
    if (this.sieges.length) this.sieges = this.sieges.filter(s => !s.dead);
  }

  siegePulse(s, S){
    const W = this.W, R = S.r, cx = s.tile % W, cy = (s.tile / W) | 0;
    const invested = new Map();
    for (let y = Math.max(0, cy - R); y <= Math.min(this.H - 1, cy + R); y++){
      for (let x = Math.max(0, cx - R); x <= Math.min(W - 1, cx + R); x++){
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy > R * R) continue;
        const i = y * W + x;
        if (!this.isLand(i)) continue;
        const o = this.owner[i];
        if (o < 0 || o === s.owner) continue;
        invested.set(o, (invested.get(o) || 0) + 1);
        if (this.build[i] && this.rand() < 0.045 * S.bite) this.raze(i);   // walls come down
      }
    }
    for (const [o, n] of invested){
      const v = this.players[o];
      this.bleed(v, n * Math.min(CFG.DEF_CAP, v.density) * CFG.SIEGE_BLEED * S.bite);
      v.grudge.set(s.owner, (v.grudge.get(s.owner) || 0) + 0.4);
    }
  }

  // ------------------------------------------------------------- diplomacy
  // Oaths are sworn for a term, not forever — otherwise the survivors all
  // end up sworn to one another and the war simply stops.
  ally(a, b){
    const A = this.players[a], B = this.players[b];
    const until = this.time + 130 + this.rand() * 130;
    A.allies.add(b); B.allies.add(a);
    A.pact.set(b, until); B.pact.set(a, until);
    A.grudge.delete(b); B.grudge.delete(a);
  }
  breakAlly(a, b, betrayal){
    const A = this.players[a], B = this.players[b];
    A.allies.delete(b); B.allies.delete(a);
    A.pact.delete(b); B.pact.delete(a);
    if (betrayal){
      A.traitor = 90;
      B.grudge.set(a, (B.grudge.get(a) || 0) + 25);
      this.log(`${A.name} breaks faith with ${B.name}`, 'war', a);
    } else if (a === this.humanId || b === this.humanId){
      const other = a === this.humanId ? B : A;
      this.log(`Your pact with ${other.name} has lapsed`, '', other.id);
    }
  }
  power(p){ return p.tiles + p.sold / 25 + p.pop / 90 + p.st[B_TOWN].size * 30; }

  // Would this bot say yes to `from`?
  //
  // The old scoring leaned almost entirely on the bot's loyalty trait, so only
  // the ~18% of lords born very loyal would ever swear to anything and three
  // offers in four were refused flat. Fear is the real reason medieval powers
  // signed: a weaker neighbour, a lord under attack, or anyone watching a
  // front-runner run away with the realm should be glad of a friend.
  wouldAlly(bot, fromId){
    if (bot.allies.has(fromId) || bot.allies.size >= 2) return false;
    if (this.aliveCount <= 3) return false;   // the last few cannot all be friends
    const from = this.players[fromId];
    const ratio = this.power(from) / Math.max(1, this.power(bot));
    let score = 0.20 + bot.loyal * 0.45;
    if (ratio > 1.15) score += 0.25;          // they are the stronger — worth having
    if (ratio > 2.50) score += 0.15;          // much stronger — worth having badly
    if (ratio < 0.60) score -= 0.15;          // we tower over them; less to gain
    for (const a of this.attacks){            // someone already at our throat
      if (!a.dead && a.target === bot.id && a.owner !== fromId){ score += 0.25; break; }
    }
    if (this.leadShare > 0.18 && this.leader !== bot.id && this.leader !== fromId) score += 0.22;
    score -= Math.min(0.7, (bot.grudge.get(fromId) || 0) * 0.06);
    if (from.traitor > 0) score -= 0.50;
    return score > 0.5;
  }

  // How long a standing pact still has to run, in seconds.
  pactLeft(a, b){ return Math.max(0, (this.players[a].pact.get(b) || 0) - this.time); }
  // ------------------------------------------------------------------- bots
  ringOf(p, cap){
    const counts = new Map(), nb = new Int32Array(4);
    const step = p.border.size > cap ? Math.ceil(p.border.size / cap) : 1;
    let i = 0;
    for (const t of p.border){
      if (i++ % step) continue;
      const n = this.neighbors(t, nb);
      for (let j = 0; j < n; j++){
        const m = nb[j];
        if (this.terrain[m] < T_PLAIN) continue;
        const o = this.owner[m];
        if (o === p.id) continue;
        counts.set(o, (counts.get(o) || 0) + 1);
      }
    }
    return counts;
  }

  botBuild(p){
    const interior = () => {
      const spread = Math.max(3, Math.sqrt(p.tiles) * 0.9);
      for (let k = 0; k < 30; k++){
        const x = Math.round(p.cx + (this.rand() - 0.5) * spread * 2);
        const y = Math.round(p.cy + (this.rand() - 0.5) * spread * 2);
        if (x < 0 || y < 0 || x >= this.W || y >= this.H) continue;
        const t = y * this.W + x;
        if (this.owner[t] === p.id && !this.build[t]) return t;
      }
      return -1;
    };
    const fromSet = set => { const t = pickFrom(set, this.rand); return (t >= 0 && !this.build[t]) ? t : -1; };
    const put = (type, get) => {
      if (p.ducats < p.costOf(type)) return false;
      const t = get(); if (t < 0) return false;
      return this.place(p.id, t, type) === null;
    };
    const T = p.tiles;
    const cap = p.jobCap;
    // Build where the doctrine says workers should go but there is no work for
    // them: a priority with no building behind it employs nobody.
    const starved = SECTORS
      .map(sct => ({ sct, gap: p.w[sct] * p.civ - (cap[sct] || 0) }))
      .sort((a, b) => b.gap - a.gap)[0];
    if (starved && starved.gap > 40){
      if (starved.sct === 'farm'  && put(B_FARM,  interior)) return;
      if (starved.sct === 'forge' && put(B_FORGE, interior)) return;
      if ((starved.sct === 'trade' || starved.sct === 'works') && put(B_TOWN, interior)) return;
    }
    if (p.idle > 60 && put(B_TOWN, interior)) return;
    if (p.ducats > 1500 * (1.2 - p.greed) && p.st[B_CASTLE].size < T / 240 && put(B_CASTLE, () => fromSet(p.border))) return;
    if (p.coast.size > 6 && p.st[B_HARBOR].size < 1 + T / 650 && put(B_HARBOR, () => fromSet(p.coast))) return;
    if (T > 340 && p.ducats > 5200 && p.st[B_SIEGE].size < 2 && put(B_SIEGE, interior)) return;
    if (p.ducats > 4200 && p.st[B_TOWER].size < 1 + T / 850 && put(B_TOWER, interior)) return;
    if (p.ducats > 2800 && put(B_TOWN, interior)) return;
  }

  botSiege(p, ring){
    if (!p.st[B_SIEGE].size) return false;
    // Without a cooldown, late-game lords with deep coffers shell the map
    // continuously and the realm decays into open ground faster than anyone
    // can retake it — no one can then reach a winning share.
    if (this.time < p.siegeAt) return false;
    let kind = null;
    if (p.ducats > SIEGE.camp.cost * 1.4) kind = 'camp';
    else if (p.ducats > SIEGE.treb.cost * 1.6) kind = 'treb';
    else if (p.ducats > SIEGE.ram.cost * 2.4) kind = 'ram';
    if (!kind || this.rand() > 0.45) return false;
    let target = -1, bestScore = 0;
    for (const [o, c] of ring){
      if (o < 0 || p.allies.has(o)) continue;
      const q = this.players[o]; if (!q.alive) continue;
      const s = c * (1 + (p.grudge.get(o) || 0) * 0.1) * this.power(q) / 400;
      if (s > bestScore){ bestScore = s; target = o; }
    }
    if (target < 0) return false;
    // invest from our own frontier, facing the ground we mean to take
    const nb = new Int32Array(4);
    let tile = -1, bestFacing = 0;
    for (let k = 0; k < 60; k++){
      const t = pickFrom(p.border, this.rand);
      if (t < 0) break;
      if (this.build[t]) continue;
      let facing = 0;
      const n = this.neighbors(t, nb);
      for (let i = 0; i < n; i++) if (this.owner[nb[i]] === target) facing++;
      if (facing > bestFacing){ bestFacing = facing; tile = t; }
    }
    if (tile < 0 || !bestFacing) return false;
    if (this.raise(p.id, kind, tile) !== null) return false;
    p.siegeAt = this.time + 26 + this.rand() * 22;
    return true;
  }

  // A lord with harbours and coin keeps the sea lanes near them. Without this
  // no AI ever built a galley, so the whole naval game only existed if a human
  // happened to buy one.
  botGalley(p){
    if (!p.coast.size || !p.st[B_HARBOR].size) return false;
    if (p.ducats < 1400) return false;
    const have = this.boats.filter(b => !b.dead && b.kind === 'galley' && b.owner === p.id).length;
    if (have >= Math.min(3, 1 + (p.st[B_HARBOR].size >> 1))) return false;
    if (this.rand() > 0.35) return false;
    const from = pickFrom(p.coast, this.rand);
    if (from < 0) return false;
    // station it out at sea, not hard against our own beach
    let spot = -1;
    for (let k = 0; k < 30; k++){
      const x = (from % this.W) + Math.round((this.rand() - 0.5) * 26);
      const y = ((from / this.W) | 0) + Math.round((this.rand() - 0.5) * 26);
      if (x < 0 || y < 0 || x >= this.W || y >= this.H) continue;
      const t = y * this.W + x;
      if (this.isWater(t)){ spot = t; break; }
    }
    if (spot < 0) return false;
    if (this.sail('galley', p.id, from, spot, 0) !== null) return false;
    p.ducats -= 1000;
    return true;
  }

  botNaval(p){
    if (!p.coast.size || p.ducats < 400 || p.sold < 500) return false;
    const marks = this.players.filter(q => q.alive && q.id !== p.id && !p.allies.has(q.id) && q.coast.size > 3);
    if (!marks.length) return false;
    marks.sort((a, b) => this.power(a) - this.power(b));
    const q = marks[(this.rand() * Math.min(4, marks.length)) | 0];
    const from = pickFrom(p.coast, this.rand), to = pickFrom(q.coast, this.rand);
    if (from < 0 || to < 0) return false;
    const troops = Math.floor(p.sold * (0.35 + p.aggr * 0.3));
    if (this.sail('longship', p.id, from, to, troops) !== null) return false;
    p.ducats -= 400; p.sold -= troops;
    return true;
  }

  // Mobilise when threatened, stand down when safe — the whole point of the
  // levy system is that peace is worth something.
  botMobilise(p){
    let threat = 0;
    for (const [id, heat] of p.grudge) if (heat > 4) threat += heat;
    for (const a of this.attacks){
      if (a.dead) continue;
      if (a.target === p.id) threat += 12;
      if (a.owner === p.id) threat += 6;
    }
    const wanted = threat > 6 ? p.warMobil : 0;
    p.mobil += Math.max(-0.05, Math.min(0.05, wanted - p.mobil));
    // arms you cannot forge are arms you must buy time for: if the stockpile is
    // dry, stop drafting men there is no kit for
    if (p.arms < p.levy * 0.15 && p.mobil > 0) p.mobil = Math.max(0, p.mobil - 0.08);
  }

  botThink(p){
    this.botBuild(p);
    this.botMobilise(p);
    this.botGalley(p);
    const ring = this.ringOf(p, 420);
    if (this.botSiege(p, ring)) return;

    // diplomacy
    if (this.rand() < 0.22 && p.allies.size < 2 && this.aliveCount > 3){
      const cand = [...ring.keys()].filter(o => o >= 0 && !p.allies.has(o) && this.players[o].alive);
      if (cand.length){
        const o = cand[(this.rand() * cand.length) | 0];
        if (o === this.humanId){
          if (!this.asks.some(a => a.from === p.id)) this.asks.push({ from: p.id, at: this.time });
        } else if (this.wouldAlly(this.players[o], p.id) && this.wouldAlly(p, o)){
          this.ally(p.id, o);
          // only pacts between lords who actually matter are worth reporting
          const big = 0.03 * this.landCount;
          if (p.tiles > big || this.players[o].tiles > big)
            this.log(`${p.name} and ${this.players[o].name} swear an alliance`, 'good', p.id);
        }
      }
    }
    for (const aid of p.allies){
      const q = this.players[aid];
      if (!q.alive){ p.allies.delete(aid); continue; }
      if (this.power(q) < this.power(p) * 0.35 && p.aggr > 0.62 && this.rand() < 0.05){
        this.breakAlly(p.id, aid, true);
        this.launch(p.id, aid, p.sold * 0.55);
        return;
      }
    }

    if (p.attacks.length >= 2) return;
    const ready = p.pop > 0 ? p.sold / p.pop : 0;
    let bestT = null, bestW = 0;
    for (const [o, c] of ring){
      if (o >= 0 && p.allies.has(o)) continue;
      let w;
      if (o < 0) w = c * (1.7 + (1 - p.aggr) * 0.9);
      else {
        const q = this.players[o]; if (!q.alive) continue;
        w = c * ((p.density + 1) / (q.density + 1)) * (0.45 + p.aggr)
              * (1 + (p.grudge.get(o) || 0) * 0.08);
        if (q.traitor > 0) w *= 1.6;
        if (this.power(q) < this.power(p) * 0.5) w *= 1.4;
        // nobody wants to be the last one to notice the front-runner — but
        // pile on too hard and no lord can ever close out a war
        const share = q.tiles / this.landCount;
        if (share > 0.22) w *= 1 + (share - 0.22) * 4;
      }
      if (w > bestW){ bestW = w; bestT = o; }
    }
    if (bestT === null){ this.botNaval(p); return; }
    // Against another lord, wait and hit hard. Dribbling the levy out in small
    // attacks just feeds a rival who bleeds you back — with few lords left that
    // reads as endless churn and no war ever ends.
    // Readiness is now "how much of my nation is actually under arms and
    // equipped", not "how full is my population bar".
    const need = bestT < 0 ? 0.02 : 0.07 + (1 - p.aggr) * 0.05;
    if (ready < need || p.sold < 60) return;
    const ratio = bestT < 0 ? 0.5 + p.aggr * 0.25 : 0.62 + p.aggr * 0.33;
    this.launch(p.id, bestT, p.sold * ratio);
  }

  // ---------------------------------------------------------------- economy
  // Civilians are spread over the sectors by the lord's priorities, capped by
  // how many jobs the buildings actually offer. Anything a realm cannot employ
  // idles: it still eats, still pays a little tax, and produces nothing.
  assignWork(p){
    const cap = p.jobCap;
    let pool = p.civ, total = 0;
    for (const s of SECTORS) total += p.w[s];
    if (total <= 0) total = 1;
    // first pass: proportional to priority, clipped by capacity
    const want = {}, got = {};
    for (const s of SECTORS){
      want[s] = pool * (p.w[s] / total);
      got[s] = Math.min(want[s], cap[s]);
    }
    // second pass: whatever a saturated sector could not take goes to the rest
    let spare = pool;
    for (const s of SECTORS) spare -= got[s];
    for (let round = 0; round < 3 && spare > 1; round++){
      let room = 0;
      for (const s of SECTORS) room += Math.max(0, cap[s] - got[s]);
      if (room < 1) break;
      const give = Math.min(spare, room);
      for (const s of SECTORS){
        const r = Math.max(0, cap[s] - got[s]);
        if (r > 0) got[s] += give * (r / room);
      }
      spare = pool;
      for (const s of SECTORS) spare -= got[s];
    }
    p.jobs = got;
    p.idle = Math.max(0, spare);
  }

  economy(p, dt){
    this.assignWork(p);
    const j = p.jobs;

    // --- food and population ---
    const sFarm = p.staffing('farm'), sForge = p.staffing('forge'), sTrade = p.staffing('trade');
    const produced = p.tiles * ECON.FOOD_PER_TILE
                   + p.st[B_FARM].size * ECON.YIELD_FARM_FOOD * sFarm;
    const eaten = p.pop * ECON.FOOD_PER_HEAD;
    p.food = produced - eaten;
    p.starving = p.food < 0;
    const supported = produced / ECON.FOOD_PER_HEAD;
    if (p.food >= 0){
      // grow toward what the land and farms can actually feed
      p.civ += (supported - p.pop) * ECON.GROW_RATE * dt * (p.pop > 0 ? 1 : 0) + dt * 4;
    } else {
      // a hungry realm loses civilians first, then its levies
      const loss = (p.pop - supported) * ECON.STARVE_RATE * dt;
      const fromCiv = Math.min(p.civ, loss);
      p.civ -= fromCiv;
      p.levy = Math.max(0, p.levy - (loss - fromCiv));
    }

    // --- forges make arms; nothing else does ---
    p.armsRate = p.st[B_FORGE].size * ECON.YIELD_FORGE_ARMS * sForge;
    p.arms += p.armsRate * dt;

    // --- ducats ---
    const income = (p.st[B_TOWN].size * ECON.YIELD_TOWN_TRADE
                  + p.st[B_HARBOR].size * ECON.YIELD_HARBOR_TRADE) * sTrade
                  + p.civ * ECON.TAX_PER_CIV + p.tiles * ECON.DUCAT_PER_TILE;
    let works = 0;
    for (const b of B_ALL) works += p.st[b].size;
    const upkeep = p.sold * ECON.UPKEEP_SOLDIER + p.levy * ECON.UPKEEP_LEVY
                 + works * ECON.UPKEEP_BUILD;
    p.income = income; p.upkeep = upkeep;
    p.ducats += (income - upkeep) * dt;
    // a realm that cannot pay cannot keep men under arms
    if (p.ducats < 0){
      p.ducats = 0;
      const shed = Math.min(p.sold, p.sold * 0.05 * dt + 1);
      p.sold -= shed; p.civ += shed;
      p.broke = true;
    } else p.broke = false;

    // --- levies become soldiers with time; arms decide how good they are ---
    if (p.levy > 0){
      const trained = Math.min(p.levy, p.levy / ECON.TRAIN_TIME * dt);
      p.levy -= trained; p.sold += trained;
    }

    // --- hold the ordered army size by drafting or releasing civilians ---
    const target = Math.max(0, Math.min(1, p.standing + p.mobil)) * p.pop;
    const underArms = p.sold + p.levy;
    if (underArms < target){
      const draft = Math.min(p.civ, (target - underArms) * 0.25 * dt);
      p.civ -= draft; p.levy += draft;
    } else if (underArms > target * 1.25 && p.mobil <= 0){
      const home = Math.min(p.sold, (underArms - target) * 0.15 * dt);
      p.sold -= home; p.civ += home;
    }
  }

  // ------------------------------------------------------------------- tick
  tick(dt){
    if (this.phase !== 'war') return;
    this.time += dt; this.ticks++;

    for (const p of this.players){
      if (!p.alive) continue;
      if (p.tiles > p.peak) p.peak = p.tiles;
      this.economy(p, dt);
      if (p.traitor > 0) p.traitor -= dt;
      if (p.grudge.size && (this.ticks & 3) === 0){
        for (const [k, v] of p.grudge){
          const nv = v - dt * 0.32;
          if (nv <= 0) p.grudge.delete(k); else p.grudge.set(k, nv);
        }
      }
    }

    let anyDead = false;
    for (const a of this.attacks){ if (!a.dead) a.tick(); if (a.dead) anyDead = true; }
    if (anyDead){
      this.attacks = this.attacks.filter(a => !a.dead);
      for (const p of this.players) if (p.attacks.length) p.attacks = p.attacks.filter(a => !a.dead);
    }

    this.stepBoats(dt);
    this.stepSieges(dt);
    this.trade(dt);

    for (const p of this.players){
      if (p.alive && p.bot && this.time >= p.nextThink){
        p.nextThink = this.time + 1.4 + this.rand() * 2.6;
        this.botThink(p);
      }
    }
    if ((this.ticks % 10) === 0) this.audit();
  }

  audit(){
    let alive = 0, best = -1, bestT = 0;
    for (const p of this.players){
      if (!p.alive) continue;
      if (p.tiles === 0){
        const afloat = this.boats.some(b => !b.dead && b.owner === p.id && b.kind === 'longship');
        const fighting = p.attacks.some(a => !a.dead);
        if (!afloat && !fighting){
          p.alive = false; p.civ = p.levy = p.sold = 0; p.dieAt = this.time;
          for (const q of this.players){ q.allies.delete(p.id); q.pact.delete(p.id); }
          p.allies.clear(); p.pact.clear();
          this.log(`${p.name} is broken and scattered`, 'big', p.id);
          continue;
        }
      }
      alive++;
      if (p.tiles > bestT){ bestT = p.tiles; best = p.id; }
    }
    this.aliveCount = alive;
    this.leader = best;
    this.leadShare = best >= 0 ? bestT / this.landCount : 0;

    for (const p of this.players){
      if (!p.alive || !p.allies.size) continue;
      for (const id of [...p.allies]){
        if (this.time > (p.pact.get(id) || 0) || alive <= 3) this.breakAlly(p.id, id, false);
      }
    }
    if (this.phase !== 'war') return;
    if (best >= 0 && bestT / this.landCount >= this.winPct){ this.phase = 'done'; this.winner = best; }
    else if (alive <= 1){ this.phase = 'done'; this.winner = best; }
    else if (this.humanId >= 0 && !this.players[this.humanId].alive){ this.phase = 'done'; this.winner = best; }
  }
}

function pickFrom(set, rand){
  const n = set.size;
  if (!n) return -1;
  let k = (rand() * n) | 0;
  for (const v of set) if (k-- === 0) return v;
  return -1;
}

// Build a full match: one human seat (id 0 unless headless) plus bot lords.
function makeMatch(opts){
  const g = new Game(opts);
  const used = new Set();
  const pickColor = () => {
    for (let i = 0; i < 90; i++){
      const c = PALETTE[(g.rand() * PALETTE.length) | 0];
      if (!used.has(c)){ used.add(c); return c; }
    }
    return PALETTE[(g.rand() * PALETTE.length) | 0];
  };
  const names = new Set();
  const pickName = () => {
    for (let i = 0; i < 60; i++){ const n = makeHouseName(g.rand); if (!names.has(n)){ names.add(n); return n; } }
    return makeHouseName(g.rand) + ' II';
  };
  if (opts.human){
    used.add(opts.human.color); names.add(opts.human.name);
    const h = g.addLord(opts.human.name, opts.human.color, false);
    g.humanId = h.id;
    // the player picks their own doctrine with the sliders — start them level
    h.doctrine = 'your own';
    h.w = { farm:0.40, forge:0.22, trade:0.28, works:0.10 };
    h.standing = 0.08; h.mobil = 0; h.warMobil = 0;
  }
  // On the Europe map the AI lords are the powers of the age, seated at home.
  if (g.preset === 'europe'){
    const pool = POWERS.slice();
    for (let i = pool.length - 1; i > 0; i--){       // deal them out, seeded
      const j = (g.rand() * (i + 1)) | 0;
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    for (let i = 0; i < opts.bots; i++){
      const power = pool[i % pool.length];
      const lord = g.addLord(power ? power[0] : pickName(), pickColor(), true);
      if (power) lord.home = [power[1], power[2]];
    }
  } else {
    for (let i = 0; i < opts.bots; i++) g.addLord(pickName(), pickColor(), true);
  }
  return g;
}

// Node takes this as a module; browser and jsc pick the declarations up as globals.
if (typeof module !== 'undefined' && module.exports){
  module.exports = {
    CFG, ECON, SECTORS, ARCHETYPES, BUILDS, SIEGE, PALETTE, TINCTURES,
    Game, Lord, Attack, Heap, makeMatch, makeHouseName, mulberry32, hslHex, pickFrom,
    fbm, vnoise, hash2,
    T_SEA, T_SHOAL, T_PLAIN, T_WOOD, T_HILL, T_PEAK,
    B_NONE, B_TOWN, B_CASTLE, B_HARBOR, B_SIEGE, B_TOWER, B_FARM, B_FORGE, B_ALL,
  };
}
