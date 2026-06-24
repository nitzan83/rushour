/* End-to-end tests for the full game in a real browser (Playwright).
   Covers the integration layer game.js owns: screens, input, pickup/deliver,
   miss/strike, game over, powerups, shop, persistence.
   Run with: node --test tests/e2e.test.mjs */
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };
const PORT = 8090;
const BASE = `http://localhost:${PORT}`;

let server, browser, context, page, errors;

before(async () => {
  server = http.createServer((req, res) => {
    let file = req.url.split('?')[0];        // strip query first (e.g. /?dev=1)
    if (file === '/') file = '/index.html';
    const full = path.join(root, path.normalize(file));
    fs.readFile(full, (err, data) => {
      if (err) { res.writeHead(404); return res.end('nope'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'text/plain' });
      res.end(data);
    });
  });
  await new Promise(r => server.listen(PORT, r));
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  await new Promise(r => server.close(r));
});

beforeEach(async () => {
  context = await browser.newContext();
  page = await context.newPage();
  errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
});

afterEach(async () => {
  assert.equal(errors.length, 0, 'console errors: ' + errors.join(' | '));
  await context.close();
});

const startRun = async () => { await page.click('#start-btn'); await page.waitForTimeout(150); };
const state = () => page.evaluate(() => RH.debug());
// move player to a node by id and act
const teleport = (x, y) => page.evaluate(([x, y]) => { const g = RH.debug(); g.player.x = x; g.player.y = y; }, [x, y]);

// poll until at least one order is available (orders spawn on a timer)
async function waitForAvailable(ms = 2500) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (await page.evaluate(() => RH.debug().orders.some(o => o.state === 'available'))) return true;
    await page.waitForTimeout(100);
  }
  return false;
}
// teleport to the first available order's source and press SPACE
async function pickupFirstAvailable() {
  const src = await page.evaluate(() => {
    const g = RH.debug();
    g.agents = []; // keep traffic from bumping the courier off-target in tests
    const o = g.orders.find(o => o.state === 'available');
    return o ? { x: g.layout.nodes[o.from].x, y: g.layout.nodes[o.from].y } : null;
  });
  if (!src) return false;
  await teleport(src.x, src.y);
  await page.waitForTimeout(40);
  await page.keyboard.press('Space');
  await page.waitForTimeout(60);
  return true;
}
// teleport to the first carried order's destination and press SPACE
async function deliverCarried() {
  const dst = await page.evaluate(() => {
    const g = RH.debug();
    g.agents = [];
    return { x: g.layout.nodes[g.carried[0].to].x, y: g.layout.nodes[g.carried[0].to].y };
  });
  await teleport(dst.x, dst.y);
  await page.waitForTimeout(40);
  await page.keyboard.press('Space');
  await page.waitForTimeout(60);
}

/* ---------------- screens ---------------- */
test('menu and shop render on load', async () => {
  await page.goto(BASE);
  assert.ok(await page.isVisible('#menu'));
  assert.equal(await page.locator('#shop .shop-item').count(), 5);
});

test('starting a run shows the HUD and hides the menu', async () => {
  await page.goto(BASE);
  await startRun();
  assert.ok(await page.isVisible('#hud'));
  assert.ok(!(await page.isVisible('#menu')));
});

/* ---------------- core loop ---------------- */
test('SPACE near a restaurant picks up an order', async () => {
  await page.goto(BASE);
  await startRun();
  const src = await page.evaluate(() => {
    const g = RH.debug();
    const o = g.orders.find(o => o.state === 'available');
    const n = g.layout.nodes[o.from];
    return { x: n.x, y: n.y };
  });
  await teleport(src.x, src.y);
  await page.waitForTimeout(50);
  await page.keyboard.press('Space');
  await page.waitForTimeout(80);
  assert.equal((await state()).carried.length, 1);
});

test('SPACE at the destination delivers, pays out, and clears the bag', async () => {
  await page.goto(BASE);
  await startRun();
  // pick up
  const src = await page.evaluate(() => {
    const g = RH.debug();
    const o = g.orders.find(o => o.state === 'available');
    return { x: g.layout.nodes[o.from].x, y: g.layout.nodes[o.from].y };
  });
  await teleport(src.x, src.y);
  await page.waitForTimeout(50);
  await page.keyboard.press('Space');
  await page.waitForTimeout(80);
  // deliver
  const dst = await page.evaluate(() => {
    const g = RH.debug();
    const n = g.layout.nodes[g.carried[0].to];
    return { x: n.x, y: n.y };
  });
  await teleport(dst.x, dst.y);
  await page.waitForTimeout(50);
  await page.keyboard.press('Space');
  await page.waitForTimeout(80);
  const s = await state();
  assert.equal(s.delivered, 1);
  assert.ok(s.cash > 0, 'cash should be earned');
  assert.equal(s.carried.length, 0);
});

