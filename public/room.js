// Stanza di gioco: lobby, round, tick e messaggi. Logica pura, senza rete.
// Il server Node ne crea una per codice; il browser ne crea una "locale" per giocare da soli.
(function (root) {
  'use strict';
  const G = (typeof require !== 'undefined' && typeof module !== 'undefined' && module.exports) ? require('./game.js') : root.Ulti3;
  const { Game } = G;

  const COLORS = ['#3a1c08', '#1f4fa8', '#a8231f', '#1f7a2c', '#6b2a8c', '#0e7c86', '#b8560f', '#2d2d2d'];
  const BOT_NAMES = ['JOM', 'ZED', 'TIM', 'LEO', 'MAX', 'BOB', 'ANT', 'SAM'];
  const MAX_PLAYERS = 8;
  const GLOW_STEPS = 6;

  function cleanName(n) {
    n = String(n || '').toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim().slice(0, 6);
    return n || 'PLAYER';
  }

  class Room {
    // io: { send(cid, msg), setTimeout, clearTimeout }
    constructor(code, io) {
      this.code = code;
      this.io = io || { send() {}, setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: t => clearTimeout(t) };
      this.clients = new Map();   // cid -> { pid }
      this.entries = [];          // giocatori in lista: { pid, cid|null, name, bot }
      this.nextPid = 1;
      this.host = null;
      this.state = 'lobby';       // lobby | countdown | playing | results
      this.cfg = { speed: 80, level: 1 };
      this.totals = new Map();    // pid -> totale
      this.roundNo = 0;
      this.game = null;
      this.timer = null;
      this.gamePid = [];          // indice (id-1) -> pid
    }

    humans() { return this.entries.filter(e => e.cid != null); }
    isEmpty() { return this.humans().length === 0; }

    // ---- ingresso / uscita
    join(cid, name) {
      if (this.state === 'countdown' || this.state === 'playing') return { error: 'PARTITA IN CORSO, RIPROVA TRA POCO' };
      if (this.entries.length >= MAX_PLAYERS) return { error: 'STANZA PIENA (8 GIOCATORI)' };
      const e = { pid: this.nextPid++, cid, name: cleanName(name), bot: false };
      this.entries.push(e);
      this.clients.set(cid, { pid: e.pid });
      if (this.host == null) this.host = cid;
      this._broadcastLobby();
      return {};
    }

    leave(cid) {
      const cl = this.clients.get(cid);
      if (!cl) return;
      this.clients.delete(cid);
      const e = this.entries.find(x => x.pid === cl.pid);
      if (this.state === 'countdown' || this.state === 'playing') {
        if (e) { e.cid = null; e.left = true; }
        const idx = this.gamePid.indexOf(cl.pid);
        if (this.game && idx >= 0) { const p = this.game.players[idx]; p.bot = true; p.level = 1; } // diventa un bot
      } else if (e) {
        this.entries.splice(this.entries.indexOf(e), 1);
      }
      if (this.host === cid) {
        const nh = this.humans()[0];
        this.host = nh ? nh.cid : null;
      }
      if (this.isEmpty()) { this.close(); return; }
      this._broadcastLobby();
    }

    close() {
      if (this.timer) this.io.clearTimeout(this.timer);
      this.timer = null; this.closed = true;
    }

    // ---- messaggi dai client
    handle(cid, m) {
      if (this.closed || !m || typeof m.t !== 'string') return;
      const isHost = cid === this.host;
      switch (m.t) {
        case 'turn': {
          const cl = this.clients.get(cid);
          if (!cl || !this.game || (this.state !== 'playing' && this.state !== 'countdown')) return;
          const idx = this.gamePid.indexOf(cl.pid);
          if (idx >= 0 && (m.s === -1 || m.s === 1)) this.game.setTurn(idx + 1, m.s);
          break;
        }
        case 'addBot':
          if (isHost && this.state !== 'countdown' && this.state !== 'playing' && this.entries.length < MAX_PLAYERS) {
            const used = new Set(this.entries.map(e => e.name));
            const name = BOT_NAMES.find(n => !used.has(n)) || 'BOT' + this.nextPid;
            this.entries.push({ pid: this.nextPid++, cid: null, name, bot: true });
            this._broadcastLobby();
          }
          break;
        case 'removeBot':
          if (isHost && this.state !== 'countdown' && this.state !== 'playing') {
            for (let i = this.entries.length - 1; i >= 0; i--) if (this.entries[i].bot) { this.entries.splice(i, 1); break; }
            this._broadcastLobby();
          }
          break;
        case 'cfg':
          if (isHost) {
            if ([110, 80, 55].includes(m.speed)) this.cfg.speed = m.speed;
            if ([0, 1, 2].includes(m.level)) this.cfg.level = m.level;
            this._broadcastLobby();
          }
          break;
        case 'start':
          if (isHost && (this.state === 'lobby' || this.state === 'results') && this.entries.length >= 2) this._startRound();
          break;
        case 'lobby':
          if (isHost && this.state === 'results') {
            this.entries = this.entries.filter(e => !e.left);
            this.state = 'lobby'; this._broadcastLobby();
          }
          break;
      }
    }

    // ---- invio
    _all(msg) { for (const cid of this.clients.keys()) this.io.send(cid, msg); }

    _lobbyMsg(cid) {
      return {
        t: 'lobby', code: this.code, host: cid === this.host, state: this.state, cfg: this.cfg,
        players: this.entries.map((e, i) => ({ name: e.name, bot: e.bot, color: COLORS[i], you: e.cid === cid, host: e.cid === this.host && e.cid != null })),
      };
    }
    _broadcastLobby() { for (const cid of this.clients.keys()) this.io.send(cid, this._lobbyMsg(cid)); }

    // ---- round
    _startRound() {
      this.entries = this.entries.filter(e => !e.left);
      const g = new Game();
      this.gamePid = [];
      this.entries.forEach((e, i) => {
        g.addPlayer({ name: e.name, color: COLORS[i], bot: e.bot, level: this.cfg.level });
        const t = this.totals.get(e.pid) || { total: 0, kills: 0 };
        g.players[i].total = t.total; g.players[i].totalKills = t.kills;
        this.gamePid.push(e.pid);
      });
      g.round = this.roundNo;
      g.newRound();
      this.roundNo = g.round;
      this.game = g;
      this.state = 'countdown';
      for (const cid of this.clients.keys()) {
        const cl = this.clients.get(cid);
        this.io.send(cid, {
          t: 'round', round: g.round, W: g.W, H: g.H, speed: this.cfg.speed,
          you: this.gamePid.indexOf(cl.pid) + 1,
          players: g.players.map(p => ({ id: p.id, name: p.name, color: p.color, x: p.x, y: p.y, dir: p.dir, total: p.total })),
        });
      }
      this._broadcastLobbyState();
      let n = 3;
      this._all({ t: 'count', n });
      const step = () => {
        if (this.closed) return;
        n--;
        if (n > 0) { this._all({ t: 'count', n }); this.timer = this.io.setTimeout(step, 800); }
        else { this._all({ t: 'count', n: 0 }); this.state = 'playing'; this._tickLoop(); }
      };
      this.timer = this.io.setTimeout(step, 800);
    }

    _broadcastLobbyState() { /* lo stato cambia: i client lo leggono da 'round' */ }

    _tickLoop() {
      if (this.closed) return;
      const g = this.game;
      g.tick();
      this._all({ t: 'tick', d: g.delta });
      if (g.over) return this._glow(0);
      const humanAlive = g.players.some(p => p.alive && !p.bot);
      const step = humanAlive ? this.cfg.speed : Math.max(12, this.cfg.speed / 4);
      this.timer = this.io.setTimeout(() => this._tickLoop(), step);
    }

    _glow(k) {
      if (this.closed) return;
      if (k < GLOW_STEPS) {
        this._all({ t: 'tick', d: this.game.afterglow() });
        this.timer = this.io.setTimeout(() => this._glow(k + 1), 70);
        return;
      }
      const g = this.game;
      g.players.forEach((p, i) => this.totals.set(this.gamePid[i], { total: p.total, kills: p.totalKills }));
      this.state = 'results';
      this._all({
        t: 'over', round: g.round, result: g.result,
        scores: g.players.map(p => ({ id: p.id, name: p.name, color: p.color, r: p.r, total: p.total, totalKills: p.totalKills })),
      });
      this._broadcastLobby();
    }
  }

  const api = { Room, COLORS, MAX_PLAYERS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.UltiRoom = api;
})(typeof self !== 'undefined' ? self : this);
