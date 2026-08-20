'use strict';
// A single match: the lobby that gathers players, and the authoritative
// simulation that runs once the horn sounds.
//
// The server owns the game. Clients send *intents* ("march on that lord",
// "raise a farm here") and the server decides what actually happens. Nothing a
// client sends is trusted beyond "which of my own lord's controls did I touch".

const core = require('../../shared/core.js');
const db = require('./db.js');
const { makeMatch, CFG, SECTORS, BUILDS, SIEGE, B_ALL } = core;

const TICK_HZ      = CFG.TICK_HZ;      // 10 — the simulation rate
const BROADCAST_HZ = 5;                // deltas to clients twice per tick
// A lobby always runs its full minute unless it fills first. Nobody can shorten
// it — there is deliberately no "start now", because a host who could skip the
// wait would mean nobody else ever got to join.
// These live in shared/core.js so the client shows the same numbers the server
// enforces, rather than a second copy that can drift away from it.
// The wait can be shortened for a test run, never removed and never bypassed:
// whatever it is set to, the server alone decides when it has elapsed.
const LOBBY_SECS   = Math.max(1, +process.env.BANNERFRONT_LOBBY_SECS || CFG.LOBBY_SECS);
const PLACE_SECS   = 25;               // time to choose your ground
const PLACE_MIN    = 16;               // fields between rival standards
const MAX_HUMANS   = CFG.MAX_HUMANS;   // seats at the table; the lobby is full at this
const LORDS_MIN    = CFG.LORDS_MIN;    // the *total* size of a match, humans included
const LORDS_MAX    = CFG.LORDS_MAX;
const MAX_LORDS    = LORDS_MAX;

let nextRoomId = 1;

class Room {
  constructor(io, opts){
    this.io = io;
    this.id = 'r' + (nextRoomId++);
    // Europe is the only map in rotation. The others still exist in core.js and
    // can be brought back by changing this line; they are simply not offered.
    this.preset = 'europe';
    this.seed = (Math.random() * 1e9) | 0;
    // Rolled once, here, when the lobby opens — and never again. This is how
    // many lords the *match* will hold, humans included; the machine fills
    // whatever the players do not take. Everything downstream reads it rather
    // than deciding for itself.
    this.targetLords = LORDS_MIN + Math.floor(Math.random() * (LORDS_MAX - LORDS_MIN + 1));
    // A lobby never holds more players than the match has room for.
    this.capacity = Math.min(MAX_HUMANS, this.targetLords);

    this.phase = 'lobby';              // lobby -> placing -> war -> done
    this.seats = [];                   // { socketId, name, colour, lordId }
    this.game = null;
    this.openedAt = Date.now();
    this.startsAt = this.openedAt + LOBBY_SECS * 1000;

    this.tickTimer = null;
    this.castTimer = null;
    this.lobbyTimer = setInterval(() => this.lobbyTick(), 1000);
    this.lastEventSent = 0;
  }

  get secondsLeft(){ return Math.max(0, Math.ceil((this.startsAt - Date.now()) / 1000)); }
  get humanCount(){ return this.seats.length; }
  get isFull(){ return this.seats.length >= this.capacity; }
  // What the machine has to supply to reach the size this match was set at.
  // Humans take slots first; this is only ever the remainder.
  get aiFill(){ return Math.max(0, this.targetLords - this.seats.length); }
  // The only two ways a match may begin. Both are decided here, on the clock
  // the server itself opened the lobby by — a client has no say in either.
  //
  // An empty lobby never starts. It is standing open all the time now, so
  // without this the server would spin up a fresh forty-lord match against
  // nobody every sixty seconds, for ever. When the clock runs out on an empty
  // room it simply winds back and goes on waiting — see lobbyTick.
  get mayStart(){
    if (this.phase !== 'lobby' || !this.seats.length) return false;
    return this.isFull || this.secondsLeft <= 0;
  }
  get startReason(){
    if (!this.seats.length) return null;
    return this.isFull ? 'full' : this.secondsLeft <= 0 ? 'expired' : null;
  }