/* ---------------- failure ---------------- */
test('an expired order adds a miss/strike', async () => {
  await page.goto(BASE);
  await startRun();
  const before = (await state()).misses;
  await page.evaluate(() => { RH.debug().orders.find(o => o.state === 'available').time = 0.01; });
  await page.waitForTimeout(120);
  assert.equal((await state()).misses, before + 1);
});

test('three misses ends the run and banks the cash', async () => {
  await page.goto(BASE);
  await startRun();
  // earn something first so the bank delta is observable
  await page.evaluate(() => {
    const g = RH.debug();
    g.cash = 50;
    g.misses = g.maxMisses - 1;           // one strike from over
    g.orders.find(o => o.state === 'available').time = 0.01;
  });
  await page.waitForTimeout(150);
  assert.ok(await page.isVisible('#gameover'));
  const bank = await page.evaluate(() => JSON.parse(localStorage.getItem('rushhour_save_v2')).bank);
  assert.equal(bank, 50);
});

test('a delivery does NOT reset the cumulative miss count (3 total, not in a row)', async () => {
  await page.goto(BASE);
  await startRun();
  // miss one order
  await page.evaluate(() => { RH.debug().orders.find(o => o.state === 'available').time = 0.01; });
  await page.waitForTimeout(120);
  assert.equal((await state()).misses, 1);
  // then successfully deliver one
  assert.ok(await waitForAvailable(), 'an order should spawn to deliver');
  assert.ok(await pickupFirstAvailable());
  await deliverCarried();
  const s = await state();
  assert.equal(s.delivered, 1, 'delivery happened');
  assert.equal(s.misses, 1, 'misses must persist through a successful delivery');
});

/* ---------------- ×2 cash powerup ---------------- */
test('×2 cash doubles the payout (cash only)', async () => {
  await page.goto(BASE);
  await startRun();
  assert.ok(await pickupFirstAvailable());
  // full timer (max time bonus) + active cash effect, deterministic payout
  const info = await page.evaluate(() => {
    const g = RH.debug();
    const o = g.carried[0];
    o.time = o.maxTime;
    g.effects.cash = 8;
    return { reward: o.reward, bonus: RH.Balance.order.timeBonusMax };
  });
  await deliverCarried();
  const s = await page.evaluate(() => ({ cash: RH.debug().cash, floaters: RH.debug().floaters.map(f => f.text) }));
  assert.equal(s.cash, (info.reward + info.bonus) * 2, 'payout should be doubled');
  assert.ok(s.floaters.some(t => t.includes('×2')), 'a ×2 floater should appear');
});

/* ---------------- order glyphs (colorblind-safe) ---------------- */
test('an order carries its restaurant glyph', async () => {
  await page.goto(BASE);
  await startRun();
  const ok = await page.evaluate(() => {
    const g = RH.debug();
    const o = g.orders.find(o => o.state === 'available');
    return !!o.symbol && o.symbol === g.layout.nodes[o.from].symbol;
  });
  assert.ok(ok, 'order.symbol matches its source node symbol');
});

/* ---------------- order kinds ---------------- */
test('a bulky order consumes 2 bag slots and blocks a second pickup when full', async () => {
  await page.goto(BASE);
  await startRun();
  // force the first available order to be bulky (2 slots), then pick it up
  await page.evaluate(() => {
    const g = RH.debug();
    const o = g.orders.find(o => o.state === 'available');
    const k = RH.Balance.order.kinds.bulky;
    Object.assign(o, { kind: 'bulky', slots: k.slots, label: k.label, tint: k.tint });
    g.capacity = 2; // base bag
  });
  assert.ok(await pickupFirstAvailable());
  let s = await state();
  assert.equal(s.carried.length, 1);
  assert.equal(s.carried[0].slots, 2);
  // bag is now full (2/2): a further pickup at any source must be refused
  assert.ok(await waitForAvailable());
  await pickupFirstAvailable();
  s = await state();
  assert.equal(s.carried.length, 1, 'no room for another order while carrying bulky');
});

/* ---------------- fragile orders ---------------- */
test('a fragile order shatters on a hard wall crash (counts as a miss)', async () => {
  await page.goto(BASE);
  await startRun();
  // set up: a road cell with a building to its right, carry a fragile order,
  // clear other orders/spawns so only the crash can change misses
  await page.evaluate(() => {
    const g = RH.debug(), L = g.layout, T = L.tile;
    let cell = null;
    for (let r = 1; r < L.rows - 1 && !cell; r++)
      for (let c = 1; c < L.cols - 1 && !cell; c++)
        if (RH.tileAt(L, c, r) === RH.TILE.ROAD && RH.tileAt(L, c + 1, r) === RH.TILE.BUILDING) cell = { c, r };
    g.player.x = cell.c * T + T / 2; g.player.y = cell.r * T + T / 2;
    g.orders = [];
    g.agents = [];             // no traffic interfering with the crash test
    g.spawnTimer = 999;        // no new spawns during the test
    g.carried = [{ id: 999, from: 0, to: 1, color: '#fff', symbol: 'A', state: 'carried',
                   time: 999, maxTime: 999, reward: 10, kind: 'fragile', slots: 1, fragile: true }];
    g.misses = 0;
  });
  // drive hard into the wall
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(500);
  await page.keyboard.up('ArrowRight');
  const s = await state();
  assert.equal(s.carried.length, 0, 'fragile order destroyed');
  assert.equal(s.misses, 1, 'crash counts as exactly one miss');
});

