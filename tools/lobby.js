// Does the lobby obey its own rules, and does a match get exactly the lords it
// asked for, on ground no two of them share?
//
//   node tools/lobby.js [games]
//
// These are the claims a player can be lied to about without ever noticing: a
// countdown that can be skipped, a lobby that says 73 AI and runs 71, a
// "random" scatter that quietly stacks two standards on one field. Each is
// checked against the real objects rather than against what the screen says.
const path = require('path');
const { Room, LOBBY_SECS, MAX_HUMANS, LORDS_MIN, LORDS_MAX } = require('../server/src/room.js');
const core = require('../shared/core.js');

const GAMES = +(process.argv[2] || 5);
let fails = 0;
const ok  = (c, m) => { if (!c) fails++; console.log((c ? '  \x1b[32m✓\x1b[0m ' : '  \x1b[31m✗\x1b[0m ') + m); };
const pad = (v, n) => String(v).padStart(n);

// A silent stand-in for socket.io: rooms broadcast constantly and none of it
// matters here except that it does not throw.
const io = () => {
  const sent = [];
  const chan = { emit: (ev, msg) => sent.push({ ev, msg }) };
  return { to: () => chan, sent };
};
const fakeSocket = (id) => ({ id, join(){}, emit(){} });

console.log('');
console.log('  BANNERFRONT — the lobby, the roll-call and the scatter');
console.log('');

// ---------------------------------------------------------------- the clock
console.log('  a lobby runs its minute');
{
  const net = io();
  const r = new Room(net, {});
  ok(r.phase === 'lobby', 'a new lobby is open');
  ok(r.secondsLeft > LOBBY_SECS - 3 && r.secondsLeft <= LOBBY_SECS,
     `and starts a ${LOBBY_SECS}s countdown (${r.secondsLeft}s left)`);
  ok(!r.mayStart, 'it may not start straight away');
  // An empty lobby stands open for ever rather than marching off alone.
  r.startsAt = Date.now() - 1;
  ok(!r.mayStart, 'and an empty lobby never starts, even at zero');
  r.lobbyTick();
  ok(r.phase === 'lobby' && r.secondsLeft > LOBBY_SECS - 3,
     `instead the clock winds back and it keeps waiting (${r.secondsLeft}s)`);

  r.addSeat(fakeSocket('a'), 'First Lord', null, null);
  ok(!r.mayStart, 'nor does it start the moment the first player joins');
  r.begin();
  ok(r.phase === 'lobby', 'and calling begin() outright does nothing — the door is guarded');

  // What a malicious client would actually try: the socket event is gone, so
  // the only route left is the method, and the method refuses.
  for (let i = 0; i < 20; i++) r.begin();
  ok(r.phase === 'lobby', 'twenty more attempts change nothing');

  r.lobbyTick();
  ok(r.phase === 'lobby', 'a tick partway through the minute does not start it');
  clearInterval(r.lobbyTimer);
}

console.log('');
console.log('  ...unless it fills');
{
  const net = io();
  const r = new Room(net, {});
  for (let i = 0; i < MAX_HUMANS - 1; i++) r.addSeat(fakeSocket('s' + i), 'Lord ' + i, null, null);
  ok(!r.isFull && !r.mayStart, `${MAX_HUMANS - 1} of ${MAX_HUMANS} seats is not full`);
  r.addSeat(fakeSocket('last'), 'Last Lord', null, null);
  ok(r.isFull, 'the last seat fills the lobby');
  ok(r.mayStart && r.startReason === 'full', 'which is a reason to start early');
  clearInterval(r.lobbyTimer);
}

console.log('');
console.log('  ...or the minute expires');
{
  const net = io();
  const r = new Room(net, {});
  r.addSeat(fakeSocket('a'), 'Patient Lord', null, null);
  r.startsAt = Date.now() - 1;                     // wind the clock forward
  ok(r.mayStart && r.startReason === 'expired', 'an unfilled lobby starts when the time is up');
  r.lobbyTick();
  ok(r.phase !== 'lobby', 'and the tick actually begins the match');
  clearInterval(r.lobbyTimer); clearInterval(r.placeTimer);
}

// ------------------------------------------------------------- the roll-call
console.log('');
console.log('  the AI count is rolled once, and honoured exactly');
console.log('');
console.log('  ' + pad('game', 6) + pad('humans', 8) + pad('asked', 7) + pad('actual AI', 11) +
            pad('total lords', 13) + pad('seats used', 12) + pad('duplicates', 12));
