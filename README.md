# Bannerfront

A real-time realm-conquest game in the vein of **openfront.io** / territorial.io,
reskinned *and* re-mechanised for the middle ages — where military strength is
earned through economy and logistics rather than granted by territory.

```bash
npm install
npm start          # serves the client and runs the game server on :8080
npm run smoke      # boots a server, connects two clients, drives a match
```

## The loop

Plant your standard on open ground. Your people divide into **civilians**, who
work the land, **levies** in training, and **soldiers**, who are the only ones who
can take or hold ground — and every soldier is a worker removed from the economy.
Farms feed your population, blacksmiths forge the **arms** without which a host
fights at a third strength, and towns turn labour into **ducats**. Click a rival's
land and your border bleeds into theirs one field at a time, as a front, paying
for terrain and fortification as it goes. Take **65%** of the realm, or be the
last banner flying.

## How it maps to OpenFront

| OpenFront | Bannerfront |
|---|---|
| City | **Town** — raises your levy ceiling |
| Defense Post | **Castle** — fortifies the ground in a radius |
| Port | **Harbour** — trade coin, and a place to launch ships |
| Missile Silo | **Siege Works** — lets you lay sieges at all |
| SAM launcher | **Watchtower** — the garrison harries besiegers |
| Transport ship | **Longship** — carries your levy to a distant shore |
| Warship | **War Galley** — holds water, sinks what passes |
| Atom / Hydrogen / MIRV | **Battering Ram / Trebuchet / Siege Camp** |

The siege tier is the one place the mapping breaks on purpose. Openfront's nukes
fly across the map into a blast radius; a siege is *laid on your own frontier*
and invests the ground in front of it until the walls come down. Nothing is
fired at a map coordinate.

Alliances, betrayal and oathbreaker status all carry over. Pacts run for a
**term** rather than forever — see "endgame deadlock" below.

## Look

The map is drawn as inked cartography on aged vellum — wheat ground, sage woods,
ochre uplands, deep blue-grey sea — and banners are drawn from **heraldry**
rather than a colour wheel: gules, azure, vert, purpure, or, tenné, murrey and
their neighbours, twelve tinctures in six shades apiece. Territory is painted
over the parchment at 72% so the tincture reads as pigment while terrain still
shows through, since terrain sets what ground costs to take.

## Controls

**Right-click anywhere on the map for orders.** The menu reads the ground under
the cursor and offers only what applies there:

| you right-click | you are offered |
|---|---|
| a rival's land | march on them · land a longship · swear or break a pact · look upon their lands · loose siege |
| open ground | claim it · land a longship |
| your own ground | raise any of the seven works, priced and greyed if you can't |
| open water | send a war galley |

Everything else:

- **drag** pan · **scroll** zoom · **click the left panel** to find your lands
- **left-click any land** to march on whoever holds it (open ground included)
- **Realm / Works / Ships / Siege** at the bottom open a tray of what each costs and does
- **1–7** pick a work to place · **Esc** cancel · **Space** cycle speed
- **↑ / ↓** nudge the soldiers-sent slider
- **Realm** at the bottom holds the worker priorities and mobilisation
- click a house in the leaderboard for the same diplomacy options

In single-player the game pauses when the tab is hidden (requestAnimationFrame
stops), which is the behaviour you want. Online matches run on the server and
keep going regardless.

## Releasing a change

The lobby carries the player-facing guide and changelog, and it is **version
gated**: a player who ticked "don't show this again" sees it once more the moment
`VERSION` changes. So every time the game changes:

1. Bump `VERSION` in `index.html` (search for `const VERSION`).
2. Add a matching entry at the top of `CHANGELOG` beside it.
3. If the change affects how the game is played, update the `HELP` string too —
   it is written in prose next to the changelog and reads the live constants
   (`CFG.WIN_PCT`, `ECON.TRAIN_TIME`, `ECON.UNARMED`) so tuning numbers stay
   correct on their own.

Skipping step 1 means returning players never see what changed.

## Layout

```
shared/core.js        the simulation — no DOM, no window, no rendering
index.html            the client: renderer, HUD, input. Loads shared/core.js
tools/sim.js|.sh      headless balance harness
tools/doctrines.js|.sh  are the four playstyles actually balanced?
tools/bundle.sh       inlines the core -> dist/bannerfront.html (standalone)
sync-preview.sh       copies the project where a local preview server can read it
```

`shared/core.js` is the one authoritative copy of the rules. It is written to run
unchanged in three places — the browser client, the Node game server, and the jsc
harnesses — so **there is no second copy to drift out of sync**. A number the sim
reports is a number a player gets.

It is deterministic given a seed, which is what makes both an authoritative
server and a reproducible balance test possible at all.