/* ---------------- water as a wadeable shortcut ---------------- */
test('the courier can wade through water but is slowed by it', async () => {
  await page.goto(BASE);
  await startRun();
  const start = await page.evaluate(() => {
    const g = RH.debug();
    const L = RH.generateRiverside(960, 640);
    Object.assign(g, { layout: L, orders: [], carried: [], powerups: [], agents: [], spawnTimer: 999, effects: {} });
    // find a vertical run of water to wade straight down through
    let cell = null;
    for (let c = 0; c < L.cols && !cell; c++)
      for (let r = 1; r < L.rows - 2 && !cell; r++)
        if (RH.tileAt(L, c, r) === RH.TILE.WATER && RH.tileAt(L, c, r + 1) === RH.TILE.WATER) cell = { c, r };
    const T = L.tile;
    g.player.x = cell.c * T + T / 2; g.player.y = cell.r * T + T / 2;
    return { y: g.player.y };
  });
  await page.keyboard.down('ArrowDown');
  await page.waitForTimeout(250);
  await page.keyboard.up('ArrowDown');
  const moved = (await page.evaluate(() => RH.debug().player.y)) - start.y;
  assert.ok(moved > 1, `courier passes through water (moved ${moved.toFixed(1)}px)`);
  assert.ok(moved < 55, `water slows the courier vs. open road (moved ${moved.toFixed(1)}px)`);
});

/* ---------------- new powerups (v0.3) ---------------- */
test('ghost lets the courier phase through a building, then ejects when it ends', async () => {
  await page.goto(BASE);
  await startRun();
  // place player inside a building cell while ghost is active → should NOT be ejected
  const inside = await page.evaluate(() => {
    const g = RH.debug(), L = g.layout, T = L.tile;
    let cell = null;
    for (let r = 0; r < L.rows && !cell; r++)
      for (let c = 0; c < L.cols && !cell; c++)
        if (RH.tileAt(L, c, r) === RH.TILE.BUILDING &&
            RH.tileAt(L, c - 1, r) === RH.TILE.BUILDING &&
            RH.tileAt(L, c + 1, r) === RH.TILE.BUILDING) cell = { c, r };
    g.effects.ghost = 4;
    g.player.x = cell.c * T + T / 2; g.player.y = cell.r * T + T / 2;
    return { x: g.player.x, y: g.player.y };
  });
  await page.waitForTimeout(120);
  const still = await page.evaluate(() => RH.tileAtPx(RH.debug().layout, RH.debug().player.x, RH.debug().player.y));
  assert.equal(still, await page.evaluate(() => RH.TILE.BUILDING), 'ghost keeps the courier inside the building');
  // end ghost → within a few frames collision should eject onto a road
  await page.evaluate(() => { delete RH.debug().effects.ghost; });
  await page.waitForTimeout(400);
  const tile = await page.evaluate(() => RH.tileAtPx(RH.debug().layout, RH.debug().player.x, RH.debug().player.y));
  assert.equal(tile, await page.evaluate(() => RH.TILE.ROAD), 'courier ejected to a road after ghost ends');
});

test('refuel instantly adds time to all active orders', async () => {
  await page.goto(BASE);
  await startRun();
  const before = await page.evaluate(() => {
    const g = RH.debug();
    const o = g.orders.find(o => o.state === 'available');
    o.time = 2; // low
    // drop a refuel powerup on the player
    const d = RH.Balance.powerups.refuel;
    g.powerups.push({ type: 'refuel', ...d, x: g.player.x, y: g.player.y, r: 14, life: 12 });
    return { id: o.id, time: o.time, add: d.addTime };
  });
  await page.waitForTimeout(120);
  const after = await page.evaluate((id) => RH.debug().orders.find(o => o.id === id)?.time ?? null, before.id);
  assert.ok(after > before.time, `order time should rise (was ${before.time}, now ${after})`);
});

