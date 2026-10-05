// Interfaccia Ulti3: menu, lobby, partita, risultati. Online (WebSocket) o locale contro bot.
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const { Room } = UltiRoom;
  const { View } = UltiView;

  const BG = [0xa8, 0x81, 0x4a], BORDER_RGB = [0x3a, 0x24, 0x10];
  const ORD = ['1ST', '2ND', '3RD'];

  const cv = $('cv'), ctx = cv.getContext('2d');
  const view = new View();
  let net = null;            // { send(m), close() }
  let local = false;
  let lobby = null;          // ultimo messaggio 'lobby'
  let screen = 'menu';       // menu | connecting | lobby | game | results
  let resultsAt = 0, off = null, offCtx = null, img = null, wake = null;

  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) {} return null; }

  // ---------- schermate
  function show(s) {
    screen = s;
    for (const el of document.querySelectorAll('.screen')) el.classList.toggle('on', el.id === s);
    const inGame = s === 'game';
    cv.style.display = inGame ? 'block' : 'none';
    $('names').classList.toggle('on', inGame && view.phase === 'countdown');
    for (const b of ['btnL', 'btnR']) $(b).classList.toggle('on', inGame);
    $('count').style.display = inGame ? 'flex' : 'none';
    if (inGame) keepAwake();
  }
  function keepAwake() { try { if (navigator.wakeLock && !wake) navigator.wakeLock.request('screen').then(w => { wake = w; w.addEventListener('release', () => { wake = null; }); }).catch(() => {}); } catch (e) {} }
  function toMenu(msg) {
    if (net) { try { net.close(); } catch (e) {} net = null; }
    local = false; lobby = null; view.reset();
    $('msg').textContent = msg || '';
    show('menu');
  }

  // ---------- menu
  const params = new URLSearchParams(location.search);
  const inviteCode = (params.get('r') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  $('pname').value = store('ulti3name') || '';
  if (inviteCode.length === 4) {
    $('invite').style.display = 'block'; $('invCode').textContent = inviteCode;
    $('bEnter').style.display = 'inline-block';
    $('bCreate').className = 'alt'; $('jbox').style.display = 'none';
  }
  function myName() {
    const n = ($('pname').value || '').toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim().slice(0, 6);
    if (!n) { $('msg').textContent = 'SCRIVI IL TUO NOME'; $('pname').focus(); return null; }
    store('ulti3name', n); return n;
  }

  function connect(first) {
    Sound.init();
    $('msg').textContent = 'CONNESSIONE...';
    screen = 'connecting';
    const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
    let opened = false;
    net = { send: m => { if (ws.readyState === 1) ws.send(JSON.stringify(m)); }, close: () => { ws.onclose = null; ws.close(); } };
    ws.onopen = () => { opened = true; ws.send(JSON.stringify(first)); };
    ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch (x) { return; } onMsg(m); };
    ws.onclose = () => { net = null; toMenu(opened ? 'CONNESSIONE PERSA' : 'SERVER NON RAGGIUNGIBILE (SE E GRATUITO PUO IMPIEGARE 1 MINUTO A SVEGLIARSI, RIPROVA)'); };
  }

  $('bCreate').onclick = () => { const n = myName(); if (n) connect({ t: 'create', name: n }); };
  $('bEnter').onclick = () => { const n = myName(); if (n) connect({ t: 'join', room: inviteCode, name: n }); };
  $('bJoin').onclick = () => {
    const n = myName(); if (!n) return;
    const c = $('jcode').value.toUpperCase().replace(/[^A-Z]/g, '');
    if (c.length !== 4) { $('msg').textContent = 'IL CODICE HA 4 LETTERE'; return; }
    connect({ t: 'join', room: c, name: n });
  };
  $('bLocal').onclick = () => {
    const n = myName(); if (!n) return;
    Sound.init(); local = true;
    const room = new Room('LOCAL', { send: (cid, m) => queueMicrotask(() => onMsg(m)), setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: t => clearTimeout(t) });
    net = { send: m => room.handle(1, m), close: () => room.close() };
    room.join(1, n);
    for (let i = 0; i < 3; i++) room.handle(1, { t: 'addBot' });
  };

  // ---------- lobby
  function renderLobby() {
    const m = lobby;
    $('lcode').textContent = local ? 'LOCALE' : m.code;
    $('plist').innerHTML = m.players.map(p =>
      `<div class="pl"><span class="dot" style="background:${p.color}"></span>${p.name}${p.bot ? ' <span class="tag">BOT</span>' : ''}${p.you ? ' <span class="tag">TU</span>' : ''}${p.host ? ' <span class="tag">HOST</span>' : ''}</div>`).join('') +
      `<small>${m.players.length}/8 GIOCATORI</small>`;
    $('invbox').style.display = local ? 'none' : 'block';
    const link = location.origin + location.pathname + '?r=' + m.code;
    $('lurl').textContent = link;
    $('hostctl').style.display = m.host ? 'block' : 'none';
    $('lvl').value = m.cfg.level; $('speed').value = m.cfg.speed;
    $('bStart').disabled = m.players.length < 2;
    $('bAdd').disabled = m.players.length >= 8;
    $('wait').textContent = m.host ? (m.players.length < 2 ? 'SERVE ALMENO UN ALTRO GIOCATORE O UN BOT' : '') : 'ASPETTA CHE L\'HOST AVVII LA PARTITA...';
  }
  $('bAdd').onclick = () => net && net.send({ t: 'addBot' });
  $('bDel').onclick = () => net && net.send({ t: 'removeBot' });
  $('lvl').onchange = () => net && net.send({ t: 'cfg', level: +$('lvl').value, speed: lobby.cfg.speed });
  $('speed').onchange = () => net && net.send({ t: 'cfg', speed: +$('speed').value, level: lobby.cfg.level });
  $('bStart').onclick = () => { Sound.init(); net && net.send({ t: 'start' }); };
  $('bLeave').onclick = () => toMenu('');
  $('bShare').onclick = async () => {
    const link = location.origin + location.pathname + '?r=' + lobby.code;
    Sound.click();
    try {
      if (navigator.share) { await navigator.share({ title: 'ULTI3', text: 'Vieni a giocare a Ulti3!', url: link }); return; }
      await navigator.clipboard.writeText(link); $('bShare').textContent = 'LINK COPIATO!';
      setTimeout(() => { $('bShare').textContent = 'Invita: copia link'; }, 2000);
    } catch (e) { window.prompt('Copia il link:', link); }
  };
  $('snd').onclick = () => { const mu = Sound.toggle(); $('snd').textContent = 'SUONO: ' + (mu ? 'OFF' : 'ON'); };
  $('snd').textContent = 'SUONO: ' + (Sound.muted ? 'OFF' : 'ON');

  // ---------- messaggi dal server
  function onMsg(m) {
    switch (m.t) {
      case 'error': toMenu(m.msg); break;
      case 'lobby':
        lobby = m;
        if (m.state === 'lobby' || screen === 'menu' || screen === 'connecting') { $('msg').textContent = ''; renderLobby(); show('lobby'); }
        else if (screen === 'lobby') renderLobby();
        else if (screen === 'results') renderResultsFooter();
        break;
      case 'round':
        view.apply(m);
        off = document.createElement('canvas'); off.width = m.W; off.height = m.H;
        offCtx = off.getContext('2d'); img = offCtx.createImageData(m.W, m.H);
        cv.width = m.W * 4; cv.height = m.H * 4;
        $('names').innerHTML = m.players.map(p =>
          `<div class="${p.id === m.you ? 'me' : ''}" style="left:${Math.min(92, Math.max(8, p.x / m.W * 100))}%;top:${p.y / m.H * 100}%;color:${p.color}">${p.name}</div>`).join('');
        $('count').textContent = '3';
        show('game'); Sound.count(3);
        break;
      case 'count':
        view.apply(m);
        $('count').textContent = m.n > 0 ? m.n : '';
        Sound.count(m.n);
        if (m.n === 0) $('names').classList.remove('on');
        break;
      case 'tick':
        view.apply(m);
        if (m.d.dead.length) Sound.crash(m.d.dead.includes(view.you));
        break;
      case 'over':
        view.apply(m);
        endSound(m);
        showResults(m);
        break;
    }
  }

  function endSound(m) {
    const r = m.result;
    if (r.type === 'win') (r.ids[0] === view.you ? Sound.win : Sound.lose)();
    else if (r.type === 'escape') (r.ids[0] === view.you ? Sound.escape : Sound.lose)();
    else Sound.allCrashed();
  }

  // ---------- input
  function turn(side) { if (net && screen === 'game') { net.send({ t: 'turn', s: side }); Sound.turn(); } }
  function bindBtn(el, side) {
    el.addEventListener('pointerdown', e => { e.preventDefault(); el.classList.add('down'); turn(side); });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) el.addEventListener(ev, () => el.classList.remove('down'));
  }
  bindBtn($('btnL'), -1); bindBtn($('btnR'), 1);
  function nextRound() {
    if (screen === 'results' && lobby && lobby.host && performance.now() > resultsAt) net.send({ t: 'start' });
  }
  addEventListener('keydown', e => {
    if (e.repeat) return;
    if (screen === 'results') { if (e.target.tagName !== 'BUTTON') { e.preventDefault(); nextRound(); } return; }
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') { if (screen === 'game') { e.preventDefault(); turn(-1); } }
    else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') { if (screen === 'game') { e.preventDefault(); turn(1); } }
    else if (e.key === 'Enter' && screen === 'menu') { const t = e.target.id; if (t === 'jcode') $('bJoin').click(); else if (t === 'pname') ($('bEnter').style.display !== 'none' ? $('bEnter') : $('bCreate')).click(); }
  });
  $('results').addEventListener('pointerdown', e => {
    if (e.target.id === 'bBack') { net && net.send({ t: 'lobby' }); return; }
    if (e.target.id === 'bExit') { toMenu(''); return; }
    nextRound();
  });

  // ---------- risultati
  let lastOver = null;
  function showResults(m) {
    lastOver = m; resultsAt = performance.now() + 700;
    const r = m.result, sc = m.scores;
    let msg;
    if (r.type === 'win') msg = sc[r.ids[0] - 1].name + ' WINS GAME!';
    else if (r.type === 'escape') msg = sc[r.ids[0] - 1].name + ' ESCAPED!';
    else msg = 'ALL PLAYERS CRASHED!';
    const ord = m.round <= 3 ? ORD[m.round - 1] : m.round + 'TH';
    // classifica per TOTAL; a parità più kill totali, poi ordine di ingresso nella stanza
    const rows = sc.slice().sort((a, b) => b.total - a.total || b.totalKills - a.totalKills || a.id - b.id).map(p =>
      `<tr><td><span class="dot" style="background:${p.color}"></span> ${p.name}</td><td class="n">${p.r.game}</td><td class="n">${p.r.kills}</td><td class="n">${p.r.escape || '-'}</td><td class="n">${p.total}</td><td class="i">${p.totalKills}</td></tr>`).join('');
    $('results').innerHTML = `${ord}. GAME'S RESULTS...<br><span style="color:var(--white);text-shadow:1px 1px 0 var(--ink)">${msg}</span>
      <table><tr><th>SCORES:</th><th>GAME</th><th>KILLS</th><th>ESCAPE</th><th>TOTAL</th><th class="i">KILLS TOT</th></tr>${rows}</table><div id="foot"></div>`;
    show('results'); renderResultsFooter();
  }
  function renderResultsFooter() {
    const f = $('foot'); if (!f) return;
    const host = lobby && lobby.host;
    f.innerHTML = (host ? '<br>PRESS ANY KEY TO PLAY...<br><button id="bBack" class="alt">Torna alla lobby</button>' : '<br>IN ATTESA DELL\'HOST...<br>') + '<button id="bExit" class="alt">Esci</button>';
  }

  // ---------- disegno
  function hex(c) { return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]; }
  function draw(now) {
    requestAnimationFrame(draw);
    if (screen !== 'game' || !view.cells) return;
    const blink = view.phase === 'countdown' && (Math.floor(now / 250) & 1);
    if (!view.dirty && !blink && view.phase !== 'countdown') return;
    view.dirty = false;
    const d = img.data, cells = view.cells, n = cells.length, W = view.W;
    const pal = view.players.map(p => hex(p.color));
    for (let i = 0; i < n; i++) {
      const v = cells[i], o = i * 4;
      const c = v === 0 ? BG : v === 255 ? BORDER_RGB : pal[v - 1];
      d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
    }
    for (const p of view.players) { // testa della linea più chiara (il tuo punto lampeggia nel conto alla rovescia)
      if (!p.alive) continue;
      const big = view.phase === 'countdown' && p.id === view.you;
      for (let dy = big ? -1 : 0; dy <= (big ? 1 : 0); dy++) for (let dx = big ? -1 : 0; dx <= (big ? 1 : 0); dx++) {
        if (big && !blink) continue;
        const x = p.x + dx, y = p.y + dy;
        if (x < 0 || y < 0 || x >= W || y >= view.H) continue;
        const o = (y * W + x) * 4; d[o] = 255; d[o + 1] = 246; d[o + 2] = 224;
      }
      const o = (p.y * W + p.x) * 4; d[o] = 255; d[o + 1] = 246; d[o + 2] = 224;
    }
    for (const [x, y] of view.sparks) {
      if (x < 0 || y < 0 || x >= W || y >= view.H) continue;
      const o = (y * W + x) * 4; d[o] = 255; d[o + 1] = 235; d[o + 2] = 160;
    }
    offCtx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0, cv.width, cv.height);
  }
  requestAnimationFrame(draw);

  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
  window.__ulti3 = { view, get screen() { return screen; }, get lobby() { return lobby; } }; // per i test
  show('menu');
})();
