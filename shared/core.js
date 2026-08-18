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
  ATTACK_RATE:    0.055,   // share of an attack's remaining levy spent per tick
  ATTACK_FLOOR:   30,      // ...but at least this many per tick
  TILE_RATE:      0.11,    // tiles converted per tick, as a share of front width.
                           // Has to stay well clear of TILE_FLOOR across the
                           // usual range of front widths, or the floor becomes
                           // the real allowance and the host multiplier below
                           // does nothing: at 0.065 with a floor of 3, hosts of
                           // 1000, 2000 and 4000 men all advanced at exactly
                           // 30 tiles a second.
  TILE_FLOOR:     2,       // a narrow front still creeps forward
  // A host does not fight on foot alone. Horse, baggage and sheer numbers let a
  // great army push a front in several places at once, so the advance scales
  // with the size of what was sent — square-root, not linear, so doubling the
  // host is worth something without making one doomstack unanswerable.
  // Without this the tile allowance is a hard ceiling at ~front width: measured
  // before the change, 8000 men and 16000 men took ground at nearly the same
  // rate, so everything above a middling host bought a longer war rather than a
  // faster one.
  HOST_REF:       1000,    // the host that advances at exactly TILE_RATE
  HOST_CAP:       4,       // ...and no host moves more than this much faster

  // --- the battle for a field ---
  // Every field taken *from another lord* is a small battle, and both sides
  // roll for it. Arming is what loads the dice: each 5% of arms-per-soldier is
  // worth 0.05, up to 1.00 for a fully equipped host — so a full armoury rolls
  // d1+1.00 against a rabble's d1+0.30. The gap between the rolls decides how
  // one-sided the exchange was: both sides bleed for it, and the field only
  // changes hands if the attacker wins. Open ground has no other side, so it is
  // claimed rather than fought for — otherwise the opening scramble would be
  // decided by coin flips against nobody.
  ROLL_STEP:      0.05,    // advantage per 5% of arming
  ROLL_CAP:       1.00,    // ...and no more than this
  ROLL_SWING:     0.50,    // how hard the gap swings the casualties either way
  ROLL_REPULSE:   0.60,    // a field the attacker lost is retried behind the
                           // rest of the contour, at this much of its cost —
                           // a repulsed assault probes elsewhere along the line
                           // rather than battering the same field for ever

  // --- settlement ---
  // Claiming open ground is not a battle, so it should not cost blood like one.
  // The levy spent on an empty field mostly *settles* it: those men leave the
  // host and come home as civilians on the new land, and only a small share is
  // truly lost to the wilderness. The attack still spends its committed men at
  // the same rate — that spend is what meters how fast a realm can claim, and
  // removing it re-created the exponential land grab — but the realm keeps the
  // people. What conquest of empty land costs you is *soldiers*: settlers must
  // be mustered back into the host, and mustering is paid in ducats.
  SETTLE_LOSS:    0.15,    // share of the levy truly lost per open field
  NEUTRAL_COST:   15,      // levy per tile of open ground...
                           // At 24 a host bought about sixteen fields of plain
                           // per thousand men, so a levy of five hundred took
                           // thirty fields and was gone inside five seconds —
                           // the advance was quick and the *ground* was still
                           // slow, which is what "claiming is too slow" meant.
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

  // --- the calendar ---
  // Match time is read as years, not as a stopwatch: the first banner goes up
  // in 1300 and a match of ordinary length runs to the middle of the next
  // century. House names are drawn from whatever year the realm has reached,
  // so the calendar is a rule, not decoration — it lives here rather than in
  // the client so the server, the client and the harnesses all date a match
  // the same way.
  EPOCH_YEAR:     1300,
  YEAR_SECS:      12,      // seconds of match time to the year

  // --- how many lords ---
  // Every match runs somewhere between these many AI lords, rolled once when
  // the lobby opens and honoured exactly. Shared rather than server-only so a
  // solo match and an online one are the same size of war.
  AI_MIN:         40,
  AI_MAX:         90,
  MAX_HUMANS:     12,      // seats at the table before a lobby is full
  LOBBY_SECS:     60,      // ...and how long it waits for them
};

const T_SEA = 0, T_SHOAL = 1, T_PLAIN = 2, T_WOOD = 3, T_HILL = 4, T_PEAK = 5;
const B_NONE = 0, B_TOWN = 1, B_CASTLE = 2, B_HARBOR = 3, B_SIEGE = 4, B_TOWER = 5,
      B_FARM = 6, B_FORGE = 7;
const B_ALL = [B_TOWN, B_CASTLE, B_HARBOR, B_SIEGE, B_TOWER, B_FARM, B_FORGE];

const BUILDS = {
  // `size` is the square of ground a work stands on. Land is the real
  // constraint on an economy — without a footprint you could fit an entire
  // realm's industry onto a ten-field island.
  [B_TOWN]:   { key:'town',   name:'Town',       cost:620,  step:1.18, needCoast:false, size:3 },
  [B_CASTLE]: { key:'castle', name:'Castle',     cost:700,  step:1.12, needCoast:false, size:3 },
  [B_HARBOR]: { key:'harbor', name:'Harbour',    cost:650,  step:1.15, needCoast:true,  size:2 },
  [B_SIEGE]:  { key:'siege',  name:'Siege Works',cost:2400, step:1.30, needCoast:false, size:2 },
  [B_TOWER]:  { key:'tower',  name:'Watchtower', cost:1300, step:1.20, needCoast:false, size:2 },
  [B_FARM]:   { key:'farm',   name:'Farm',       cost:340,  step:1.10, needCoast:false, size:3 },
  [B_FORGE]:  { key:'forge',  name:'Blacksmith', cost:560,  step:1.14, needCoast:false, size:2 },
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

  // roads
  ROAD_MAX:         46,     // furthest two works will link up, in fields
  CARAVAN_SPEED:     7,     // fields a second
  CARAVAN_VALUE:     9,     // ducats a caravan delivers
  CARAVAN_EVERY:     4,     // seconds between a work sending one out
  ROAD_LINK:        0.16,   // trade bonus per extra work on the same network
  ROAD_LINK_CAP:    1.30,   // ...up to this much on top
  SUPPLY_R:         30,     // how far a supplied network reaches from its works
  UNSUPPLIED:       1.55,   // an unsupplied advance pays this much more a field
  UNSUPPLIED_RATE:  0.55,   // ...and creeps at this share of the usual speed

  TRAIN_TIME:       42,     // seconds for a levy to become a soldier
  DEMOB_RETURN:     0.6,    // share of arms recovered when disbanding

  // Every lord has a peasant levy standing whether they ordered one or not —
  // the fields empty when the horn blows. It is free because it is barely an
  // army. Raising anything *above* it is a muster, and a muster is bought man
  // by man, in coin, as it happens. That is what stops mobilisation being a
  // slider with nothing behind it: a realm that cannot pay cannot raise the
  // men however loudly it orders them, so the choice to go to war competes
  // directly with everything else coin buys.
  // --- what a realm can actually run ---
  // A realm cannot build without limit, and the limit is not coin. Works need
  // ground to stand on, hands to run them, and somewhere to administer them
  // from — so capacity grows with the realm rather than with the treasury.
  //
  // Keyed on the *root* of the land held, for the reason this project keeps
  // relearning: a linear term cannot cap size. At one work per field a great
  // power would run thousands; at the root it runs about a hundred, and a new
  // holding of twenty fields runs four or five. Towns then raise the ceiling,
  // which is what makes development the way to build more — not saving up.
  //
  // Capacity gates *construction*, never possession. Ground taken from a lord
  // comes with the works standing on it, and those keep working however far
  // over your ceiling they put you; you simply cannot raise more of that kind
  // until the realm grows into them. Razing what you captured is a real choice.
  WORKS_BASE:       3,      // what the smallest holding can run
  WORKS_ROOT:       0.95,   // ...plus this per root of a field held
  WORKS_PER_TOWN:   2.2,    // and this much more for every town administering
  // Each kind's share of that ceiling. They do not sum to one — a realm at its
  // limit for farms may still have room for forges.
  CAP_SHARE: { farm:0.42, forge:0.26, town:0.15, harbor:0.16, castle:0.20, tower:0.10, siege:0.05 },
  CAP_COAST:        22,     // ...and a harbour wants this many coastal fields
  CAP_MIN:          1,      // every realm may always run one of anything

  // A plot can be built up rather than out: raise a second farm on the same
  // ground and it joins the first. Land stops being the hard wall on an economy
  // — a small island can hold a realm — while the ceiling above still decides
  // how many works there are in total, so this buys space and never scale.
  STACK_MAX:        15,

  // How the price rises as a realm fills its ceiling. Cheap while there is
  // room, dear at the limit — and *cheaper again* once the ceiling rises, so
  // growing the realm is what makes building affordable rather than hoarding.
  // This replaced an exponential on lifetime purchases, which punished razing,
  // never noticed a captured work, and could not tell a realm of twenty fields
  // from one of ten thousand.
  COST_FILL:        3.0,
  COST_POW:         1.6,

  // What a levy is worth beside a soldier, before arms are counted.
  LEVY_WORTH:       0.45,

  PEASANT_LEVY:     0.08,   // share of the population always under arms
  MUSTER_COST:      0.85,   // ducats to raise one man above the peasant levy
  DRAFT_RATE:       0.25,   // share of the shortfall drafted per second
  // A muster draws on the treasury at a *rate*, never to the bottom of it.
  // Spending every ducat as it arrived pinned a mobilised realm at zero for the
  // rest of the match: the ordered size scales with population, population
  // keeps growing, so the order is never satisfied and the drain never ends —
  // a lord who touched the slider once could not afford a 340c farm again.
  // Drawing a share lets the treasury settle where income meets the muster. A
  // rich realm raises men quickly, a poor one slowly, and both keep something
  // to build with.
  // Share of the treasury a muster may spend a second. At 0.30 the muster ate
  // so much of the purse that lords stopped building: measured over fifteen
  // minutes, halving it to 0.15 left them with 5,242 ducats in hand against
  // 3,262, 118 works each against 103, and *fewer* starving (17% against 20%),
  // because a slower muster leaves more hands in the fields. Note that removing
  // the cost altogether is worse again — 28% starving — since nothing then
  // throttles how fast a lord can empty its own farms into an army.
  MUSTER_DRAW:      0.15,

  // Going to war is a thing you prepare for, not a thing you decide. A lord
  // will not open a war on another lord until all three are true: the men are
  // called up and have come in, there are arms for them, and there is coin in
  // hand to keep them in the field. Claiming *open* ground asks none of this —
  // empty land has no defenders, and gating the opening scramble behind a war
  // chest would simply stop the map ever being settled.
  WAR_MOBIL:        0.50,   // what a lord orders when it means to fight
  // Measured: at 0.80 arms-per-soldier the forges were the long pole and the
  // map sat still from minute 7 to minute 14 with thirty-odd lords all waiting
  // on kit. 0.66 is still emphatically armed — a wholly unequipped host fights
  // at UNARMED (0.30), and this one fights at about 0.77 of full strength.
  WAR_EQUIP:        0.66,   // arms per soldier before it will march on a lord
  WAR_CHEST:        250,    // ducats it wants in hand before opening a war
  WAR_HOST:         0.10,   // share of its people it wants under arms first
  WAR_LOOMS:        0.72,   // claimed share of the map at which realms start arming
  ARMING:           0.40,   // ...and how much of a war footing that is worth

  SEA_NEWS_EVERY:   20,     // seconds between reports of other lords' sea fights
};