/* ---------------- traffic / agents (v0.6) ---------------- */
test('cars spawn during a run and bumping one stuns + knocks back the courier', async () => {
  await page.goto(BASE);
  await startRun();
  const cars = await page.evaluate(() => RH.debug().agents.length);
  assert.ok(cars >= 1, 'at least one car spawned');
  // teleport a car onto the courier and pin it there (speed 0) → deterministic bump
  const res = await page.evaluate(() => {
    const g = RH.debug();
    g.stun = 0; g.bumpCd = 0;
    const a = g.agents[0];
    a.speed = 0; a.x = g.player.x + 8; a.y = g.player.y; // overlap (offset gives a knockback direction)
    g.player.dir = 0;
    return { px: g.player.x, py: g.player.y };
  });
  await page.waitForTimeout(150);
  const after = await page.evaluate(() => { const g = RH.debug(); return { stun: g.stun, px: g.player.x, py: g.player.y }; });
  assert.ok(after.stun > 0, 'bump stunned the courier');
  assert.ok(Math.hypot(after.px - res.px, after.py - res.py) > 1, 'bump knocked the courier back');
});

test('hitting a person fines you (cash drops, combo resets) without stunning', async () => {
  await page.goto(BASE);
  await startRun();
  const setup = await page.evaluate(() => {
    const g = RH.debug();
    g.cash = 100; g.combo = 5; g.stun = 0;
    // inject a pedestrian on top of the courier
    const cfg = RH.Balance.agents.kinds.ped;
    g.agents.push({ kind: 'ped', r: cfg.r, speed: cfg.speed, color: cfg.color,
      cc: 0, cr: 0, pc: 0, pr: 0, tc: 0, tr: 0, hdc: 0, hdr: 0, dir: 0, fineCd: 0,
      x: g.player.x, y: g.player.y });
    return { cash: g.cash };
  });
  await page.waitForTimeout(80);
  const after = await page.evaluate(() => { const g = RH.debug(); return { cash: g.cash, combo: g.combo, stun: g.stun }; });
  assert.ok(after.cash < setup.cash, 'a fine was charged');
  assert.equal(after.combo, 0, 'fine breaks the combo');
  assert.ok(after.stun <= 0, 'a person does not stun you (only cars do)');
});

/* ---------------- dash (v0.8) ---------------- */
test('dash gives a burst of speed and then goes on cooldown', async () => {
  await page.goto(BASE);
  await startRun();
  // measure normal travel over a fixed time on open road
  await page.evaluate(() => { const g = RH.debug(); g.player.dir = 0; g.stun = 0; g.dashCd = 0; g.agents = []; });
  const normal = await page.evaluate(async () => {
    const g = RH.debug(); const x0 = g.player.x;
    RH.input.dx = 1; RH.input.dy = 0; RH.input.active = true;
    await new Promise(r => setTimeout(r, 150));
    const d = g.player.x - x0; RH.input.active = false; return d;
  });
  // now dash and measure travel over the same window
  await page.evaluate(() => { const g = RH.debug(); g.player.x = g.layout.spawn.x; g.player.y = g.layout.spawn.y; g.dashCd = 0; });
  const dashed = await page.evaluate(async () => {
    const g = RH.debug(); const x0 = g.player.x;
    g.player.dir = 0; RH.dash();
    RH.input.dx = 1; RH.input.dy = 0; RH.input.active = true;
    await new Promise(r => setTimeout(r, 150));
    const d = g.player.x - x0; RH.input.active = false; return d;
  });
  assert.ok(dashed > normal, `dash should cover more ground (dash ${dashed.toFixed(0)} > normal ${normal.toFixed(0)})`);
  // dash is on cooldown immediately after
  assert.ok(await page.evaluate(() => RH.debug().dashCd > 0), 'dash on cooldown');
  // a second dash while cooling does nothing to dashTime
  const blocked = await page.evaluate(() => { const g = RH.debug(); const t = g.dashTime; RH.dash(); return g.dashTime <= Math.max(t, 0) + 0.001; });
  assert.ok(blocked, 'cannot dash again while on cooldown');
});

/* ---------------- police (v0.9) ---------------- */
test('dashing near a police car fines you; just driving near it does not', async () => {
  await page.goto(BASE);
  await startRun();
  // place a police car a short distance from a stationary courier
  await page.evaluate(() => {
    const g = RH.debug();
    g.cash = 100; g.combo = 5; g.agents = []; g.dashTime = 0; g.dashCd = 0;
    const cfg = RH.Balance.agents.kinds.police;
    g.agents.push({ kind: 'police', r: cfg.r, speed: 0, color: cfg.color,
      cc: 0, cr: 0, pc: 0, pr: 0, tc: 0, tr: 0, hdc: 0, hdr: 0, dir: 0, heatCd: 0,
      x: g.player.x + 40, y: g.player.y }); // within the ~66px detect radius
  });
  // not dashing → no fine
  await page.waitForTimeout(120);
  assert.equal(await page.evaluate(() => RH.debug().cash), 100, 'no fine without a dash');
  // dash near the cop → fine
  await page.evaluate(() => { const g = RH.debug(); g.dashCd = 0; RH.dash(); });
  await page.waitForTimeout(120);
  const s = await page.evaluate(() => { const g = RH.debug(); return { cash: g.cash, combo: g.combo }; });
  assert.ok(s.cash < 100, 'dashing near police charges a fine');
  assert.equal(s.combo, 0, 'reckless fine breaks combo');
});

