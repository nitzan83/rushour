/* ============================================================
   audio.js — synthesized SFX, wired purely through the EventBus.
   No asset files: every sound is generated with WebAudio. This module
   only SUBSCRIBES to game events — it never touches game logic (seam 4).
   ============================================================ */
(() => {
  'use strict';
  const RH = window.RH;
  if (!RH || !RH.bus) return; // nothing to attach to

  const MUTE_KEY = 'rushhour_muted';
  let muted = false;
  try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch {}

  let ctx = null;
  function ac() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); } catch { ctx = null; }
    return ctx;
  }

  // A simple synth voice: one oscillator through a gain envelope.
  function tone(freq, t0, dur, { type = 'square', gain = 0.12, slideTo = null } = {}) {
    const c = ac();
    if (!c) return;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  // White-noise burst (for the "miss" error sound).
  function noise(t0, dur, gain = 0.12) {
    const c = ac();
    if (!c) return;
    const n = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, n, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = c.createBufferSource();
    const g = c.createGain();
    g.gain.value = gain;
    src.buffer = buf;
    src.connect(g).connect(c.destination);
    src.start(t0);
  }

  // play a sequence of [freqOffsetSeconds, freq, dur, opts]
  function play(notes) {
    const c = ac();
    if (!c || muted) return;
    if (c.state === 'suspended') c.resume().catch(() => {});
    const now = c.currentTime;
    for (const [at, freq, dur, opts] of notes) tone(freq, now + at, dur, opts);
  }

  const SFX = {
    pickup: () => play([[0, 520, 0.09, { type: 'triangle' }], [0.06, 720, 0.09, { type: 'triangle' }]]),
    deliver: () => play([[0, 660, 0.10, { type: 'square' }], [0.08, 880, 0.14, { type: 'square' }]]),
    powerup: () => play([[0, 600, 0.07], [0.05, 800, 0.07], [0.10, 1100, 0.10], [0.15, 1500, 0.12]]),
    levelup: () => play([[0, 523, 0.10], [0.10, 659, 0.10], [0.20, 784, 0.16]]),
    miss: () => { if (!muted) { const c = ac(); if (c) { if (c.state === 'suspended') c.resume().catch(() => {}); tone(180, c.currentTime, 0.22, { type: 'sawtooth', gain: 0.14, slideTo: 90 }); noise(c.currentTime, 0.18, 0.06); } } },
    gameover: () => play([[0, 440, 0.18, { type: 'sawtooth' }], [0.16, 330, 0.20, { type: 'sawtooth' }], [0.34, 220, 0.30, { type: 'sawtooth' }]]),
  };

  // Subscribe to game events. Adding a sound never touches game logic.
  RH.bus.on('order:pickup', SFX.pickup);
  RH.bus.on('order:delivered', SFX.deliver);
  RH.bus.on('powerup:grabbed', SFX.powerup);
  RH.bus.on('level:up', SFX.levelup);
  RH.bus.on('order:missed', SFX.miss);
  RH.bus.on('run:over', SFX.gameover);

  // Public control for the mute button / tests.
  RH.audio = {
    get muted() { return muted; },
    setMuted(v) {
      muted = !!v;
      try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch {}
      const btn = document.getElementById('mute-btn');
      if (btn) btn.textContent = muted ? '🔇' : '🔊';
    },
    toggle() { RH.audio.setMuted(!muted); return muted; },
  };

  // Wire the mute button + 'M' key, and unlock the context on first gesture.
  function init() {
    const btn = document.getElementById('mute-btn');
    if (btn) {
      btn.textContent = muted ? '🔇' : '🔊';
      btn.addEventListener('click', () => RH.audio.toggle());
    }
    window.addEventListener('keydown', e => { if (e.key.toLowerCase() === 'm') RH.audio.toggle(); });
    const unlock = () => { const c = ac(); if (c && c.state === 'suspended') c.resume().catch(() => {}); };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
