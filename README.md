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
fights at a third strength, and towns turn labour into **ducats**. A peasant
levy is always under arms; every man you call **above** it must be mustered, and
mustering is paid for in coin as the men are raised, so going to war competes
directly with everything else that coin buys. Click a rival's
land and your border bleeds into theirs one field at a time, as a front, paying
for terrain and fortification as it goes. Take **50%** of the realm on Europe —
**65%** on the open maps — or be the last banner flying.

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
- **1–7** pick a work to place · **Esc** cancel
- **↑ / ↓** nudge the soldiers-sent slider
- **Realm** at the bottom holds the worker priorities and mobilisation
- click a house in the leaderboard for the same diplomacy options

In single-player the game pauses when the tab is hidden (requestAnimationFrame
stops), which is the behaviour you want. Online matches run on the server and
keep going regardless.

## Releasing a change

The lobby carries the player-facing guide and changelog, and every player sees it
every time they join — there is no longer any way to switch it off, because a
player who dismissed it once had no way of knowing the rules had changed
underneath them. `VERSION` is what the changelog is keyed to. So every time the
game changes:

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
tools/readiness.js    do lords prepare before they go to war?
tools/battle.js       does arming decide a fight, and does a front stay joined?
tools/capacity.js     is the building ceiling real, and does the AI obey it?
tools/roads.js        roads, caravans, trade and supply
tools/botsense.js     do the lords' decisions cohere?
tools/tempo.js        how fast does ground change hands, and does host size help?
tools/landmarks.js    is Europe where Europe is, and do seats name themselves right?
tools/mapshot.js      render a preset to a PNG, and report its terrain mix
tools/bundle.sh       inlines the core -> dist/bannerfront.html (standalone)
sync-preview.sh       copies the project where a local preview server can read it
```

`sim` runs under macOS's JavaScriptCore, through its `.sh` wrapper; everything
else is plain `node`. The split is historical — there was no Node on the machine
when `sim` was written, and its comments still say so — so mind which runner a
harness wants.

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
./tools/sim.sh 5 40 continents     # matches, lords, map preset — runs under jsc
node tools/readiness.js 4 24       # do lords prepare before they fight?
node tools/landmarks.js 10         # is Europe where Europe is?
node tools/mapshot.js europe m.png # look at a map instead of arguing about it
```

Note that a local preview server cannot read `~/Desktop` (macOS TCC denies it
and it surfaces as a 404) — `./sync-preview.sh` copies the project into the
session scratchpad first. **`sync-preview.sh` has a stale session id baked into
its default path**; set `BANNERFRONT_PREVIEW` to the scratchpad you are actually
using.

## The map

The default map is **Europe around 1300**, built from coastline polygons and
mountain spines in degrees rather than from noise, so Iberia, the British Isles,
Scandinavia, Italy, Anatolia and the Black Sea are where they belong. The sample
point for each field is warped by noise before it is tested, which keeps the
coast ragged instead of showing the straight edges of the polygons.

Coastlines are traced at roughly a degree or finer through the features that
give a country its silhouette. Coarser than that and the map reads as a set of
polygons however much noise is laid over it, because the warp displaces a long
straight edge *coherently* — it stays straight and merely leans. The warp runs
at two scales for the same reason: a coarse one for bays and headlands, a fine
one to fray the coast at field scale. The coarse amplitude has to stay well
under the width of the narrowest real feature; at 0.9° it punched clean through
Italy and the Anatolian coast, both barely 2° wide.

`node tools/landmarks.js` checks 43 landmarks — London, Rome, Novgorod, the
Alps, the Black Sea, the Gulf of Bothnia — against the ground they land on,
across several seeds, because the warp is seeded and a check that passes on one
seed proves very little. Harbour cities may wobble offshore on a minority of
seeds, since they sit inside the noise band by construction; everything else
must hold every time. Run it after *any* change to the polygons: when the Alpine
and Carpathian connectors were dropped during a redraw, Italy became an island
and Transylvania became open sea, and the map still looked perfectly plausible.
`node tools/mapshot.js europe out.png` draws the result and reports the terrain
mix, which is the other half — a map that has quietly become half upland is a
balance change, and it does not look like one.