/* ---------------- fuel (v0.10) ---------------- */
test('charge drains while driving, tops off at a station, and runs dry to a crawl', async () => {
  await page.goto(BASE);
  await startRun();
  await page.evaluate(() => { const g = RH.debug(); g.agents = []; g.fuel = g.maxFuel; });
  // drive for a bit → fuel drops
  const drained = await page.evaluate(async () => {
    const g = RH.debug(); const f0 = g.fuel;
    RH.input.dx = 1; RH.input.dy = 0; RH.input.active = true;
    await new Promise(r => setTimeout(r, 300));
    RH.input.active = false;
    return { f0, f1: g.fuel };
  });
  assert.ok(drained.f1 < drained.f0, 'driving drains charge');
  // park on a station → fuel climbs back up
  const refilled = await page.evaluate(async () => {
    const g = RH.debug();
    g.fuel = 10;
    const st = g.layout.nodes.find(n => n.role === 'station');
    g.player.x = st.x; g.player.y = st.y;
    const f0 = g.fuel;
    await new Promise(r => setTimeout(r, 250));
    return { f0, f1: g.fuel };
  });
  assert.ok(refilled.f1 > refilled.f0, 'a station recharges you');
  // empty tank → crawl (effective speed is throttled)
  const crawl = await page.evaluate(async () => {
    const g = RH.debug();
    g.agents = []; g.fuel = 0; g.player.dir = 0;
    g.player.x = g.layout.spawn.x; g.player.y = g.layout.spawn.y;
    const x0 = g.player.x;
    RH.input.dx = 1; RH.input.dy = 0; RH.input.active = true;
    await new Promise(r => setTimeout(r, 200));
    RH.input.active = false;
    return g.player.x - x0;
  });
  // a full-speed 200ms run covers ~40px; empty should be far less
  assert.ok(crawl < 20, `empty tank crawls (moved ${crawl.toFixed(1)}px)`);
});

/* ---------------- dev / cheat mode ---------------- */
test('dev mode: ?dev=1 panel, jump levels, spawn agents, god mode', async () => {
  const c = await browser.newContext({ viewport: { width: 1100, height: 760 } });
  const p = await c.newPage();
  const errs = []; p.on('pageerror', e => errs.push('' + e));
  await p.goto(BASE + '?dev=1');
  assert.ok(await p.isVisible('#dev-panel'), 'dev panel shows with ?dev=1');
  await p.click('#start-btn');
  await p.waitForTimeout(120);
  // jump to level 7 via the API → level set + traffic refreshed for that level
  await p.evaluate(() => RH.dev.jump(7));
  await p.waitForTimeout(60);
  const s1 = await p.evaluate(() => { const g = RH.debug(); return { level: g.level, cars: g.agents.filter(a => a.kind === 'car').length, police: g.agents.filter(a => a.kind === 'police').length }; });
  assert.equal(s1.level, 7, 'jumped to level 7');
  assert.ok(s1.cars >= 1, 'traffic respawned for the level');
  assert.ok(s1.police >= 1, 'police present at high level');
  // spawn a fragile order + a cyclist on demand
  await p.evaluate(() => { RH.dev.order('fragile'); RH.dev.spawnAgent('cyclist'); });
  const s2 = await p.evaluate(() => { const g = RH.debug(); return { fragile: g.orders.some(o => o.kind === 'fragile'), cyclist: g.agents.some(a => a.kind === 'cyclist') }; });
  assert.ok(s2.fragile, 'dev forced a fragile order');
  assert.ok(s2.cyclist, 'dev spawned a cyclist');
  // god mode prevents fines: drop a ped on the courier, no cash loss
  await p.evaluate(() => {
    const g = RH.debug(); g.cash = 100; RH.dev.god();
    const cfg = RH.Balance.agents.kinds.ped;
    g.agents.push({ kind: 'ped', r: cfg.r, speed: 0, color: cfg.color, cc: 0, cr: 0, pc: 0, pr: 0, tc: 0, tr: 0, hdc: 0, hdr: 0, dir: 0, fineCd: 0, x: g.player.x, y: g.player.y });
  });
  await p.waitForTimeout(80);
  assert.equal(await p.evaluate(() => RH.debug().cash), 100, 'god mode: no fine charged');
  assert.equal(errs.length, 0, errs.join(' | '));
  await c.close();
});