Because the client now loads the core as a separate file, `index.html` needs to
be *served* rather than opened off disk. `./tools/bundle.sh` inlines the core
into `dist/bannerfront.html` if you want a single file to double-click — it only
ever copies from `shared/core.js`, so it cannot drift.

```bash
./tools/sim.sh 5 40 continents     # matches, lords, map preset
./tools/doctrines.sh 6 24          # are the four playstyles balanced?
```

These run under the JavaScriptCore shell that ships with macOS, so they need no
install and no Node. Note that a local preview server cannot read `~/Desktop`
(macOS TCC denies it and it surfaces as a 404) — `./sync-preview.sh` copies the
project into the session scratchpad first.

## The map

The default map is **Europe around 1300**, built from coastline polygons and
mountain spines in degrees rather than from noise, so Iberia, the British Isles,
Scandinavia, Italy, Anatolia and the Black Sea are where they belong. The sample
point for each field is warped by noise before it is tested, which keeps the
coast ragged instead of showing the straight edges of the polygons. A test
checks 19 landmarks (London, Rome, Stockholm, the Alps, the Pyrenees, the
Atlantic, the Black Sea…) fall on the right kind of ground.

Because the geometry is sampled from polygons it is resolution-independent: the
Europe grid is deliberately coarser (456×248 against 528×288) purely for pacing,
and the geography is unchanged by it.

Rivals are the powers of the age — France, England, Castile, Aragon, Venice,
Byzantium, the Golden Horde, the Teutonic Order, Novgorod, the Ottoman Beylik
and thirty-odd more — each seated at its historical capital. Players choose
their own ground.

**A winning share on Europe is 50%, not 65%.** The seas cut the map up, so
ground has to be taken across them; at 65% no match resolved inside 45 minutes
(0 of 3). At 50% every match resolves, averaging 26 minutes.

## Roads, trade and supply

Works — farms, forges, towns, castles, harbours — are the **nodes** of a network.
A road is an **edge** you pay for by the field, and it does two things:

**Trade follows connection.** Each town and harbour earns more the larger the
connected component it sits on (`ROAD_LINK` per extra work, capped at +130%), so
six joined works are worth far more than six scattered ones. This is the lever
that lets a small, well-connected realm out-earn a sprawling one.

**Supply follows the network.** Ground within `SUPPLY_R` of a component that
contains a town is supplied. An assault whose frontier lies beyond supply pays
`UNSUPPLIED` more per field and advances at `UNSUPPLIED_RATE` of the usual speed
— measured at a third less ground taken over twenty seconds.

Taking the ground under a work drops every road to it, which can split a network
in two and starve a whole front. That is what makes storming a castle worth the
cost, rather than walking around it.

`node tools/roads.js` checks the lot: that joining works raises trade, that
supply reaches from a town and not beyond it, and that losing a work severs what
it held together.

## Balance, and how it got there

Current shape at 40 lords on *Continents*, from `./tools/sim.sh`:

```
decided       4/5, 28–39 min per match
land claimed  36% by minute 2, 87% by 4, 98% by 6
first death   ~4 min
survivors     ~5 of 41
```

Six findings worth not rediscovering:

**An attack frontier must be keyed on cost *accumulated from where it started*,
not on each tile's own cost.** Keyed on its own cost, the min-heap is a greedy
best-first search: it always grabs the cheapest tile anywhere along the border,
so it threads through plains like a worm, strands the woods and hills behind it,
and simply routes *around* castle ground instead of pushing through. Accumulate
the cost and the heap pops in order of depth, so everything at one contour falls
before anything past it — which is what a front is. Measured over the same map
and the same levy (`greedy` vs `front`):

| | stranded pockets | edge vs compact blob | hills+peaks taken |
|---|---|---|---|
| greedy | 714 / 634 | 8.98x / 7.99x | 0% / 12% |
| front | 14 / 6 | 1.81x / 2.12x | 42% / 29% |

The 0% column is the whole story: the old advance never took high ground at all,
which is exactly why terrain and castles felt like they did nothing. Note that a
front costs *more* per field than cherry-picking did — about 1.5x — so defence
values have to come down when you make this change or no war ever ends.

**Flat pricing on open ground makes the land grab exponential.** Men grow with
land and land cost the same, so the scramble compounded: 40% of the map claimed
by minute 2 and 90% by minute 4 — a slow crawl, then the whole map gone in a
90-second burst. Open ground is now priced by **reach** (`NEUTRAL_BASE +
tiles/NEUTRAL_SCALE`), so your first fields are cheap and your thousandth is
dear. That alone smoothed the curve and roughly halved how fast the leader ran
away; giving each lord more room (the map is 528×288) stretched the scramble to
about six minutes.

