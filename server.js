// Server Ulti3: serve i file della web app e le stanze di gioco via WebSocket.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { Room } = require('./public/room.js');

const PORT = process.env.PORT || 8133;
const PUBLIC = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/healthz') { res.writeHead(200); return res.end('ok'); }
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 1024 });
const rooms = new Map();    // codice -> Room
const sockets = new Map();  // cid -> ws
let nextCid = 1;

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
function newCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += LETTERS[Math.floor(Math.random() * LETTERS.length)];
    if (!rooms.has(c)) return c;
  }
}

const io = {
  send(cid, msg) {
    const ws = sockets.get(cid);
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
  },
  setTimeout, clearTimeout,
};

function dropRoom(room) {
  if (room.closed || room.isEmpty()) { room.close(); rooms.delete(room.code); }
}

wss.on('connection', ws => {
  const cid = nextCid++;
  sockets.set(cid, ws);
  ws.isAlive = true;
  let room = null;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m.t !== 'string') return;
    if (!room) {
      if (m.t === 'create') {
        if (rooms.size > 200) return io.send(cid, { t: 'error', msg: 'SERVER PIENO, RIPROVA PIU TARDI' });
        room = new Room(newCode(), io);
        rooms.set(room.code, room);
        room.join(cid, m.name);
      } else if (m.t === 'join') {
        const r = rooms.get(String(m.room || '').toUpperCase());
        if (!r) return io.send(cid, { t: 'error', msg: 'STANZA NON TROVATA' });
        const res = r.join(cid, m.name);
        if (res.error) return io.send(cid, { t: 'error', msg: res.error });
        room = r;
      }
      return;
    }
    room.handle(cid, m);
  });
  ws.on('close', () => {
    sockets.delete(cid);
    if (room) { room.leave(cid); dropRoom(room); }
  });
  ws.on('error', () => {});
});

// elimina i collegamenti morti (e tiene sveglia la connessione sui servizi gratuiti)
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false; ws.ping();
  }
}, 25000);

server.listen(PORT, () => console.log('Ulti3 in ascolto sulla porta ' + PORT));