/* ---------------- combo & perk draft (v0.4) ---------------- */
test('combo builds on deliveries and resets on a miss', async () => {
  await page.goto(BASE);
  await startRun();
  // freeze timers so nothing expires mid-test (isolates combo from misses)
  await page.evaluate(() => { RH.debug().effects.freeze = 999; });
  // deliver two orders (stay under the level-up threshold)
  for (let i = 0; i < 2; i++) {
    assert.ok(await waitForAvailable());
    assert.ok(await pickupFirstAvailable());
    await deliverCarried();
  }
  assert.equal((await state()).combo, 2);
  // a miss breaks the streak: force a spawn, lift the freeze, force an expiry
  await page.evaluate(() => { RH.debug().spawnTimer = 0; });
  assert.ok(await waitForAvailable());
  await page.evaluate(() => { const g = RH.debug(); delete g.effects.freeze; g.orders.find(o => o.state === 'available').time = 0.01; });
  await page.waitForTimeout(150);
  assert.equal((await state()).combo, 0);
});

test('leveling up: district draft → map transition → perk draft → resume', async () => {
  await page.goto(BASE);
  await startRun();
  const map0 = await page.evaluate(() => RH.debug().layout.name);
  // one delivery short of a level-up
  await page.evaluate(() => { RH.debug().delivered = RH.Balance.run.deliveriesPerLevel - 1; });
  assert.ok(await waitForAvailable());
  assert.ok(await pickupFirstAvailable());
  await deliverCarried(); // triggers level 2 → district draft
  // district draft comes first
  assert.ok(await page.isVisible('#districts'), 'district draft opens');
  assert.equal(await page.locator('#district-cards .perk-card').count(), 3);
  assert.equal(await page.evaluate(() => RH.debug().paused), true, 'paused during draft');
  await page.locator('#district-cards .perk-card').first().click();
  await page.waitForTimeout(80);
  // map changed, bag cleared (in-flight forgiven), still paused for the perk draft
  const map1 = await page.evaluate(() => RH.debug().layout.name);
  assert.notEqual(map1, map0, 'the district (map) changed');
  assert.equal(await page.evaluate(() => RH.debug().carried.length), 0, 'in-flight orders forgiven');
  assert.ok(!(await page.isVisible('#districts')), 'district draft closes');
  assert.ok(await page.isVisible('#perks'), 'perk draft opens next');
  // choose a perk → resume on the new map
  await page.locator('#perk-cards .perk-card').first().click();
  await page.waitForTimeout(60);
  assert.ok(!(await page.isVisible('#perks')), 'perk draft closes');
  assert.equal(await page.evaluate(() => RH.debug().paused), false, 'run resumes');
});

/* ---------------- powerups ---------------- */
test('grabbing a powerup applies a timed effect', async () => {
  await page.goto(BASE);
  await startRun();
  await page.evaluate(() => {
    const g = RH.debug();
    g.powerups.push({ type: 'speed', color: '#4dd0ff', label: '⚡', dur: 6, mods: [{ stat: 'speed', op: 'mul', value: 1.6 }], x: g.player.x, y: g.player.y, r: 14, life: 12 });
  });
  await page.waitForTimeout(120);
  const effects = await page.evaluate(() => Object.keys(RH.debug().effects));
  assert.ok(effects.includes('speed'), 'speed effect should be active');
});

/* ---------------- shop & persistence ---------------- */
test('buying an upgrade spends bank and raises its level', async () => {
  await context.addInitScript(() => {
    localStorage.setItem('rushhour_save_v2', JSON.stringify({ bank: 9999, best: 0, upgrades: { speed: 0, capacity: 0, time: 0, pay: 0 } }));
  });
  await page.goto(BASE);
  const first = page.locator('#shop .shop-item').first();
  await first.click();
  await page.waitForTimeout(50);
  assert.match(await first.locator('.lvl').textContent(), /Lv 1/);
  const bank = await page.textContent('#bank-amount');
  assert.ok(Number(bank) < 9999, 'bank should be reduced after purchase');
  // persisted to storage
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('rushhour_save_v2')));
  assert.equal(saved.upgrades.speed, 1);
});

/* ---------------- audio ---------------- */
test('mute button toggles audio state and persists', async () => {
  await page.goto(BASE);
  assert.equal(await page.evaluate(() => RH.audio.muted), false);
  await page.click('#mute-btn');
  assert.equal(await page.evaluate(() => RH.audio.muted), true);
  assert.equal(await page.textContent('#mute-btn'), '🔇');
  assert.equal(await page.evaluate(() => localStorage.getItem('rushhour_muted')), '1');
});

