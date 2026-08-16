// Does the generated map actually put Europe where Europe is?
//
//   node tools/landmarks.js [seeds]
//
// The coastlines are polygons sampled through a noise warp, so a change to
// either can quietly move a coast a long way without looking wrong in the
// small. This checks known places against the ground they land on: cities must
// be on land, seas must be water, and the great ranges must be high. Every
// landmark is checked on several seeds, because the warp is seeded — a check
// that passes on one seed proves very little.
//
// Landmarks sit well inside whatever they are testing. The warp displaces a
// sample by up to ~0.7°, so a point chosen right on a coastline tells you about
// the noise rather than about the geography.
const c = require('../shared/core.js');

const SEEDS = +(process.argv[2] || 6);

// LAND/SEA/HIGH must hold on every seed. COAST is for cities that sit *on* the
// coastline — Naples, Lisbon, Constantinople. The coast is deliberately warped
// by up to ~0.7°, which is four or five fields, so a harbour city is inside the
// noise band by construction and will be offshore on the occasional seed.
// Demanding perfection there would only invite someone to flatten the noise.
// The failure this test exists to catch is a landmass being absent or in the
// wrong place, and that shows up as a rate far below the bar, not as one seed
// in ten — when these connectors were missing, the Alps read as sea 6 times out
// of 6. Lords are seated by seatAtHome, which searches outward for real ground,
// so a wobbling harbour is cosmetic rather than a broken start.
const LAND = 'land', SEA = 'sea', HIGH = 'high', COAST = 'coast';
const COAST_BAR = 0.7;
const MARKS = [
  // cities of the age — all must stand on dry ground
  ['London',            -0.13, 51.51, LAND],
  ['Paris',              2.35, 48.86, LAND],
  ['Rome',              12.50, 41.90, LAND],
  ['Madrid',            -3.70, 40.42, LAND],
  ['Lisbon',            -8.90, 38.72, COAST],
  ['Stockholm',         17.90, 59.33, COAST],
  ['Vienna',            16.37, 48.21, LAND],
  ['Kyiv',              30.52, 50.45, LAND],
  ['Constantinople',    28.80, 41.05, COAST],
  ['Naples',            14.27, 40.85, COAST],
  ['Dublin',            -6.40, 53.35, COAST],
  ['Edinburgh',         -3.40, 55.95, COAST],
  ['Copenhagen',        12.20, 55.68, COAST],
  ['Novgorod',          31.27, 58.52, LAND],
  ['Krakow',            19.94, 50.06, LAND],
  ['Barcelona',          2.00, 41.55, COAST],
  ['Marseille',          5.20, 43.50, COAST],
  ['Hamburg',            9.99, 53.40, COAST],
  ['Warsaw',            21.01, 52.23, LAND],
  ['Athens',            23.60, 38.10, COAST],
  ['Tunis',             10.00, 36.60, COAST],
  ['Konya',             32.50, 37.90, LAND],
  ['Moscow marches',    38.00, 55.50, LAND],
  ['Toledo',            -4.03, 39.86, LAND],
  ['Milan',              9.19, 45.47, LAND],
  // The Russian north. All of this was open sea once — Karelia, Onega, the
  // White Sea shore, Arkhangelsk and the whole Kola — which left Finland
  // unattached to Russia and Novgorod on the edge of an ocean.
  ['Karelia',           31.50, 62.50, LAND],
  ['Onega country',     35.50, 62.50, LAND],
  ['Arkhangelsk',       40.50, 64.55, COAST],
  ['Kola interior',     36.00, 67.50, LAND],
  ['Murmansk',          33.08, 68.97, COAST],

  // seas — a lord must not be able to walk across these
  ['the North Sea',      3.00, 56.20, SEA],
  ['the Baltic',        19.00, 57.20, SEA],
  ['the Gulf of Bothnia',20.30, 62.50, SEA],
  ['the Bay of Biscay', -4.50, 45.50, SEA],
  ['the Channel',       -1.20, 50.15, SEA],
  ['the Irish Sea',     -5.10, 53.60, SEA],
  ['the Tyrrhenian',    11.80, 39.60, SEA],
  ['the Adriatic',      15.60, 42.60, SEA],
  ['the Aegean',        25.00, 37.90, SEA],
  ['the Ionian',        18.60, 37.30, SEA],
  ['the Black Sea',     34.00, 43.40, SEA],
  ['the western ocean',-11.00, 48.00, SEA],
  ['the Norwegian Sea',  2.00, 64.00, SEA],
  ['the White Sea',     37.50, 65.50, SEA],
  ['the Barents Sea',   35.00, 70.60, SEA],

  // the great ranges — hill or peak, not farmland
  ['the Alps',          10.50, 46.55, HIGH],
  ['the Pyrenees',       0.50, 42.70, HIGH],
  ['the Carpathians',   24.60, 47.40, HIGH],
  ['the Keel',          13.20, 65.20, HIGH],
  ['the Apennines',     13.20, 42.55, HIGH],
];

