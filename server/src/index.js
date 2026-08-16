'use strict';
// Bannerfront game server.
//
// Serves the static client and runs authoritative matches over Socket.IO.
// The client never advances the simulation — it sends intents and draws what
// comes back.

const http = require('http');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');
const { Room, MAX_LORDS } = require('./room.js');
const db = require('./db.js');

const PORT = process.env.PORT || 8080;
const ROOT = path.resolve(__dirname, '../..');

// Only these may open a socket. Set ALLOWED_ORIGINS on the host to your site,
// comma separated; localhost is always allowed so development keeps working.
const ALLOWED = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);
function originOk(origin){
  if (!origin) return true;                       // same-origin / native clients
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  return ALLOWED.length === 0 || ALLOWED.includes(origin);
}

// ------------------------------------------------------------ static client
const TYPES = {
  '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.json':'application/json',
  '.png':'image/png', '.svg':'image/svg+xml', '.ico':'image/x-icon',
};
// ------------------------------------------------------------------ the API
// Accounts ride the same HTTP server as the client. Everything is JSON, the
// token travels as a Bearer header, and sign-in attempts are rate-limited per
// address so the ledger cannot be ground through.
const attempts = new Map();   // ip -> { n, resetAt }
function throttled(ip){
  const t = Date.now();
  const a = attempts.get(ip) || { n: 0, resetAt: t + 600e3 };
  if (t > a.resetAt){ a.n = 0; a.resetAt = t + 600e3; }
  a.n++; attempts.set(ip, a);
  return a.n > 30;
}
function api(req, res){
  const url = (req.url || '').split('?')[0];
  if (!url.startsWith('/api/')) return false;
  // The client is served from Netlify and the server lives on Railway, so every
  // account call is cross-origin. Socket.IO carries its own CORS config; plain
  // fetch does not, and without these headers the browser refuses the response
  // in production while working perfectly on localhost. Same allow-list as the
  // socket, and the Bearer header has to be named or the preflight fails.
  const origin = req.headers.origin;
  const cors = originOk(origin) && origin ? {
    'Access-Control-Allow-Origin': origin,
    'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
  } : {};
  if (req.method === 'OPTIONS'){ res.writeHead(204, cors); res.end(); return true; }
  const send = (code, obj) => {
    res.writeHead(code, Object.assign({ 'Content-Type': 'application/json' }, cors));
    res.end(JSON.stringify(obj));
  };
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  if (req.method === 'GET'){
    if (url === '/api/me'){
      const a = db.resolve(token);
      if (!a) return send(401, { err: 'not signed in' }), true;
      const { id, ...pub } = a;   // the row id is the server's business
      return send(200, { account: pub }), true;
    }
    if (url === '/api/leaderboard') return send(200, { lords: db.leaderboard() }), true;
    return send(404, { err: 'no such scroll' }), true;
  }
  if (req.method !== 'POST') return send(405, { err: 'wrong method' }), true;
  let body = '';
  req.on('data', d => { body += d; if (body.length > 4096) req.destroy(); });
  req.on('end', () => {
    let msg = {};
    try { msg = JSON.parse(body || '{}'); } catch (e) { return send(400, { err: 'bad json' }); }
    if (url === '/api/signup' || url === '/api/login'){
      if (throttled(req.socket.remoteAddress || '?')) return send(429, { err: 'too many attempts — rest a while' });
      const r = url === '/api/signup' ? db.signup(msg.name, msg.pass) : db.login(msg.name, msg.pass);
      return send(r.err ? 400 : 200, r);
    }
    if (url === '/api/logout') return send(200, db.logout(token));
    return send(404, { err: 'no such scroll' });
  });
  return true;
}

const server = http.createServer((req, res) => {
  if (req.url === '/healthz'){
    res.writeHead(200, { 'Content-Type':'application/json' });
    return res.end(JSON.stringify({ ok:true, rooms: rooms.size, ledger: db.enabled,
      ledgerAt: db.where, onVolume: db.onVolume, uptime: process.uptime() }));
  }
  if (api(req, res)) return;
  let rel = decodeURIComponent((req.url || '/').split('?')[0]);
  if (rel === '/') rel = '/index.html';
  const file = path.join(ROOT, rel);
  // never serve outside the project
  if (!file.startsWith(ROOT)){ res.writeHead(403); return res.end('no'); }
  fs.readFile(file, (err, buf) => {
    if (err){ res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(buf);
  });
});

const io = new Server(server, {
  cors: { origin: (origin, cb) => cb(null, originOk(origin)), methods: ['GET','POST'] },
  pingInterval: 10000,
  pingTimeout: 20000,
});

// ------------------------------------------------------------------- rooms
const rooms = new Map();

// One lobby gathers players at a time; when it starts, the next arrival opens
// a fresh one. That is what makes the 60-second countdown meaningful instead of
// leaving the first player waiting for a full house.
function openLobby(){
  for (const r of rooms.values()) if (r.phase === 'lobby') return r;
  const r = new Room(io, { lords: MAX_LORDS });
  rooms.set(r.id, r);
  return r;
}

setInterval(() => {
  for (const [id, r] of rooms){
    if (r.phase === 'done'){ r.close(); rooms.delete(id); }
  }
}, 30000);

io.on('connection', socket => {
  if (!originOk(socket.handshake.headers.origin)){
    socket.emit('denied', { why: 'origin not allowed' });
    return socket.disconnect(true);
  }
  let room = null;

  socket.on('join', msg => {
    if (room) return;
    room = openLobby();
    // A signed-in player's seat carries their account, so the match result can
    // be written to the ledger when the war ends. Anonymous play stays welcome.
    const acct = db.resolve(msg && msg.token);
    room.addSeat(socket, msg && msg.name, msg && msg.colour, acct ? acct.id : null);
  });

  socket.on('intent', msg => { if (room) room.intent(socket.id, msg); });

  // Any player may call the muster early once someone is waiting.
  socket.on('beginNow', () => { if (room && room.phase === 'lobby') room.begin(); });

  socket.on('disconnect', () => { if (room) room.dropSeat(socket.id); });
});

server.listen(PORT, () => {
  console.log(`bannerfront server on :${PORT}`);
  console.log(`  allowed origins: ${ALLOWED.length ? ALLOWED.join(', ') : '(any — set ALLOWED_ORIGINS)'}`);
});