**A missing landmass does not announce itself.** The whole Russian north —
Karelia, Onega, the White Sea shore, Arkhangelsk, the entire Kola peninsula —
was open sea, because the Ruthenia polygon stopped at about 60°N and nothing
covered anything above it. Forty-three landmark checks all passed, because none
of them happened to stand on the missing ground. What catches this is asking
whether the map is *one landmass*: a flood fill from central Finland now has to
reach Novgorod, Moscow, Arkhangelsk, Murmansk, Kyiv, Paris and Rome overland, and
before the fix Finland was an island. Point checks verify the places you thought
of; connectivity verifies the ones you did not.

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

## Ground

Works occupy a square of your own land — **3×3** for a Town, Castle or Farm,
**2×2** for a Harbour, Blacksmith, Siege Works or Watchtower — validated over
every field of the footprint before anything is built. Land is therefore the
real constraint on an economy: a small island cannot hold everything a realm
needs, and *where* you build is a decision rather than a formality.

`game.site` maps every occupied field back to the work standing on it, so
overlap is impossible and razing frees the whole square.

## What a realm can run

Coin is not capacity. Every kind of work has a ceiling, and the ceiling grows
with the realm rather than with the treasury:

```
worksCap = WORKS_BASE + WORKS_ROOT * sqrt(fields) + WORKS_PER_TOWN * towns
capOf(kind) = worksCap * CAP_SHARE[kind]      (harbours also want shoreline)
```

Keyed on the **root** of the land held, for the reason this project keeps
relearning — a linear term cannot cap size. At one work per field a great power
would run thousands; at the root it runs about 160, and a new holding of twenty
fields runs seven. Towns then raise the ceiling, which is what makes development
the way to build more.

| fields | ceiling | farms | forges | castles |
|---|---|---|---|---|
| 21 | 7 | 3 | 1 | 1 |
| 400 | 28 | 12 | 7 | 5 |
| 2,500 | 76 | 32 | 19 | 15 |
| 10,000 | 164 | 68 | 42 | 32 |

**A plot can be built up as well as out.** Raise a second work of the same kind
on a plot already carrying one and it joins it, up to `STACK_MAX` (15). Land
therefore stops being the wall it was — a small island can hold a realm — while
the ceiling above still decides how many works exist, so building up buys room
and never scale.

That splits one number into two, and the split is where the bugs live:
`p.st[kind]` is the set of **plots** built on, `p.cnt[kind]` is how many **works**
stand on them. Everything that means "how many farms" — food, jobs, upkeep, the
ceiling, the price, the panel — reads `cnt`; everything that means "where are
they" — roads, the network, castle radius, rendering — reads `st`. A plot
changes hands with its whole pile, and razing takes the pile down; moving the
plot without its count would quietly destroy works on one side and mint them on
the other. Online, the build delta carries `[tile, kind, howMany]` for the same
reason — a client told only the kind would draw one work where fifteen stand and
read the realm's economy short.

**Capacity gates construction, never possession.** Ground taken from a lord comes
with the works standing on it, and those keep working however far over your
ceiling they put you — you simply cannot raise more of that kind until the realm
grows into them. This matters more than it sounds: measured before the change, a
lord holding 514 works had *bought* 115 of them and taken 399. Capping what you
may hold would have meant deleting conquered buildings; capping what you may
build leaves conquest alone and still bit hard — works bought across all lords
fell from 2,133 to 1,231, and land covered in buildings from 36% to 21%.

Price rises with how full the ceiling is (`COST_FILL`, `COST_POW`) rather than
with lifetime purchases. The old exponential on `bought[type]` punished razing,
never noticed a captured work, and could not tell a realm of twenty fields from
one of ten thousand. A farm costs 340 with room and 3,124 at the limit — and
cheapens again the moment the ceiling rises.

