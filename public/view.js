// Ricostruisce il campo sul client dai messaggi del server (round, tick, over). Nessuna dipendenza dal DOM.
(function (root) {
  'use strict';
  const G = (typeof require !== 'undefined' && typeof module !== 'undefined' && module.exports) ? require('./game.js') : root.Ulti3;

  class View {
    constructor() { this.reset(); }
    reset() {
      this.W = 0; this.H = 0; this.cells = null; this.players = []; this.sparks = [];
      this.you = 0; this.round = 0; this.count = null; this.phase = 'idle'; this.over = null; this.dirty = true;
    }
    apply(m) {
      switch (m.t) {
        case 'round': {
          this.W = m.W; this.H = m.H; this.round = m.round; this.you = m.you; this.speed = m.speed;
          this.cells = G.makeField(m.W, m.H);
          this.players = m.players.map(p => ({ ...p, alive: true }));
          for (const p of this.players) this.cells[p.y * m.W + p.x] = p.id;
          this.sparks = []; this.count = 3; this.phase = 'countdown'; this.over = null;
          break;
        }
        case 'count':
          this.count = m.n;
          if (m.n === 0) this.phase = 'playing';
          break;
        case 'tick': {
          const d = m.d, W = this.W;
          for (const [id, x, y] of d.h) { this.cells[y * W + x] = id; const p = this.players[id - 1]; p.x = x; p.y = y; }
          for (const i of d.c) this.cells[i] = 0;
          for (const id of d.dead) this.players[id - 1].alive = false;
          this.sparks = d.s;
          break;
        }
        case 'over':
          this.over = m; this.phase = 'results';
          break;
      }
      this.dirty = true;
    }
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { View };
  else root.UltiView = { View };
})(typeof self !== 'undefined' ? self : this);