  // ------------------------------------------------------------------ lobby
  addSeat(socket, name, colour, accountId){
    if (this.phase !== 'lobby') return false;
    this.seats.push({
      socketId: socket.id,
      name: String(name || 'A Lord').slice(0, 18),
      colour: /^#[0-9a-f]{6}$/i.test(colour || '') ? colour : null,
      lordId: -1, seated: false,
      accountId: accountId == null ? null : accountId,
    });
    socket.join(this.id);
    this.sendLobby();
    return true;
  }

  dropSeat(socketId){
    const i = this.seats.findIndex(s => s.socketId === socketId);
    if (i < 0) return;
    const seat = this.seats[i];
    if (this.phase === 'lobby'){
      this.seats.splice(i, 1);
      this.sendLobby();
    } else if (seat.lordId >= 0 && this.game){
      // A lord whose player left keeps fighting — handed to the AI, which is
      // far better than having their realm freeze mid-war.
      const lord = this.game.players[seat.lordId];
      if (lord){ lord.bot = true; lord.abandoned = true; }
    }
  }

  sendLobby(){
    this.io.to(this.id).emit('lobby', {
      room: this.id,
      seconds: this.secondsLeft,
      humans: this.seats.map(s => ({ name: s.name, colour: s.colour })),
      capacity: this.capacity,
      lords: this.targetLords,       // total size of the match, decided at open
      ai: this.aiFill,               // ...and how much of it the machine takes
      map: this.preset,
      starting: this.startReason,    // 'full' | 'expired' | null
    });
  }

  lobbyTick(){
    if (this.phase !== 'lobby') return;
    // The clock ran out with nobody here: wind it back and keep the doors open,
    // rather than starting a war nobody came to.
    if (!this.seats.length && this.secondsLeft <= 0){
      this.openedAt = Date.now();
      this.startsAt = this.openedAt + LOBBY_SECS * 1000;
      // A fresh wait is a fresh match: roll its size again.
      this.targetLords = LORDS_MIN + Math.floor(Math.random() * (LORDS_MAX - LORDS_MIN + 1));
      this.capacity = Math.min(MAX_HUMANS, this.targetLords);
      this.seed = (Math.random() * 1e9) | 0;
    }
    this.sendLobby();
    if (this.mayStart) this.begin();
  }

  // ------------------------------------------------------------------- war
  begin(){
    // Guarded rather than trusted: this is the one door into a match, and it
    // opens only when the lobby is full or the minute is up. A client that
    // found a way to call it early gets nothing.
    if (!this.mayStart) return;
    clearInterval(this.lobbyTimer); this.lobbyTimer = null;
    this.phase = 'war';
    this.startedBecause = this.startReason;

    // Human seats are reserved *alongside* the AI rather than carved out of
    // them, so the match holds exactly targetLords: the players who joined,
    // and the machine filling the rest.
    const fill = this.aiFill;
    const g = makeMatch({ bots: fill, humanSeats: this.seats.length,
                          preset: this.preset, seed: this.seed });
    this.game = g;
    g.humanId = -1;                    // no single privileged human on the server

    // Humans take the seats that were held for them — never an AI's — keeping
    // their chosen name and colour.
    this.seats.forEach((seat, i) => {
      const lord = g.players[g.humanSeats[i]];
      if (!lord) return;
      lord.bot = false;
      lord.name = seat.name;
      if (seat.colour) lord.color = seat.colour;
      lord.w = { farm:0.40, forge:0.24, trade:0.26, works:0.10 };
      lord.standing = core.ECON.PEASANT_LEVY; lord.mobil = 0;
      seat.lordId = lord.id;
    });

    // Nobody is seated yet — players choose their own ground first. Bots are
    // placed only once the humans have had their pick, so a human never has to
    // fight for a spot with an AI that chose instantly.
    this.phase = 'placing';
    this.placeLeft = PLACE_SECS;

    this.io.to(this.id).emit('start', {
      room: this.id,
      seed: this.seed, preset: this.preset, w: g.W, h: g.H,
      tickHz: TICK_HZ, placing: PLACE_SECS,
      lords: g.players.map(p => ({ id: p.id, name: p.name, colour: p.color, bot: p.bot })),
      you: Object.fromEntries(this.seats.map(s => [s.socketId, s.lordId])),
    });

    // The first broadcast has to carry the whole world. Clearing the dirty list
    // here instead left every client with an empty map: the server had already
    // seated all 41 lords, and nobody was ever told.
    g.dirty.length = 0; g.dirtyAll = true;
    this.castTimer = setInterval(() => this.broadcast(), 1000 / BROADCAST_HZ);
    this.placeTimer = setInterval(() => this.placeTick(), 1000);
  }

