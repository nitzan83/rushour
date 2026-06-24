/* ============================================================
   agents.js — moving NPCs (cars now; pedestrians/cyclists/police later).
   Pure road-following AI over the tile grid. game.js owns the array and the
   player-interaction pass; this module just spawns and steps agents.
   ============================================================ */
(() => {
  'use strict';
  const RH = (window.RH = window.RH || {});
  const { rand, choice } = RH.util;

  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  // cars drive on ROAD tiles only (not water/mud/buildings)
  const drivable = (layout, c, r) => RH.tileAt(layout, c, r) === RH.TILE.ROAD;

  function roadCells(layout) {
    const out = [];
    for (let r = 0; r < layout.rows; r++)
      for (let c = 0; c < layout.cols; c++)
        if (drivable(layout, c, r)) out.push({ c, r });
    return out;
  }

  // choose the next cell to drive to: prefer going straight, never immediately
  // reverse unless it's a dead end
  function pickNext(layout, a) {
    const opts = [];
    for (const [dc, dr] of DIRS) {
      const nc = a.cc + dc, nr = a.cr + dr;
      if (!drivable(layout, nc, nr)) continue;
      const reverse = (nc === a.pc && nr === a.pr);
      opts.push({ c: nc, r: nr, dc, dr, reverse });
    }
    if (!opts.length) return { c: a.cc, r: a.cr };       // stuck (shouldn't happen)
    const forward = opts.filter(o => !o.reverse);
    const pool = forward.length ? forward : opts;        // reverse only at dead ends
    // bias toward continuing straight
    const straight = pool.find(o => o.dc === a.hdc && o.dr === a.hdr);
    const chosen = (straight && Math.random() < 0.7) ? straight : choice(pool);
    return chosen;
  }

  RH.Agents = {
    // spawn one agent of `kind` (cfg from balance) on a random road cell
    spawn(layout, kind, cfg) {
      const cells = roadCells(layout);
      if (!cells.length) return null;
      const cell = choice(cells);
      const T = layout.tile;
      const a = {
        kind, r: cfg.r, speed: cfg.speed, color: cfg.color,
        cc: cell.c, cr: cell.r, pc: cell.c, pr: cell.r,
        x: cell.c * T + T / 2, y: cell.r * T + T / 2,
        hdc: 0, hdr: 0, dir: 0,
      };
      const n = pickNext(layout, a);
      a.tc = n.c; a.tr = n.r; a.hdc = Math.sign(n.c - a.cc); a.hdr = Math.sign(n.r - a.cr);
      return a;
    },

    // advance an agent along the roads
    step(layout, a, dt) {
      const T = layout.tile;
      const tx = a.tc * T + T / 2, ty = a.tr * T + T / 2;
      const dx = tx - a.x, dy = ty - a.y;
      const d = Math.hypot(dx, dy);
      const move = a.speed * dt;
      if (d <= move || d < 0.5) {
        // reached the target cell — adopt it and choose the next
        a.x = tx; a.y = ty;
        a.pc = a.cc; a.pr = a.cr;
        a.cc = a.tc; a.cr = a.tr;
        const n = pickNext(layout, a);
        a.tc = n.c; a.tr = n.r;
        a.hdc = Math.sign(a.tc - a.cc); a.hdr = Math.sign(a.tr - a.cr);
      } else {
        a.x += (dx / d) * move; a.y += (dy / d) * move;
        a.dir = Math.atan2(dy, dx);
      }
    },
  };
})();