`node tools/capacity.js` checks the ceiling is real rather than decorative: that
a lord with a hundred million ducats and nine hundred open fields builds exactly
its cap and no more, and that across three thousand AI purchases not one work was
raised by a lord already at its limit.

## Levies, soldiers and arms

They are three things, not two. `p.levy` are peasants raised; `p.sold` are
trained soldiers; `p.arms` is an armoury belonging to the realm rather than to
any man.

**Soldiers are equipped first and the levy is handed what is left.** So a peasant
cannot arm himself, and yet the forges still decide what he is worth: the same
levy behind full forges is a real force, and on an empty armoury it is a mob.
Without this the arms economy stopped at the edge of the levy, and a realm could
raise a hundred thousand peasants and lose nothing by never building a forge.

```
levyArms  = max(0, arms - sold)      soldiers took theirs first
levyEquip = levyArms / levy
density   = (sold * quality + levy * LEVY_WORTH * levyQuality) / fields
```

Measured with 1,000 soldiers and 4,000 levies: an armoury of 1,000 arms the
soldiers and none of the levy; 3,000 arms half of it; 5,000 all of it — and the
ground the realm holds gets 3.3x harder to take across that range.

## Roads, trade and supply

Works — farms, forges, towns, castles, harbours — are the **nodes** of a network,
and **roads build themselves**: every work links to the nearest works it can
reach, as a minimum spanning forest. There is nothing to buy and nothing to
click. The player's decision is *where to build*; the network is the
consequence. **Caravans** then run those roads unprompted, carrying goods
between works and paying out on arrival.

The network does two things:

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

`node tools/roads.js` checks the lot: that works link themselves, that the road
is free, that trade rises with connection, that caravans run and pay, that
supply reaches from a town and not beyond it, and that losing a work severs what
it held together.

## The lords

Bot behaviour is measured by `node tools/botsense.js`, which asks whether their
decisions cohere rather than whether they win:

```
networked lords   86%   works joined into a trading network
marches armed    100%   rabble marches 0%
lords starving    23%
reckless marches   0%   marched out heavily while already invaded
```

Three findings worth keeping:

**Answer the shortage you have, not the one your plan predicts.** Building from
the worker-demand gap alone left lords starving with fields to spare and
marching half-armed with coin in the treasury: the gap said "jobs are staffed",
the realm said "there is no food and no kit". Reading `food < 0` and
`equip < 0.7` directly took equipment from ~50% to ~78%.

**Shifting labour beats building when you are hungry.** A farm needs coin and a
3×3 site; moving hands back to the fields works instantly. But the response has
to be gentle and the recovery quick — a first version that lunged at farms and
crept back dropped equipment 20 points as a side effect.

**Siting works near existing ones matters more than how many you build.** Since
roads form automatically between works in range, placing near what you hold
compounds the network: 84% → 94% of lords ended with a connected trading network
from that change alone.

## Balance, and how it got there

Current shape at 40 lords on *Europe*, from `./tools/sim.sh 3 40 europe`:

```
decided       3/3, 24–31 min per match (avg 27)
land claimed  12% by minute 2, 44% by 4, 94% by 6
first death   ~8–9 min
survivors     ~11 of 41
```

The two phases are meant to read differently. The scramble is over by minute 6,
and the wars start once the free land is gone — the gap between the two is the
time lords spend arming, and it is deliberately short enough that the map is
never simply sitting still. An earlier cut of the readiness rule left fourteen
dead minutes there; see "preparation you cannot afford" below.

The *Continents* preset was the reference before Europe became the default, and
its numbers are older: 4/5 decided, 28–39 min, 98% claimed by minute 6.

Findings worth not rediscovering:

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