  placeTick(){
    if (this.phase !== 'placing') return;
    this.placeLeft--;
    this.io.to(this.id).emit('placing', {
      seconds: Math.max(0, this.placeLeft),
      seated: this.seats.filter(s => s.seated).length,
      humans: this.seats.length,
    });
    // everyone has chosen — no reason to make them wait out the clock
    if (this.placeLeft <= 0 || (this.seats.length && this.seats.every(s => s.seated))) this.beginWar();
  }

  // Is this a fair place to plant a standard?
  canSeat(g, tile){
    if (!Number.isInteger(tile) || tile < 0 || tile >= g.N) return 'that is not on the map';
    if (!g.isLand(tile)) return 'plant your standard on dry land';
    if (g.terrain[tile] === 5) return 'nothing grows on the peaks — choose kinder ground';
    if (g.owner[tile] >= 0) return 'that ground is already claimed';
    const x = tile % g.W, y = (tile / g.W) | 0;
    for (const p of g.players){
      if (!p.alive || !p.tiles) continue;
      if (Math.hypot(x - p.cx, y - p.cy) < PLACE_MIN) return 'too close to another lord — spread out';
    }
    return null;
  }

  seatPlayer(socketId, tile){
    const g = this.game;
    if (!g || this.phase !== 'placing') return;
    const seat = this.seats.find(s => s.socketId === socketId);
    if (!seat || seat.lordId < 0 || seat.seated) return;
    const err = this.canSeat(g, tile);
    if (err) return this.nope(socketId, err);
    g.seat(g.players[seat.lordId], tile);
    seat.seated = true;
    this.io.to(socketId).emit('seated', { tile });
  }

  beginWar(){
    if (this.phase !== 'placing') return;
    clearInterval(this.placeTimer); this.placeTimer = null;
    this.phase = 'war';
    const g = this.game;

    // Everyone still standing gets a field: the players who never chose, then
    // every AI lord. Seats are dealt from one shuffled pool of valid ground, so
    // no two lords can be handed the same field however many of them there are
    // — and it is drawn from the match seed, so a client rebuilding this world
    // arrives at the same map.
    //
    // The powers no longer open at their historical capitals. Seating forty to
    // ninety lords at forty-six fixed seats cannot work, and a match where the
    // same crowns always rise in the same places is the same match every time.
    const waiting = [];
    for (const seat of this.seats)
      if (!seat.seated && seat.lordId >= 0) waiting.push(g.players[seat.lordId]);
    for (const p of g.players)
      if (!p.tiles && !waiting.includes(p)) waiting.push(p);

    const spots = g.pickSeats(waiting.length);
    if (spots.length < waiting.length){
      // Fewer usable fields than lords. Seat who can be seated and let the rest
      // fall, rather than stacking two standards on one field.
      console.log(`  room ${this.id}: only ${spots.length} seats for ${waiting.length} lords`);
    }
    waiting.forEach((p, i) => { if (i < spots.length) g.seat(p, spots[i]); });
    g.audit();

    const ai = g.players.filter(p => p.bot && p.alive).length;
    console.log(`  room ${this.id}: ${this.preset}, ${this.seats.length} human, ` +
                `${ai} AI (target ${this.targetLords} lords), ` +
                `started because ${this.startedBecause}`);
    g.phase = 'war';
    this.io.to(this.id).emit('war', { lords: g.aliveCount });
    const step = 1 / TICK_HZ;
    this.tickTimer = setInterval(() => this.tick(step), 1000 / TICK_HZ);
  }

  tick(step){
    const g = this.game;
    if (!g || g.phase !== 'war') return;
    g.tick(step);
    if (g.phase === 'done') this.finish();
  }

