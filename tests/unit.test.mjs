/* Unit tests for the pure-logic seams: util, Stats resolver, EventBus, Save,
   layout generation, tile queries, and collision. Run with: node --test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RH, resetStorage } from './load-rh.mjs';

/* ---------------- util ---------------- */
test('util.clamp bounds a value', () => {
  assert.equal(RH.util.clamp(5, 0, 10), 5);
  assert.equal(RH.util.clamp(-3, 0, 10), 0);
  assert.equal(RH.util.clamp(99, 0, 10), 10);
});

test('util.dist is euclidean', () => {
  assert.equal(RH.util.dist(0, 0, 3, 4), 5);
});

test('util.rand stays within range; choice returns a member', () => {
  for (let i = 0; i < 100; i++) {
    const v = RH.util.rand(2, 5);
    assert.ok(v >= 2 && v < 5);
  }
  const arr = ['a', 'b', 'c'];
  for (let i = 0; i < 50; i++) assert.ok(arr.includes(RH.util.choice(arr)));
});

/* ---------------- Stats resolver (seam 3) ---------------- */
test('Stats.resolve returns base when no modifiers', () => {
  assert.equal(RH.Stats.resolve(100, 'speed', []), 100);
});

test('Stats.resolve applies mul and add and ignores other stats', () => {
  const mods = [
    { stat: 'speed', op: 'mul', value: 1.5 },
    { stat: 'speed', op: 'add', value: 10 },
    { stat: 'pay', op: 'mul', value: 99 }, // should be ignored for 'speed'
  ];
  // 100 * 1.5 = 150, then + 10 = 160
  assert.equal(RH.Stats.resolve(100, 'speed', mods), 160);
});

test('Stats.resolve defaults unknown op to multiply', () => {
  assert.equal(RH.Stats.resolve(10, 'x', [{ stat: 'x', value: 2 }]), 20);
});

/* ---------------- EventBus (seam 4) ---------------- */
test('EventBus delivers payloads to all listeners', () => {
  const bus = RH.EventBus();
  const seen = [];
  bus.on('hit', p => seen.push('a' + p.n));
  bus.on('hit', p => seen.push('b' + p.n));
  bus.emit('hit', { n: 1 });
  assert.deepEqual(seen, ['a1', 'b1']);
});

test('EventBus unsubscribe stops delivery; unknown event is safe', () => {
  const bus = RH.EventBus();
  let count = 0;
  const off = bus.on('e', () => count++);
  bus.emit('e');
  off();
  bus.emit('e');
  assert.equal(count, 1);
  assert.doesNotThrow(() => bus.emit('never-registered', {}));
});

/* ---------------- Save ---------------- */
test('Save.load returns defaults on empty storage', () => {
  resetStorage();
  const s = RH.Save.load();
  assert.equal(s.bank, 0);
  assert.equal(s.best, 0);
  assert.deepEqual(s.upgrades, { speed: 0, capacity: 0, time: 0, pay: 0 });
});

test('Save round-trips and merges partial upgrades', () => {
  resetStorage();
  const s = RH.Save.load();
  s.bank = 250; s.best = 1700; s.upgrades.speed = 3;
  RH.Save.persist(s);
  const r = RH.Save.load();
  assert.equal(r.bank, 250);
  assert.equal(r.best, 1700);
  assert.equal(r.upgrades.speed, 3);
  assert.equal(r.upgrades.capacity, 0); // default preserved
});

/* ---------------- layout generation (seams 1 & 2) ---------------- */
test('generateDowntown produces a valid grid', () => {
  const L = RH.generateDowntown(960, 640);
  assert.equal(L.cols, 24);
  assert.equal(L.rows, 16);
  assert.equal(L.tile, 40);
  assert.equal(L.grid.length, 24 * 16);
  // spawn must be on a road
  assert.equal(RH.tileAtPx(L, L.spawn.x, L.spawn.y), RH.TILE.ROAD);
});