// There are no doctrines. A lord is not born mercantile or military; every
// realm runs the same way and the only question that separates them is whether
// they are *ready* to fight. Preparing for a war is the decision: order the
// mobilisation, pay to raise the men, forge arms for them, and keep enough coin
// to see it through. A lord that marches without doing all three is throwing
// its people away, and now knows it.
//
// Fixed archetypes never delivered the trade-offs they promised anyway — one of
// the four won every match, before and after the levy was priced.
const START_W = { farm:0.40, forge:0.24, trade:0.26, works:0.10 };

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
// A house is named for where it sits and for when it rose. Both halves matter:
// one undifferentiated word-pool gave a Rhineland count and a Castilian one the
// same invented syllables, and gave a lord of 1300 the same title as one of
// 1460 — by which time half the counties of Europe had been swallowed by the
// crowns that named themselves after them.
const STOCK = {
  insular:   { a:['Ash','Black','Raven','Thorn','Bram','Harl','Ken','Dun','Kil','Inver','Glen','Strath','Wold','Mor'],
               b:['worth','ford','bury','combe','shire','wick','mere','dale','ness','garth','more','rick','holt'] },
  iberian:   { a:['Cast','Alca','Mont','Vill','Pen','Torr','Salv','Mira','Val','Ribe','Sant','Guad','Bel'],
               b:['illa','alba','ejo','ares','uela','osa','ada','eira','orte','anca','eda','ejar'] },
  frankish:  { a:['Beau','Mont','Chat','Ville','Roche','Cler','Vaux','Bel','Cour','Aube','Fer','Aur'],
               b:['mont','fort','champ','ville','court','val','lieu','bourg','rand','ray','gny','eres'] },
  italian:   { a:['Monte','Castel','Villa','Rocc','Alta','Bella','Poggi','Camp','Vald','Colle','Fior','Sasso'],
               b:['alto','vecchio','nuovo','forte','rosso','bello','grande','ferro','lungo','secco','marino'] },
  germanic:  { a:['Falken','Rosen','Lowen','Hohen','Wolfs','Eisen','Grun','Schwarz','Stern','Adler','Berg','Reichen'],
               b:['berg','burg','stein','feld','walde','heim','bach','thal','horst','fels','au','rode'] },
  norse:     { a:['Bjarn','Hald','Sten','Ulf','Thor','Skag','Val','Nord','Vin','Hrafn','Aske','Fjell'],
               b:['stad','vik','fjord','holm','berg','heim','strand','naes','lund','dal','borg','oy'] },
  slavic:    { a:['Bela','Novo','Zvon','Rado','Cherni','Vysh','Krasno','Miro','Gorod','Vlad','Pere','Zbor'],
               b:['grad','gora','polye','mir','slav','ovo','itsa','vets','ynia','sk','bor'] },
  magyar:    { a:['Var','Feher','Nagy','Kis','Somo','Zala','Csan','Bekes','Bihar','Tolna','Szek'],
               b:['var','hely','falva','sag','hida','mar','to','vesd'] },
  greek:     { a:['Palaio','Neo','Kastro','Mega','Chryso','Hagio','Thermo','Amphi','Kalli','Xero'],
               b:['kastron','polis','choria','limni','vouni','pyrgos','nisos','vrysi'] },
  anatolian: { a:['Kara','Ak','Kizil','Sari','Demir','Gok','Alt','Yeni','Eski','Boz'],
               b:['han','kale','su','dag','ova','pinar','bey','oglu','yurt'] },
  maghrebi:  { a:['Beni','Ait','Ouled','Sidi','Tafi','Zaw','Meri','Ham','Tlem','Kser'],
               b:['lalt','mane','rout','wan','zir','dad','rif','sen','ada'] },
};

// Which stock a seat draws on. Deliberately rough: these are bands of influence
// rather than borders, and there are no borders on the map to consult.
// Order matters as much as the bounds here: the isles are tested before the
// north, or Scotland comes out Norse, and the Hungarian plain before the Rus,
// or it comes out Slavic.
function regionAt(lon, lat){
  if (lat < 36.6) return 'maghrebi';
  if (lon > 25.5 && lat < 42.5) return 'anatolian';
  if (lon > 18.5 && lat < 41.0) return 'greek';
  if (lon < 2.0 && lat > 49.5) return 'insular';
  if (lat > 55.5 && lon < 26) return 'norse';   // bounded east, or Novgorod turns Norse
  if (lon >= 16.5 && lon < 23.5 && lat >= 44.5 && lat < 49.5) return 'magyar';
  if (lon >= 14.5 && lat < 45.5) return 'slavic';   // the Balkans
  if (lon >= 17) return 'slavic';                   // Poland and the Rus
  if (lon < 3.5 && lat < 44.5) return 'iberian';
  if (lon >= 6.5 && lat < 46.5) return 'italian';
  if (lon < 7.5) return 'frankish';
  return 'germanic';
}

// Titles move with the century. The fourteenth opens on a patchwork of
// lordships and counties and closes on duchies and free companies; by the
// fifteenth the survivors are crowns and grand duchies. That is the arc the
// real powers took, and it is why the year the house rose is worth carrying.
const ERAS = [
  { until: 1340, of: ['Barony of','Lordship of','County of','March of','Viscounty of','Honour of'],
                 bare: ['House','House','Clan'] },
  { until: 1380, of: ['County of','March of','Duchy of','Lordship of','Bishopric of'],
                 bare: ['House','House','the'] },
  { until: 1420, of: ['Duchy of','County of','Free City of','Signoria of','Company of'],
                 bare: ['House','the','the'] },
  { until: 9999, of: ['Kingdom of','Grand Duchy of','Duchy of','Republic of','Crown of','Principality of'],
                 bare: ['House','the'] },
];

const pickOf = (rand, arr) => arr[(rand() * arr.length) | 0];