test('upgrades persist across reload', async () => {
  await context.addInitScript(() => {
    localStorage.setItem('rushhour_save_v2', JSON.stringify({ bank: 500, best: 1200, upgrades: { speed: 2, capacity: 1, time: 0, pay: 0 } }));
  });
  await page.goto(BASE);
  assert.equal(await page.textContent('#bank-amount'), '500');
  assert.equal(await page.textContent('#best-score'), '1200');
  // speed upgrade lv 2 shown on its card
  const speedCard = page.locator('#shop .shop-item').first();
  assert.match(await speedCard.locator('.lvl').textContent(), /Lv 2/);
});

/* ---------------- mobile / touch controls ---------------- */
test('touch devices get on-screen controls that drive the courier', async () => {
  const tctx = await browser.newContext({ hasTouch: true, viewport: { width: 414, height: 896 } });
  const tpage = await tctx.newPage();
  const errs2 = [];
  tpage.on('pageerror', e => errs2.push(e.message));
  await tpage.goto(BASE);
  // controls show on a touch device
  assert.ok(await tpage.evaluate(() => document.body.classList.contains('touch')), 'touch class set');
  assert.ok(await tpage.isVisible('#touch-stick'));
  assert.ok(await tpage.isVisible('#touch-go'));
  await tpage.click('#start-btn');
  await tpage.waitForTimeout(150);
  // virtual stick input drives movement
  const x0 = await tpage.evaluate(() => RH.debug().player.x);
  await tpage.evaluate(() => { RH.input.dx = 1; RH.input.dy = 0; RH.input.active = true; });
  await tpage.waitForTimeout(200);
  await tpage.evaluate(() => { RH.input.active = false; });
  const x1 = await tpage.evaluate(() => RH.debug().player.x);
  assert.notEqual(x1, x0, 'the virtual stick moved the courier');
  // GO button triggers pick up
  await tpage.evaluate(() => { const g = RH.debug(); g.agents = []; const o = g.orders.find(o => o.state === 'available'); const n = g.layout.nodes[o.from]; g.player.x = n.x; g.player.y = n.y; });
  await tpage.waitForTimeout(40);
  await tpage.tap('#touch-go');
  await tpage.waitForTimeout(80);
  assert.equal(await tpage.evaluate(() => RH.debug().carried.length), 1, 'GO button picks up');
  assert.equal(errs2.length, 0, errs2.join(' | '));
  await tctx.close();
});

test('on a small phone the whole stage and controls fit within the viewport', async () => {
  const VW = 390, VH = 844;
  const tctx = await browser.newContext({ hasTouch: true, viewport: { width: VW, height: VH } });
  const tpage = await tctx.newPage();
  await tpage.goto(BASE);
  await tpage.click('#start-btn');
  await tpage.waitForTimeout(120);
  const within = (b, name) => {
    assert.ok(b, `${name} has a box`);
    assert.ok(b.x >= -1 && b.y >= -1, `${name} not off the top/left (x=${b.x.toFixed(0)}, y=${b.y.toFixed(0)})`);
    assert.ok(b.x + b.width <= VW + 1, `${name} fits horizontally (right=${(b.x + b.width).toFixed(0)} ≤ ${VW})`);
    assert.ok(b.y + b.height <= VH + 1, `${name} fits vertically (bottom=${(b.y + b.height).toFixed(0)} ≤ ${VH})`);
  };
  within(await tpage.locator('#game-wrap').boundingBox(), 'stage');
  within(await tpage.locator('#touch-go').boundingBox(), 'GO button');     // must be reachable
  within(await tpage.locator('#touch-stick').boundingBox(), 'joystick');   // must be reachable
  await tctx.close();
});

test('dragging the on-screen joystick steers the courier (real touch events)', async () => {
  const tctx = await browser.newContext({ hasTouch: true, viewport: { width: 414, height: 896 } });
  const tpage = await tctx.newPage();
  const errs3 = [];
  tpage.on('pageerror', e => errs3.push(e.message));
  await tpage.goto(BASE);
  await tpage.click('#start-btn');
  await tpage.waitForTimeout(120);
  // dispatch real touchstart + rightward touchmove on the stick element
  const input = await tpage.evaluate(() => {
    const stick = document.getElementById('touch-stick');
    const r = stick.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const fire = (type, x, y) => {
      const t = new Touch({ identifier: 1, target: stick, clientX: x, clientY: y });
      stick.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, changedTouches: [t], touches: [t], targetTouches: [t] }));
    };
    fire('touchstart', cx, cy);
    fire('touchmove', cx + 60, cy); // push right
    return { active: RH.input.active, dx: RH.input.dx, dy: RH.input.dy };
  });
  assert.ok(input.active && input.dx > 0.5 && Math.abs(input.dy) < 0.3, `stick set rightward input (${JSON.stringify(input)})`);
  const x0 = await tpage.evaluate(() => RH.debug().player.x);
  await tpage.waitForTimeout(220);
  const x1 = await tpage.evaluate(() => RH.debug().player.x);
  assert.ok(x1 > x0, 'courier moved right while the stick was held');
  // release
  await tpage.evaluate(() => {
    const stick = document.getElementById('touch-stick');
    const t = new Touch({ identifier: 1, target: stick, clientX: 0, clientY: 0 });
    stick.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, changedTouches: [t], touches: [], targetTouches: [] }));
  });
  assert.equal(await tpage.evaluate(() => RH.debug().player ? RH.input.active : false), false, 'releasing stops input');
  assert.equal(errs3.length, 0, errs3.join(' | '));
  await tctx.close();
});

