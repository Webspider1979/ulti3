// Verifica le regole di punteggio con i 3 round dell'esempio approvato (4 giocatori: JIM, JOM, ZED, TIM).
const assert = require('assert');
const { Game } = require('../public/game.js');

function mk() {
  const g = new Game();
  for (const n of ['JIM', 'JOM', 'ZED', 'TIM']) g.addPlayer({ name: n, color: '#000' });
  return g;
}
// setta lo stato d'uscita: out = { NOME: tick } ; chi non è in out è vivo; kills = { NOME: n }
function round(g, out, kills, res) {
  g.newRound();
  for (const p of g.players) {
    p.alive = !(p.name in out); p.deathTick = p.alive ? -1 : out[p.name];
    p.r.kills = kills[p.name] || 0;
  }
  g._finish(res);
  return Object.fromEntries(g.players.map(p => [p.name, [p.r.game, p.r.kills, p.r.escape, p.total, p.totalKills]]));
}
const g = mk();
// Round 1: JOM 1°, ZED 2°, JIM e TIM insieme (3°/4° -> media 3)
let r = round(g, { JOM: 10, ZED: 20, JIM: 30, TIM: 30 }, { TIM: 2, JIM: 1 }, { type: 'crash', ids: [1, 4] });
assert.deepStrictEqual(r, { JIM: [4, 1, 0, 4, 1], JOM: [0, 0, 0, 0, 0], ZED: [1, 0, 0, 1, 0], TIM: [5, 2, 0, 5, 2] });
// Round 2: escape di JOM (8 = 2x4) con 1 kill; gli altri solo kill
r = round(g, { ZED: 10, TIM: 20, JOM: 30 }, { JOM: 1 }, { type: 'escape', ids: [2] });
assert.deepStrictEqual(r, { JIM: [0, 0, 0, 4, 1], JOM: [9, 1, 8, 9, 1], ZED: [0, 0, 0, 1, 0], TIM: [0, 0, 0, 5, 2] });
// Round 3: TIM 1°, JOM e ZED insieme (2°/3° -> media 1,5 -> 2), JIM vince
r = round(g, { TIM: 10, JOM: 20, ZED: 20 }, { JIM: 1, ZED: 1 }, { type: 'win', ids: [1] });
assert.deepStrictEqual(r, { JIM: [5, 1, 0, 9, 2], JOM: [2, 0, 0, 11, 1], ZED: [3, 1, 0, 4, 1], TIM: [0, 0, 0, 5, 2] });

// tabella N = 2..8: posti 0,1,..N-2 e vincitore N; tutti insieme al primo tick = media arrotondata
for (let N = 2; N <= 8; N++) {
  const h = new Game();
  for (let i = 0; i < N; i++) h.addPlayer({ name: 'P' + i, color: '#000' });
  h.newRound();
  h.players.forEach((p, i) => { p.alive = i === N - 1; p.deathTick = i < N - 1 ? i + 1 : -1; });
  h._finish({ type: 'win', ids: [N] });
  assert.deepStrictEqual(h.players.map(p => p.r.place), [...Array(N - 1).keys(), N]);
  h.newRound(); h.players.forEach(p => { p.alive = false; p.deathTick = 5; }); h._finish({ type: 'crash', ids: [] });
  const vals = [...Array(N - 1).keys(), N], avg = Math.ceil(vals.reduce((a, b) => a + b, 0) / N);
  assert.ok(h.players.every(p => p.r.place === avg), 'tutti insieme N=' + N);
  h.newRound(); h._finish({ type: 'escape', ids: [1] });
  assert.strictEqual(h.players[0].r.escape, 2 * N);
}
// kill: scia di un giocatore già morto non conta; scontro frontale +1 a entrambi
{
  const h = new Game({ W: 40, H: 20 });
  h.addPlayer({ name: 'A', color: '#000' }); h.addPlayer({ name: 'B', color: '#000' });
  h.newRound();
  const [a, b] = h.players;
  a.x = 10; a.y = 10; a.dir = 0; b.x = 12; b.y = 10; b.dir = 2; // si incontrano nella cella 11
  h.cells.fill(0); h.cells[10 * 40 + 10] = 1; h.cells[10 * 40 + 12] = 2;
  h.tick();
  assert.strictEqual(a.r.kills, 1); assert.strictEqual(b.r.kills, 1);
  assert.strictEqual(h.result.type, 'crash');
  const k = new Game({ W: 40, H: 20 });
  k.addPlayer({ name: 'A', color: '#000' }); k.addPlayer({ name: 'B', color: '#000' }); k.addPlayer({ name: 'C', color: '#000' });
  k.newRound();
  const [x, y, z] = k.players;
  k.cells.fill(0);
  y.alive = false; y.deathTick = 1; k.cells[10 * 40 + 11] = 2;          // scia di B (già morto)
  x.x = 10; x.y = 10; x.dir = 0; k.cells[10 * 40 + 10] = 1;             // A va a sbattere su B
  z.x = 30; z.y = 15; z.dir = 0; k.cells[15 * 40 + 30] = 3;
  k.tick();
  assert.strictEqual(y.r.kills, 0, 'scia di un morto non dà kill');
}
console.log('SCORING OK');
