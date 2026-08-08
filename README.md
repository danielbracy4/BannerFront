# Bannerfront

A real-time realm-conquest game in the vein of **openfront.io** / territorial.io,
reskinned *and* re-mechanised for the middle ages. One HTML file, no build step,
no dependencies — double-click `index.html`.

```
open index.html
```

## The loop

Plant your standard on open ground. Your levy grows with the land you hold, on a
logistic curve, so small realms recover fast and huge ones plateau. Drag the
**levy sent** slider, click a rival's land, and your border bleeds into theirs
one field at a time — terrain and their troop density set the price per field.
Coin accrues from population, land, towns and sea trade, and buys works and
siege. Take **65%** of the realm, or be the last banner flying.

## How it maps to OpenFront

| OpenFront | Bannerfront |
|---|---|
| City | **Town** — raises your levy ceiling |
| Defense Post | **Castle** — fortifies the ground in a radius |
| Port | **Harbour** — trade coin, and a place to launch ships |
| Missile Silo | **Siege Works** — unlocks siege engines |
| SAM launcher | **Watchtower** — may bring incoming siege down |
| Transport ship | **Longship** — carries your levy to a distant shore |
| Warship | **War Galley** — holds water, sinks what passes |
| Atom / Hydrogen / MIRV | **Trebuchet / Greek Fire / Plague Cart** |

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
| your own ground | raise any of the five works, priced and greyed if you can't |
| open water | send a war galley |

Everything else:

- **drag** pan · **scroll** zoom · **click the left panel** to find your lands
- **left-click any land** to march on whoever holds it (open ground included)
- **Works / Ships / Siege** at the bottom open a tray of what each costs and does
- **1–5** pick a work to place · **Esc** cancel · **Space** cycle speed
- **↑ / ↓** nudge the levy slider
- click a house in the leaderboard for the same diplomacy options

The game pauses when the tab is hidden (requestAnimationFrame stops), which is
the behaviour you want for a single-player match.

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
```

There is no Node on this machine, so the harness runs under the JavaScriptCore
shell that ships with macOS. Note also that a local preview server cannot read
`~/Desktop` (macOS TCC denies it and it surfaces as a 404) — `./sync-preview.sh`
copies the project into the session scratchpad first.

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

## Where this stops

It is single-player against bots. The sim is deterministic given a seed and runs
at ~0.28 ms/tick with 41 lords, so it would tolerate being moved behind an
authoritative server for real multiplayer — that is the interesting next step,
and the `//<CORE>` split already isolates exactly the code that would move.

Smaller things left undone: no spawn-phase timer (you place, then the bots
place), no fog of war (openfront has none either), and boats path with a plain
BFS over water that is recomputed per voyage rather than cached.
