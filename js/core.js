/* ============================================================
   core.js — RH namespace, utils, EventBus, Save, Stats resolver
   These are the cross-cutting seams every system depends on.
   ============================================================ */
(() => {
  'use strict';
  const RH = (window.RH = window.RH || {});

  /* ---------------- utils ---------------- */
  RH.util = {
    dist: (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by),
    rand: (a, b) => a + Math.random() * (b - a),
    randInt: (a, b) => a + ((Math.random() * (b - a + 1)) | 0),
    clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)),
    choice: arr => arr[(Math.random() * arr.length) | 0],
  };

  /* ---------------- EventBus (seam 4) ----------------
     Core systems emit; juice / audio / quests subscribe.
     Decouples reactions from game logic. */
  RH.EventBus = function () {
    const listeners = {};
    return {
      on(event, fn) {
        (listeners[event] ||= []).push(fn);
        return () => {
          const a = listeners[event];
          if (a) a.splice(a.indexOf(fn), 1);
        };
      },
      emit(event, payload) {
        const a = listeners[event];
        if (a) for (const fn of a.slice()) fn(payload);
      },
    };
  };

  /* ---------------- Save (persistent meta) ---------------- */
  const SAVE_KEY = 'rushhour_save_v2';
  const DEFAULTS = { bank: 0, best: 0, upgrades: { speed: 0, capacity: 0, time: 0, pay: 0, battery: 0 } };
  RH.Save = {
    load() {
      try {
        const raw = JSON.parse(localStorage.getItem(SAVE_KEY)) || {};
        return {
          bank: raw.bank ?? DEFAULTS.bank,
          best: raw.best ?? DEFAULTS.best,
          upgrades: Object.assign({}, DEFAULTS.upgrades, raw.upgrades),
        };
      } catch {
        return JSON.parse(JSON.stringify(DEFAULTS));
      }
    },
    persist(save) {
      try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch {}
    },
  };

  /* ---------------- Stats resolver (seam 3) ----------------
     Every stat-bending effect (upgrade, powerup, terrain, cargo,
     weather...) is a modifier. One funnel computes the effective value. */
  RH.Stats = {
    // modifiers: [{ stat, op:'mul'|'add', value, source }]
    resolve(base, stat, modifiers) {
      let v = base;
      for (const m of modifiers) {
        if (m.stat !== stat) continue;
        if (m.op === 'add') v += m.value;
        else v *= m.value; // default multiply
      }
      return v;
    },
  };
})();
