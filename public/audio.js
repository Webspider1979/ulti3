// Effetti sonori 8-bit generati al volo con WebAudio (nessun file da scaricare).
(function (root) {
  'use strict';
  let ctx = null, master = null, noiseBuf = null;
  let muted = false;
  try { muted = localStorage.getItem('ulti3mute') === '1'; } catch (e) {}

  function init() { // va chiamata dentro un tocco/click dell'utente
    try {
      if (!ctx) {
        const AC = root.AudioContext || root.webkitAudioContext;
        if (!AC) return;
        ctx = new AC();
        master = ctx.createGain(); master.gain.value = muted ? 0 : 0.6; master.connect(ctx.destination);
        noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.6, ctx.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      if (ctx.state === 'suspended') ctx.resume();
    } catch (e) {}
  }

  function tone(freq, dur, o) {
    if (!ctx || muted) return;
    o = o || {};
    const t0 = ctx.currentTime + (o.delay || 0);
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = o.type || 'square';
    osc.frequency.setValueAtTime(freq, t0);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t0 + dur);
    const v = o.vol == null ? 0.18 : o.vol;
    g.gain.setValueAtTime(v, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(master);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
  }

  function noise(dur, o) {
    if (!ctx || muted) return;
    o = o || {};
    const t0 = ctx.currentTime + (o.delay || 0);
    const src = ctx.createBufferSource(); src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass';
    f.frequency.setValueAtTime(o.f0 || 4000, t0); f.frequency.exponentialRampToValueAtTime(o.f1 || 300, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(o.vol == null ? 0.35 : o.vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t0); src.stop(t0 + dur + 0.02);
  }

  const Sound = {
    init,
    get muted() { return muted; },
    toggle() {
      muted = !muted;
      try { localStorage.setItem('ulti3mute', muted ? '1' : '0'); } catch (e) {}
      if (master) master.gain.value = muted ? 0 : 0.6;
      init();
      return muted;
    },
    count(n) { n > 0 ? tone(440, 0.12, { vol: 0.2 }) : tone(880, 0.35, { vol: 0.22 }); },
    turn() { tone(1500, 0.025, { vol: 0.06 }); },
    // scontro: scoppio + scintille; più grave se sei tu
    crash(mine) {
      noise(mine ? 0.5 : 0.3, { vol: mine ? 0.5 : 0.28 });
      tone(mine ? 220 : 340, mine ? 0.45 : 0.25, { to: 40, type: 'sawtooth', vol: mine ? 0.25 : 0.14 });
      for (let i = 0; i < 4; i++) tone(1800 + Math.random() * 2500, 0.04, { delay: 0.04 + i * 0.05, vol: 0.05 });
    },
    win() { [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, 0.14, { delay: i * 0.11, vol: 0.2 })); },
    lose() { [392, 330, 262, 196].forEach((f, i) => tone(f, 0.22, { delay: i * 0.18, type: 'triangle', vol: 0.25 })); },
    allCrashed() { noise(0.7, { vol: 0.3 }); tone(150, 0.7, { to: 40, type: 'sawtooth', vol: 0.2 }); },
    escape() { [392, 523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.12, { delay: i * 0.07, vol: 0.2 })); tone(1568, 0.5, { delay: 0.5, vol: 0.2 }); },
    click() { tone(660, 0.05, { vol: 0.12 }); },
  };
  root.Sound = Sound;
})(typeof self !== 'undefined' ? self : this);