console.log('  ' + '-'.repeat(69));

const counts = [];
for (let n = 1; n <= GAMES; n++){
  const net = io();
  const r = new Room(net, {});
  const humans = n % 4;                            // 0..3 players in the lobby
  for (let i = 0; i < humans; i++) r.addSeat(fakeSocket('h' + i), 'Player ' + i, null, null);

  const asked = r.targetLords;          // total size of the match
  counts.push(asked);
  const rolledAgain = r.targetLords;
  const fill = r.aiFill;                // what the machine must supply

  r.startsAt = Date.now() - 1;                     // expire it and let it run
  r.begin();
  clearInterval(r.lobbyTimer);
  // Record the field each standard is actually planted on. Reading it back off
  // the map afterwards does not work: seating claims a small blob of ground, so
  // the first owned field in scan order is some corner of that blob and may
  // legitimately be a peak or a shore. The seat itself is what the rule is
  // about, so watch the call that makes it.
  const planted = [];
  const realSeat = r.game.seat.bind(r.game);
  r.game.seat = (p, t) => { planted.push({ id: p.id, tile: t }); return realSeat(p, t); };
  // players never choose ground, so placement runs its course
  r.placeLeft = 0; r.placeTick();
  clearInterval(r.placeTimer); clearInterval(r.tickTimer); clearInterval(r.castTimer);

  const g = r.game;
  const actualAI = g.players.filter(p => p.bot).length;
  const seats = g.players.filter(p => p.tiles > 0);
  const tiles = planted.map(s => s.tile);
  const dupes = tiles.length - new Set(tiles).size;

  console.log('  ' + pad(n, 6) + pad(humans, 8) + pad(asked, 7) + pad(actualAI, 11) +
              pad(g.players.length, 13) + pad(seats.length, 12) + pad(dupes, 12));

  ok(asked >= LORDS_MIN && asked <= LORDS_MAX, `  game ${n}: a match of ${asked} lords is within ${LORDS_MIN}–${LORDS_MAX}`);
  ok(rolledAgain === asked, `  game ${n}: the count is not re-rolled when read again`);
  ok(actualAI === fill, `  game ${n}: ${actualAI} AI actually exist against ${fill} needed to fill`);
  ok(g.players.length === asked, `  game ${n}: ${g.players.length} lords total = ${humans} human + ${fill} AI`);
  ok(dupes === 0, `  game ${n}: no two lords share a starting field`);
  ok(seats.length === g.players.length, `  game ${n}: every lord received ground`);
  ok(planted.length === g.players.length, `  game ${n}: every lord was planted exactly once`);

  // every seat has to be real ground, and not a peak
  let badGround = 0;
  for (const t of tiles){
    if (t < 0){ badGround++; continue; }
    const terr = g.terrain[t];
    if (terr < 2 || terr === 5) badGround++;
  }
  ok(badGround === 0, `  game ${n}: every standard stands on valid land`);

  // ...and they must not all land in one corner. Quarter the map and count
  // which quarters got lords: a scatter that piles everyone into Iberia is
  // random in the small and useless in the large.
  const quads = new Set();
  for (const t of tiles) quads.add(((t % g.W) < g.W / 2 ? 'W' : 'E') + (((t / g.W) | 0) < g.H / 2 ? 'N' : 'S'));
  ok(quads.size === 4, `  game ${n}: lords rise across the whole map (${[...quads].sort().join(' ')})`);
}

console.log('');
ok(new Set(counts).size > 1, `the count differs between games (${counts.join(', ')})`);

// ------------------------------------------------ the same world every time
console.log('');
console.log('  a match is the same world wherever it is rebuilt');
{
  const build = (seed) => {
    const g = core.makeMatch({ bots: 50, humanSeats: 2, preset: 'europe', seed });
    const spots = g.pickSeats(g.players.length);
    g.players.forEach((p, i) => { if (i < spots.length) g.seat(p, spots[i]); });
    return spots;
  };
  const a = build(12345), b = build(12345), c = build(999);
  ok(a.length === b.length && a.every((v, i) => v === b[i]),
     'the same seed deals the same seats');
  ok(!(a.length === c.length && a.every((v, i) => v === c[i])),
     'a different seed deals different ones');
}