  // Ownership travels as flat [tile, owner, tile, owner, ...] pairs — about
  // five bytes a field, so even a furious battle is a kilobyte a second.
  broadcast(){
    const g = this.game;
    if (!g) return;   // runs during placing too, so claims appear as they are made

    let owners = null, full = false;
    if (g.dirtyAll){
      full = true;
      owners = Array.from(g.owner);
      g.dirtyAll = false; g.dirty.length = 0;
    } else if (g.dirty.length){
      const seen = new Set();
      const pairs = [];
      for (const t of g.dirty){
        if (seen.has(t)) continue;
        seen.add(t);
        pairs.push(t, g.owner[t]);
      }
      owners = pairs;
      g.dirty.length = 0;
    }

    // works that went up or came down since we last spoke
    let builds = null;
    if (full){
      builds = [];
      // tile, kind, and how many stand on it — a plot can be built up, and a
      // client that only heard the kind would draw one work where there are
      // fifteen and count the realm's economy short.
      for (let i = 0; i < g.N; i++) if (g.build[i]) builds.push(i, g.build[i], g.stack[i]);
      g.buildDirty.length = 0;
    } else if (g.buildDirty.length){
      builds = [];
      const seen = new Set();
      for (const t of g.buildDirty){
        if (seen.has(t)) continue;
        seen.add(t);
        builds.push(t, g.build[t], g.stack[t]);
      }
      g.buildDirty.length = 0;
    }

    // the road network, whenever it changes — it is small and rarely moves
    let roads = null;
    if (full || g.roadDirty){
      roads = [];
      for (const pl of g.players) for (const r of pl.roads) roads.push(pl.id, r.a, r.b);
      g.roadDirty = false;
    }

    // rates too — without them the client's panel reads a flat 0.0/s and the
    // player cannot see whether their realm is feeding itself or starving
    const lords = g.players.map(p => [
      p.id, p.tiles, Math.round(p.civ), Math.round(p.levy), Math.round(p.sold),
      Math.round(p.arms), Math.round(p.ducats), p.alive ? 1 : 0, Math.round(p.committed),
      +(p.food || 0).toFixed(2), +(p.income || 0).toFixed(2), +(p.upkeep || 0).toFixed(2),
      +(p.armsRate || 0).toFixed(2), Math.round(p.mustered || 0),
    ]);

    const events = g.events.slice(this.lastEventSent);
    this.lastEventSent = g.events.length;

    this.io.to(this.id).emit('state', {
      t: +g.time.toFixed(1),
      full, owners, builds, lords, roads,
      alive: g.aliveCount, leader: g.leader,
      boats: g.boats.map(b => [b.owner, +b.x.toFixed(1), +b.y.toFixed(1), b.kind]),
      vans: g.caravans.map(c => [c.owner, +c.x.toFixed(1), +c.y.toFixed(1)]),
      sieges: g.sieges.map(s => [s.owner, s.tile, s.kind, +(s.t / s.dur).toFixed(2)]),
      events: events.map(e => ({ text: e.text, kind: e.kind, who: e.who })),
    });
  }

  finish(){
    this.phase = 'done';
    clearInterval(this.tickTimer); clearInterval(this.castTimer); clearInterval(this.placeTimer);
    this.tickTimer = this.castTimer = null;
    const g = this.game;
    // The ledger is written here and only here: the authoritative server, at
    // the end of an online match. A solo result is the client's word, and the
    // client's word is not a record.
    for (const seat of this.seats){
      if (seat.accountId == null || seat.lordId < 0) continue;
      const lord = g.players[seat.lordId];
      db.recordMatch(seat.accountId, {
        won: g.winner === seat.lordId,
        share: lord ? lord.peak / g.landCount : 0,
      });
    }
    this.io.to(this.id).emit('over', {
      winner: g.winner,
      name: g.winner >= 0 ? g.players[g.winner].name : null,
      minutes: +(g.time / 60).toFixed(1),
    });
  }

  // --------------------------------------------------------------- intents
  // Everything a client can ask for. Each one is checked against the sender's
  // own lord — there is no path here to touch anybody else's realm.
  nope(socketId, why){ if (why) this.io.to(socketId).emit('nope', { why }); }

