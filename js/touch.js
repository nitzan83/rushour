/* ============================================================
   touch.js — mobile support: fit-to-screen scaling (all devices) +
   a virtual joystick and action button (touch devices only).
   Writes movement into RH.input and fires RH.action() for pick up/deliver.
   ============================================================ */
(() => {
  'use strict';
  const RH = window.RH;
  const wrap = document.getElementById('game-wrap');

  /* ---- fit the fixed 960×640 stage to any viewport ---- */
  function fit() {
    const s = Math.min(window.innerWidth / 960, window.innerHeight / 640);
    wrap.style.transform = `scale(${s})`;
  }
  window.addEventListener('resize', fit);
  window.addEventListener('orientationchange', fit);
  fit();

  /* ---- touch controls (only on touch devices) ---- */
  const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  if (!isTouch) return;
  document.body.classList.add('touch');

  // build the joystick (left) and action button (right) inside the stage
  const stick = document.createElement('div'); stick.id = 'touch-stick';
  const knob = document.createElement('div'); knob.id = 'touch-knob';
  stick.appendChild(knob);
  const go = document.createElement('button'); go.id = 'touch-go'; go.textContent = 'GO';
  wrap.appendChild(stick); wrap.appendChild(go);

  const RADIUS = 48; // px (in screen space) for full deflection
  let stickId = null;

  function setDir(clientX, clientY) {
    const r = stick.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let dx = clientX - cx, dy = clientY - cy;
    const len = Math.hypot(dx, dy) || 1;
    const clamped = Math.min(len, RADIUS);
    const nx = dx / len, ny = dy / len;
    knob.style.transform = `translate(${nx * clamped}px, ${ny * clamped}px)`;
    RH.input.dx = nx; RH.input.dy = ny; RH.input.active = true;
  }
  function release() {
    RH.input.active = false; RH.input.dx = 0; RH.input.dy = 0;
    knob.style.transform = 'translate(0,0)';
    stickId = null;
  }

  stick.addEventListener('touchstart', e => {
    e.preventDefault();
    const t = e.changedTouches[0]; stickId = t.identifier; setDir(t.clientX, t.clientY);
  }, { passive: false });
  stick.addEventListener('touchmove', e => {
    e.preventDefault();
    for (const t of e.changedTouches) if (t.identifier === stickId) setDir(t.clientX, t.clientY);
  }, { passive: false });
  stick.addEventListener('touchend', e => {
    for (const t of e.changedTouches) if (t.identifier === stickId) { e.preventDefault(); release(); }
  }, { passive: false });
  stick.addEventListener('touchcancel', release);

  go.addEventListener('touchstart', e => { e.preventDefault(); if (RH.action) RH.action(); }, { passive: false });
})();
