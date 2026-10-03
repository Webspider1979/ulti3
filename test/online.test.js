// Test: stanza + protocollo. Il client ricostruito dai messaggi deve combaciare con il gioco reale del server.
const assert = require('assert');
const { Room } = require('../public/room.js');
const { View } = require('../public/view.js');

function run(label, nBots, humansTurn) {
  return new Promise(resolve => {
    let fired = false; const views = new Map(), lobby = new Map(), msgs = [];
    const io = { send(cid, m) { msgs.push([cid, m.t]); if (m.t === 'lobby') lobby.set(cid, m); else views.get(cid).apply(m); if (m.t === 'over' && !fired) { fired = true; setImmediate(done); } },
      setTimeout: (f, ms) => setTimeout(f, Math.min(ms, 1)), clearTimeout };
    const room = new Room('TEST', io);
    for (const cid of [1, 2]) { views.set(cid, new View()); assert.deepStrictEqual(room.join(cid, 'p' + cid), {}); }
    assert.strictEqual(room.host, 1);
    for (let i = 0; i < nBots; i++) room.handle(1, { t: 'addBot' });
    room.handle(2, { t: 'addBot' });              // un non-host non può
    assert.strictEqual(room.entries.length, 2 + nBots);
    room.handle(2, { t: 'start' });               // idem
    assert.strictEqual(room.state, 'lobby');
    room.handle(1, { t: 'cfg', speed: 55, level: 2 });
    room.handle(1, { t: 'start' });
    assert.strictEqual(room.state, 'countdown');
    assert.deepStrictEqual(room.join(3, 'late'), { error: 'PARTITA IN CORSO, RIPROVA TRA POCO' });
    let n = 0;
    const iv = setInterval(() => { if (room.state === 'playing') { room.handle(1, { t: 'turn', s: n++ % 2 ? 1 : -1 }); room.handle(2, { t: 'turn', s: 1 }); } }, 3);
    function done() {
      clearInterval(iv);
      const g = room.game;
      for (const v of views.values()) {
        assert.ok(Buffer.from(v.cells).equals(Buffer.from(g.cells)), label + ': campo client diverso da quello del server');
        assert.strictEqual(v.phase, 'results');
        assert.strictEqual(v.over.scores.length, 2 + nBots);
      }
      assert.strictEqual(views.get(1).you, 1); assert.strictEqual(views.get(2).you, 2);
      assert.strictEqual(room.state, 'results');
      // secondo round dal host, poi uscita di un client a metà
      room.handle(2, { t: 'start' }); assert.strictEqual(room.state, 'results'); // non host
      room.handle(1, { t: 'start' }); assert.strictEqual(room.state, 'countdown');
      assert.strictEqual(views.get(1).round, 2);
      room.leave(2);
      assert.strictEqual(room.host, 1);
      room.close();
      console.log('ok', label, 'messaggi:', msgs.length);
      resolve();
    }
  });
}
(async () => { await run('2 umani + 2 bot', 2); await run('2 umani + 6 bot (8)', 6); console.log('TUTTO OK'); })().catch(e => { console.error(e); process.exit(1); });