test('the board adapts to the viewport (generic across phone sizes)', async () => {
  const sizes = [
    { w: 360, h: 740 },  // small phone, portrait
    { w: 414, h: 896 },  // large phone, portrait
    { w: 844, h: 390 },  // phone, landscape
    { w: 768, h: 1024 }, // tablet, portrait
  ];
  for (const s of sizes) {
    const c = await browser.newContext({ hasTouch: true, viewport: { width: s.w, height: s.h } });
    const p = await c.newPage();
    await p.goto(BASE);
    await p.click('#start-btn');
    await p.waitForTimeout(120);
    const stage = await p.evaluate(() => RH.stage);
    assert.ok(stage.w <= s.w && stage.h <= s.h, `${s.w}x${s.h}: board ${stage.w}x${stage.h} fits the screen`);
    assert.ok(stage.w / 40 >= 9 && stage.h / 40 >= 9, `${s.w}x${s.h}: board is at least 9x9 cells`);
    const box = await p.locator('#game-wrap').boundingBox();
    assert.ok(box.x >= -1 && box.y >= -1 && box.x + box.width <= s.w + 1 && box.y + box.height <= s.h + 1,
      `${s.w}x${s.h}: stage stays fully on-screen`);
    assert.equal(await p.evaluate(() => RH.sources(RH.debug().layout).length), 4, `${s.w}x${s.h}: valid run on the adapted board`);
    await c.close();
  }
});

test('the pickup prompt says GO on touch and SPACE on desktop', async () => {
  // desktop (non-touch context from beforeEach)
  await page.goto(BASE);
  await startRun();
  await page.evaluate(() => { const g = RH.debug(); const o = g.orders.find(o => o.state === 'available'); const n = g.layout.nodes[o.from]; g.player.x = n.x; g.player.y = n.y; });
  await page.waitForTimeout(80);
  assert.match(await page.evaluate(() => RH.debug().prompt || ''), /SPACE/, 'desktop prompt mentions SPACE');
  // touch
  const c = await browser.newContext({ hasTouch: true, viewport: { width: 414, height: 896 } });
  const p = await c.newPage();
  await p.goto(BASE);
  await p.click('#start-btn');
  await p.waitForTimeout(120);
  await p.evaluate(() => { const g = RH.debug(); const o = g.orders.find(o => o.state === 'available'); const n = g.layout.nodes[o.from]; g.player.x = n.x; g.player.y = n.y; });
  await p.waitForTimeout(80);
  assert.match(await p.evaluate(() => RH.debug().prompt || ''), /GO/, 'touch prompt mentions GO (no SPACE)');
  await c.close();
});

test('GO picks up within the forgiving touch range (no pixel-perfect aim, no spacebar)', async () => {
  const c = await browser.newContext({ hasTouch: true, viewport: { width: 414, height: 896 } });
  const p = await c.newPage();
  await p.goto(BASE);
  await p.click('#start-btn');
  await p.waitForTimeout(120);
  // sit OFF the source (not pixel-perfect) but far enough to prove the touch
  // range; pick the largest offset that still keeps this source the nearest node
  const offset = await p.evaluate(() => {
    const g = RH.debug(); g.agents = [];
    const o = g.orders.find(o => o.state === 'available');
    const n = g.layout.nodes[o.from];
    for (const off of [40, 32, 24, 16, 8]) {
      const px = n.x + off, py = n.y;
      let nearest = null, best = 46;
      for (const m of g.layout.nodes) {
        if (m.role === 'station') continue;
        const d = Math.hypot(px - m.x, py - m.y);
        if (d < best) { best = d; nearest = m; }
      }
      if (nearest === n) { g.player.x = px; g.player.y = py; return off; }
    }
    g.player.x = n.x; g.player.y = n.y; return 0;
  });
  assert.ok(offset >= 8, `stands off the source by ${offset}px (forgiving range, not pixel-perfect)`);
  await p.waitForTimeout(60);
  await p.tap('#touch-go');           // pointerdown → RH.action(); no keyboard involved
  await p.waitForTimeout(80);
  assert.equal(await p.evaluate(() => RH.debug().carried.length), 1, `picked up from ${offset}px away via GO`);
  await c.close();
});
