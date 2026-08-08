'use strict';
// A single match: the lobby that gathers players, and the authoritative
// simulation that runs once the horn sounds.
//
// The server owns the game. Clients send *intents* ("march on that lord",
// "raise a farm here") and the server decides what actually happens. Nothing a
// client sends is trusted beyond "which of my own lord's controls did I touch".

const core = require('../../shared/core.js');
const { makeMatch, CFG, SECTORS, BUILDS, SIEGE, B_ALL } = core;

const TICK_HZ      = CFG.TICK_HZ;      // 10 — the simulation rate
const BROADCAST_HZ = 5;                // deltas to clients twice per tick
const LOBBY_SECS   = 60;
const MAX_LORDS    = 41;               // one human seat + AI fill up to this

let nextRoomId = 1;

class Room {
  constructor(io, opts){
    this.io = io;
    this.id = 'r' + (nextRoomId++);
    this.preset = (opts && opts.preset) || 'continents';
    this.targetLords = Math.min(MAX_LORDS, (opts && opts.lords) || 41);
    this.seed = (Math.random() * 1e9) | 0;

    this.phase = 'lobby';              // lobby -> war -> done
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

  // ------------------------------------------------------------------ lobby
  addSeat(socket, name, colour){
    if (this.phase !== 'lobby') return false;
    this.seats.push({
      socketId: socket.id,
      name: String(name || 'A Lord').slice(0, 18),
      colour: /^#[0-9a-f]{6}$/i.test(colour || '') ? colour : null,
      lordId: -1,
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
      aiFill: Math.max(0, this.targetLords - this.seats.length),
    });
  }

  lobbyTick(){
    if (this.phase !== 'lobby') return;
    this.sendLobby();
    if (this.secondsLeft <= 0) this.begin();
  }

  // ------------------------------------------------------------------- war
  begin(){
    if (this.phase !== 'lobby') return;
    clearInterval(this.lobbyTimer); this.lobbyTimer = null;
    this.phase = 'war';

    // makeMatch builds the whole field; humans then take over the first few
    // seats. Subtracting the humans here as well would quietly shrink the match.
    const g = makeMatch({ bots: this.targetLords, preset: this.preset, seed: this.seed });
    this.game = g;
    g.humanId = -1;                    // no single privileged human on the server

    // Humans take over the first N lords, keeping their chosen name and colour.
    this.seats.forEach((seat, i) => {
      const lord = g.players[i];
      if (!lord) return;
      lord.bot = false;
      lord.name = seat.name;
      if (seat.colour) lord.color = seat.colour;
      lord.doctrine = 'your own';
      lord.w = { farm:0.40, forge:0.22, trade:0.28, works:0.10 };
      lord.standing = 0.08; lord.mobil = 0;
      seat.lordId = lord.id;
    });

    // v1 seats everyone automatically. Letting players choose their own ground
    // needs a placement phase, which is the next thing worth adding.
    const minDist = Math.max(9, Math.sqrt(g.landCount / (g.players.length + 2)) * 0.85);
    for (const p of g.players){
      const t = g.pickSeat(minDist);
      if (t >= 0) g.seat(p, t);
    }
    g.audit();
    g.phase = 'war';

    this.io.to(this.id).emit('start', {
      room: this.id,
      seed: this.seed, preset: this.preset, w: g.W, h: g.H,
      tickHz: TICK_HZ,
      lords: g.players.map(p => ({ id: p.id, name: p.name, colour: p.color, bot: p.bot })),
      you: Object.fromEntries(this.seats.map(s => [s.socketId, s.lordId])),
    });

    // The first broadcast has to carry the whole world. Clearing the dirty list
    // here instead left every client with an empty map: the server had already
    // seated all 41 lords, and nobody was ever told.
    g.dirty.length = 0; g.dirtyAll = true;
    const step = 1 / TICK_HZ;
    this.tickTimer = setInterval(() => this.tick(step), 1000 / TICK_HZ);
    this.castTimer = setInterval(() => this.broadcast(), 1000 / BROADCAST_HZ);
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
    if (!g) return;

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
      for (let i = 0; i < g.N; i++) if (g.build[i]) builds.push(i, g.build[i]);
      g.buildDirty.length = 0;
    } else if (g.buildDirty.length){
      builds = [];
      const seen = new Set();
      for (const t of g.buildDirty){
        if (seen.has(t)) continue;
        seen.add(t);
        builds.push(t, g.build[t]);
      }
      g.buildDirty.length = 0;
    }

    // rates too — without them the client's panel reads a flat 0.0/s and the
    // player cannot see whether their realm is feeding itself or starving
    const lords = g.players.map(p => [
      p.id, p.tiles, Math.round(p.civ), Math.round(p.levy), Math.round(p.sold),
      Math.round(p.arms), Math.round(p.ducats), p.alive ? 1 : 0, Math.round(p.committed),
      +(p.food || 0).toFixed(2), +(p.income || 0).toFixed(2), +(p.upkeep || 0).toFixed(2),
      +(p.armsRate || 0).toFixed(2),
    ]);

    const events = g.events.slice(this.lastEventSent);
    this.lastEventSent = g.events.length;

    this.io.to(this.id).emit('state', {
      t: +g.time.toFixed(1),
      full, owners, builds, lords,
      alive: g.aliveCount, leader: g.leader,
      boats: g.boats.map(b => [b.owner, +b.x.toFixed(1), +b.y.toFixed(1), b.kind]),
      sieges: g.sieges.map(s => [s.owner, s.tile, s.kind, +(s.t / s.dur).toFixed(2)]),
      events: events.map(e => ({ text: e.text, kind: e.kind, who: e.who })),
    });
  }

  finish(){
    this.phase = 'done';
    clearInterval(this.tickTimer); clearInterval(this.castTimer);
    this.tickTimer = this.castTimer = null;
    const g = this.game;
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
    if (!g || g.phase !== 'war' || !msg || typeof msg.do !== 'string') return;
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
        if (msg.standing != null) me.standing = Math.max(0, Math.min(0.4, +msg.standing || 0));
        if (msg.mobil != null)    me.mobil    = Math.max(0, Math.min(0.6, +msg.mobil || 0));
        return;
      }
    }
  }

  close(){
    clearInterval(this.lobbyTimer); clearInterval(this.tickTimer); clearInterval(this.castTimer);
  }
}

module.exports = { Room, LOBBY_SECS, TICK_HZ, BROADCAST_HZ, MAX_LORDS };