const EU = { lon0: -12, lon1: 42, lat0: 34.0, lat1: 71.5 };

function classify(g, lon, lat){
  const W = g.W, H = g.H;
  const x = Math.round((lon - EU.lon0) / (EU.lon1 - EU.lon0) * W);
  const y = Math.round((EU.lat1 - lat) / (EU.lat1 - EU.lat0) * H);
  if (x < 0 || y < 0 || x >= W || y >= H) return 'off the map';
  const t = g.terrain[y * W + x];
  if (t <= 1) return SEA;
  if (t >= 4) return HIGH;
  return LAND;
}

const games = [];
for (let i = 0; i < SEEDS; i++) games.push(c.makeMatch({ bots: 0, preset: 'europe', seed: 100 + i * 977 }));

const pad = (s, n) => { s = String(s); while (s.length < n) s += ' '; return s; };
let fails = 0;

console.log('');
console.log('  BANNERFRONT — is Europe where Europe is?');
console.log('  ' + MARKS.length + ' landmarks × ' + SEEDS + ' seeds');
console.log('');

for (const [name, lon, lat, want] of MARKS){
  let ok = 0;
  const got = new Set();
  for (const g of games){
    const c2 = classify(g, lon, lat);
    // high ground is dry ground: a city landmark is satisfied by hill or peak
    const dry = c2 === LAND || c2 === HIGH;
    const pass = (want === LAND || want === COAST) ? dry : c2 === want;
    if (pass) ok++; else got.add(c2);
  }
  const rate = ok / games.length;
  const bar = want === COAST ? COAST_BAR : 1;
  const shown = rate === 1 ? '' : '  (' + ok + '/' + games.length + ' seeds)';
  if (rate >= bar){
    console.log('  \x1b[32m✓\x1b[0m ' + pad(name, 22) + pad(want, 6) + shown);
  } else {
    fails++;
    console.log('  \x1b[31m✗\x1b[0m ' + pad(name, 22) + pad(want, 6) +
                '  wanted ' + want + ', got ' + [...got].join('/') +
                ' on ' + (games.length - ok) + '/' + games.length + ' seeds');
  }
}

console.log('');
console.log(fails ? '  ' + fails + ' of ' + MARKS.length + ' landmarks are in the wrong place'
                  : '  all ' + MARKS.length + ' landmarks fall on the right ground'
                    + ' (harbours allowed to wobble to ' + (COAST_BAR * 100) + '%)');