  intent(socketId, msg){
    const g = this.game;
    if (!g || !msg || typeof msg.do !== 'string') return;
    if (msg.do === 'seat') return this.seatPlayer(socketId, msg.tile);
    if (g.phase !== 'war') return;
    const seat = this.seats.find(s => s.socketId === socketId);
    if (!seat || seat.lordId < 0) return;
    const me = g.players[seat.lordId];
    if (!me || !me.alive) return;

    const tile = Number.isInteger(msg.tile) && msg.tile >= 0 && msg.tile < g.N ? msg.tile : -1;
    const ratio = Math.max(0.01, Math.min(1, +msg.ratio || 0.35));

    switch (msg.do){
      case 'march': {
        if (tile < 0 || !g.isLand(tile)) return;
        const target = g.owner[tile];
        if (target === me.id) return;
        if (me.sold < 10) return this.nope(socketId, 'You have no soldiers to send.');
        if (!g.launch(me.id, target, me.sold * ratio))
          this.nope(socketId, target >= 0
            ? `No border with ${g.players[target].name} — sail a longship instead.`
            : 'No open ground touches your lands.');
        return;
      }
      case 'build': {
        const type = +msg.type;
        if (tile < 0 || !B_ALL.includes(type)) return;
        this.nope(socketId, g.place(me.id, tile, type));
        return;
      }
      case 'siege': {
        if (tile < 0 || !SIEGE[msg.kind]) return;
        this.nope(socketId, g.raise(me.id, msg.kind, tile));
        return;
      }
      case 'ship':
      case 'galley': {
        if (tile < 0) return;
        const isGalley = msg.do === 'galley';
        const cost = isGalley ? 1000 : 400;
        if (me.ducats < cost) return this.nope(socketId, 'Not enough coin.');
        if (isGalley ? !g.isWater(tile) : !g.isLand(tile)) return;
        let from = -1, best = Infinity;
        const tx = tile % g.W, ty = (tile / g.W) | 0;
        for (const c of me.coast){
          const d = (c % g.W - tx) ** 2 + (((c / g.W) | 0) - ty) ** 2;
          if (d < best){ best = d; from = c; }
        }
        if (from < 0) return this.nope(socketId, 'You hold no coastline.');
        const troops = isGalley ? 0 : Math.floor(me.sold * ratio);
        if (!isGalley && troops < 20) return this.nope(socketId, 'Too few men to fill a longship.');
        const sailErr = g.sail(isGalley ? 'galley' : 'longship', me.id, from, tile, troops);
        if (sailErr !== null) return this.nope(socketId, sailErr);
        me.ducats -= cost; me.sold -= troops;
        return;
      }
      case 'ally': {
        const id = +msg.id;
        const them = g.players[id];
        if (!them || !them.alive || id === me.id) return;
        if (them.bot && g.wouldAlly(them, me.id)){ g.ally(me.id, id); this.nope(socketId, `${them.name} swears to you.`); }
        else this.nope(socketId, `${them.name} spurns your offer.`);
        return;
      }
      case 'break': {
        const id = +msg.id;
        if (me.allies.has(id)) g.breakAlly(me.id, id, true);
        return;
      }
      case 'realm': {
        if (msg.w && typeof msg.w === 'object'){
          for (const s of SECTORS){
            const v = +msg.w[s];
            if (v >= 0 && v <= 1) me.w[s] = v;
          }
        }
        // The peasant levy is not the player's to set — it is simply there.
        // Only mobilisation above it is an order, and it is paid for in coin
        // as the men are raised.
        if (msg.mobil != null) me.mobil = Math.max(0, Math.min(0.6, +msg.mobil || 0));
        return;
      }
    }
  }

  close(){
    clearInterval(this.lobbyTimer); clearInterval(this.tickTimer); clearInterval(this.castTimer);
  }
}

module.exports = { Room, LOBBY_SECS, TICK_HZ, BROADCAST_HZ, MAX_LORDS, MAX_HUMANS, LORDS_MIN, LORDS_MAX };
