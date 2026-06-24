/* ============================================================
   game.js — run state, systems, render, HUD, shop, main loop
   Systems are plain functions over the run state. Stat-bending
   effects go through RH.Stats; reactions go through the EventBus.
   ============================================================ */
(() => {
  'use strict';
  const RH = window.RH;
  const { dist, rand, clamp, choice } = RH.util;
  const TILE = RH.TILE;

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const TILEPX = 40;             // world tile size in px
  const wrap = document.getElementById('game-wrap');
  let W = 960, H = 640;          // playfield size — recomputed to fit the screen

  let save = RH.Save.load();
  const bus = RH.EventBus();
  RH.bus = bus; // expose so EventBus listeners (e.g. js/audio.js) can subscribe
  RH.input = { dx: 0, dy: 0, active: false }; // touch/virtual stick writes here (js/touch.js)
  RH.touchMode = false;          // set true by js/touch.js on touch devices

  /* ---------------- responsive stage (generic across phones) ----------------
     The board ADAPTS to the viewport: cols/rows are derived from screen size
     (clamped), so portrait phones get a tall board and the screen is filled —
     no fixed 960×640 letterbox. Locked at run start; scaled to fit if the
     viewport later shrinks (e.g. rotation). */
  function viewport() {
    const vv = window.visualViewport;
    return { w: (vv && vv.width) || window.innerWidth, h: (vv && vv.height) || window.innerHeight };
  }
  function resizeStage() {
    const { w: vw, h: vh } = viewport();
    const cols = clamp(Math.floor(vw / TILEPX), 9, 30);
    const rows = clamp(Math.floor(vh / TILEPX), 9, 20);
    W = cols * TILEPX; H = rows * TILEPX;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in logical (W×H) coords
    wrap.style.width = W + 'px'; wrap.style.height = H + 'px';
    RH.stage = { w: W, h: H };
    fitStage();
  }
  function fitStage() {
    const { w: vw, h: vh } = viewport();
    const s = Math.min(1, vw / W, vh / H); // only ever scale DOWN to fit
    wrap.style.transform = `translate(-50%, -50%) scale(${s})`;
  }
  // recompute the board only when idle (menus); mid-run just rescale to fit
  function onResize() { if (!game) resizeStage(); else fitStage(); }
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);

  // interaction radius — more forgiving on touch (no pixel-perfect aiming)
  const interactRange = () => RH.touchMode ? 46 : B.player.interactRange;

  /* ---------------- content & tuning (all numbers in js/balance.js) ---- */
  const B = RH.Balance;
  const UPGRADES = B.upgrades;
  const POWERUPS = B.powerups;
  const difficulty = B.difficulty;
  const upgradeCost = key =>
    Math.round(UPGRADES[key].baseCost * Math.pow(UPGRADES[key].growth, save.upgrades[key]));

  // friendly readouts for active powerup effects
  const EFFECT_LABELS = { speed: '⚡ SPEED', freeze: '❄ FREEZE TIMERS', cash: '×2 CASH', magnet: '🧲 MAGNET', ghost: '👻 GHOST' };

  /* ---------------- run state ---------------- */
  let game = null;
  let lastT = 0;

  // upgrade-derived modifiers are fixed for the run; built once at start.
  // Built generically from the upgrade defs that declare a `mod`.
  function makeUpgradeMods() {
    const mods = [];
    for (const key in UPGRADES) {
      const m = UPGRADES[key].mod;
      if (m) mods.push({ stat: m.stat, op: 'mul', value: 1 + m.perLevel * save.upgrades[key], source: 'upg' });
    }
    return mods;
  }

  function startRun() {
    resizeStage();                 // lock the board to the current screen/orientation
    const layout = RH.randomLayout(W, H);
    game = {
      layout,
      player: { x: layout.spawn.x, y: layout.spawn.y, r: B.player.radius, dir: 0 },
      baseSpeed: B.player.baseSpeed,
      capacity: B.player.baseCapacity + save.upgrades.capacity * UPGRADES.capacity.capacityPerLevel,
      upgradeMods: makeUpgradeMods(),
      effects: {},          // type -> remaining seconds (active powerups)
      orders: [],
      nextOrderId: 1,
      carried: [],
      score: 0, cash: 0, delivered: 0,
      misses: 0, maxMisses: B.run.maxMisses, level: 1,
      combo: 0, comboStep: B.combo.step,   // streak scoring (3.2)
      perkMods: [],                        // run perks feed the Stats funnel (3.1)
      paused: false,                       // true while the perk draft is open
      runTime: 0,
      spawnTimer: B.run.firstSpawnDelay,
      powerups: [],
      powerupTimer: rand(B.powerupSpawn.firstMin, B.powerupSpawn.firstMax),
      particles: [],
      floaters: [],         // rising "+$N" text popups
      rings: [],            // expanding ring "pops" on pickup/deliver
      shake: 0,
      crashCooldown: 0,     // debounce for fragile-breaking crashes
      agents: [],           // moving NPCs (cars, …)
      stun: 0,              // >0 while reeling from a car bump (can't drive)
      bumpCd: 0,            // debounce so one contact bumps once
      nearNode: null,       // node currently in interaction range (for prompt)
    };
    spawnAgents();
    spawnOrder();
    showHUD(true);
    hide('menu'); hide('gameover'); hide('perks'); hide('districts');
  }

  /* ---------------- current modifiers (the funnel) ----------------
     Combine static upgrades + run perks + active powerups + terrain. */
  function activeMods() {
    const mods = game.upgradeMods.concat(game.perkMods);
    for (const type in game.effects) {
      const def = POWERUPS[type];
      if (def) for (const m of def.mods) mods.push(m);
    }
    // terrain multiplier on speed (roads = 1.0; seam for mud/ice/alley)
    const t = RH.tileAtPx(game.layout, game.player.x, game.player.y);
    const tm = RH.TILE_MODS[t];
    if (tm != null && tm > 0) mods.push({ stat: 'speed', op: 'mul', value: tm, source: 'terrain' });
    return mods;
  }
  const stat = (base, name) => RH.Stats.resolve(base, name, activeMods());

  /* ---------------- spawning ---------------- */
  function spawnOrder() {
    const d = difficulty(game.level);
    const avail = game.orders.filter(o => o.state === 'available');
    if (avail.length >= d.maxActive) return;

    const from = choice(RH.sources(game.layout));
    const to = choice(RH.sinks(game.layout));
    const travel = dist(from.x, from.y, to.x, to.y);
    const O = B.order;
    // roll an order kind (normal / rush / bulky / vip) and apply its modifiers
    const kindKey = O.rollKind(game.level);
    const kind = O.kinds[kindKey];
    const staticMods = game.upgradeMods.concat(game.perkMods); // upgrades + run perks
    const timeBudget = RH.Stats.resolve((d.timeBudget + travel / O.timeTravelDivisor) * kind.timeMult, 'time', staticMods);
    const basePay = RH.Stats.resolve(Math.round((O.payBase + travel * O.payPerDist) * kind.payMult), 'pay', staticMods);

    const order = {
      id: game.nextOrderId++,
      from: from.id, to: to.id, color: from.color, symbol: from.symbol,
      state: 'available',
      time: timeBudget, maxTime: timeBudget,
      reward: Math.round(basePay),
      kind: kindKey, slots: kind.slots, decays: !!kind.decays, fragile: !!kind.fragile, label: kind.label, tint: kind.tint,
      modifiers: [],
    };
    game.orders.push(order);
    bus.emit('order:available', { order });
  }

  function spawnPowerup() {
    const types = Object.keys(POWERUPS);
    const type = choice(types);
    // place on a random road tile
    let x, y, tries = 0;
    do {
      x = rand(40, W - 40); y = rand(60, H - 40); tries++;
    } while (RH.tileAtPx(game.layout, x, y) !== TILE.ROAD && tries < 40);
    game.powerups.push({ type, ...POWERUPS[type], x, y, r: 14, life: 12 });
  }

  // (re)spawn the level's agents on the current map
  function spawnAgents() {
    const g = game;
    g.agents = [];
    const counts = B.agents.countsAt(g.level);
    for (const kind in counts) {
      const cfg = B.agents.kinds[kind];
      for (let i = 0; i < counts[kind]; i++) {
        const a = RH.Agents.spawn(g.layout, kind, cfg);
        if (a) g.agents.push(a);
      }
    }
  }

  // timed powerups set an active effect; instant ones fire once on pickup
  function applyPowerup(p) {
    const def = POWERUPS[p.type];
    if (def.instant) {
      if (p.type === 'refuel') {
        for (const o of game.orders)
          if (o.state === 'available' || o.state === 'carried')
            o.time = Math.min(o.maxTime, o.time + def.addTime);
      }
    } else {
      game.effects[p.type] = def.dur;
    }
  }

  /* ---------------- juice ---------------- */
  function burst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2), s = rand(40, 180);
      game.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.3, 0.7), color });
    }
  }
  const pop = (x, y, color, maxR, life) => game.rings.push({ x, y, color, maxR, life, age: 0 });
  bus.on('order:pickup', ({ node, order }) => { burst(node.x, node.y, order.color, 10); pop(node.x, node.y, order.color, 30, 0.35); });
  bus.on('order:delivered', ({ node, gained, boosted }) => {
    burst(node.x, node.y, '#ffcc4d', boosted ? 28 : 20);
    pop(node.x, node.y, boosted ? '#4dd0ff' : '#ffcc4d', boosted ? 52 : 40, 0.45); // deliver pop
    game.floaters.push({
      x: node.x, y: node.y - 14,
      text: boosted ? `+$${gained}  ×2!` : `+$${gained}`,
      color: boosted ? '#4dd0ff' : '#ffcc4d',
      big: boosted, life: boosted ? 1.4 : 1.0, age: 0,
    });
  });
  bus.on('powerup:grabbed', ({ p }) => burst(p.x, p.y, p.color, 16));
  bus.on('order:missed', () => { game.shake = 0.4; });
  bus.on('agent:hit', ({ agent }) => burst(agent.x, agent.y, agent.color, 8));
  // Level-up flow: choose a new DISTRICT (map changes), then a perk.
  bus.on('level:up', ({ level }) => openDistrictDraft(level));

  /* ---------------- district draft + map transition (v0.5) ---------------- */
  // build a layout from a generator, rejecting any that isn't fully connected
  function buildDistrict(gen) {
    let L;
    for (let i = 0; i < 12; i++) { L = gen(W, H); if (RH.isConnected(L)) return L; }
    return L; // fall back to the last one (shouldn't happen for built-in maps)
  }

  // swap the live map. In-flight orders are forgiven (no miss); combo, perks,
  // score, cash, misses and level all persist across the transition.
  function transitionTo(layout) {
    const g = game;
    g.layout = layout;
    g.player.x = layout.spawn.x; g.player.y = layout.spawn.y;
    g.orders = []; g.carried = []; g.powerups = [];
    g.spawnTimer = B.run.firstSpawnDelay;
    g.stun = 0; g.bumpCd = 0;
    g.nearNode = null;
    spawnAgents();   // fresh traffic for the new district + level count
    spawnOrder();
    bus.emit('district:enter', { layout });
  }

  function openDistrictDraft(level) {
    game.paused = true;
    document.getElementById('districts-title').textContent = `LEVEL ${level}`;
    const wrap = document.getElementById('district-cards');
    wrap.innerHTML = '';
    RH.draftDistricts(3, game.layout.name).forEach(meta => {
      const el = document.createElement('div');
      el.className = 'perk-card';
      el.innerHTML = `<div class="perk-name">${meta.name}</div><div class="perk-desc">${meta.blurb}</div>`;
      el.addEventListener('click', () => {
        transitionTo(buildDistrict(meta.gen));
        hide('districts');
        openDraft(level); // chain straight into the perk draft (stays paused)
      });
      wrap.appendChild(el);
    });
    show('districts');
  }

  /* ---------------- perk draft (3.1) ---------------- */
  function openDraft(level) {
    game.paused = true;
    document.getElementById('perks-title').textContent = `LEVEL ${level}`;
    const wrap = document.getElementById('perk-cards');
    wrap.innerHTML = '';
    // 3 distinct perks
    const pool = B.perks.slice();
    for (let i = pool.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [pool[i], pool[j]] = [pool[j], pool[i]]; }
    pool.slice(0, 3).forEach(perk => {
      const el = document.createElement('div');
      el.className = 'perk-card';
      el.innerHTML = `<div class="perk-name">${perk.name}</div><div class="perk-desc">${perk.desc}</div>`;
      el.addEventListener('click', () => applyPerk(perk));
      wrap.appendChild(el);
    });
    show('perks');
  }

  function applyPerk(perk) {
    if (perk.mod) game.perkMods.push({ ...perk.mod, source: 'perk' });
    if (perk.capacity) game.capacity += perk.capacity;
    if (perk.maxMisses) game.maxMisses += perk.maxMisses;
    if (perk.comboFast) game.comboStep = Math.max(1, game.comboStep - 1);
    hide('perks');
    game.paused = false;
  }

  /* ---------------- order outcomes ---------------- */
  function deliver(order) {
    order.state = 'done';
    game.delivered++;
    const O = B.order;
    const frac = Math.max(0, order.time / order.maxTime);
    const mult = game.effects.cash ? 2 : 1;
    const timeBonus = Math.round(frac * O.timeBonusMax);
    // "rush" (perishable) orders pay less the longer they took to arrive
    const decay = order.decays ? (O.decayFloor + (1 - O.decayFloor) * frac) : 1;
    const gained = (Math.round(order.reward * decay) + timeBonus) * mult;
    game.cash += gained;
    // combo: each delivery extends the streak and multiplies score
    game.combo++;
    const cMult = B.combo.mult(game.combo, game.comboStep);
    game.score += Math.round((O.scorePerDelivery + timeBonus * O.scorePerTimeBonus) * cMult);
    const newLevel = 1 + Math.floor(game.delivered / B.run.deliveriesPerLevel);
    if (newLevel !== game.level) { game.level = newLevel; bus.emit('level:up', { level: newLevel }); }
    bus.emit('order:delivered', { order, node: game.layout.nodes[order.to], gained, boosted: mult > 1 });
  }

  function missOrder(order) {
    order.state = 'expired';
    game.misses++;
    game.combo = 0; // a miss breaks the streak
    bus.emit('order:missed', { order });
    if (game.misses >= game.maxMisses) endRun();
  }

  // a fragile order shatters on a hard crash — lost, and counts as a miss
  function breakOrder(order) {
    order.state = 'expired';
    game.misses++;
    game.combo = 0;
    game.shake = 0.5;
    burst(game.player.x, game.player.y, '#ff6b6b', 18);
    bus.emit('order:missed', { order, broke: true });
    if (game.misses >= game.maxMisses) endRun();
  }

  function endRun() {
    save.bank += game.cash;
    save.best = Math.max(save.best, game.score);
    RH.Save.persist(save);
    document.getElementById('final-score').textContent = game.score;
    document.getElementById('final-delivered').textContent = game.delivered;
    document.getElementById('final-earned').textContent = game.cash;
    showHUD(false); show('gameover');
    bus.emit('run:over', {});
    game = null;
  }

  /* ---------------- interaction (SPACE) ---------------- */
  function findNearestNode() {
    const p = game.player;
    let best = null, bestD = interactRange();
    for (const n of game.layout.nodes) {
      const d = dist(p.x, p.y, n.x, n.y);
      if (d < bestD) { bestD = d; best = n; }
    }
    return best;
  }

  function tryInteract() {
    if (!game || game.paused) return;
    const node = game.nearNode;
    if (!node) return;
    if (node.role === 'sink') {
      // deliver a carried order bound here
      const i = game.carried.findIndex(o => o.to === node.id);
      if (i >= 0) { const o = game.carried[i]; game.carried.splice(i, 1); deliver(o); }
    } else if (node.role === 'source') {
      const free = game.capacity - usedSlots();
      // pick up the most-urgent available order at this source that FITS the bag
      const here = game.orders
        .filter(o => o.state === 'available' && o.from === node.id && (o.slots || 1) <= free)
        .sort((a, b) => a.time - b.time);
      if (here.length) {
        const o = here[0];
        o.state = 'carried';
        game.carried.push(o);
        bus.emit('order:pickup', { node, order: o });
      }
    }
  }

  // bag space used by carried orders (bulky orders take 2 slots)
  const usedSlots = () => game.carried.reduce((s, o) => s + (o.slots || 1), 0);

  /* ---------------- input ---------------- */
  const keys = {};
  window.addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    keys[k] = true;
    if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
    if (k === ' ') tryInteract();
  });
  window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });

  /* ---------------- update ---------------- */
  function update(dt) {
    if (!game || game.paused) return; // perk draft freezes the sim
    const g = game;
    g.runTime += dt;

    // tick effects
    for (const k in g.effects) { g.effects[k] -= dt; if (g.effects[k] <= 0) delete g.effects[k]; }

    // movement (keyboard or virtual stick)
    let dx = 0, dy = 0;
    if (keys['w'] || keys['arrowup']) dy -= 1;
    if (keys['s'] || keys['arrowdown']) dy += 1;
    if (keys['a'] || keys['arrowleft']) dx -= 1;
    if (keys['d'] || keys['arrowright']) dx += 1;
    if (RH.input.active) { dx += RH.input.dx; dy += RH.input.dy; }
    if (g.stun > 0) { dx = 0; dy = 0; } // reeling from a car bump
    const prevX = g.player.x, prevY = g.player.y;
    if (dx || dy) {
      const len = Math.hypot(dx, dy); dx /= len; dy /= len;
      g.player.dir = Math.atan2(dy, dx);
      const spd = stat(g.baseSpeed, 'speed'); // terrain (mud) already folded in here
      g.player.x += dx * spd * dt;
      g.player.y += dy * spd * dt;
    }
    const intX = g.player.x, intY = g.player.y; // where we wanted to go
    // ghost powerup phases through buildings; otherwise collide.
    if (!g.effects.ghost) {
      RH.resolveCollision(g.layout, g.player);
      // safety net: if ghost just ended deep inside a block, snap to a road
      if (RH.isSolid(RH.tileAtPx(g.layout, g.player.x, g.player.y))) RH.snapToRoad(g.layout, g.player);
    } else {
      g.player.x = clamp(g.player.x, g.player.r, W - g.player.r);
      g.player.y = clamp(g.player.y, g.player.r, H - g.player.r);
    }

    // fragile crash: if a wall absorbed most of an at-speed move, shatter cargo
    if (g.crashCooldown > 0) g.crashCooldown -= dt;
    if (!g.effects.ghost) {
      const intended = Math.hypot(intX - prevX, intY - prevY);
      const actual = Math.hypot(g.player.x - prevX, g.player.y - prevY);
      const impact = intended - actual;
      if (intended > 1.5 && impact > intended * B.crash.impactFrac && g.crashCooldown <= 0) {
        const fragile = g.carried.filter(o => o.fragile);
        if (fragile.length) {
          g.crashCooldown = B.crash.cooldown;
          for (const o of fragile) breakOrder(o);
          if (!game) return; // run may have ended
        }
      }
    }

    // timers (freeze powerup pauses them)
    if (!g.effects.freeze) {
      for (const o of g.orders)
        if ((o.state === 'available' || o.state === 'carried')) {
          o.time -= dt;
          if (o.time <= 0) missOrder(o);
        }
    }
    if (!game) return; // run may have ended on a missed order

    // spawns
    g.spawnTimer -= dt;
    if (g.spawnTimer <= 0) { spawnOrder(); g.spawnTimer = difficulty(g.level).spawnEvery; }
    g.powerupTimer -= dt;
    if (g.powerupTimer <= 0) { spawnPowerup(); g.powerupTimer = rand(B.powerupSpawn.min, B.powerupSpawn.max); }

    // drop expired carried orders out of the bag
    g.carried = g.carried.filter(o => o.state === 'carried');
    // clean finished orders
    g.orders = g.orders.filter(o => o.state === 'available' || o.state === 'carried');

    // powerups: magnet pull + pickup
    const px = g.player.x, py = g.player.y;
    for (let i = g.powerups.length - 1; i >= 0; i--) {
      const p = g.powerups[i];
      p.life -= dt;
      if (g.effects.magnet) {
        const dd = dist(px, py, p.x, p.y);
        if (dd < 160) { p.x += (px - p.x) * dt * 4; p.y += (py - p.y) * dt * 4; }
      }
      if (dist(px, py, p.x, p.y) < g.player.r + p.r) {
        applyPowerup(p);
        bus.emit('powerup:grabbed', { p });
        g.powerups.splice(i, 1);
      } else if (p.life <= 0) g.powerups.splice(i, 1);
    }

    // agents (cars): drive the roads and bump the courier on contact
    g.bumpCd -= dt; g.stun -= dt;
    for (const a of g.agents) RH.Agents.step(g.layout, a, dt);
    for (const a of g.agents) {
      const cfg = B.agents.kinds[a.kind];
      if (cfg.bump && g.bumpCd <= 0 && dist(px, py, a.x, a.y) < g.player.r + a.r) {
        const dx = g.player.x - a.x, dy = g.player.y - a.y, d = Math.hypot(dx, dy) || 1;
        g.player.x += (dx / d) * B.agents.knockback;
        g.player.y += (dy / d) * B.agents.knockback;
        RH.resolveCollision(g.layout, g.player);
        g.stun = B.agents.bumpStun; g.bumpCd = B.agents.bumpCooldown;
        g.shake = Math.max(g.shake, 0.35);
        bus.emit('agent:hit', { agent: a });
      }
    }

    // interaction prompt target + label (device-appropriate: GO on touch)
    g.nearNode = findNearestNode();
    g.prompt = null;
    const n = g.nearNode;
    if (n) {
      const verb = RH.touchMode ? 'GO' : 'SPACE';
      const free = g.capacity - usedSlots();
      if (n.role === 'source' && g.orders.some(o => o.state === 'available' && o.from === n.id && (o.slots || 1) <= free))
        g.prompt = `▸ ${verb}: pick up`;
      else if (n.role === 'sink' && g.carried.some(o => o.to === n.id))
        g.prompt = `▸ ${verb}: deliver`;
    }

    // particles
    for (let i = g.particles.length - 1; i >= 0; i--) {
      const pt = g.particles[i];
      pt.x += pt.vx * dt; pt.y += pt.vy * dt;
      pt.vx *= 0.92; pt.vy *= 0.92; pt.life -= dt;
      if (pt.life <= 0) g.particles.splice(i, 1);
    }

    // floaters (rising score/cash popups)
    for (let i = g.floaters.length - 1; i >= 0; i--) {
      const f = g.floaters[i];
      f.age += dt; f.y -= 26 * dt;
      if (f.age >= f.life) g.floaters.splice(i, 1);
    }

    // rings (expanding pop on pickup/deliver)
    for (let i = g.rings.length - 1; i >= 0; i--) {
      const rg = g.rings[i];
      rg.age += dt;
      if (rg.age >= rg.life) g.rings.splice(i, 1);
    }

    if (g.shake > 0) g.shake = Math.max(0, g.shake - dt);

    updateHUD();
  }

  /* ---------------- render ---------------- */
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawLayout() {
    const L = game.layout, T = L.tile;
    // road surface
    ctx.fillStyle = '#2c3252'; ctx.fillRect(0, 0, W, H);
    // mud cells (walkable but slow) — drawn as patches on the road surface
    for (let r = 0; r < L.rows; r++)
      for (let c = 0; c < L.cols; c++)
        if (RH.tileAt(L, c, r) === TILE.MUD) {
          ctx.fillStyle = '#5a4a36'; ctx.fillRect(c * T, r * T, T, T);
          ctx.fillStyle = 'rgba(0,0,0,0.18)';
          ctx.beginPath(); ctx.arc(c * T + T * 0.35, r * T + T * 0.4, 4, 0, Math.PI * 2);
          ctx.arc(c * T + T * 0.65, r * T + T * 0.65, 5, 0, Math.PI * 2); ctx.fill();
        }
    // water cells (rivers/canals)
    for (let r = 0; r < L.rows; r++)
      for (let c = 0; c < L.cols; c++)
        if (RH.tileAt(L, c, r) === TILE.WATER) {
          ctx.fillStyle = '#274a6e'; ctx.fillRect(c * T, r * T, T, T);
          // subtle ripple sheen
          ctx.fillStyle = 'rgba(120,190,255,0.10)';
          ctx.fillRect(c * T, r * T + (Math.sin(game.runTime * 2 + c + r) * 3 + 6), T, 3);
        }
    // building cells
    ctx.fillStyle = '#1a1d2e';
    for (let r = 0; r < L.rows; r++)
      for (let c = 0; c < L.cols; c++)
        if (RH.tileAt(L, c, r) === TILE.BUILDING) ctx.fillRect(c * T, r * T, T, T);
    // top-face highlight + crisp block outlines on road-facing edges
    ctx.strokeStyle = '#0f1120'; ctx.lineWidth = 2;
    for (let r = 0; r < L.rows; r++) {
      for (let c = 0; c < L.cols; c++) {
        if (RH.tileAt(L, c, r) !== TILE.BUILDING) continue;
        const x = c * T, y = r * T;
        if (RH.tileAt(L, c, r - 1) === TILE.ROAD) { ctx.fillStyle = '#21263e'; ctx.fillRect(x, y, T, 8); line(x, y, x + T, y); }
        if (RH.tileAt(L, c, r + 1) === TILE.ROAD) line(x, y + T, x + T, y + T);
        if (RH.tileAt(L, c - 1, r) === TILE.ROAD) line(x, y, x, y + T);
        if (RH.tileAt(L, c + 1, r) === TILE.ROAD) line(x + T, y, x + T, y + T);
      }
    }
    // lane dashes down road corridors
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 2; ctx.setLineDash([10, 14]);
    for (let c = 0; c < L.cols; c++) if (c % 4 === 0) { ctx.beginPath(); ctx.moveTo(c * T + T / 2, 0); ctx.lineTo(c * T + T / 2, H); ctx.stroke(); }
    for (let r = 0; r < L.rows; r++) if (r % 4 === 0) { ctx.beginPath(); ctx.moveTo(0, r * T + T / 2); ctx.lineTo(W, r * T + T / 2); ctx.stroke(); }
    ctx.setLineDash([]);
  }
  function line(x1, y1, x2, y2) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }

  function render() {
    ctx.clearRect(0, 0, W, H);
    if (!game) { ctx.fillStyle = '#1a1d2e'; ctx.fillRect(0, 0, W, H); return; }
    const g = game;

    ctx.save();
    if (g.shake > 0) ctx.translate(rand(-1, 1) * g.shake * 12, rand(-1, 1) * g.shake * 12);

    drawLayout();

    const activeSinks = new Set(g.carried.map(o => o.to));

    // nodes
    for (const n of g.layout.nodes) {
      if (n.role === 'source') {
        ctx.fillStyle = n.color;
        roundRect(n.x - 14, n.y - 14, 28, 28, 6); ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        roundRect(n.x - 14, n.y - 14, 28, 8, 6); ctx.fill();
        // colorblind-safe glyph identifying this restaurant
        ctx.fillStyle = '#11131f'; ctx.font = 'bold 15px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(n.symbol, n.x, n.y + 2);
      } else {
        const active = activeSinks.has(n.id);
        ctx.fillStyle = active ? '#5fd97f' : '#3a4060';
        roundRect(n.x - 13, n.y - 10, 26, 20, 4); ctx.fill();
        ctx.fillStyle = active ? '#4cc36a' : '#2c3150';
        ctx.beginPath();
        ctx.moveTo(n.x - 15, n.y - 10); ctx.lineTo(n.x, n.y - 20); ctx.lineTo(n.x + 15, n.y - 10);
        ctx.closePath(); ctx.fill();
        if (active) {
          // show the glyph of the order(s) bound here (matches restaurant + badge)
          const ord = g.carried.find(o => o.to === n.id);
          ctx.fillStyle = ord.color;
          ctx.beginPath(); ctx.arc(n.x, n.y, 7, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#11131f'; ctx.font = 'bold 10px sans-serif';
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(ord.symbol, n.x, n.y + 1);
        }
      }
    }

    // available orders: timer ring on source + dashed line to dest
    for (const o of g.orders) {
      if (o.state !== 'available') continue;
      const src = g.layout.nodes[o.from], dst = g.layout.nodes[o.to];
      const frac = Math.max(0, o.time / o.maxTime);
      const urgent = frac < 0.3;
      // near-miss flash: urgent timers blink red
      ctx.globalAlpha = urgent ? (Math.sin(g.runTime * 14) * 0.35 + 0.65) : 1;
      ctx.strokeStyle = urgent ? '#ff6b6b' : o.color; ctx.lineWidth = urgent ? 4 : 3;
      ctx.beginPath();
      ctx.arc(src.x, src.y, 22, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 2; ctx.setLineDash([4, 6]);
      ctx.beginPath(); ctx.moveTo(src.x, src.y); ctx.lineTo(dst.x, dst.y); ctx.stroke();
      ctx.setLineDash([]);
      // special-kind tag (RUSH / BULKY / VIP) above the restaurant
      if (o.label) {
        ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const w = ctx.measureText(o.label).width + 8;
        ctx.fillStyle = o.tint; roundRect(src.x - w / 2, src.y - 38, w, 13, 4); ctx.fill();
        ctx.fillStyle = '#11131f'; ctx.fillText(o.label, src.x, src.y - 31);
      }
    }

    // carried badges around player (color + glyph + timer ring; bulky is bigger)
    let bx = g.player.x + 18;
    g.carried.forEach((o) => {
      const rad = o.slots > 1 ? 11 : 8;       // bulky badge is larger
      const by = g.player.y - 20;
      bx += rad + 4;
      const frac = Math.max(0, o.time / o.maxTime);
      const urgent = frac < 0.3;
      // kind tint halo (RUSH/BULKY/VIP)
      if (o.tint) { ctx.fillStyle = o.tint; ctx.globalAlpha = 0.35; ctx.beginPath(); ctx.arc(bx, by, rad + 4, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; }
      ctx.fillStyle = o.color; ctx.beginPath(); ctx.arc(bx, by, rad, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#11131f'; ctx.font = `bold ${o.slots > 1 ? 12 : 10}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(o.symbol, bx, by + 1);
      ctx.globalAlpha = urgent ? (Math.sin(g.runTime * 14) * 0.35 + 0.65) : 1;
      ctx.strokeStyle = urgent ? '#ff6b6b' : 'rgba(255,255,255,0.7)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(bx, by, rad + 3, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
      bx += rad + 6;
    });

    // powerups
    for (const p of g.powerups) {
      const pulse = 1 + Math.sin(g.runTime * 6) * 0.12;
      ctx.globalAlpha = p.life < 3 ? (Math.sin(g.runTime * 12) * 0.4 + 0.6) : 1;
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * pulse, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#11131f'; ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(p.label, p.x, p.y + 1);
    }

    // rings (expanding pop on pickup/deliver)
    for (const rg of g.rings) {
      const t = rg.age / rg.life;
      ctx.globalAlpha = Math.max(0, 1 - t);
      ctx.strokeStyle = rg.color; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(rg.x, rg.y, t * rg.maxR, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // particles
    for (const pt of g.particles) {
      ctx.globalAlpha = Math.max(0, pt.life * 1.6);
      ctx.fillStyle = pt.color; ctx.fillRect(pt.x - 2, pt.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;

    // floaters (+$N popups)
    for (const f of g.floaters) {
      ctx.globalAlpha = Math.max(0, 1 - f.age / f.life);
      ctx.fillStyle = f.color;
      ctx.font = `bold ${f.big ? 18 : 14}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;

    // agents (cars): a body with a darker windshield, oriented by heading
    for (const a of g.agents) {
      ctx.save();
      ctx.translate(a.x, a.y);
      ctx.rotate(a.dir);
      ctx.fillStyle = a.color;
      roundRect(-a.r, -a.r * 0.7, a.r * 2, a.r * 1.4, 4); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      roundRect(a.r * 0.1, -a.r * 0.5, a.r * 0.7, a.r, 2); ctx.fill();
      ctx.restore();
    }

    // player
    const pl = g.player;
    // wading ripples when crossing water (the slow shortcut)
    if (RH.tileAtPx(g.layout, pl.x, pl.y) === TILE.WATER) {
      ctx.strokeStyle = 'rgba(180,220,255,0.55)'; ctx.lineWidth = 2;
      const t = (g.runTime * 1.5) % 1;
      ctx.globalAlpha = 1 - t;
      ctx.beginPath(); ctx.arc(pl.x, pl.y, pl.r + t * 12, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.save(); ctx.translate(pl.x, pl.y); ctx.rotate(pl.dir);
    if (g.effects.ghost) ctx.globalAlpha = 0.45; // phasing
    if (g.effects.speed) { ctx.fillStyle = 'rgba(77,208,255,0.3)'; ctx.beginPath(); ctx.arc(-12, 0, pl.r, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = '#ffcc4d'; ctx.beginPath(); ctx.arc(0, 0, pl.r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1a1d2e'; ctx.fillRect(2, -4, 8, 8);
    ctx.restore();

    // interaction prompt (computed in update; says GO on touch, SPACE on desktop)
    const n = g.nearNode;
    if (n && g.prompt) {
      ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      const w = ctx.measureText(g.prompt).width + 16;
      ctx.fillStyle = 'rgba(17,19,31,0.85)';
      roundRect(n.x - w / 2, n.y - 44, w, 22, 6); ctx.fill();
      ctx.fillStyle = '#ffcc4d'; ctx.fillText(g.prompt, n.x, n.y - 25);
    }

    // active effect labels (friendly names so effects read clearly)
    Object.keys(g.effects).forEach((f, i) => {
      ctx.fillStyle = POWERUPS[f] ? POWERUPS[f].color : '#4dd0ff';
      ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText(`${EFFECT_LABELS[f] || f.toUpperCase()} ${g.effects[f].toFixed(1)}s`, 14, H - 24 - i * 16);
    });

    ctx.restore();
  }

  /* ---------------- HUD & screens ---------------- */
  const show = id => document.getElementById(id).classList.remove('hidden');
  const hide = id => document.getElementById(id).classList.add('hidden');
  const showHUD = on => document.getElementById('hud').classList.toggle('hidden', !on);

  function updateHUD() {
    const g = game;
    document.getElementById('hud-score').textContent = g.score;
    document.getElementById('hud-cash').textContent = g.cash;
    document.getElementById('hud-level').textContent = `${g.level}  ·  ${g.layout.name}`;
    const s = document.getElementById('hud-streak');
    s.textContent = `MISSES: ${g.misses} / ${g.maxMisses}`;
    s.className = g.misses === 0 ? 'streak-ok' : (g.misses < g.maxMisses - 1 ? 'streak-warn' : 'streak-danger');
    document.getElementById('hud-carry').textContent = `CARRYING: ${usedSlots()} / ${g.capacity}`;
    const combo = document.getElementById('hud-combo');
    const cMult = B.combo.mult(g.combo, g.comboStep);
    if (g.combo >= 2 && cMult > 1) {
      combo.classList.remove('hidden');
      combo.textContent = `COMBO ×${g.combo}  (${cMult.toFixed(1)}×)`;
    } else combo.classList.add('hidden');
  }

  function renderShop() {
    document.getElementById('bank-amount').textContent = save.bank;
    document.getElementById('best-score').textContent = save.best;
    const shop = document.getElementById('shop');
    shop.innerHTML = '';
    for (const key in UPGRADES) {
      const u = UPGRADES[key], lvl = save.upgrades[key], maxed = lvl >= u.max, cost = upgradeCost(key);
      const afford = save.bank >= cost;
      const el = document.createElement('div');
      el.className = 'shop-item' + (maxed ? ' maxed' : '') + (!maxed && !afford ? ' unaffordable' : '');
      el.innerHTML =
        `<div class="name">${u.name}</div><div class="desc">${u.desc}</div>` +
        `<div class="lvl">Lv ${lvl} / ${u.max}</div>` +
        `<div class="cost">${maxed ? 'MAXED' : cost + ' 💰'}</div>`;
      if (!maxed) el.addEventListener('click', () => {
        if (save.bank >= cost) { save.bank -= cost; save.upgrades[key]++; RH.Save.persist(save); renderShop(); }
      });
      shop.appendChild(el);
    }
  }

  /* ---------------- main loop ---------------- */
  function frame(t) {
    const dt = Math.min(0.05, (t - lastT) / 1000 || 0);
    lastT = t;
    update(dt); render();
    requestAnimationFrame(frame);
  }

  RH.debug = () => game;       // dev/test hook: inspect live run state
  RH.action = tryInteract;     // SPACE equivalent for the touch action button
  RH.isPlaying = () => !!game && !game.paused;

  document.getElementById('start-btn').addEventListener('click', startRun);
  document.getElementById('continue-btn').addEventListener('click', () => { hide('gameover'); renderShop(); show('menu'); });

  renderShop();
  resizeStage();   // size the stage to the screen before the first frame
  requestAnimationFrame(frame);
})();