test('generateDowntown places 4 sources and 8 sinks on building edges', () => {
  const L = RH.generateDowntown(960, 640);
  assert.equal(RH.sources(L).length, 4);
  assert.equal(RH.sinks(L).length, 8);
  for (const n of L.nodes) {
    assert.ok(n.x > 0 && n.x < 960 && n.y > 0 && n.y < 640);
    assert.ok(['source', 'sink'].includes(n.role));
    // node sits on a BUILDING cell whose access side is walkable (road, or mud
    // if terrain was sprinkled there — both are non-solid)
    assert.equal(RH.tileAt(L, n.cell.c, n.cell.r), RH.TILE.BUILDING);
    const fc = n.cell.c + n.face.dx, fr = n.cell.r + n.face.dy;
    assert.ok(!RH.isSolid(RH.tileAt(L, fc, fr)), 'access side is reachable');
  }
});

test('each restaurant gets a unique colorblind-safe symbol; houses have none', () => {
  const L = RH.generateDowntown(960, 640);
  const symbols = RH.sources(L).map(n => n.symbol);
  assert.ok(symbols.every(Boolean), 'every source has a symbol');
  assert.equal(new Set(symbols).size, symbols.length, 'symbols are unique');
  assert.ok(RH.sinks(L).every(n => n.symbol == null), 'sinks carry no symbol');
});

/* ---------------- second layout: Riverside (layout + tile seams) ---------- */
test('generateRiverside is a valid layout with water and road bridges', () => {
  const L = RH.generateRiverside(960, 640);
  assert.equal(L.name, 'Riverside');
  assert.equal(L.grid.length, L.cols * L.rows);
  assert.equal(RH.sources(L).length, 4);
  assert.equal(RH.sinks(L).length, 8);
  // spawn sits on a road
  assert.equal(RH.tileAtPx(L, L.spawn.x, L.spawn.y), RH.TILE.ROAD);
  // there IS water, and bridges (road) cross it at the horizontal road rows
  let water = 0, bridges = 0;
  for (let r = 0; r < L.rows; r++)
    for (let c = 0; c < L.cols; c++) {
      const t = RH.tileAt(L, c, r);
      if (t === RH.TILE.WATER) water++;
      if (t === RH.TILE.ROAD && r % 4 === 0 && Math.abs(c - Math.round(L.cols / 2)) <= 1) bridges++;
    }
  assert.ok(water > 0, 'river exists');
  assert.ok(bridges > 0, 'bridges cross the river on road rows');
});

test('water is a slow, wadeable shortcut (not solid); buildings still block', () => {
  assert.ok(RH.isSolid(RH.TILE.BUILDING), 'buildings block');
  assert.ok(!RH.isSolid(RH.TILE.ROAD));
  assert.ok(!RH.isSolid(RH.TILE.WATER), 'water is wadeable');
  const m = RH.TILE_MODS[RH.TILE.WATER];
  assert.ok(m > 0 && m < 1, 'water slows but does not block');
  assert.ok(m < RH.TILE_MODS[RH.TILE.MUD], 'water is slower than mud');
  // a body sitting in a water cell is NOT pushed out (you can wade through)
  const L = RH.generateRiverside(960, 640);
  const T = L.tile;
  let w = null;
  for (let r = 0; r < L.rows && !w; r++)
    for (let c = 0; c < L.cols && !w; c++)
      if (RH.tileAt(L, c, r) === RH.TILE.WATER) w = { c, r };
  const p = { x: w.c * T + T / 2, y: w.r * T + T / 2, r: 13 };
  RH.resolveCollision(L, p);
  assert.equal(RH.tileAtPx(L, p.x, p.y), RH.TILE.WATER, 'body stays in the water (wading)');
});

test('randomLayout returns a valid layout from the registry', () => {
  assert.ok(RH.LAYOUTS.length >= 2);
  const L = RH.randomLayout(960, 640);
  assert.ok(RH.DISTRICTS.some(d => d.name === L.name));
  assert.equal(RH.sources(L).length, 4);
});