**A rate limit and a floor will quietly swallow each other.** The tile allowance
is `front width × TILE_RATE × host multiplier`, with a floor so a narrow front
still creeps. With `TILE_RATE` at 0.065 and the floor at 3, the computed term sat
*below* the floor across most real front widths — so hosts of 1000, 2000 and
4000 men all advanced at exactly 30 tiles a second and the host multiplier did
nothing whatever. Identical figures across a range are the tell; the fix is to
keep the rate well clear of the floor, not to raise the multiplier.

**A cost that recurs forever is not a cost, it is a tax.** Charging ducats to
muster men works, but the ordered army size scales with population, and
population keeps growing — so the order is never satisfied and the charge never
ends. Spending the whole treasury as it arrived pinned a mobilised realm at zero
ducats for the rest of the match, and a farm costs 340. Drawing a *share* of the
treasury per second lets it settle where income meets the muster instead: a rich
realm raises men quickly, a poor one slowly, and both keep something to build
with.

**Claiming empty land should not cost blood like a battle does.** Committing a
whole host to unclaimed ground bought about thirty fields and left the realm
with no army — measured in play, 208 men took 20 fields in under ten seconds and
then there was nothing to defend with for two minutes. That is what "claiming is
too slow" actually was: not the rate, but that an army was *spent* rather than
deployed. Open ground has no defenders, so it is now **settled** — the levy
spent on a field mostly returns as civilians living on it, less `SETTLE_LOSS`.
The attack still meters at the same rate, which matters: that spend is what
paces the land grab, and removing it re-creates the exponential scramble the
reach-pricing was introduced to kill. Measured before and after, the curve is
unchanged (12%/46%/96% of the map claimed at minutes 2/4/6) and matches still
resolve in 28 minutes — the realm simply keeps its people. What conquering empty
land costs you now is *soldiers*, and soldiers are re-mustered in coin.

**An advance has to stay attached to the realm behind it.** A field is queued
for capture while it touches your ground — but the defender can retake that
ground before the assault pops it, and nothing re-checked. Attack a lord who is
attacking you and your front carried on converting fields deep inside their
realm with nothing joining them to you. Measured on a staged front: after a
counter-push retook the contact strip, 8 of the next 156 captures had no field
of the attacker's adjacent. Re-checking adjacency at the moment of capture fixed
it, and *also* made host size matter far more (1.8x to 4.0x from a thousand men
to sixteen thousand) — dropping severed fields from the queue lets them be
picked up again, so the front stays compact instead of trailing dead entries.

**Arming is what decides a battle, so it should be visible in the dice.** Every
field taken from another lord is now a small battle: both sides roll, and each
5% of arms-per-soldier adds 0.05 to the roll, to a cap of 1.00. The gap between
the rolls sets the casualties on *both* sides, and the ground only moves if the
attacker wins. Staged on an even front, a fully-armed attacker takes 467 fields
from a 20%-armed defender and loses 108k men; reverse the armouries and the same
assault takes 167 and loses 160k. Open ground is deliberately *not* rolled for —
there is no other side, and putting the opening scramble on coin flips against
nobody would make the land grab pure noise.

**Fixed playstyles never delivered the trade-offs they promised, so there are
none.** Four doctrines — mercantile, military, industrial, agricultural — were
meant to be four viable ways to run a realm. They never were: before any of this
season's changes agricultural won 6 matches out of 6, and after the levy was
priced military won 83% while mercantile and industrial won none and finished
with an average 0.1% of the map. A free allowance keyed on each doctrine's own
`standing` (0.06 to 0.22) was a hidden subsidy on top — one kind of realm got a
free army three times another's. The whole concept is gone. Every realm is run
the same way, and what separates two lords is **whether they are ready to
fight**, which is a state you can act on rather than a label you were born with.