// A house is named for where it sits, so the region bands are geography too —
// and they are easy to get subtly wrong, since they are tested in order and an
// early band swallows a later one. Scotland came out Norse and Novgorod came
// out Norse from exactly that.
const SEATS = [
  ['London', -0.13, 51.5, 'insular'],   ['Edinburgh', -3.2, 55.9, 'insular'],
  ['Dublin', -6.3, 53.3, 'insular'],    ['Paris', 2.35, 48.9, 'frankish'],
  ['Bordeaux', -0.6, 44.8, 'frankish'], ['Madrid', -3.7, 40.4, 'iberian'],
  ['Barcelona', 2.2, 41.4, 'iberian'],  ['Rome', 12.5, 41.9, 'italian'],
  ['Venice', 12.3, 45.4, 'italian'],    ['Naples', 14.3, 40.8, 'italian'],
  ['Mainz', 8.3, 50.0, 'germanic'],     ['Bohemia', 14.4, 50.1, 'germanic'],
  ['Vienna', 16.4, 48.2, 'germanic'],   ['Oslo', 10.8, 59.9, 'norse'],
  ['Stockholm', 18.1, 59.3, 'norse'],   ['Copenhagen', 12.6, 55.7, 'norse'],
  ['Hungary', 19.0, 47.5, 'magyar'],    ['Poland', 19.9, 50.1, 'slavic'],
  ['Novgorod', 31.3, 58.5, 'slavic'],   ['Serbia', 20.9, 44.0, 'slavic'],
  ['Bulgaria', 23.3, 42.7, 'slavic'],   ['Athens', 23.7, 38.0, 'greek'],
  ['Konya', 32.5, 37.9, 'anatolian'],   ['Tunis', 10.2, 36.0, 'maghrebi'],
];
// A landmass can be missing entirely without a single point-check noticing, so
// long as no landmark happened to be standing on it. What catches that is
// asking whether you can *walk* from one country to another: the whole Russian
// north was open sea, and what gave it away was Finland being an island.
console.log('');
{
  const g = games[0], W = g.W, H = g.H;
  const tile = (lon, lat) => Math.round((EU.lat1 - lat) / (EU.lat1 - EU.lat0) * H) * W
                           + Math.round((lon - EU.lon0) / (EU.lon1 - EU.lon0) * W);
  const from = tile(26.0, 62.5);                     // central Finland
  const seen = new Uint8Array(g.N), stack = [from];
  seen[from] = 1;
  let reached = 0;
  while (stack.length){
    const t = stack.pop(); reached++;
    const x = t % W, y = (t / W) | 0;
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const u = ny * W + nx;
      if (seen[u] || g.terrain[u] < 2) continue;
      seen[u] = 1; stack.push(u);
    }
  }
  const walk = [['Novgorod', 31.27, 58.52], ['Moscow', 37.60, 55.80],
                ['Arkhangelsk', 40.50, 64.55], ['Murmansk', 33.08, 68.97],
                ['Kyiv', 30.52, 50.45], ['Paris', 2.35, 48.86], ['Rome', 12.50, 41.90]];
  let cut = 0;
  for (const [name, lon, lat] of walk){
    const there = !!seen[tile(lon, lat)];
    if (!there){ cut++; console.log('  \x1b[31m✗\x1b[0m ' + pad(name, 22) + 'cannot be reached overland from Finland'); }
  }
  fails += cut;
  if (!cut) console.log('  \x1b[32m✓\x1b[0m ' + pad('one landmass', 22) +
    `Finland walks to Novgorod, Moscow, Arkhangelsk, Murmansk, Kyiv, Paris and Rome (${reached.toLocaleString()} fields)`);
}

console.log('');
let nameFails = 0;
for (const [name, lon, lat, want] of SEATS){
  const got = c.regionAt(lon, lat);
  if (got !== want){
    nameFails++;
    console.log('  \x1b[31m✗\x1b[0m ' + pad(name, 22) + 'draws ' + got + ' names, wanted ' + want);
  }
}
console.log(nameFails ? '  ' + nameFails + ' seats draw on the wrong name stock'
                      : '  all ' + SEATS.length + ' seats draw on the right name stock');
console.log('');
process.exit(fails + nameFails ? 1 : 0);