/* ---------------- districts (v0.5) ---------------- */
test('every district generates a fully-connected, valid map', () => {
  assert.ok(RH.DISTRICTS.length >= 3, 'a pool worth drafting from');
  for (const d of RH.DISTRICTS) {
    assert.ok(d.name && d.blurb && typeof d.gen === 'function', `${d.name} well-formed`);
    const L = d.gen(960, 640);
    assert.equal(RH.sources(L).length, 4, `${d.name} has 4 sources`);
    assert.equal(RH.sinks(L).length, 8, `${d.name} has 8 sinks`);
    assert.ok(RH.isConnected(L), `${d.name} is fully connected (no unreachable node)`);
  }
});

test('isConnected rejects a layout with a node walled off from spawn', () => {
  const L = RH.generateDowntown(960, 640);
  assert.ok(RH.isConnected(L));
  // wall the whole map solid except the spawn cell → nodes unreachable
  const sc = Math.floor(L.spawn.x / L.tile), sr = Math.floor(L.spawn.y / L.tile);
  for (let i = 0; i < L.grid.length; i++) L.grid[i] = RH.TILE.BUILDING;
  L.grid[sr * L.cols + sc] = RH.TILE.ROAD;
  assert.equal(RH.isConnected(L), false);
});

test('draftDistricts returns n distinct districts, excluding the current one', () => {
  const picks = RH.draftDistricts(3, 'Downtown');
  assert.equal(picks.length, 3);
  assert.equal(new Set(picks.map(p => p.name)).size, 3, 'distinct');
  assert.ok(!picks.some(p => p.name === 'Downtown'), 'current district excluded');
});

test('tileAt treats out-of-bounds as building (solid border)', () => {
  const L = RH.generateDowntown(960, 640);
  assert.equal(RH.tileAt(L, -1, 0), RH.TILE.BUILDING);
  assert.equal(RH.tileAt(L, 0, -1), RH.TILE.BUILDING);
  assert.equal(RH.tileAt(L, 999, 999), RH.TILE.BUILDING);
});

/* ---------------- balance (tuning-as-data) ---------------- */
test('Balance exposes the expected tuning shape', () => {
  const B = RH.Balance;
  assert.ok(B.player.baseSpeed > 0 && B.player.interactRange > 0);
  assert.equal(Object.keys(B.upgrades).length, 4);
  assert.ok(Object.keys(B.powerups).length >= 4);
  assert.ok(B.run.maxMisses >= 1 && B.run.deliveriesPerLevel >= 1);
});

test('difficulty curve gets harder with level and respects floors', () => {
  const B = RH.Balance;
  const d1 = B.difficulty(1), d5 = B.difficulty(5), d99 = B.difficulty(99);
  assert.ok(d5.spawnEvery < d1.spawnEvery, 'spawns get faster');
  assert.ok(d5.timeBudget < d1.timeBudget, 'timers get tighter');
  assert.ok(d5.maxActive >= d1.maxActive, 'more orders active');
  assert.ok(d99.spawnEvery >= 2.0 && d99.timeBudget >= 6.5, 'floors hold at extreme levels');
  assert.ok(d99.maxActive <= 6, 'maxActive is capped');
});

test('upgrade defs that declare a mod feed the Stats resolver correctly', () => {
  const B = RH.Balance;
  // emulate makeUpgradeMods for speed at level 3
  const m = B.upgrades.speed.mod;
  const mod = { stat: m.stat, op: 'mul', value: 1 + m.perLevel * 3 };
  assert.equal(RH.Stats.resolve(100, 'speed', [mod]), 100 * (1 + 0.12 * 3));
});