// ------------------------------------------------------------------ Novgorod
// This engine has no territory objects — the map is a 456x248 grid of fields,
// and "Novgorod" is a power with a capital coordinate, not a territory with an
// id and a list of neighbours. So the questions worth asking are the ones the
// engine can actually answer: is that ground real, can a lord live on it, can
// it be taken, and can the machine find its way there.
console.log('');
console.log('  Novgorod');
{
  const NOV = [31.27, 58.52];
  const g = core.makeMatch({ bots: 60, humanSeats: 0, preset: 'europe', seed: 4242 });
  const EU = core.EU, W = g.W, H = g.H;
  const toTile = ([lon, lat]) => Math.round((EU.lat1 - lat) / (EU.lat1 - EU.lat0) * H) * W
                               + Math.round((lon - EU.lon0) / (EU.lon1 - EU.lon0) * W);
  const t = toTile(NOV);

  ok(t >= 0 && t < g.N, 'the seat of Novgorod is on the map');
  ok(g.isLand(t), 'and it is dry land');
  ok(g.terrain[t] !== 5, 'and not a peak, so a standard may stand there');

  const power = core.POWERS.find(p => /Novgorod/.test(p[0]));
  ok(!!power, `it is one of the powers of the age (${power && power[0]})`);

  // A lord can hold it. Seat the rival before any time passes, too: `audit`
  // culls lords holding nothing, so a map with one seated lord on it ends the
  // match on the first tick and every check after that fails for want of a
  // game rather than for want of Novgorod.
  const lord = g.players[0], rival = g.players[1];
  // Drive both by hand. They are ordinary bots otherwise, and two live bots
  // sharing a border will go to war on their own schedule — which ate the rival
  // during the expansion step and ended the match before the conquest check
  // ever ran. What is being tested is whether the ground *can* be taken, not
  // what the AI chooses to do with it.
  lord.bot = false; rival.bot = false;
  g.seat(lord, t); g.audit();
  ok(lord.tiles > 0 && g.owner[t] === lord.id, `a lord can be seated there (${lord.tiles} fields)`);

  let beside = -1;
  for (const b of lord.border){
    for (const d of [-1, 1, -W, W]){
      const nb = b + d;
      if (nb >= 0 && nb < g.N && g.owner[nb] < 0 && g.isLand(nb) && g.terrain[nb] !== 5){ beside = nb; break; }
    }
    if (beside >= 0) break;
  }
  ok(beside >= 0, 'there is open ground beside it for a rival to land on');
  g.seat(rival, beside);
  g.audit();
  g.phase = 'war';

  // it can expand
  lord.sold = 4000; lord.arms = 4000;
  const before = lord.tiles;
  g.launch(lord.id, -1, 3000);
  for (let i = 0; i < 120; i++) g.tick(0.1);
  ok(lord.tiles > before, `and expand from it (${before} -> ${lord.tiles} fields)`);

  // and it can be taken
  rival.sold = 60000; rival.arms = 60000;
  const heldBefore = lord.tiles;
  const war = g.launch(rival.id, lord.id, 40000);
  ok(!!war, 'a rival on its border can march on it');
  for (let i = 0; i < 300; i++) g.tick(0.1);
  ok(lord.tiles < heldBefore || !lord.alive,
     `and take its ground (${heldBefore} -> ${lord.tiles} fields)`);

  // the scatter reaches that country at all — AI can be dealt seats up there
  const g2 = core.makeMatch({ bots: 90, humanSeats: 0, preset: 'europe', seed: 77 });
  const spots = g2.pickSeats(90);
  const nx = t % W, ny = (t / W) | 0;
  const nearNov = spots.filter(s => Math.hypot(s % W - nx, ((s / W) | 0) - ny) < 40).length;
  ok(nearNov > 0, `the random scatter seats lords in Novgorod's country (${nearNov} within 40 fields)`);
  ok(spots.every(s => g2.isLand(s) && g2.terrain[s] !== 5), 'and every seat it deals is valid ground');

  // enough room for the largest match the lobby can ask for
  const g3 = core.makeMatch({ bots: 90, humanSeats: MAX_HUMANS, preset: 'europe', seed: 5 });
  const most = g3.pickSeats(LORDS_MAX);
  ok(most.length === LORDS_MAX,
     `Europe seats the largest possible match (${most.length} of ${LORDS_MAX})`);
  ok(new Set(most).size === most.length, 'with no field dealt twice');
}

console.log('');
console.log(fails ? `  ${fails} check(s) failed\n` : '  all lobby checks passed\n');
process.exit(fails ? 1 : 0);
