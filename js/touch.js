/* ============================================================
   touch.js — mobile controls: a virtual joystick + action button.
   Sizing/scaling of the stage is owned by js/game.js (resizeStage). This
   module only adds touch input: writes movement into RH.input and fires
   RH.action() for pick up / deliver (the on-screen equivalent of SPACE).
   ============================================================ */
(() => {
  'use strict';
  const RH = window.RH;
  const wrap = document.getElementById('game-wrap');

  const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  RH.touchMode = isTouch;
  if (!isTouch) return;
  document.body.classList.add('touch');

  // joystick (left) + action button (right), inside the stage so they scale with it
  const stick = document.createElement('div'); stick.id = 'touch-stick';
  const knob = document.createElement('div'); knob.id = 'touch-knob';
  stick.appendChild(knob);
  const go = document.createElement('button'); go.id = 'touch-go'; go.textContent = 'GO';
  const dash = document.createElement('button'); dash.id = 'touch-dash'; dash.textContent = 'DASH';
  wrap.appendChild(stick); wrap.appendChild(go); wrap.appendChild(dash);

  const RADIUS = 48; // px of deflection for full tilt
  let stickId = null;

  function setDir(clientX, clientY) {
    const r = stick.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const dx = clientX - cx, dy = clientY - cy;
    const len = Math.hypot(dx, dy) || 1;
    const nx = dx / len, ny = dy / len;
    const clamped = Math.min(len, RADIUS);
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

  // Action button → pick up / deliver. pointerdown covers touch (and mouse),
  // fires once per tap (no double-trigger from touch+mouse synthesis).
  const act = e => { e.preventDefault(); if (RH.action) RH.action(); };
  go.addEventListener('pointerdown', act);
  dash.addEventListener('pointerdown', e => { e.preventDefault(); if (RH.dash) RH.dash(); });
})();
