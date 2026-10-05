// Motore di gioco Ulti3 — logica pura, nessun accesso a DOM/rete.
// Gira nel browser (prototipo locale) e in Node (futuro server online).
(function (root) {
  'use strict';

  const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]]; // destra, giù, sinistra, su
  const EMPTY = 0;
  const BORDER = 255;

  const DEFAULTS = {
    W: 160,
    H: 90,
    // punti: kill = 1 ciascuna; escape = escapeMult x N; il piazzamento si calcola in _finish
    scoring: { kill: 1, escapeMult: 2 },
    spark: { count: 14, speed: 1.6, life: 4 },
  };

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Campo vuoto con il bordo: usato sia dal server sia dai client per ricostruire lo stato.
  function makeField(W, H) {
    const c = new Uint8Array(W * H);
    for (let x = 0; x < W; x++) { c[x] = BORDER; c[(H - 1) * W + x] = BORDER; }
    for (let y = 0; y < H; y++) { c[y * W] = BORDER; c[y * W + W - 1] = BORDER; }
    return c;
  }

  class Game {
    constructor(opts) {
      opts = opts || {};
      this.W = opts.W || DEFAULTS.W;
      this.H = opts.H || DEFAULTS.H;
      this.scoring = Object.assign({}, DEFAULTS.scoring, opts.scoring);
      this.sparkCfg = Object.assign({}, DEFAULTS.spark, opts.spark);
      this.rng = opts.rng || mulberry32((Math.random() * 2 ** 32) >>> 0);
      this.cells = new Uint8Array(this.W * this.H);
      this.players = [];
      this.sparks = [];
      this.round = 0;
      this.t = 0;
      this.over = true;
      this.result = null;
    }

    addPlayer(p) {
      const id = this.players.length + 1;
      this.players.push({
        id, name: p.name, color: p.color, bot: !!p.bot, level: p.level == null ? 1 : p.level,
        x: 0, y: 0, dir: 0, alive: false, pending: 0, deathTick: -1, escaped: false,
        r: { game: 0, kills: 0, escape: 0, place: 0 }, total: 0, totalKills: 0,
      });
      return id;
    }

    // Posizioni di partenza: con 2 giocatori come nel video, altrimenti su un'ellisse verso il centro.
    _layout() {
      const n = this.players.length, W = this.W, H = this.H;
      if (n === 2) {
        const y = Math.round(H * 0.25);
        return [
          { x: Math.round(W * 0.16), y, dir: 0 },
          { x: Math.round(W * 0.84), y, dir: 2 },
        ];
      }
      const out = [];
      const off = this.rng() * Math.PI * 2;
      for (let i = 0; i < n; i++) {
        const a = off + (i / n) * Math.PI * 2;
        const x = Math.round(W / 2 + Math.cos(a) * W * 0.36);
        const y = Math.round(H / 2 + Math.sin(a) * H * 0.36);
        const dx = W / 2 - x, dy = H / 2 - y;
        const dir = Math.abs(dx) / W > Math.abs(dy) / H ? (dx > 0 ? 0 : 2) : (dy > 0 ? 1 : 3);
        out.push({ x, y, dir });
      }
      return out;
    }

    newRound() {
      const W = this.W;
      this.cells = makeField(W, this.H);
      const c = this.cells;
      this.delta = null;
      this.sparks = [];
      this.round++;
      this.t = 0;
      this.over = false;
      this.result = null;
      const lay = this._layout();
      this.players.forEach((p, i) => {
        p.x = lay[i].x; p.y = lay[i].y; p.dir = lay[i].dir;
        p.alive = true; p.pending = 0; p.deathTick = -1; p.escaped = false;
        p.r = { game: 0, kills: 0, escape: 0, place: 0 };
        c[p.y * W + p.x] = p.id;
      });
    }

    // side: -1 sinistra, +1 destra (relativo alla direzione di marcia)
    setTurn(id, side) {
      const p = this.players[id - 1];
      if (p && p.alive) p.pending = side;
    }

    _free(x, y) {
      return x >= 0 && y >= 0 && x < this.W && y < this.H && this.cells[y * this.W + x] === EMPTY;
    }

    _run(p, dir, max) {
      let n = 0, x = p.x, y = p.y;
      const d = DIRS[dir];
      while (n < max) {
        x += d[0]; y += d[1];
        if (!this._free(x, y)) break;
        n++;
      }
      return n;
    }

    _botThink(p) {
      const lvl = p.level; // 0 facile, 1 medio, 2 difficile
      const look = [2, 3, 5][lvl] || 3;
      const straight = this._run(p, p.dir, 20);
      const L = this._run(p, (p.dir + 3) & 3, 20);
      const R = this._run(p, (p.dir + 1) & 3, 20);
      const rnd = this.rng();
      if (straight < look) {
        if (L === 0 && R === 0) return;
        if (lvl === 0 && rnd < 0.25) return; // il facile a volte sbaglia
        p.pending = L === R ? (rnd < 0.5 ? -1 : 1) : (L > R ? -1 : 1);
      } else if (rnd < [0.05, 0.04, 0.03][lvl]) {
        const side = rnd < 0.5 * [0.05, 0.04, 0.03][lvl] ? -1 : 1;
        if ((side < 0 ? L : R) >= 8) p.pending = side;
      }
    }

    _emitSparks(x, y) {
      const s = this.sparkCfg;
      for (let i = 0; i < s.count; i++) {
        const a = this.rng() * Math.PI * 2;
        const v = s.speed * (0.6 + this.rng() * 0.8);
        this.sparks.push({ x: x + 0.5, y: y + 0.5, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: s.life + ((this.rng() * 3) | 0) });
      }
    }

    _stepSparks() {
      const W = this.W, H = this.H, c = this.cells, keep = [];
      for (const s of this.sparks) {
        let alive = true;
        for (let k = 0; k < 2 && alive; k++) { // 2 sotto-passi per non saltare celle
          s.x += s.vx / 2; s.y += s.vy / 2;
          const cx = Math.floor(s.x), cy = Math.floor(s.y);
          if (cx < 0 || cy < 0 || cx >= W || cy >= H) { alive = false; break; }
          if (c[cy * W + cx] !== EMPTY) { c[cy * W + cx] = EMPTY; if (this.delta) this.delta.c.push(cy * W + cx); } // buca scie e bordo
        }
        s.life--;
        if (alive && s.life > 0) keep.push(s);
      }
      this.sparks = keep;
      if (this.delta) this.delta.s = keep.map(s => [Math.floor(s.x), Math.floor(s.y)]);
    }

    // Scintille che continuano a correre dopo la fine del round (solo effetto grafico e buchi).
    afterglow() {
      this.delta = { h: [], dead: [], c: [], s: [] };
      this._stepSparks();
      return this.delta;
    }

    tick() {
      if (this.over) return;
      const W = this.W, H = this.H, c = this.cells;
      this.t++;
      this.delta = { h: [], dead: [], c: [], s: [] }; // cosa è cambiato in questo tick (per i client)
      const live = this.players.filter(p => p.alive);

      for (const p of live) if (p.bot) this._botThink(p);
      for (const p of live) {
        if (p.pending) { p.dir = (p.dir + (p.pending > 0 ? 1 : 3)) & 3; p.pending = 0; }
        p.nx = p.x + DIRS[p.dir][0];
        p.ny = p.y + DIRS[p.dir][1];
      }

      // fuga attraverso un buco nel bordo
      let escaper = null;
      for (const p of live) {
        if (p.nx < 0 || p.ny < 0 || p.nx >= W || p.ny >= H) { escaper = escaper || p; }
      }

      // celle bersaglio contese
      const claims = new Map();
      for (const p of live) {
        if (p === escaper || p.nx < 0 || p.ny < 0 || p.nx >= W || p.ny >= H) continue;
        const k = p.ny * W + p.nx;
        claims.set(k, (claims.get(k) || 0) + 1);
      }

      const crashed = [];
      for (const p of live) {
        if (p === escaper) continue;
        if (p.nx < 0 || p.ny < 0 || p.nx >= W || p.ny >= H) continue;
        const k = p.ny * W + p.nx, v = c[k];
        if (v !== EMPTY || claims.get(k) > 1) {
          crashed.push(p);
          // uccisione reale: scia di un avversario ancora vivo (o che muore in questo stesso tick)
          if (v !== EMPTY && v !== BORDER && v !== p.id) {
            const owner = this.players[v - 1];
            if (owner.alive) owner.r.kills++;
          }
        }
      }
      // scontro frontale (stessa cella): ogni giocatore uccide gli altri che l'hanno raggiunta
      for (const p of crashed) {
        const k = p.ny * W + p.nx;
        if (c[k] === EMPTY && claims.get(k) > 1) {
          p.r.kills += crashed.filter(q => q !== p && q.ny * W + q.nx === k).length;
        }
      }
      for (const p of live) {
        if (crashed.includes(p) || p === escaper) continue;
        p.x = p.nx; p.y = p.ny;
        c[p.y * W + p.x] = p.id;
        this.delta.h.push([p.id, p.x, p.y]);
      }
      for (const p of crashed) {
        p.alive = false; p.deathTick = this.t;
        this.delta.dead.push(p.id);
        this._emitSparks(p.nx, p.ny);
      }

      this._stepSparks();

      if (escaper) {
        escaper.alive = false; escaper.escaped = true; escaper.deathTick = this.t;
        this.delta.dead.push(escaper.id);
        return this._finish({ type: 'escape', ids: [escaper.id] });
      }
      const alive = this.players.filter(p => p.alive);
      if (alive.length === 1) return this._finish({ type: 'win', ids: [alive[0].id] });
      if (alive.length === 0) {
        const ids = this.players.filter(p => p.deathTick === this.t).map(p => p.id);
        return this._finish({ type: 'crash', ids });
      }
    }

    // Punteggio del round (N = giocatori totali, bot compresi):
    //  - senza escape: i posti per ordine di uscita valgono 0,1,2..N-2; l'ultimo rimasto N.
    //    Chi esce nello stesso tick prende la media dei posti contesi, arrotondata per eccesso.
    //  - con escape: solo chi fugge prende escapeMult x N; gli altri 0 di piazzamento.
    //  - in ogni caso ogni uccisione vale scoring.kill.
    _finish(res) {
      this.over = true;
      this.result = res;
      const sc = this.scoring, ps = this.players, N = ps.length;
      if (res.type === 'escape') {
        ps[res.ids[0] - 1].r.escape = sc.escapeMult * N;
      } else {
        const order = ps.slice().sort((a, b) => (a.alive ? Infinity : a.deathTick) - (b.alive ? Infinity : b.deathTick));
        let pos = 1;
        for (let i = 0; i < order.length;) {
          let j = i;
          const key = order[i].alive ? Infinity : order[i].deathTick;
          while (j < order.length && (order[j].alive ? Infinity : order[j].deathTick) === key) j++;
          let sum = 0;
          for (let k = pos; k < pos + (j - i); k++) sum += k === N ? N : k - 1;
          const pts = Math.ceil(sum / (j - i));
          for (let m = i; m < j; m++) order[m].r.place = pts;
          pos += j - i; i = j;
        }
      }
      for (const p of ps) {
        p.r.game = p.r.place + p.r.escape + p.r.kills * sc.kill;
        p.total += p.r.game;
        p.totalKills += p.r.kills;
      }
    }
  }

  const api = { Game, makeField, DIRS, EMPTY, BORDER, mulberry32 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Ulti3 = api;
})(typeof self !== 'undefined' ? self : this);
