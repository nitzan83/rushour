/* ============================================================
   layout.js — tiles, layout generator, collision (seams 1 & 2)
   A Layout is PURE DATA. Systems read it generically, so any map
   works with the same engine.
   ============================================================ */
(() => {
  'use strict';
  const RH = (window.RH = window.RH || {});
  const { rand, choice } = RH.util;

  // Tile types. Add ICE / ALLEY here later — engine won't change.
  const TILE = { ROAD: 0, BUILDING: 1, WATER: 2, MUD: 3 };
  // Per-tile movement multiplier (terrain as data → feeds Stats resolver).
  // A multiplier of 0 means impassable (solid); <1 slows; >1 speeds.
  // WATER is wadeable but very slow — a risky shortcut vs. the bridges.
  const TILE_MODS = { [TILE.ROAD]: 1.0, [TILE.BUILDING]: 0, [TILE.WATER]: 0.35, [TILE.MUD]: 0.55 };
  RH.TILE = TILE;
  RH.TILE_MODS = TILE_MODS;
  // A tile is solid (blocks movement) when its multiplier is 0.
  RH.isSolid = tile => (TILE_MODS[tile] ?? 0) === 0;

  const REST_COLORS = ['#ff8c42', '#ff5e7e', '#c490ff', '#42c5ff'];
  // A distinct symbol per restaurant so orders are identifiable WITHOUT color
  // (colorblind-safe): you match a glyph, not a hue.
  const REST_SYMBOLS = ['A', 'B', 'C', 'D'];

  // grid index helpers
  const idx = (layout, c, r) => r * layout.cols + c;
  RH.tileAt = (layout, c, r) => {
    if (c < 0 || r < 0 || c >= layout.cols || r >= layout.rows) return TILE.BUILDING;
    return layout.grid[idx(layout, c, r)];
  };
  RH.tileAtPx = (layout, x, y) =>
    RH.tileAt(layout, Math.floor(x / layout.tile), Math.floor(y / layout.tile));

  // ---- shared helpers used by every layout generator ----

  // fill a fresh block grid: roads every `step` rows/cols, buildings between
  function blockGrid(cols, rows, step = 4) {
    const grid = new Uint8Array(cols * rows);
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++)
        grid[r * cols + c] = (c % step === 0 || r % step === 0) ? TILE.ROAD : TILE.BUILDING;
    return grid;
  }

  // place 4 sources + 8 sinks on building cells that face a road (works for ANY
  // grid — water/extra obstacles are simply never adjacent-to-road candidates)
  function placeNodes(layout) {
    const tile = layout.tile;
    const candidates = [];
    for (let r = 0; r < layout.rows; r++) {
      for (let c = 0; c < layout.cols; c++) {
        if (RH.tileAt(layout, c, r) !== TILE.BUILDING) continue;
        const sides = [];
        if (RH.tileAt(layout, c, r - 1) === TILE.ROAD) sides.push({ dx: 0, dy: -1 });
        if (RH.tileAt(layout, c, r + 1) === TILE.ROAD) sides.push({ dx: 0, dy: 1 });
        if (RH.tileAt(layout, c - 1, r) === TILE.ROAD) sides.push({ dx: -1, dy: 0 });
        if (RH.tileAt(layout, c + 1, r) === TILE.ROAD) sides.push({ dx: 1, dy: 0 });
        if (sides.length) candidates.push({ c, r, face: choice(sides) });
      }
    }
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    const mkNode = (site, role, color, tags, symbol) => {
      const cx = site.c * tile + tile / 2, cy = site.r * tile + tile / 2;
      return {
        id: layout.nodes.length,
        role, color, symbol: symbol || null, tags: tags || [],
        cell: { c: site.c, r: site.r }, face: site.face,
        x: cx + site.face.dx * (tile / 2),
        y: cy + site.face.dy * (tile / 2),
      };
    };
    let ci = 0;
    for (let i = 0; i < 4 && ci < candidates.length; i++, ci++)
      layout.nodes.push(mkNode(candidates[ci], 'source', REST_COLORS[i], ['food'], REST_SYMBOLS[i]));
    for (let i = 0; i < 8 && ci < candidates.length; i++, ci++)
      layout.nodes.push(mkNode(candidates[ci], 'sink', '#5fd97f', ['home']));
  }

  // sprinkle slow MUD onto random road tiles (not the spawn). Terrain variety
  // needs zero engine changes — movement reads TILE_MODS via the Stats funnel.
  function sprinkleTerrain(layout, count) {
    const roads = [];
    for (let r = 0; r < layout.rows; r++)
      for (let c = 0; c < layout.cols; c++)
        if (RH.tileAt(layout, c, r) === TILE.ROAD) roads.push({ c, r });
    const sc = Math.floor(layout.spawn.x / layout.tile), sr = Math.floor(layout.spawn.y / layout.tile);
    for (let i = 0; i < count && roads.length; i++) {
      const j = (Math.random() * roads.length) | 0;
      const cell = roads.splice(j, 1)[0];
      if (cell.c === sc && cell.r === sr) continue; // keep the spawn clean
      layout.grid[cell.r * layout.cols + cell.c] = TILE.MUD;
    }
  }

  // nearest road cell to (c,r), used to seat the spawn on a road
  function roadSpawn(layout, c, r) {
    const p = { x: c * layout.tile + layout.tile / 2, y: r * layout.tile + layout.tile / 2, r: 0 };
    RH.snapToRoad(layout, p);
    return { x: p.x, y: p.y };
  }

  /* ---- Generator: Downtown — a regular grid of blocks separated by roads ----
     ONE generator. Other cities are just other functions returning the same
     { name, cols, rows, tile, grid, nodes, spawn } shape. */
  RH.generateDowntown = function (canvasW, canvasH) {
    const tile = 40;
    const cols = Math.floor(canvasW / tile), rows = Math.floor(canvasH / tile);
    const layout = { name: 'Downtown', blurb: 'Tight, even streets.', cols, rows, tile, grid: blockGrid(cols, rows), nodes: [], spawn: null };
    const sc = Math.round(cols / 2 / 4) * 4, sr = Math.round(rows / 2 / 4) * 4;
    layout.spawn = { x: sc * tile + tile / 2, y: sr * tile + tile / 2 };
    placeNodes(layout);
    sprinkleTerrain(layout, (RH.Balance && RH.Balance.terrain.mudPatches) || 0);
    return layout;
  };

  /* ---- Generator: Riverside — same blocks, but a river splits the city ----
     The river is WATER (impassable, new tile type); you cross on the bridges
     where the horizontal roads meet it. Same engine, different topology. */
  RH.generateRiverside = function (canvasW, canvasH) {
    const tile = 40;
    const cols = Math.floor(canvasW / tile), rows = Math.floor(canvasH / tile);
    const grid = blockGrid(cols, rows);
    const layout = { name: 'Riverside', blurb: 'Wade the river for shortcuts.', cols, rows, tile, grid, nodes: [], spawn: null };
    // carve a 2-wide vertical river down the middle; leave the horizontal road
    // rows intact as bridges so both banks stay connected.
    const rc = Math.round(cols / 2);
    for (let r = 0; r < rows; r++) {
      if (r % 4 === 0) continue; // bridge row — keep road
      grid[r * cols + (rc - 1)] = TILE.WATER;
      grid[r * cols + rc] = TILE.WATER;
    }
    placeNodes(layout);
    // spawn on a road on the left bank, clear of the river
    layout.spawn = roadSpawn(layout, Math.max(0, rc - 4), Math.round(rows / 2 / 4) * 4);
    sprinkleTerrain(layout, (RH.Balance && RH.Balance.terrain.mudPatches) || 0);
    return layout;
  };

  /* ---- Generator: Old Town — big blocks, long routes, fewer turns ---- */
  RH.generateOldTown = function (canvasW, canvasH) {
    const tile = 40;
    const cols = Math.floor(canvasW / tile), rows = Math.floor(canvasH / tile);
    const layout = { name: 'Old Town', blurb: 'Big blocks, long routes.', cols, rows, tile, grid: blockGrid(cols, rows, 6), nodes: [], spawn: null };
    const sc = Math.round(cols / 2 / 6) * 6, sr = Math.round(rows / 2 / 6) * 6;
    layout.spawn = roadSpawn(layout, sc, sr);
    placeNodes(layout);
    sprinkleTerrain(layout, (RH.Balance && RH.Balance.terrain.mudPatches) || 0);
    return layout;
  };

  /* ---- Generator: Outskirts — standard grid but heavily muddy (slow) ---- */
  RH.generateOutskirts = function (canvasW, canvasH) {
    const tile = 40;
    const cols = Math.floor(canvasW / tile), rows = Math.floor(canvasH / tile);
    const layout = { name: 'Outskirts', blurb: 'Muddy and slow — plan ahead.', cols, rows, tile, grid: blockGrid(cols, rows), nodes: [], spawn: null };
    const sc = Math.round(cols / 2 / 4) * 4, sr = Math.round(rows / 2 / 4) * 4;
    layout.spawn = { x: sc * tile + tile / 2, y: sr * tile + tile / 2 };
    placeNodes(layout);
    sprinkleTerrain(layout, 30); // lots of mud
    return layout;
  };

  // Registry of districts (the layout seam). name/blurb shown in the draft.
  RH.DISTRICTS = [
    { name: 'Downtown',  blurb: 'Tight, even streets.',        gen: RH.generateDowntown },
    { name: 'Riverside', blurb: 'Wade the river for shortcuts.', gen: RH.generateRiverside },
    { name: 'Old Town',  blurb: 'Big blocks, long routes.',    gen: RH.generateOldTown },
    { name: 'Outskirts', blurb: 'Muddy and slow — plan ahead.', gen: RH.generateOutskirts },
  ];
  RH.LAYOUTS = RH.DISTRICTS.map(d => d.gen);
  RH.randomLayout = (w, h) => choice(RH.LAYOUTS)(w, h);

  // pick `n` distinct districts for a draft, preferring to exclude the current one
  RH.draftDistricts = (n, excludeName) => {
    const pool = RH.DISTRICTS.slice();
    for (let i = pool.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const others = pool.filter(d => d.name !== excludeName);
    const pick = others.slice(0, n);
    while (pick.length < n && pool.length) { const d = pool.shift(); if (!pick.includes(d)) pick.push(d); }
    return pick.slice(0, n);
  };

  RH.sources = layout => layout.nodes.filter(n => n.role === 'source');
  RH.sinks = layout => layout.nodes.filter(n => n.role === 'sink');

  /* ---- Connectivity: are all node access tiles reachable from spawn? ----
     BFS flood over walkable (non-solid) tiles. Guards against a map that
     soft-locks a run (a node you can't drive to). Generators/transitions
     should reject any layout this rejects. */
  RH.isConnected = function (layout) {
    const { cols, rows, tile } = layout;
    const sc = Math.floor(layout.spawn.x / tile), sr = Math.floor(layout.spawn.y / tile);
    const walk = (c, r) => c >= 0 && r >= 0 && c < cols && r < rows && !RH.isSolid(RH.tileAt(layout, c, r));
    if (!walk(sc, sr)) return false;
    const seen = new Uint8Array(cols * rows);
    const q = [[sc, sr]]; seen[sr * cols + sc] = 1;
    while (q.length) {
      const [c, r] = q.pop();
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = c + dc, nr = r + dr;
        if (!walk(nc, nr)) continue;
        const i = nr * cols + nc;
        if (!seen[i]) { seen[i] = 1; q.push([nc, nr]); }
      }
    }
    // every node's access tile (the road-facing neighbor) must be reachable
    return layout.nodes.every(n => {
      const ac = n.cell.c + n.face.dx, ar = n.cell.r + n.face.dy;
      return ac >= 0 && ar >= 0 && ac < cols && ar < rows && seen[ar * cols + ac];
    });
  };

  /* ---- Snap a point to the nearest road cell center ----
     Safety net for when a body ends up inside a building (e.g. the ghost
     powerup expiring mid-block). Expanding-ring search for the closest road. */
  RH.snapToRoad = function (layout, p) {
    const T = layout.tile;
    const pc = Math.floor(p.x / T), pr = Math.floor(p.y / T);
    if (RH.tileAt(layout, pc, pr) === TILE.ROAD) return;
    const maxRad = Math.max(layout.cols, layout.rows);
    for (let rad = 1; rad <= maxRad; rad++) {
      for (let dr = -rad; dr <= rad; dr++) {
        for (let dc = -rad; dc <= rad; dc++) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad) continue; // ring only
          if (RH.tileAt(layout, pc + dc, pr + dr) === TILE.ROAD) {
            p.x = (pc + dc) * T + T / 2;
            p.y = (pr + dr) * T + T / 2;
            return;
          }
        }
      }
    }
  };

  /* ---- Collision: circle vs solid cells (buildings, water, …) ----
     Reads the grid generically — works for any layout. */
  RH.resolveCollision = function (layout, p) {
    const T = layout.tile, r = p.r;
    for (let iter = 0; iter < 2; iter++) {
      const minC = Math.floor((p.x - r) / T), maxC = Math.floor((p.x + r) / T);
      const minR = Math.floor((p.y - r) / T), maxR = Math.floor((p.y + r) / T);
      for (let cr = minR; cr <= maxR; cr++) {
        for (let cc = minC; cc <= maxC; cc++) {
          if (!RH.isSolid(RH.tileAt(layout, cc, cr))) continue;
          const bx = cc * T, by = cr * T;
          const nx = Math.max(bx, Math.min(p.x, bx + T));
          const ny = Math.max(by, Math.min(p.y, by + T));
          let dx = p.x - nx, dy = p.y - ny;
          const d2 = dx * dx + dy * dy;
          if (d2 < r * r && d2 > 0.0001) {
            const d = Math.sqrt(d2);
            const push = r - d;
            p.x += (dx / d) * push;
            p.y += (dy / d) * push;
          } else if (d2 <= 0.0001) {
            // center inside the cell: push out on least-penetration axis
            const left = p.x - bx, right = bx + T - p.x, top = p.y - by, bot = by + T - p.y;
            const m = Math.min(left, right, top, bot);
            if (m === left) p.x = bx - r;
            else if (m === right) p.x = bx + T + r;
            else if (m === top) p.y = by - r;
            else p.y = by + T + r;
          }
        }
      }
    }
    // keep inside canvas
    p.x = RH.util.clamp(p.x, r, layout.cols * T - r);
    p.y = RH.util.clamp(p.y, r, layout.rows * T - r);
  };
})();