// `where` is a [lon, lat] seat and `year` the year the house rose. Both are
// optional — the other map presets have no geography to speak of, so they fall
// back to a spread across every stock.
function makeHouseName(rand, where, year){
  const key = where ? regionAt(where[0], where[1])
                    : Object.keys(STOCK)[(rand() * Object.keys(STOCK).length) | 0];
  const st = STOCK[key];
  const stem = pickOf(rand, st.a) + pickOf(rand, st.b);
  const era = ERAS.find(e => (year || CFG.EPOCH_YEAR) < e.until) || ERAS[ERAS.length - 1];
  const cap = stem[0].toUpperCase() + stem.slice(1);
  const r = rand();
  if (r < 0.46) return pickOf(rand, era.of) + ' ' + cap;
  if (r < 0.80){
    const t = pickOf(rand, era.bare);
    return t === 'the' ? 'the ' + cap + ' Host' : t + ' ' + cap;
  }
  return 'House ' + cap;
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
// Twelve tinctures in nine shades. Nine rather than six because a match can now
// seat ninety AI lords plus a lobby of humans, and a realm that shares its
// colour with its neighbour cannot be told apart on the map at all.
const PALETTE = (() => {
  const out = [], shades = [43, 33, 53, 38, 48, 28, 58, 23, 63];
  for (let i = 0; i < 108; i++){
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
  // Coastlines are traced at roughly a degree or finer through the headlands
  // and gulfs that give a country its silhouette — the boot of Italy with a
  // real heel and toe, Brittany, Cornwall and the Wash, the Adriatic, the
  // Aegean, the Gulf of Bothnia. Coarser outlines than this are what made the
  // map read as a set of polygons rather than as Europe: a fourteen-point
  // Iberia has a dead-straight south coast whatever noise is laid over it,
  // because the warp displaces a long edge coherently instead of breaking it.
  land: [
    // Iberia — Biscay coast, the Mediterranean down to Tarifa, the Atlantic back up
    [[-9.30,42.90],[-8.85,43.33],[-8.30,43.55],[-7.10,43.75],[-5.85,43.65],[-4.50,43.45],
     [-3.15,43.50],[-1.90,43.45],[-1.60,43.38],[0.90,42.72],[2.10,42.45],[3.28,42.32],
     [3.15,41.90],[2.20,41.40],[1.20,41.10],[0.87,40.72],[0.55,40.55],[0.20,40.10],
     [-0.30,39.50],[0.19,38.73],[-0.50,38.30],[-0.65,37.95],[-1.00,37.57],[-1.80,37.20],
     [-2.50,36.83],[-3.40,36.72],[-4.42,36.72],[-5.35,36.15],[-5.60,36.00],[-6.30,36.55],
     [-6.90,37.20],[-7.40,37.18],[-7.90,36.98],[-8.80,37.02],[-8.99,37.02],[-8.85,37.90],
     [-8.80,38.45],[-9.15,38.70],[-9.48,38.78],[-9.35,39.35],[-9.05,39.75],[-8.87,40.15],
     [-8.75,40.65],[-8.65,41.15],[-8.85,41.90],[-9.20,42.55]],
    // France — Roussillon and Provence, the Alpine and Rhine frontiers, Flanders,
    // then the Channel, Brittany and the Bay of Biscay
    [[3.05,42.45],[3.10,43.08],[4.20,43.45],[5.35,43.30],[6.00,43.08],[6.95,43.42],
     [7.55,43.78],[7.10,44.20],[6.80,44.90],[7.00,45.50],[6.80,46.05],[6.10,46.20],
     [6.20,46.80],[7.00,47.35],[7.60,47.60],[7.80,48.60],[8.20,49.00],[6.35,49.50],
     [6.10,50.15],[5.00,51.45],[3.70,51.40],[2.55,51.10],[1.85,50.95],[1.55,50.35],
     [0.70,49.90],[0.10,49.50],[-1.15,49.38],[-1.60,49.65],[-1.25,49.25],[-1.60,48.65],
     [-2.60,48.55],[-3.50,48.85],[-4.30,48.70],[-4.75,48.40],[-4.35,48.05],[-3.20,47.75],
     [-2.55,47.50],[-2.15,47.28],[-1.75,46.98],[-1.20,46.30],[-1.15,45.65],[-1.25,44.65],
     [-1.55,43.48],[-1.60,43.38],[0.90,42.72],[2.10,42.45]],
    // The German lands, Bohemia, Poland and Hungary — the North Sea and Baltic
    // coasts in front, the Carpathian and Alpine rim behind
    [[6.10,50.15],[5.00,51.45],[4.10,51.95],[4.75,52.95],[5.60,53.30],[6.50,53.40],
     [7.20,53.35],[8.10,53.55],[8.50,53.90],[8.70,54.00],[9.00,54.50],[8.60,55.00],
     [9.40,54.82],[10.10,54.35],[10.90,53.90],[12.10,54.20],[13.40,54.40],[14.60,53.90],
     [15.60,54.20],[16.80,54.55],[18.70,54.35],[19.60,54.42],[20.50,54.70],[21.10,55.70],
     [21.00,56.50],[22.30,57.10],[23.50,56.95],[24.20,56.20],[23.90,54.90],[23.60,54.00],
     [23.90,52.10],[24.20,50.60],[23.30,49.30],[22.60,48.50],[22.90,47.90],[21.50,46.20],
     [19.60,45.90],[17.00,45.80],[16.00,46.50],[13.70,46.50],[12.40,46.60],[11.00,47.00],
     [9.60,47.50],[7.60,47.60],[7.80,48.60],[8.20,49.00],[6.35,49.50]],
    // Ruthenia and the western Rus — the Gulf of Finland, Ladoga's country, the
    // steppe down to the Black Sea and the Sea of Azov
    [[23.60,54.00],[23.90,54.90],[24.20,56.20],[23.50,56.95],[24.50,57.60],[26.00,57.55],
     [27.50,57.55],[28.20,58.30],[28.00,59.35],[29.50,59.90],[31.00,60.20],[33.00,60.00],
     [36.00,59.20],[39.00,58.20],[41.00,57.20],[42.00,55.60],[42.00,51.00],[41.00,48.60],
     [39.50,47.60],[38.30,47.15],[37.50,47.05],[36.60,46.60],[35.20,46.20],[34.00,46.15],
     [33.50,46.20],[32.10,46.55],[31.20,46.60],[30.50,46.05],[29.70,45.35],[28.75,45.25],
     [28.60,46.00],[28.20,46.90],[26.60,48.30],[24.90,49.60],[24.00,50.50],[23.90,52.10]],
    // The Balkans and Greece — Dalmatia down the Adriatic, the Peloponnese, the
    // Aegean shore and the Bosphorus approach
    [[16.00,46.50],[19.60,45.90],[21.50,46.20],[22.90,47.90],[25.00,45.50],[26.60,44.30],
     [27.90,44.05],[28.65,43.75],[28.20,43.40],[27.90,42.70],[28.10,41.95],[28.85,41.25],
     [29.15,41.15],[28.85,40.85],[28.20,40.82],[27.40,40.80],[26.80,40.62],[26.30,40.58],
     [26.00,40.75],[25.20,40.90],[24.30,40.80],[23.70,40.55],[23.35,40.25],[22.95,40.50],
     [22.60,40.35],[23.00,39.90],[23.35,39.20],[23.55,38.55],[24.10,38.35],[24.05,38.02],
     [24.03,37.68],[23.75,37.88],[23.50,37.98],[23.15,37.88],[23.05,37.70],
     [23.20,37.45],[22.75,37.00],[23.10,36.42],[22.50,36.75],[22.00,36.90],
     [21.70,37.15],[21.30,37.65],[21.15,38.30],[20.75,38.85],[20.90,39.60],[19.95,40.10],
     [19.40,40.35],[19.30,41.30],[18.90,41.85],[18.10,42.65],[17.20,43.05],[16.20,43.45],
     [15.30,44.15],[14.55,44.90],[13.90,45.40],[13.60,45.55]],
    // Italy — the Ligurian arc, the Tyrrhenian coast, the toe and the heel with
    // the Gulf of Taranto between them, the Gargano spur, and the Po to Venice
    [[7.55,43.90],[8.25,44.35],[9.20,44.30],[9.85,44.05],[10.30,43.85],[10.55,43.35],
     [10.30,42.95],[11.20,42.40],[11.80,42.10],[12.25,41.75],[13.05,41.25],[13.75,41.25],
     [14.05,40.92],[14.30,40.75],[14.60,40.60],[14.95,40.25],[15.30,40.05],[15.65,39.95],[16.00,39.40],
     [16.55,38.95],[16.10,38.65],[15.65,38.25],[15.90,37.95],[16.55,38.55],[17.15,38.95],
     [17.20,39.45],[16.85,39.65],[16.55,39.80],[17.20,40.45],[17.95,40.65],[18.50,40.15],
     [18.35,39.80],[17.90,40.50],[17.20,40.90],[16.20,41.40],[15.90,41.65],[16.20,41.90],
     [15.60,41.90],[15.15,41.95],[14.85,42.20],[14.05,42.65],[13.55,43.60],[12.90,44.05],
     [12.25,44.25],[12.35,44.85],[12.50,45.45],[13.60,45.80],[13.75,45.60],[13.00,45.60],
     [11.80,45.65],[10.60,45.70],[9.30,45.85],[8.10,45.95],[7.00,45.55],[6.90,44.80]],
    // Great Britain — Cornwall, the Bristol Channel, Wales, the Solway, the
    // Highlands, the east coast down past the Wash to Kent
    [[-5.72,50.07],[-4.20,50.35],[-3.55,50.62],[-2.45,50.62],[-1.95,50.72],[-1.10,50.78],
     [-0.30,50.82],[0.55,50.87],[1.42,51.10],[1.30,51.80],[1.75,52.48],[1.75,52.98],
     [0.35,53.10],[0.10,53.55],[-0.20,54.10],[-0.55,54.50],[-1.15,54.65],[-1.35,55.05],
     [-1.60,55.60],[-2.10,56.05],[-2.60,56.05],[-3.10,56.15],[-2.75,56.45],[-2.45,56.75],
     [-2.10,57.20],[-1.85,57.60],[-2.60,57.70],[-3.50,57.85],[-4.00,57.90],[-3.80,58.60],
     [-4.75,58.60],[-5.10,58.25],[-5.30,57.85],[-5.75,57.55],[-5.60,57.10],[-5.80,56.60],
     [-5.65,56.10],[-5.35,55.85],[-4.80,55.35],[-4.90,54.85],[-3.60,54.90],[-3.05,54.20],
     [-3.10,53.40],[-4.15,53.35],[-4.55,53.30],[-4.10,52.90],[-4.10,52.50],[-4.35,52.20],
     [-4.75,51.75],[-5.25,51.72],[-4.30,51.55],[-3.40,51.40],[-3.00,51.25],[-3.55,51.02],
     [-4.20,50.95],[-5.05,50.60]],
    // Ireland
    [[-6.05,55.25],[-5.45,54.75],[-5.55,54.25],[-6.05,53.90],[-6.15,53.35],[-6.05,52.80],
     [-6.35,52.25],[-7.55,52.05],[-8.30,51.75],[-9.45,51.55],[-10.15,51.65],[-9.90,52.15],
     [-9.70,52.60],[-9.05,53.15],[-10.05,53.45],[-9.90,54.00],[-8.65,54.30],[-8.30,54.65],
     [-7.35,55.10],[-6.95,55.25]],
    // Norway and Sweden — the western fjords, the North Cape, and the Baltic
    // side down through Skåne with the Gulf of Bothnia cut in behind
    [[4.95,58.10],[5.20,59.20],[5.10,60.10],[6.20,60.60],[5.90,61.20],[7.00,62.10],
     [8.10,62.60],[9.60,63.40],[11.20,64.20],[12.60,65.20],[14.00,66.30],[15.50,67.40],
     [17.20,68.10],[19.00,69.00],[21.00,70.00],[23.00,70.60],[25.00,71.10],[27.00,71.00],
     [28.50,70.90],[30.50,69.75],[29.00,69.60],[27.00,68.50],[24.00,66.00],[22.20,65.80],
     [21.50,64.00],[19.20,63.00],[17.40,62.00],[18.30,61.00],[17.60,60.30],[18.60,59.50],
     [17.20,58.80],[16.60,57.00],[15.00,56.10],[14.50,55.40],[13.00,55.40],[12.60,56.20],
     [11.90,57.30],[11.20,58.30],[10.60,59.10],[9.60,58.90],[8.00,58.15],[6.60,58.10]],
    // Finland
    [[21.50,64.00],[22.20,65.80],[24.00,66.00],[27.00,68.50],[29.00,69.60],[30.50,69.75],
     [31.50,68.30],[30.20,66.20],[31.50,64.20],[31.00,62.00],[28.50,61.00],[27.50,60.40],
     [25.00,60.00],[23.00,59.85],[21.30,60.50],[21.10,62.20]],
    // Karelia, the White Sea country and the Kola.
    //
    // This was missing entirely, and it is a large hole to leave: everything
    // north of about 60°N and east of Finland — Karelia, Onega, the White Sea
    // shore, Arkhangelsk, the whole Kola peninsula — was open water. Finland
    // touched Russia only through a strip of shoal, so the two were not joined
    // by land at all and no army could march between them. Novgorod sat on the
    // edge of an ocean that should have been its hinterland.
    //
    // Traced so the White Sea stays a real inlet rather than being filled in:
    // the boundary runs west along the Kola's southern shore at about 66°N,
    // turns at the Kandalaksha gulf and comes back east along the Karelian
    // shore at about 65°N, leaving the water between them outside the land.
    [[28.50,61.00],[31.00,62.00],[31.50,64.20],[30.20,66.20],[31.50,68.30],[30.50,69.75],
     [33.00,69.55],[36.00,68.95],[38.50,68.25],[40.60,67.85],[41.80,67.30],
     [41.00,66.55],[39.00,66.25],[37.40,66.00],[35.90,65.60],   // south shore of the Kola
     [34.00,66.25],[32.60,66.60],                                // the Kandalaksha gulf
     [32.90,65.20],[34.30,64.90],[36.00,64.80],[37.60,64.80],[39.20,64.90],[40.60,65.00],
     [42.00,65.10],[42.00,60.40],                                // Arkhangelsk, then the map's edge
     [38.00,59.90],[34.00,60.10],[31.00,60.20],[29.50,60.40]],
    // Jutland, and the Danish islands behind it
    [[8.45,55.30],[8.15,56.20],[8.60,57.10],[9.60,57.60],[10.60,57.75],[10.40,56.90],
     [10.20,56.15],[10.70,55.80],[10.00,55.30],[9.50,55.10],[9.40,54.82],[8.60,55.00]],
    [[9.80,55.60],[10.70,55.55],[10.80,55.05],[9.90,55.02]],                // Funen
    [[11.05,56.05],[12.15,56.12],[12.65,55.55],[12.10,55.00],[11.15,55.20]],// Zealand
    // The Alpine arc and the Carpathian bow are land bridges as much as
    // mountains: without them Italy is an island and Transylvania is open sea,
    // which is precisely what the landmark check caught when these were
    // dropped. Every neighbouring polygon shares vertices with them on purpose.
    [[6.10,46.20],[6.80,46.05],[7.00,45.55],[8.10,45.95],[9.30,45.85],[10.60,45.70],
     [11.80,45.65],[13.60,45.60],[13.70,46.50],[12.40,46.60],[11.00,47.00],[9.60,47.50],
     [7.60,47.60],[6.20,46.80]],
    [[22.60,48.50],[24.20,48.55],[26.60,48.30],[28.20,46.90],[28.60,46.00],[27.20,45.35],
     [25.00,45.50],[22.90,47.90]],
    // Anatolia — the Aegean coast with its gulfs, the Marmara, the Black Sea
    // shore and the Cilician bight
    [[26.20,40.15],[27.20,40.55],[28.30,40.45],[29.20,41.00],[29.10,41.25],[30.30,41.15],
     [31.40,41.30],[33.30,42.05],[35.00,42.10],[36.20,41.70],[37.50,41.10],[39.00,41.10],
     [40.50,41.30],[41.60,41.55],[42.00,41.40],[42.00,37.50],[40.00,37.00],[38.00,36.70],
     [36.60,36.20],[35.90,36.60],[35.00,36.35],[34.00,36.30],[33.00,36.10],[32.00,36.25],
     [31.00,36.30],[30.50,36.30],[30.20,36.90],[29.30,36.30],[28.80,36.65],[28.20,36.95],
     [27.40,37.05],[27.20,37.60],[26.80,38.20],[27.20,38.60],[26.70,38.75],[26.90,39.35],
     [26.20,39.55],[26.10,39.95]],
    // The Maghreb coast — the Rif and Kabylia headlands, the Gulf of Gabès
    [[-5.95,35.90],[-5.20,35.60],[-4.30,35.20],[-3.00,35.30],[-1.80,35.10],[-0.60,35.75],
     [0.20,36.00],[1.50,36.55],[2.90,36.80],[4.60,36.90],[5.80,36.90],[6.90,37.10],
     [8.20,37.05],[9.80,37.35],[10.30,37.20],[10.80,36.80],[10.60,36.10],[11.10,35.25],
     [10.80,34.40],[10.10,33.80],[11.50,33.20],[9.50,33.10],[7.50,33.60],[5.00,34.00],
     [2.00,33.70],[-1.00,33.60],[-3.50,33.70],[-5.30,34.20],[-6.10,34.80]],
    // Crimea, and the Sea of Azov behind it
    [[33.50,46.20],[35.20,46.20],[36.60,45.45],[35.90,45.00],[35.40,44.95],[34.70,44.75],
     [33.60,44.40],[33.40,44.90],[32.50,45.35]],
    // islands
    [[12.45,37.80],[13.30,38.05],[14.40,38.05],[15.25,38.30],[15.65,38.25],[15.10,37.35],
     [15.30,36.70],[14.50,36.80],[12.65,37.55]],                            // Sicily
    [[8.20,41.10],[9.20,41.25],[9.80,40.90],[9.65,40.10],[9.60,39.15],[9.05,39.20],
     [8.40,39.10],[8.45,40.00],[8.20,40.60]],                               // Sardinia
    [[8.60,42.95],[9.35,42.70],[9.55,42.15],[9.40,41.40],[8.80,41.60],[8.65,42.30]],  // Corsica
    [[23.55,35.55],[24.50,35.60],[25.75,35.35],[26.30,35.30],[25.70,35.00],[24.70,34.95],
     [23.60,35.20]],                                                        // Crete
    [[32.30,35.15],[33.60,35.35],[34.60,35.70],[34.05,34.95],[32.90,34.65],[32.35,34.75]], // Cyprus
    [[24.80,40.65],[25.30,40.50],[24.90,40.35],[24.55,40.50]],              // Thasos
    [[19.65,39.80],[20.10,39.65],[19.85,39.35],[19.60,39.55]],              // Corfu
    [[-1.30,49.95],[-0.55,49.75],[-1.10,49.55],[-1.55,49.75]],              // the Channel Isles, loosely
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
    { r:0.55, pts:[[-5.2,57.2],[-4.2,57.0],[-3.6,56.8]] },                 // the Highlands
    { r:0.30, pts:[[-2.35,54.6],[-2.05,53.5]] },                           // the Pennines
    { r:0.30, pts:[[-4.0,53.05],[-3.5,52.3]] },                            // the Welsh mountains
    { r:0.55, pts:[[20.9,39.9],[21.4,39.2],[22.0,38.6]] },                 // Pindus
    { r:0.40, pts:[[23.8,41.6],[25.6,41.5]] },                             // Rhodope
    { r:0.50, pts:[[19.9,43.4],[21.3,42.7],[22.2,42.3]] },                 // the Serbian highlands
    { r:0.50, pts:[[33.5,41.1],[36.5,40.9],[39.5,40.7],[41.5,41.2]] },     // the Pontic range
    { r:0.40, pts:[[-6.2,38.4],[-3.4,38.5]] },                             // Sierra Morena
    { r:0.45, pts:[[-2.6,41.7],[-1.6,40.9],[-0.9,40.3]] },                 // the Iberian System
    { r:0.35, pts:[[7.1,48.3],[8.2,48.1]] },                               // Vosges and the Black Forest
    { r:0.35, pts:[[15.4,50.7],[17.2,50.2]] },                             // the Sudetes
    { r:0.60, pts:[[-5.5,32.5],[-2.5,33.3],[1.0,35.2],[5.0,36.2],[7.5,36.4]] },  // the Atlas
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
    this.standing = ECON.PEASANT_LEVY;  // the peasant levy, always under arms
    this.mobil = 0;         // extra mobilisation ordered on top of it
    this.mustered = 0;      // men being raised a second, and paid for
    this.tiles = 0; this.peak = 0; this.sumX = 0; this.sumY = 0;
    this.border = new Set();   // own land touching foreign/open land
    this.coast  = new Set();   // own land touching water
    // `st` holds the *plots* a lord has built on; `cnt` holds how many works
    // actually stand there. They used to be the same number, because a plot
    // held exactly one work. Now a plot can be built up — see STACK_MAX — so a
    // realm with six farm plots may be running fifteen farms, and every rule
    // that means "how many farms" has to read `cnt` while everything that means
    // "where are they" keeps reading `st`.
    this.st = { 1:new Set(), 2:new Set(), 3:new Set(), 4:new Set(), 5:new Set(), 6:new Set(), 7:new Set() };
    this.cnt = { 1:0, 2:0, 3:0, 4:0, 5:0, 6:0, 7:0 };
    this.bought = { 1:0, 2:0, 3:0, 4:0, 5:0, 6:0, 7:0 };  // for price escalation
    this.allies = new Set();
    this.pact = new Map();     // id -> the hour the oath lapses
    this.grudge = new Map();   // id -> heat; decays. drives bot target choice
    this.attacks = [];
    this.traitor = 0;
    this.nextThink = 0;
    this.tradeAt = 0;
    this.home = null;      // seat of power on the Europe map, if any
    this.roads = [];       // { a, b } — both ends are works of ours
    this.net = null;       // cached: tile -> component id, and each size
    this.netDirty = true;
    this.siegeAt = 0;
    this.siegeAim = -1; this.siegeAimAt = 0;
    // bot temperament
    const r = g.rand;
    this.aggr  = 0.25 + r() * 0.7;   // how readily it attacks
    this.greed = 0.25 + r() * 0.7;   // build vs. levy
    this.loyal = 0.2  + r() * 0.75;  // alliance behaviour
    // Every realm is run the same way. What differs is temperament above and
    // whether it has troubled to get ready before it marches.
    this.w = { farm:START_W.farm, forge:START_W.forge, trade:START_W.trade, works:START_W.works };
    this.restW = { farm:START_W.farm, forge:START_W.forge, trade:START_W.trade, works:START_W.works };
    this.standing = ECON.PEASANT_LEVY;
    this.wantWar = false;   // preparing to fight: mobilised, arming, saving
  }
  get cx(){ return this.tiles ? this.sumX / this.tiles : 0; }
  get cy(){ return this.tiles ? this.sumY / this.tiles : 0; }
  get pop(){ return this.civ + this.levy + this.sold; }
  // What holds ground: soldiers, plus levies who can at least stand on a wall,
  // scaled by how well the host is equipped.
  // What holds ground: soldiers at their own quality, and the levy at its own —
  // which is a different and usually worse number, see below.
  get density(){
    if (!this.tiles) return 0;
    return (this.sold * this.quality
          + this.levy * ECON.LEVY_WORTH * this.levyQuality) / this.tiles;
  }
  get equip(){ return this.sold > 0 ? Math.min(1, this.arms / this.sold) : 1; }
  get quality(){ return ECON.UNARMED + (1 - ECON.UNARMED) * this.equip; }

  // Arms belong to the realm, not to the man. The soldiers are equipped first —
  // they are the professionals and the armoury is theirs — and the levy is
  // handed whatever is left over. So a peasant cannot arm himself, and yet the
  // forges still decide what he is worth: the same levy raised behind full
  // forges is a real force, and raised on an empty armoury is a mob with
  // billhooks. Without this the arms economy stopped at the edge of the levy,
  // and a realm could raise a hundred thousand peasants and lose nothing by
  // never building a forge for them.
  get levyArms(){ return Math.max(0, this.arms - this.sold); }
  get levyEquip(){ return this.levy > 0 ? Math.min(1, this.levyArms / this.levy) : 0; }
  get levyQuality(){ return ECON.UNARMED + (1 - ECON.UNARMED) * this.levyEquip; }
  get jobCap(){
    const t = this.cnt[B_TOWN], h = this.cnt[B_HARBOR];
    return {
      farm:  this.cnt[B_FARM]  * ECON.JOBS_FARM,
      forge: this.cnt[B_FORGE] * ECON.JOBS_FORGE,
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
  // Every work of ours, in one list — the nodes of the road network.
  get nodes(){
    const out = [];
    for (const b of B_ALL) for (const t of this.st[b]) out.push(t);
    return out;
  }

  // Which works are joined to which, following the roads we have laid. Cached
  // until a road or a work changes, because it is read every tick.
  // Roads are not built, they appear. Every work links to the nearest works it
  // can reach, as a minimum spanning forest — so the network is a consequence
  // of where you chose to build, not a thing to micromanage.
  layout(){
    const nodes = this.nodes;
    const W = this.g.W;
    if (nodes.length < 2){ this.roads = []; return nodes; }
    const pairs = [];
    for (let i = 0; i < nodes.length; i++){
      for (let j = i + 1; j < nodes.length; j++){
        const a = nodes[i], b = nodes[j];
        const d = Math.hypot(a % W - b % W, ((a / W) | 0) - ((b / W) | 0));
        if (d <= ECON.ROAD_MAX) pairs.push([d, i, j]);
      }
    }
    pairs.sort((x, y) => x[0] - y[0]);
    const parent = nodes.map((_, i) => i);
    const find = i => { while (parent[i] !== i){ parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const roads = [];
    for (const [, i, j] of pairs){
      const a = find(i), b = find(j);
      if (a === b) continue;              // already joined — one road is enough
      parent[a] = b;
      roads.push({ a: nodes[i], b: nodes[j] });
    }
    this.roads = roads;
    return nodes;
  }

  network(){
    if (!this.netDirty && this.net) return this.net;
    const nodes = this.layout();
    const idx = new Map();
    nodes.forEach((t, i) => idx.set(t, i));
    const parent = nodes.map((_, i) => i);
    const find = i => { while (parent[i] !== i){ parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    for (const r of this.roads){
      const a = find(idx.get(r.a)), b = find(idx.get(r.b));
      if (a !== b) parent[a] = b;
    }
    const size = new Map(), hasTown = new Map();
    nodes.forEach((t, i) => {
      const root = find(i);
      size.set(root, (size.get(root) || 0) + 1);
      if (this.g.build[t] === B_TOWN) hasTown.set(root, true);
    });
    const comp = new Map();          // node tile -> { size, fed }
    nodes.forEach((t, i) => {
      const root = find(i);
      comp.set(t, { size: size.get(root), fed: !!hasTown.get(root) });
    });
    this.netDirty = false;
    return (this.net = { comp, nodes });
  }

  // Trade is worth more the better connected the works producing it are — this
  // is what lets a small, well-joined realm out-earn a sprawling one.
  get linkBonus(){
    const { comp } = this.network();
    let sum = 0, n = 0;
    for (const b of [B_TOWN, B_HARBOR]){
      for (const t of this.st[b]){
        const c = comp.get(t);
        sum += Math.min(ECON.ROAD_LINK_CAP, (c ? c.size - 1 : 0) * ECON.ROAD_LINK);
        n++;
      }
    }
    return n ? sum / n : 0;
  }

  // Ground within reach of a network that has a town on it to feed from.
  supplied(x, y){
    const { comp } = this.network();
    const R2 = ECON.SUPPLY_R * ECON.SUPPLY_R;
    for (const [t, c] of comp){
      if (!c.fed) continue;
      const dx = (t % this.g.W) - x, dy = ((t / this.g.W) | 0) - y;
      if (dx * dx + dy * dy <= R2) return true;
    }
    return false;
  }

  get committed(){ let s = 0; for (const a of this.attacks) s += a.troops; return s; }
  // What this realm could run in total, if it ran nothing else.
  get worksCap(){
    return ECON.WORKS_BASE
         + ECON.WORKS_ROOT * Math.sqrt(Math.max(0, this.tiles))
         + ECON.WORKS_PER_TOWN * this.cnt[B_TOWN];
  }
  // ...and how many of one kind. Harbours answer to the shore rather than the
  // ceiling, since a landlocked realm has no use for the allowance.
  capOf(type){
    const key = BUILDS[type].key;
    let n = this.worksCap * (ECON.CAP_SHARE[key] || 0.1);
    if (type === B_HARBOR) n = Math.min(n, this.coast.size / ECON.CAP_COAST);
    return Math.max(ECON.CAP_MIN, Math.floor(n));
  }
  atCap(type){ return this.cnt[type] >= this.capOf(type); }
  // The price of the next one, set by how full the ceiling already is. An empty
  // realm builds at the listed price; one at its limit pays several times over;
  // and raising the ceiling brings the price back down, so the way to build
  // cheaply is to grow rather than to save.
  costOf(type){
    const cap = this.capOf(type);
    const fill = Math.min(1, this.cnt[type] / Math.max(1, cap));
    return Math.round(BUILDS[type].cost * Math.pow(1 + ECON.COST_FILL * fill, ECON.COST_POW));
  }
}

// What a host's armoury is worth on the roll. Quantised to 5% steps so the
// number a player reads in the panel — "40% armed" — maps to a figure they can
// reason about: 0.40 on the die, against a full armoury's 1.00.
function armAdvantage(p){
  return Math.min(CFG.ROLL_CAP, Math.floor(p.equip / CFG.ROLL_STEP) * CFG.ROLL_STEP);
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
  // Does this field touch ground the attacker actually holds?
  touchesOwner(t){
    const g = this.g, W = g.W, x = t % W, y = (t / W) | 0;
    return (x > 0       && g.owner[t - 1] === this.owner)
        || (x < W - 1   && g.owner[t + 1] === this.owner)
        || (y > 0       && g.owner[t - W] === this.owner)
        || (y < g.H - 1 && g.owner[t + W] === this.owner);
  }
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
    // Ground the attacker cannot supply costs more to take. This is what makes
    // a castle on a road worth storming: cut the network and the front in
    // front of it goes hungry.
    const sup = this.supplyMul();
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
  // Whether this assault is in supply, judged once a tick at the head of the
  // advance rather than per field — walking the node list for every tile taken
  // would cost more than the rest of the simulation put together.
  supplyMul(){ return this._sup || 1; }
  refreshSupply(){
    const g = this.g, me = g.players[this.owner];
    const head = this.heap.peek();
    if (head < 0){ this._sup = 1; this._inSupply = true; return; }
    const ok = me.supplied(head % g.W, (head / g.W) | 0);
    this._inSupply = ok;
    this._sup = ok ? 1 : ECON.UNSUPPLIED;
  }

  tick(){
    const g = this.g, me = g.players[this.owner];
    if (!me.alive){ this.dead = true; return; }
    this.refreshSupply();
    // Two separate limits. The levy pool is how much force is available to
    // spend; the tile allowance is how fast a front of that width can actually
    // advance. A huge host funnelled through a narrow border still crawls.
    this.pool = Math.min(this.pool + Math.max(CFG.ATTACK_FLOOR, this.troops * CFG.ATTACK_RATE),
                         this.troops * 0.5 + 400);
    const host = Math.min(CFG.HOST_CAP, Math.max(1, Math.sqrt(this.troops / CFG.HOST_REF)));
    let allow = Math.max(CFG.TILE_FLOOR, Math.ceil(this.heap.size * CFG.TILE_RATE * host
                          * (this._inSupply ? 1 : ECON.UNSUPPLIED_RATE)));
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
      // A front has to stay attached to the realm behind it. A field is queued
      // while it touches our ground, but the defender can retake that ground
      // before we pop it — and without this the advance carried on converting
      // fields deep inside the enemy with nothing joining them to us, which is
      // what "attacking while they attack goes behind enemy lines" was. Drop it
      // from `queued` too, so it can be picked up again if the front returns.
      if (!this.touchesOwner(t)){ this.heap.pop(); this.queued.delete(t); continue; }
      const c = this.cost(t);
      if (c > this.troops){ this.finish(); return; }                 // spent
      if (c > this.pool) return;                                     // next tick

      // Open ground is claimed, not fought for: the men spent on it settle it
      // and return to the realm as civilians, less a share lost to the march.
      if (this.target < 0){
        this.heap.pop();
        this.troops -= c; this.pool -= c; allow--; this.taken++;
        me.civ += c * (1 - CFG.SETTLE_LOSS);
        g.setOwner(t, this.owner);
        this.probe(t, key);
        continue;
      }

      const d = g.players[this.target];
      const gap = (g.rand() + armAdvantage(me)) - (g.rand() + armAdvantage(d));
      const swing = Math.max(-1, Math.min(1, gap)) * CFG.ROLL_SWING;
      // Both sides bleed, and the worse you lost the exchange the more it cost
      // you. A narrow win is nearly as expensive as a narrow loss; a rout is
      // cheap for the winner and ruinous for the loser.
      const atkLoss = c * (1 - swing);
      const defLoss = c * CFG.DEF_LOSS * (1 + swing);
      this.troops -= atkLoss; this.pool -= atkLoss; allow--;
      g.bleed(d, defLoss);
      d.grudge.set(this.owner, (d.grudge.get(this.owner) || 0) + 1.5);

      if (gap > 0){                       // the field falls
        this.heap.pop();
        this.taken++;
        g.setOwner(t, this.owner);
        this.probe(t, key);
      } else {                            // thrown back — try further along
        this.heap.pop();
        this.heap.push(t, key + c * CFG.ROLL_REPULSE);
      }
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
    // The year the first banner goes up. A match can be set in any year, and
    // the houses it raises are named for it.
    this.startYear = o.year == null ? CFG.EPOCH_YEAR : o.year | 0;
    this.phase = 'place';                 // place -> war -> done
    this.players = []; this.humanId = -1;
    this.attacks = []; this.boats = []; this.sieges = []; this.caravans = [];
    this.events = []; this.dirty = []; this.dirtyAll = true; this.asks = [];
    this.buildDirty = [];   // works raised or razed since the last broadcast
    this.winner = -1; this.leader = -1; this.leadShare = 0; this.aliveCount = 0;
    this.terrain = new Uint8Array(this.N);
    this.owner   = new Int16Array(this.N).fill(-1);
    this.build   = new Uint8Array(this.N);
    this.elev    = new Uint8Array(this.N);
    this.castleField = new Uint8Array(this.N);
    this.site = new Int32Array(this.N).fill(-1);   // tile -> the plot the work stands on
    this.stack = new Uint8Array(this.N);           // plot -> how many works are on it
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
        // Warp the sample point in degrees, at two scales. The coarse one bends
        // the coast into bays and headlands; the fine one frays it at tile
        // scale, which is what actually kills the straight polygon edge — a
        // single coarse warp displaces a long edge *coherently*, so it stays
        // straight and merely leans. The coarse amplitude has to stay well
        // under the width of the narrowest real feature: at 0.9° it punched
        // clean through Italy and the Anatolian coast, both barely 2° wide.
        const wx = (fbm(x / 26, y / 26, s + 17, 4, 0.5) - 0.5) * 0.42
                 + (fbm(x /  7, y /  7, s + 23, 3, 0.5) - 0.5) * 0.26;
        const wy = (fbm(x / 26, y / 26, s + 91, 4, 0.5) - 0.5) * 0.42
                 + (fbm(x /  7, y /  7, s + 53, 3, 0.5) - 0.5) * 0.26;
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
        // A range whose width is constant along its length renders as a smooth
        // lozenge — the "sausage" look. Wobble the reach so the spine swells
        // into massifs and pinches into saddles, and the crest breaks up.
        const wob = 0.72 + fbm(x / 13, y / 13, s + 700, 3, 0.55) * 0.56;
        let rise = 0;
        for (const rg of EU.ranges){
          const reach = rg.r * 1.6 * wob;
          for (let j = 1; j < rg.pts.length; j++){
            const d = segDist(lon, lat, rg.pts[j-1][0], rg.pts[j-1][1], rg.pts[j][0], rg.pts[j][1]);
            if (d < reach){
              const v = Math.max(0, 1 - d / reach);
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
    // A plot changes hands with everything standing on it — all fifteen farms
    // if fifteen is what was there. Moving the plot but not its count would
    // quietly destroy works on one side and mint them on the other.
    const onPlot = b ? Math.max(1, this.stack[t]) : 0;
    if (from >= 0){
      const p = this.players[from];
      p.tiles--; p.sumX -= t % this.W; p.sumY -= (t / this.W) | 0;
      p.border.delete(t); p.coast.delete(t);
      if (b){ p.st[b].delete(t); p.cnt[b] = Math.max(0, p.cnt[b] - onPlot); p.netDirty = true; this.roadDirty = true; }
    }
    this.owner[t] = to;
    if (to >= 0){
      const p = this.players[to];
      p.tiles++; p.sumX += t % this.W; p.sumY += (t / this.W) | 0;
      if (b){ p.st[b].add(t); p.cnt[b] += onPlot; p.netDirty = true; this.roadDirty = true; }
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

  // Deal `n` distinct starting fields, spread over the whole map.
  //
  // Seating lord-by-lord with `pickSeat` cannot promise this: it samples at
  // random and gives up after a fixed number of tries, so with ninety lords on
  // a crowded map it starts returning whatever it last looked at — which may
  // already be taken. This walks a shuffled list of every valid field instead,
  // so a field can be handed out at most once by construction, and relaxes the
  // spacing in passes rather than failing: a full map seats everyone closer
  // together instead of seating two lords on the same ground.
  //
  // Deterministic given the match seed, so the server and any reconnecting
  // client build the same world.
  pickSeats(n){
    if (n <= 0) return [];
    const valid = [];
    for (let t = 0; t < this.N; t++){
      if (this.terrain[t] < T_PLAIN || this.terrain[t] === T_PEAK) continue;
      if (this.owner[t] >= 0) continue;
      valid.push(t);
    }
    // Fisher-Yates on the match's own RNG — same seed, same shuffle, everywhere.
    for (let i = valid.length - 1; i > 0; i--){
      const j = (this.rand() * (i + 1)) | 0;
      [valid[i], valid[j]] = [valid[j], valid[i]];
    }
    const W = this.W, out = [], px = [], py = [];
    // Start from the spacing an even scatter would allow, then halve it each
    // pass until everyone has a home.
    let space = Math.max(4, Math.sqrt(valid.length / Math.max(1, n)) * 0.80);
    const used = new Set();
    for (let pass = 0; pass < 7 && out.length < n; pass++){
      const min2 = space * space;
      for (let i = 0; i < valid.length && out.length < n; i++){
        const t = valid[i];
        if (used.has(t)) continue;
        const x = t % W, y = (t / W) | 0;
        let ok = true;
        for (let k = 0; k < px.length; k++){
          const dx = x - px[k], dy = y - py[k];
          if (dx * dx + dy * dy < min2){ ok = false; break; }
        }
        if (!ok) continue;
        used.add(t); out.push(t); px.push(x); py.push(y);
      }
      space /= 2;
    }
    // Last resort: the map simply has fewer usable fields than lords asked for.
    // Hand out what is left rather than repeating a field.
    for (let i = 0; i < valid.length && out.length < n; i++){
      if (!used.has(valid[i])){ used.add(valid[i]); out.push(valid[i]); }
    }
    return out;
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
  // The square of ground a work would stand on, anchored at the clicked field.
  // Returns null if any of it runs off the map.
  footprint(tile, size){
    const W = this.W, x = tile % W, y = (tile / W) | 0;
    if (x + size > W || y + size > this.H) return null;
    const out = [];
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) out.push((y + j) * W + x + i);
    return out;
  }

  // Is this field clear to build on — land, and nothing already standing?
  clear(tile){ return this.isLand(tile) && this.site[tile] < 0; }

  canPlace(ownerId, tile, type){
    const p = this.players[ownerId], B = BUILDS[type];
    // The ceiling and the purse are asked first: they apply whether the work is
    // going on fresh ground or onto a plot that already carries its own kind.
    const afford = () => {
      if (p.atCap(type)) return `your realm can run no more than ${p.capOf(type)} — grow it, or raise a town`;
      if (p.ducats < p.costOf(type)) return 'not enough coin';
      return null;
    };

    // Building *up* rather than out: a plot already carrying this kind of work
    // takes another onto the same ground. Checked before the footprint rules,
    // because those exist to stop two works sharing a field — and here that is
    // exactly what is wanted.
    if (this.build[tile] === type && this.owner[tile] === ownerId){
      if (this.stack[tile] >= ECON.STACK_MAX)
        return `no more than ${ECON.STACK_MAX} may stand on one plot`;
      return afford();
    }

    const cells = this.footprint(tile, B.size);
    if (!cells) return 'there is not room for it there';
    for (const t of cells){
      if (this.owner[t] !== ownerId) return `a ${B.name.toLowerCase()} needs ${B.size}×${B.size} of your own ground`;
      if (!this.isLand(t)) return 'it cannot be built on water';
      if (this.site[t] >= 0) return 'something already stands there';
    }
    if (B.needCoast && !cells.some(t => p.coast.has(t))) return 'a harbour must sit on the shore';
    return afford();
  }

  place(ownerId, tile, type){
    const err = this.canPlace(ownerId, tile, type);
    if (err) return err;
    const p = this.players[ownerId], B = BUILDS[type];
    p.ducats -= p.costOf(type); p.bought[type]++; p.cnt[type]++;

    // Adding to a plot that already carries this kind: no new ground is taken
    // and no road changes, only the count on the plot goes up.
    if (this.build[tile] === type){
      this.stack[tile]++;
      this.dirty.push(tile); this.buildDirty.push(tile);
      return null;
    }

    const cells = this.footprint(tile, B.size);
    for (const t of cells){ this.site[t] = tile; this.dirty.push(t); }
    this.build[tile] = type; this.stack[tile] = 1;
    p.st[type].add(tile); p.netDirty = true; this.roadDirty = true;
    if (type === B_CASTLE) this.stampCastle(tile, 1);
    this.dirty.push(tile); this.buildDirty.push(tile);
    return null;
  }

  raze(tile){
    const b = this.build[tile];
    if (!b) return;
    const o = this.owner[tile];
    // Razing a plot takes down everything standing on it, not one of the pile.
    if (o >= 0){
      const p = this.players[o];
      p.cnt[b] = Math.max(0, p.cnt[b] - Math.max(1, this.stack[tile]));
      p.st[b].delete(tile); p.netDirty = true; this.roadDirty = true;
    }
    this.stack[tile] = 0;
    if (b === B_CASTLE) this.stampCastle(tile, -1);
    const cells = this.footprint(tile, BUILDS[b].size) || [tile];
    for (const t of cells){ if (this.site[t] === tile){ this.site[t] = -1; this.dirty.push(t); } }
    this.build[tile] = 0;
    this.dirty.push(tile); this.buildDirty.push(tile);
  }

  // ---------------------------------------------------------------- caravans
  // Wagons run the roads on their own, carrying goods between works and paying
  // out when they arrive. The player builds the works; the trade takes care of
  // itself.
  stepCaravans(dt){
    for (const c of this.caravans){
      if (c.dead) continue;
      const p = this.players[c.owner];
      if (!p.alive || this.owner[c.b] !== c.owner || this.owner[c.a] !== c.owner){
        c.dead = true; continue;                 // the road under it is gone
      }
      const bx = c.b % this.W, by = (c.b / this.W) | 0;
      const dx = bx - c.x, dy = by - c.y, d = Math.hypot(dx, dy);
      const step = ECON.CARAVAN_SPEED * dt;
      if (d <= step){
        const paid = ECON.CARAVAN_VALUE * (1 + p.linkBonus);
        p.ducats += paid;
        p.vanPaid = (p.vanPaid || 0) + paid;   // what the roads have actually earned
        c.dead = true;
      } else {
        c.x += dx / d * step; c.y += dy / d * step;
      }
    }
    if (this.caravans.length) this.caravans = this.caravans.filter(c => !c.dead);
  }

  sendCaravans(dt){
    this._vanT = (this._vanT || 0) + dt;
    if (this._vanT < 1) return;
    this._vanT = 0;
    if (this.caravans.length > 400) return;
    for (const p of this.players){
      if (!p.alive || !p.roads.length) continue;
      if (this.time < (p.vanAt || 0)) continue;
      p.vanAt = this.time + ECON.CARAVAN_EVERY / Math.min(8, p.roads.length) + this.rand();
      // a busy network puts several wagons on the road at once
      const send = Math.min(3, 1 + (p.roads.length / 10) | 0);
      for (let k = 0; k < send; k++){
        const r = p.roads[(this.rand() * p.roads.length) | 0];
        const flip = this.rand() < 0.5;
        const a = flip ? r.b : r.a, b = flip ? r.a : r.b;
        this.caravans.push({ owner: p.id, a, b, x: a % this.W, y: (a / this.W) | 0, dead: false });
      }
    }
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
          // Same rule as a capture below: your own losses always reach you, two
          // strangers sinking each other in a far sea are throttled. Left open
          // these alone were 81% of the chronicle.
          const ours = g.owner === this.humanId || prey.owner === this.humanId;
          const say = ours || this.time >= (this.seaNewsAt || 0);
          if (say && !ours) this.seaNewsAt = this.time + ECON.SEA_NEWS_EVERY;
          if (prey.hp <= 0){ prey.dead = true; if (say) this.log(`${this.players[prey.owner].name} loses a war galley`, 'war', prey.owner); }
          if (g.hp <= 0){ g.dead = true; if (say) this.log(`${this.players[g.owner].name} loses a war galley`, 'war', g.owner); }
        } else {
          prey.dead = true;
          // Anything happening to your own ships is always news. Two strangers
          // trading blows in a far sea is not: unfiltered, these were 61% of
          // every message in the log — 245 of 400 — and they buried the sixteen
          // realms that fell and the nine oaths sworn in the same span. So the
          // wider sea war is throttled rather than silenced, which also keeps
          // it working on the server, where there is no single human to test
          // against and an ownership filter would mute the sea completely.
          const mine_ = g.owner === this.humanId || prey.owner === this.humanId;
          const tell = mine_ || this.time >= (this.seaNewsAt || 0);
          if (tell && !mine_) this.seaNewsAt = this.time + ECON.SEA_NEWS_EVERY;
          if (prey.kind === 'trade'){
            // a taken trader is plunder, not just a sinking
            mine.ducats += CFG.PRIZE;
            if (tell) this.log(`A galley of ${mine.name} takes a trader of ${this.players[prey.owner].name}`, 'war', g.owner);
          } else if (tell){
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
      if (!p.alive || p.cnt[B_HARBOR] === 0) continue;
      if (this.time < p.tradeAt) continue;
      p.tradeAt = this.time + 14 / Math.min(4, p.cnt[B_HARBOR]) + this.rand() * 6;
      const partners = this.players.filter(q =>
        q.alive && q.id !== p.id && q.cnt[B_HARBOR] > 0 && !this.atWar(p.id, q.id));
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
    if (!p.cnt[B_SIEGE]) return 'you have no Siege Works';
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
        if (!q.alive || q.id === s.owner || !q.cnt[B_TOWER]) continue;
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
  power(p){ return p.tiles + p.sold / 25 + p.pop / 90 + p.cnt[B_TOWN] * 30; }

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

  // The year the realm has reached. Everything that wants a date asks for this
  // rather than doing its own arithmetic on `time`.
  get year(){ return this.startYear + Math.floor(this.time / CFG.YEAR_SECS); }

  // Where a lord sits, in degrees — what the name stock and the region bands
  // are keyed on.
  seatDegrees(tile){
    const x = tile % this.W, y = (tile / this.W) | 0;
    return [EU.lon0 + (x + 0.5) / this.W * (EU.lon1 - EU.lon0),
            EU.lat1 - (y + 0.5) / this.H * (EU.lat1 - EU.lat0)];
  }
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
    // Site new works within reach of the ones we already hold, so a road forms
    // and the network compounds. Scattering them at random across the realm
    // built the same number of works for a fraction of the trade.
    const near = (anchor, type) => {
      const ax = anchor % this.W, ay = (anchor / this.W) | 0;
      for (let k = 0; k < 34; k++){
        const r = 5 + this.rand() * (ECON.ROAD_MAX * 0.7 - 5);
        const a = this.rand() * Math.PI * 2;
        const x = Math.round(ax + Math.cos(a) * r), y = Math.round(ay + Math.sin(a) * r);
        if (x < 0 || y < 0 || x >= this.W || y >= this.H) continue;
        const t = y * this.W + x;
        if (!this.canPlace(p.id, t, type)) return t;
      }
      return -1;
    };
    // Building up on a plot already held is cheaper in ground than clearing a
    // new 3x3, and it keeps the realm's works together on the road network. A
    // lord tries it first, and only goes looking for fresh ground when every
    // plot of that kind is full. Without this the AI would never build up at
    // all — it only ever asked for empty ground.
    const onExisting = type => () => {
      const plots = [...p.st[type]];
      for (let k = 0; k < 6 && plots.length; k++){
        const t = plots[(this.rand() * plots.length) | 0];
        if (this.stack[t] < ECON.STACK_MAX && !this.canPlace(p.id, t, type)) return t;
      }
      return -1;
    };
    const interior = type => () => {
      const built = onExisting(type)();
      if (built >= 0 && this.rand() < 0.55) return built;   // often, not always
      const nodes = p.nodes;
      if (nodes.length){
        const t = near(nodes[(this.rand() * nodes.length) | 0], type);
        if (t >= 0) return t;
      }
      const spread = Math.max(4, Math.sqrt(p.tiles) * 0.9);
      for (let k = 0; k < 34; k++){
        const x = Math.round(p.cx + (this.rand() - 0.5) * spread * 2);
        const y = Math.round(p.cy + (this.rand() - 0.5) * spread * 2);
        if (x < 0 || y < 0 || x >= this.W || y >= this.H) continue;
        const t = y * this.W + x;
        if (!this.canPlace(p.id, t, type)) return t;
      }
      return -1;
    };
    const fromSet = (set, type) => {
      for (let k = 0; k < 12; k++){
        const t = pickFrom(set, this.rand);
        if (t >= 0 && !this.canPlace(p.id, t, type)) return t;
      }
      return -1;
    };
    const put = (type, get) => {
      if (p.ducats < p.costOf(type)) return false;
      const t = get(); if (t < 0) return false;
      return this.place(p.id, t, type) === null;
    };
    const T = p.tiles;
    const cap = p.jobCap;

    // A lord that has filled its ceiling has one useful thing left to build: a
    // town, which is what raises the ceiling. Without this the AI spends the
    // rest of the match asking for farms it cannot have and never works out
    // why — it would sit at its limit with a full treasury, because every
    // branch below leads to a kind of work it is already capped on.
    const wants = [B_FARM, B_FORGE, B_TOWN].filter(b => !p.atCap(b));
    if (!wants.length && !p.atCap(B_TOWN) && put(B_TOWN, interior(B_TOWN))) return;
    // Build where the priorities say workers should go but there is no work for
    // them: a priority with no building behind it employs nobody.
    // Answer the shortage you actually have. Reading only the worker-demand gap
    // left lords starving with fields to spare and marching half-armed with
    // coin in the treasury: the gap said "jobs are staffed", the realm said
    // "there is no food and no kit".
    if (p.food < 0 && put(B_FARM, interior(B_FARM))) return;
    // Forges when the *host* is short of kit, not merely the soldiers. A realm
    // can be fully armed on paper and still be marching a great levy out with
    // nothing, because the soldiers took the armoury first.
    const underArmed = p.equip < 0.7 || (p.levy > 400 && p.levyEquip < 0.35);
    if (p.sold > 200 && underArmed && put(B_FORGE, interior(B_FORGE))) return;

    const starved = SECTORS
      .map(sct => ({ sct, gap: p.w[sct] * p.civ - (cap[sct] || 0) }))
      .sort((a, b) => b.gap - a.gap)[0];
    if (starved && starved.gap > 40){
      if (starved.sct === 'farm'  && put(B_FARM,  interior(B_FARM))) return;
      if (starved.sct === 'forge' && put(B_FORGE, interior(B_FORGE))) return;
      if ((starved.sct === 'trade' || starved.sct === 'works') && put(B_TOWN, interior(B_TOWN))) return;
    }
    // An army fighting beyond supply pays half again for every field. If our
    // own frontier has gone out of reach of the network, a town near the front
    // is worth more than anything else we could build.
    if (p.attacks.length && p.nodes.length){
      const front = pickFrom(p.border, this.rand);
      if (front >= 0 && !p.supplied(front % this.W, (front / this.W) | 0)){
        const t = fromSet(p.border, B_TOWN);
        if (t >= 0 && put(B_TOWN, () => t)) return;
      }
    }
    if (p.idle > 60 && put(B_TOWN, interior(B_TOWN))) return;
    if (p.ducats > 1500 * (1.2 - p.greed) && p.cnt[B_CASTLE] < T / 240 && put(B_CASTLE, () => fromSet(p.border, B_CASTLE))) return;
    if (p.coast.size > 6 && p.cnt[B_HARBOR] < 1 + T / 650 && put(B_HARBOR, () => fromSet(p.coast, B_HARBOR))) return;
    if (T > 340 && p.ducats > 5200 && p.cnt[B_SIEGE] < 2 && put(B_SIEGE, interior(B_SIEGE))) return;
    if (p.ducats > 4200 && p.cnt[B_TOWER] < 1 + T / 850 && put(B_TOWER, interior(B_TOWER))) return;
    if (p.ducats > 2800 && put(B_TOWN, interior(B_TOWN))) return;
  }

  botSiege(p, ring){
    if (!p.cnt[B_SIEGE]) return false;
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
      if (!this.clear(t)) continue;
      let facing = 0;
      const n = this.neighbors(t, nb);
      for (let i = 0; i < n; i++) if (this.owner[nb[i]] === target) facing++;
      if (facing > bestFacing){ bestFacing = facing; tile = t; }
    }
    if (tile < 0 || !bestFacing) return false;
    if (this.raise(p.id, kind, tile) !== null) return false;
    p.siegeAt = this.time + 26 + this.rand() * 22;
    p.siegeAim = target;      // storm the ground we just invested
    p.siegeAimAt = this.time + 70;
    return true;
  }

  // A lord with harbours and coin keeps the sea lanes near them. Without this
  // no AI ever built a galley, so the whole naval game only existed if a human
  // happened to buy one.
  botGalley(p){
    if (!p.coast.size || !p.cnt[B_HARBOR]) return false;
    if (p.ducats < 1400) return false;
    const have = this.boats.filter(b => !b.dead && b.kind === 'galley' && b.owner === p.id).length;
    if (have >= Math.min(3, 1 + (p.cnt[B_HARBOR] >> 1))) return false;
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
    // An invasion overseas is a war like any other, so it wants the same
    // preparation — and the preparation is due when the fleet is loaded, not
    // when it beaches: by then the men are at sea and already committed. This
    // was the last door left open, and about a tenth of all wars came through
    // it with no arms and no treasury behind them.
    if (!p.coast.size || p.ducats < 400 || p.sold < 500 || !this.warReady(p)) return false;
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
  // A realm that cannot feed itself moves hands back to the fields. Building a
  // farm only helps if there is coin and room for one; shifting labour works
  // immediately, and is what a steward would actually do.
  botFeed(p, dt){
    if (p.food < 0){
      p.w.farm = Math.min(0.70, p.w.farm + 0.02);
      for (const sct of SECTORS){
        if (sct !== 'farm') p.w[sct] = Math.max(0.05, p.w[sct] - 0.007);
      }
    } else if (p.food > 2){
      // comfortable again — drift back toward how the realm runs at rest
      for (const sct of SECTORS) p.w[sct] += (p.restW[sct] - p.w[sct]) * 0.12;
    }
  }

  // Is this lord in a state to open a war? Men called up and actually come in,
  // arms for them, and coin in hand to keep them there. All three, or it waits.
  warReady(p){
    return p.sold >= ECON.WAR_HOST * p.pop
        && p.equip >= ECON.WAR_EQUIP
        && p.ducats >= ECON.WAR_CHEST;
  }

  botMobilise(p){
    let threat = 0;
    for (const [id, heat] of p.grudge) if (heat > 4) threat += heat;
    for (const a of this.attacks){
      if (a.dead) continue;
      if (a.target === p.id) threat += 12;
      if (a.owner === p.id) threat += 6;
    }
    // A lord mobilises because it is threatened, because it means to fight, or
    // because the free land is nearly gone and it can see what comes next. That
    // last one matters: while there is open ground to take, no lord ever wants
    // a war, so none prepares for one — and they all began mustering only once
    // the map was full, which put the first war nineteen minutes into a match
    // that ends at twenty-five.
    // Full mobilisation is for a war you are in or a war you mean to start.
    // When the free land merely runs out, a realm *arms* — it does not empty
    // its fields. Treating "the land is gone" as a reason for full mobilisation
    // put every lord on a war footing permanently from 72% claimed onward, and
    // since soldiers still eat but no longer farm, a third of them starved.
    const landGone = (this.claimedShare || 0) > ECON.WAR_LOOMS;
    const wanted = (threat > 6 || p.wantWar) ? ECON.WAR_MOBIL
                 : landGone ? ECON.WAR_MOBIL * ECON.ARMING
                 : 0;
    p.mobil += Math.max(-0.05, Math.min(0.05, wanted - p.mobil));
    // arms you cannot forge are arms you must buy time for: if the stockpile is
    // dry, stop drafting men there is no kit for
    if (p.arms < p.levy * 0.15 && p.mobil > 0) p.mobil = Math.max(0, p.mobil - 0.08);
    // A realm that cannot feed its host sends men home. This is the only lever
    // on it: botFeed shuffles *civilians* between sectors and has no reach into
    // the men already under arms, so without this a lord could mobilise itself
    // into a famine and then sit in it. Measured, mobilisation was doubling the
    // starving lords — 19% to 37% — with nothing able to answer.
    if (p.food < 0) p.mobil = Math.max(0, p.mobil - 0.06);
    // Short of kit? Put hands in the forges until there is some — but never
    // while the realm is hungry. Arming and feeding were pulling the same
    // labour in opposite directions, botFeed shoving hands back to the fields
    // while this shoved them into the forges, and the lords starved: 31% of
    // them against 11% before. Answer the shortage you actually have.
    if (p.wantWar && p.equip < ECON.WAR_EQUIP && p.food >= 0){
      p.w.forge = Math.min(0.55, p.w.forge + 0.03);
      p.w.trade = Math.max(0.08, p.w.trade - 0.01);
    }
  }

  botThink(p){
    this.botFeed(p);
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
      // Betrayal is still a war, and wants the same preparation as any other —
      // otherwise it is the one door left open through which a lord can march
      // unarmed and penniless.
      if (this.power(q) < this.power(p) * 0.35 && p.aggr > 0.62 && this.rand() < 0.05
          && this.warReady(p)){
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
      // ground we are already besieging is breached and half-starved — that is
      // where an assault belongs
      if (o >= 0 && o === p.siegeAim && this.time < p.siegeAimAt) w *= 2.2;
      if (w > bestW){ bestW = w; bestT = o; }
    }
    if (bestT === null){ this.botNaval(p); return; }

    // Claiming open ground is not a war: no defenders, no preparation, and the
    // map would never be settled if it needed a war chest.
    if (bestT >= 0){
      // A war on another lord has to be prepared for. If this lord is not
      // ready, it does not abandon the idea — it starts getting ready, which
      // is what mobilisation is for, and comes back to this when it can.
      if (!this.warReady(p)){
        p.wantWar = true;
        return;
      }
      p.wantWar = false;
    }

    // Against another lord, wait and hit hard. Dribbling the levy out in small
    // attacks just feeds a rival who bleeds you back — with few lords left that
    // reads as endless churn and no war ever ends.
    const need = bestT < 0 ? 0.02 : 0.07 + (1 - p.aggr) * 0.05;
    const fit = bestT < 0 ? ready : ready * p.quality;
    if (fit < need || p.sold < 60) return;
    let ratio = bestT < 0 ? 0.5 + p.aggr * 0.25 : 0.62 + p.aggr * 0.33;
    // Keep a garrison if somebody is already at our throat: committing the whole
    // host to an attack while being invaded loses both the attack and the realm.
    let pressed = 0;
    for (const a of this.attacks) if (!a.dead && a.target === p.id) pressed++;
    if (pressed){
      // already committed more than we hold in reserve — see the fight we are
      // in through before starting another
      if (p.committed > p.sold * 1.2) return;
      ratio *= Math.max(0.30, 1 - 0.30 * pressed);
    }
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
                   + p.cnt[B_FARM] * ECON.YIELD_FARM_FOOD * sFarm;
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
    p.armsRate = p.cnt[B_FORGE] * ECON.YIELD_FORGE_ARMS * sForge;
    p.arms += p.armsRate * dt;

    // --- ducats ---
    const income = (p.cnt[B_TOWN] * ECON.YIELD_TOWN_TRADE
                  + p.cnt[B_HARBOR] * ECON.YIELD_HARBOR_TRADE) * sTrade * (1 + p.linkBonus)
                  + p.civ * ECON.TAX_PER_CIV + p.tiles * ECON.DUCAT_PER_TILE;
    let works = 0;
    for (const b of B_ALL) works += p.cnt[b];   // upkeep is paid per work, stacked or not
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
    // Rebuilding the peasant levy is free; everything above it is mustered, and
    // paid for as it is raised. A realm short of coin therefore raises men
    // slowly no matter what it has ordered, which is the whole cost of war.
    // The free peasant levy is the same share for every lord. It was once keyed
    // on a per-lord constant, which was a hidden subsidy: one kind of realm got
    // a free army three times another's. Everything above the peasant levy is
    // mustered and paid for, by everyone, which is what makes going to war a
    // decision with a price rather than a slider.
    const peasants = ECON.PEASANT_LEVY * p.pop;
    const want = Math.max(ECON.PEASANT_LEVY, Math.min(1, p.standing + p.mobil));
    const target = want * p.pop;
    const underArms = p.sold + p.levy;
    p.mustered = 0;
    if (underArms < target){
      let draft = Math.min(p.civ, (target - underArms) * ECON.DRAFT_RATE * dt);
      const free = Math.max(0, Math.min(draft, peasants - underArms));
      const afford = p.ducats * ECON.MUSTER_DRAW * dt / ECON.MUSTER_COST;
      if (draft - free > afford) draft = free + afford;
      const paid = Math.max(0, draft - free);
      p.ducats -= paid * ECON.MUSTER_COST;
      p.mustered = paid / Math.max(dt, 1e-6);   // men bought a second, for the HUD
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
    this.stepCaravans(dt);
    this.sendCaravans(dt);
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
    let alive = 0, best = -1, bestT = 0, held = 0;
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
      held += p.tiles;
      if (p.tiles > bestT){ bestT = p.tiles; best = p.id; }
    }
    this.aliveCount = alive;
    this.leader = best;
    this.leadShare = best >= 0 ? bestT / this.landCount : 0;
    // How much of the map is spoken for. Lords watch this: when the free land
    // is nearly gone they start preparing for the war that must follow, rather
    // than waiting until the last field is taken and only then beginning to
    // muster — which left the first war until nineteen minutes in.
    this.claimedShare = this.landCount ? held / this.landCount : 0;

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
  const pickName = (where) => {
    for (let i = 0; i < 60; i++){
      const n = makeHouseName(g.rand, where, g.startYear);
      if (!names.has(n)){ names.add(n); return n; }
    }
    return makeHouseName(g.rand, where, g.startYear) + ' II';
  };
  // A seat drawn from open land, for the houses that are not one of the great
  // powers — so they are still named for somewhere rather than from nowhere.
  const openSeat = () => {
    for (let i = 0; i < 400; i++){
      const t = (g.rand() * g.N) | 0;
      if (g.terrain[t] >= T_PLAIN && g.terrain[t] !== T_PEAK) return t;
    }
    return -1;
  };
  const levelStart = (l) => {
    l.w = { farm:START_W.farm, forge:START_W.forge, trade:START_W.trade, works:START_W.works };
    l.standing = ECON.PEASANT_LEVY; l.mobil = 0;
  };
  if (opts.human){
    used.add(opts.human.color); names.add(opts.human.name);
    const h = g.addLord(opts.human.name, opts.human.color, false);
    g.humanId = h.id;
    // the player sets their own priorities with the sliders — start them level
    levelStart(h);
  }
  // Seats held for human players in an online match. These are *extra* lords,
  // created before the AI and never counted as AI.
  //
  // The server used to make `bots` lords and then convert the first few into
  // the humans who had joined, which meant the AI count silently came out short
  // by however many people were playing — ask for 73 with two humans in the
  // lobby and 71 lords are actually run by the machine. Reserving the seats
  // separately is what makes the AI count exact.
  const heldSeats = [];
  for (let i = 0; i < (opts.humanSeats || 0); i++){
    const l = g.addLord('Awaiting a lord', pickColor(), false);
    levelStart(l);
    heldSeats.push(l.id);
  }
  g.humanSeats = heldSeats;
  // On the Europe map the AI lords are the powers of the age, seated at home.
  if (g.preset === 'europe'){
    const pool = POWERS.slice();
    for (let i = pool.length - 1; i > 0; i--){       // deal them out, seeded
      const j = (g.rand() * (i + 1)) | 0;
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    for (let i = 0; i < opts.bots; i++){
      // The historical powers are dealt out once each. Past them — more lords
      // than there were great powers — a house is raised on open ground and
      // named for that ground and for the year, rather than the pool wrapping
      // round and seating a second Kingdom of France on top of the first.
      const power = i < pool.length ? pool[i] : null;
      if (power){
        const lord = g.addLord(power[0], pickColor(), true);
        names.add(power[0]);
        lord.home = [power[1], power[2]];
      } else {
        const t = openSeat();
        const where = t >= 0 ? g.seatDegrees(t) : null;
        const lord = g.addLord(pickName(where), pickColor(), true);
        if (where) lord.home = where;
      }
    }
  } else {
    for (let i = 0; i < opts.bots; i++) g.addLord(pickName(null), pickColor(), true);
  }
  // The authoritative roll-call. Anything that wants to know how many lords the
  // machine is running asks this rather than counting the roster and hoping.
  g.aiIds = g.players.filter(p => p.bot).map(p => p.id);
  return g;
}

// Node takes this as a module; browser and jsc pick the declarations up as globals.
if (typeof module !== 'undefined' && module.exports){
  module.exports = {
    CFG, ECON, SECTORS, START_W, BUILDS, SIEGE, PALETTE, TINCTURES, POWERS, EU,
    Game, Lord, Attack, Heap, makeMatch, makeHouseName, regionAt, mulberry32, hslHex, pickFrom,
    fbm, vnoise, hash2,
    T_SEA, T_SHOAL, T_PLAIN, T_WOOD, T_HILL, T_PEAK,
    B_NONE, B_TOWN, B_CASTLE, B_HARBOR, B_SIEGE, B_TOWER, B_FARM, B_FORGE, B_ALL,
  };
}