/* ---------------- order kinds (the order-modifier seam) ---------------- */
test('order kinds gate by level via eligibleKinds', () => {
  const O = RH.Balance.order;
  const lvl1 = O.eligibleKinds(1);
  assert.ok(lvl1.includes('normal') && lvl1.includes('rush'));
  assert.ok(!lvl1.includes('bulky') && !lvl1.includes('vip') && !lvl1.includes('fragile'), 'bulky/vip/fragile locked early');
  const hi = O.eligibleKinds(99);
  assert.deepEqual(new Set(hi), new Set(['normal', 'rush', 'bulky', 'fragile', 'vip']));
});

test('rollKind only ever returns a level-eligible kind', () => {
  const O = RH.Balance.order;
  const allowed = new Set(O.eligibleKinds(1));
  for (let i = 0; i < 200; i++) {
    const k = O.rollKind(1, () => i / 200); // sweep the whole [0,1) range
    assert.ok(allowed.has(k), `rollKind returned locked kind: ${k}`);
  }
});

test('bulky orders take 2 slots; vip is high-pay/short-time; fragile is flagged', () => {
  const K = RH.Balance.order.kinds;
  assert.equal(K.bulky.slots, 2);
  assert.equal(K.normal.slots, 1);
  assert.ok(K.vip.payMult > K.normal.payMult && K.vip.timeMult < K.normal.timeMult);
  assert.equal(K.fragile.fragile, true);
  assert.ok(K.fragile.payMult > K.normal.payMult, 'fragile pays a risk premium');
});

/* ---------------- terrain (mud) ---------------- */
test('MUD is a walkable slow tile (not solid), and layouts place some', () => {
  assert.equal(RH.isSolid(RH.TILE.MUD), false, 'mud is walkable');
  const m = RH.TILE_MODS[RH.TILE.MUD];
  assert.ok(m > 0 && m < 1, 'mud slows but does not block');
  const L = RH.generateDowntown(960, 640);
  let mud = 0;
  for (let i = 0; i < L.grid.length; i++) if (L.grid[i] === RH.TILE.MUD) mud++;
  assert.ok(mud > 0, 'downtown has mud patches');
});

/* ---------------- combo & perks (v0.4) ---------------- */
test('combo multiplier scales with the streak and caps at maxBonus', () => {
  const C = RH.Balance.combo;
  assert.equal(C.mult(0), 1);
  assert.equal(C.mult(C.step), 1 + C.per);          // first step
  assert.equal(C.mult(C.step * 2), 1 + C.per * 2);  // second step
  assert.equal(C.mult(1000), 1 + C.maxBonus);       // capped
});

test('a smaller step (Hot Streak perk) builds combo faster', () => {
  const C = RH.Balance.combo;
  assert.ok(C.mult(2, 1) > C.mult(2, 2), 'step 1 reaches a higher mult at the same combo');
});

test('perks are well-formed: a name, a desc, and at least one effect', () => {
  assert.ok(RH.Balance.perks.length >= 3);
  for (const p of RH.Balance.perks) {
    assert.ok(p.name && p.desc, `${p.id} has name+desc`);
    const hasEffect = p.mod || p.capacity || p.maxMisses || p.comboFast;
    assert.ok(hasEffect, `${p.id} has an effect`);
  }
});

/* ---------------- dash (v0.8) ---------------- */
test('dash config is a real speed boost on a cooldown', () => {
  const d = RH.Balance.player.dash;
  assert.ok(d.mult > 1, 'dash is faster than normal');
  assert.ok(d.duration > 0 && d.cooldown > d.duration, 'a short burst with a longer cooldown');
});

/* ---------------- agents (v0.6 traffic) ---------------- */
test('agent counts scale with level and cap out', () => {
  const A = RH.Balance.agents;
  assert.ok(A.countsAt(1).car >= 1, 'at least one car early');
  assert.ok(A.countsAt(5).car > A.countsAt(1).car, 'more cars at higher levels');
  assert.ok(A.countsAt(99).car <= A.maxTotal, 'capped at maxTotal');
});

