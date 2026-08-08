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
const server = http.createServer((req, res) => {
  if (req.url === '/healthz'){
    res.writeHead(200, { 'Content-Type':'application/json' });
    return res.end(JSON.stringify({ ok:true, rooms: rooms.size, uptime: process.uptime() }));
  }
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
    room.addSeat(socket, msg && msg.name, msg && msg.colour);
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