**Fixed sea levels make unplayable maps.** A constant elevation threshold gave
anywhere from 11.6% to 33.7% land depending on seed — a 12% map with 40 lords is
a knife fight in a closet. The waterline is now a *quantile* of the map's own
elevation histogram, so every seed lands within 0.3% of its target. Hill and peak
bands are quantiles of the land for the same reason; before that, one seed was
all plains and the next was a wall of mountains.

**Levy must be sublinear in land, or the leader runs away with it.** With
population proportional to holdings, a lord ten times your size fields ten times
your men while each of their fields costs the same to take — a pure snowball.
`POP_EXP = 0.93` means they field only ~7×, *and* their thinner density makes
their ground cheaper to take. This is the same lesson as the galaxy-game economy:
a linear term cannot cap size, you need a curved one.

**Attacks need two separate limits.** A levy pool (how much force is available)
*and* a tile allowance proportional to the width of the front (how fast that
force can actually advance). With only the first, a huge host funnelled through a
narrow border swallowed 200 fields in a single tick. With only the pool and no
carry-over, small attacks could never afford even one field and hung forever,
holding their troops hostage — the pool now accumulates across ticks so every
attack terminates.

**Use `DEF_LOSS`, never `GROWTH`, to make a late game decisive.** When wars went
indecisive — levies pinned at 20–45% of capacity, 15,000 fields changing hands a
minute, nobody able to mass a killing blow — the obvious lever was faster
population growth. It works, and it also drags the opening scramble back to 97%
claimed by minute 4, because growth feeds both phases equally. Defender attrition
is the lever that only touches lord-vs-lord war: open ground has no defender, so
raising it leaves the scramble untouched while making a breakthrough compound.

**Siege should break levies, not erase the map.** Neutralising ground outright,
combined with reach-priced open ground, meant a plague cart could create a hole
nobody could afford to retake — total claimed land *fell* from 96% to 64% over a
match and no lord could ever reach a winning share. Siege now guts the population
of a province and only sometimes voids the claim, and bots have a cooldown on it.
Reach pricing is capped (`NEUTRAL_CAP`) for the same reason.

**An alliance needs a reason to sign and something to deliver.** Scoring
acceptance mostly off a bot's "loyalty" trait meant only the ~18% born loyal ever
agreed and three offers in four were refused — alliances effectively did not
exist. Fear is what actually got medieval powers to sign, so acceptance now keys
on being the weaker party, being under attack, and on a front-runner emerging;
that moves acceptance from a flat 39% to 83% once wars start. Delivery is the
other half: a grievance against your attacker only helps if the ally *borders*
them, so a distant friend can do nothing. Allies therefore also pay — a subsidy
straight to whoever was attacked — which is the one thing a small rich realm can
always do, and which is what makes a mercantile game worth playing.

**Permanent alliances deadlock the endgame.** One 45-minute match ran to the cap
with four lords alive and nobody willing to move, all sworn to each other. Oaths
now lapse after 130–260s, and the last three lords cannot swear at all. Every
match has resolved since.

## Multiplayer

The server is authoritative. Clients send **intents** — march there, raise a farm
here, mobilise to 40% — and the server decides what happens; nothing a client
sends can touch another player's realm.

```
server/src/index.js   http + Socket.IO, static client, /healthz
server/src/room.js    lobby, match lifecycle, tick loop, intent handling
server/test/smoke.js  boots the server and drives two real clients through a match
```

- **10 Hz** simulation, **5 Hz** broadcast. The spec called for 20 Hz; this is a
  game where a field changes hands every few seconds, so 20 doubles cost for
  motion nobody perceives.
- Ownership travels as **tile-flip deltas** — `[tile, owner, …]`, about five
  bytes a field, so even a furious battle is roughly a kilobyte a second. The
  client rebuilds terrain from the map seed rather than being sent it.
- The lobby opens on the first arrival, counts down 60 seconds, and fills the
  remaining seats with AI. A player who disconnects mid-match hands their realm
  to the AI rather than freezing it.
- **Placement**: when the lobby closes, players get 25 seconds on an empty map to
  plant their own standard, watching rivals' claims appear as they are made. The
  server validates every choice (dry land, not a peak, unclaimed, at least 16
  fields from another lord). AI lords are seated only *after* the humans have
  chosen, so no player ever loses a spot to an instant AI. The war starts early
  once everyone has planted.
- `ALLOWED_ORIGINS` restricts who may open a socket. Leave it unset only in
  development.

## Where this stops

There is no persistence, no accounts and no matchmaking beyond one lobby at a
time. No fog of war (openfront has none either), and boats path with a plain BFS
over water recomputed per voyage rather than cached.