test('people (cyclists/peds) appear from level 2 and carry a fine, not a bump', () => {
  const A = RH.Balance.agents;
  assert.equal(A.countsAt(1).ped, 0, 'no people at level 1');
  assert.equal(A.countsAt(1).cyclist, 0);
  assert.ok(A.countsAt(3).ped > 0 && A.countsAt(3).cyclist > 0, 'people appear later');
  assert.ok(A.kinds.ped.fine > 0 && A.kinds.cyclist.fine > 0, 'people fine you');
  assert.ok(!A.kinds.ped.bump && !A.kinds.cyclist.bump, 'people do not bump');
  assert.ok(A.kinds.car.bump && !A.kinds.car.fine, 'cars bump, no fine');
});

test('police appear from level 3 and fine you for dashing nearby', () => {
  const A = RH.Balance.agents;
  assert.equal(A.countsAt(2).police, 0, 'no police before level 3');
  assert.ok(A.countsAt(4).police > 0, 'police from level 3+');
  assert.ok(A.kinds.police.dashFine > 0 && A.kinds.police.detect > 0, 'police fine on dash proximity');
});

test('a spawned car sits on a road and stays on roads as it drives', () => {
  const L = RH.generateDowntown(960, 640);
  const car = RH.Agents.spawn(L, 'car', RH.Balance.agents.kinds.car);
  assert.ok(car, 'car spawned');
  assert.equal(RH.tileAtPx(L, car.x, car.y), RH.TILE.ROAD, 'spawns on a road');
  // drive for a while; it must never end a step on a non-road tile
  for (let i = 0; i < 400; i++) {
    RH.Agents.step(L, car, 0.05);
    assert.equal(RH.tileAtPx(L, car.x, car.y), RH.TILE.ROAD, `still on a road at step ${i}`);
  }
});

/* ---------------- collision ---------------- */
test('player fully on open road is not moved', () => {
  const L = RH.generateDowntown(960, 640);
  const p = { x: L.spawn.x, y: L.spawn.y, r: 13 };
  const before = { x: p.x, y: p.y };
  RH.resolveCollision(L, p);
  assert.ok(Math.abs(p.x - before.x) < 0.001);
  assert.ok(Math.abs(p.y - before.y) < 0.001);
});

test('snapToRoad relocates a point from inside a building to a road cell', () => {
  const L = RH.generateDowntown(960, 640);
  const T = L.tile;
  // pick a building cell
  let b = null;
  for (let r = 0; r < L.rows && !b; r++)
    for (let c = 0; c < L.cols && !b; c++)
      if (RH.tileAt(L, c, r) === RH.TILE.BUILDING) b = { c, r };
  const p = { x: b.c * T + T / 2, y: b.r * T + T / 2, r: 13 };
  RH.snapToRoad(L, p);
  assert.equal(RH.tileAtPx(L, p.x, p.y), RH.TILE.ROAD);
});

test('player overlapping a building edge is pushed back onto the road', () => {
  const L = RH.generateDowntown(960, 640);
  const T = L.tile;
  // find a road cell with a building neighbor to the right
  let road = null;
  for (let r = 1; r < L.rows - 1 && !road; r++)
    for (let c = 1; c < L.cols - 1 && !road; c++)
      if (RH.tileAt(L, c, r) === RH.TILE.ROAD && RH.tileAt(L, c + 1, r) === RH.TILE.BUILDING)
        road = { c, r };
  assert.ok(road, 'expected a road cell adjacent to a building');
  // place player just inside the building edge (overlapping the building cell)
  const buildingLeftEdge = (road.c + 1) * T;
  const p = { x: buildingLeftEdge + 4, y: road.r * T + T / 2, r: 13 };
  RH.resolveCollision(L, p);
  // after resolution the player circle must not overlap the building interior:
  // its right edge should be at/left of the building's left edge
  assert.ok(p.x + p.r <= buildingLeftEdge + 0.5, `player x=${p.x} not pushed out`);
});