**Going to war is a preparation, and every door into it has to be gated.** A
lord may not open a war until the men are called up *and have arrived*, there
are arms for them, and there is coin in hand. Gating the obvious path got 78% of
wars prepared; the missing fifth came in through two side doors — betraying an
ally, and an overseas invasion, which is checked when the fleet **loads** rather
than when it beaches, since by then the men are at sea and already committed.
Closing both took it to 100%. Claiming *open* ground is deliberately exempt and
sits at 3%: empty land has no defenders, and gating the scramble behind a war
chest stops the map ever being settled. `tools/readiness.js` watches both rows,
and the open-ground row is the control — if it climbs to meet the other, the
requirement has leaked into the land grab.

**Preparation you cannot afford is a stalemate.** Requiring 80% arms-per-soldier
before marching read as reasonable and stopped the game dead: the map filled by
minute 6 and then nothing happened until minute 20, forty lords all waiting on
forges, first death at 15 minutes. Measuring which of the three conditions was
actually blocking — 31 of 37 lords on arms, every minute from 7 to 14 — pointed
straight at it. At 66% a host still fights at about three-quarters strength, and
matches resolve in 27 minutes again.

**An army eats whether or not it fights.** Mobilisation doubled the starving
lords, 19% to 37%, and neither of the first two things I blamed made any
difference: guarding the forge-labour shift made it *worse* (38%), and softening
the arming trigger moved it one point. The cause was that `botFeed` reallocates
**civilians** between sectors and has no reach into men already under arms, so a
lord could mobilise itself into a famine and then sit in it with no lever. A
realm that cannot feed its host now sends men home. Counter-intuitively, making
the muster **free** is worse again (28% starving) — the ducat cost is the only
thing throttling how fast a lord can empty its own fields into an army.

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
server/src/index.js   http + Socket.IO, static client, /healthz, /api/*
server/src/room.js    lobby, match lifecycle, tick loop, intent handling
server/src/db.js      the ledger — accounts, sessions, match records
server/test/smoke.js  boots the server and drives two real clients through a match
tools/lobby.js        the lobby rules, the roll-call and the scatter
```

### The muster

A lobby runs for **60 seconds** and begins for exactly two reasons: the seats
fill, or the time is up. **There is no way to start it early.** The old "begin
now" button and its socket event are gone — a host who could skip the wait would
mean nobody else ever got to join — and `begin()` is guarded rather than trusted,
so a modified client that finds the method still gets nothing. The countdown on
screen is a readout of the server's clock, never its own.

Every match rolls its own number of AI lords, **40 to 90**, once when the lobby
opens. The number is fixed from that moment: it is not re-rolled when it is read,
and no lord is created after the war begins.

Getting that count *exactly* right needed a change in how seats are dealt.
`makeMatch` used to build the whole field as AI and then convert the first few
into whoever had joined, so a lobby of two players quietly turned a 73-lord match
into 71 — the count on screen was right and the world was wrong. Human seats are
now reserved *alongside* the AI (`humanSeats`), never carved out of them, and
`g.aiIds` is the roll-call anything can check against.

### Where lords begin

Seats are dealt by `Game.pickSeats(n)`: every valid field is collected, shuffled
on the match seed, and handed out under a spacing rule that relaxes in passes
until everyone has ground. A field can be dealt at most once **by construction**,
which the old per-lord `pickSeat` could not promise — it sampled at random, gave
up after a fixed number of tries, and with ninety lords began returning ground
that was already taken. Because it runs on the match's own RNG it is
deterministic: the same seed builds the same world on the server and on any
client that rebuilds it.

The powers no longer open at their historical capitals. Forty-six fixed seats
cannot serve ninety lords, and a match where the same crowns always rise in the
same places is the same match every time.

**Europe is the only realm in rotation** while it is being tuned. The other
presets are still in `shared/core.js` and are simply not offered — putting them
back is a matter of listing them in the client's `#inMap` and letting `Room` take
a preset again.

### The ledger

Accounts are optional and exist for one reason: to keep a record of **online**
wars. Solo play never asks for one, and no order in the game is gated behind
signing in.

It runs on Node's built-in `node:sqlite` (22.5+), so there is **no native
dependency to compile and nothing new in `package.json`** — which is most of why
it is SQLite and not anything larger. Passwords are scrypt-hashed with a
per-account salt and compared in constant time; a login against a name that does
not exist still hashes against a dummy salt, so a wrong name and a wrong password
take the same time to refuse. Sessions are opaque 32-byte tokens with a 30-day
life, held in `localStorage` and sent as a Bearer header — there are no cookies,
so there is nothing to CSRF. Sign-in attempts are rate-limited per address.

```
POST /api/signup   {name, pass} -> {token, account} | {err}
POST /api/login    {name, pass} -> {token, account} | {err}
POST /api/logout   (Bearer)     -> {}
POST /api/delete   (Bearer) {pass} -> {gone} | {err}
GET  /api/me       (Bearer)     -> {account} | 401
GET  /api/leaderboard           -> {lords:[…]}
GET  /api/providers             -> {ledger, google, steam}
GET  /api/auth/google           -> 302 to Google   (needs GOOGLE_CLIENT_ID/SECRET)
GET  /api/auth/steam            -> 302 to Valve    (needs nothing)
```

## Signing in through Google and Steam

Both are redirects out and back, written on `fetch` and `node:crypto` — no
dependency, and each provider is inert unless its credentials are set, so a
server with neither configured runs as it always did and offers no buttons.
`/api/providers` is what the title screen asks, so it can only offer sign-ins
the server can actually honour.

| variable | for |
|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google sign-in |
| `STEAM_API_KEY` | Steam display names (the sign-in itself needs no key) |
| `STEAM_LOGIN=0` | turn Steam off |
| `CLIENT_ORIGIN` | where to send the player back (default `https://bannerfront.com`) |
| `PUBLIC_ORIGIN` | this server's own address, for the callback URL |

Google's redirect URI must be registered as
`PUBLIC_ORIGIN + /api/auth/google/callback`.

**The session comes home in the URL fragment**, not the query string. Fragments
are never sent to a server, so the token stays out of access logs, proxy logs
and `Referer` headers; the client takes it and scrubs the address bar.

**Sign-ins match on the provider id and nothing else, deliberately.** The
tempting second key is the email, so that someone who founded a house with a
password and later clicks "sign in with Google" lands back in their own account
rather than an empty one. That is only safe if the password account's address
was *verified*, and this server sends no mail. Adopting an account by an
unverified address is an account takeover: found a house claiming somebody
else's gmail, wait for them to sign in with Google, and the server hands you
their record with your password still on it. So Google, Steam and password
houses stay separate. The address Google gives us is verified and is stored, so
the day verification exists this can be switched on safely.

Accounts that never had a password get an **unusable** one — a random hash
nobody knows the input to, so password login can never succeed on them. Leaving
the field empty instead would have been a way in.

`delete` asks for the password again rather than trusting the session, so a
token left behind on a shared machine is not enough to destroy the account it
belongs to.

A match record is written in exactly one place — `Room.finish`, on the
authoritative server, for seats that carried an account. A solo result is the
client's word, and the client's word is not a record.

**Deploying it: attach a volume, and that is the whole step.** Railway injects
`RAILWAY_VOLUME_MOUNT_PATH` the moment a volume is attached to a service, and the
ledger reads it, so there is no second variable to remember and no way to attach
storage while still writing to a disk the next deploy throws away. `DATA_DIR`
overrides it if you want the file somewhere specific; failing both it falls back
to `./data` (gitignored) for local runs.

`/healthz` reports where it actually landed:

```json
{ "ledger": true, "ledgerAt": "/data", "onVolume": true }
```

`onVolume: false` in production means the container's filesystem is ephemeral and
accounts will vanish on the next deploy. If `node:sqlite` is unavailable the
server still boots and plays — it reports `ledger: false` and refuses signups,
which is better than losing accounts silently.

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
