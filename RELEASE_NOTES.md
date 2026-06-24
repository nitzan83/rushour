# Rush Hour — Release Notes

## v0.9.0 — "Police" (2026-06-24)

Risk on the dash.

### 🚓 Police cars
- Patrol the roads (blue car, flashing light bar) from level 3. They bump like
  any car — but **dashing within range of one is "reckless driving" and fines
  you** (`RECKLESS -$N`, breaks combo), with a per-cop cooldown.
- Makes dash a real risk/reward call around them. New `dashFine`/`detect` config
  on the agent kind; reuses the `fine` event.

### ✅ Tests
- 66 → 68: police appear from level 3 with a dash-fine (unit); dashing near a cop
  charges a fine + breaks combo while merely driving near does not (e2e).

---

## v0.8.0 — "Dash" (2026-06-24)

A skill move for weaving through the new traffic.

### ⚡ Dash
- A short **burst of speed** in your current heading, on a cooldown. Lunges even
  with no direction held.
- Input: **Shift** (desktop) or a new **DASH** button beside GO (touch). Can't
  dash while stunned or on cooldown; shows a gold trail while active.
- Runs through the **Stats** speed funnel (same path as the ⚡ powerup), so it
  composes with everything.

### ✅ Tests
- 64 → 66: dash covers more ground than normal travel and then locks on cooldown
  (e2e); dash config is a real boost with a longer cooldown than duration (unit).

---

## v0.7.0 — "Mind the People" (2026-06-24)

The second hazard, on the same Agents system.

### 🚶 Pedestrians & cyclists — hit = a fine
- **Pedestrians** (slow) and **cyclists** (faster) join the streets from level 2.
- Unlike cars, they don't block you — **hitting one charges an instant cash
  fine**, breaks your combo, and pops a red `-$N FINE` floater (with a per-person
  cooldown so one contact fines once). Cars still bump/stun; people fine.
- Counts scale per level via `agents.countsAt`; rendered as dots (vs. car rects).

### ✅ Tests
- 62 → 64: people appear from level 2 and carry a fine (not a bump); hitting a
  person drops cash + resets combo + does **not** stun (e2e).

---

## v0.6.0 — "Traffic" (2026-06-24)

First hazard of the "escalating danger" arc — and the **Agents system** that the
next few features (pedestrians, police) reuse.

### 🚗 NPC cars
- Cars drive the road network (road-following AI: continue straight, turn at
  intersections, never reverse except at dead ends). They stay on roads only.
- **Bumping a car** knocks the courier back, briefly **stuns** you (can't drive),
  and shakes the screen — with a short cooldown so one contact bumps once.
- **Traffic scales with the level**: ~1 car early, more each level (capped),
  respawned fresh on every district. This is the "more obstacles each level"
  mechanic, driven by `RH.Balance.agents.countsAt(level)`.
- New `js/agents.js` (spawn + road AI) and an `agent:hit` event for juice/sound.

### 🔧 CI
- A GitHub Actions workflow now runs the full test suite (`npm test`) on every
  push and PR.

### ✅ Tests
- 59 → 62: agent counts scale + cap; a spawned car stays on roads across 400
  steps (unit); cars spawn in a run and a bump stuns + knocks back the courier
  (e2e).

---

## v0.5.2 — mobile experience (2026-06-23)

Makes mobile a first-class way to play.

### 📐 Responsive board (generic across phones)
- The playfield is no longer a fixed 960×640 letterbox. It now **adapts to the
  screen**: columns/rows are derived from the viewport (clamped 9–30 × 9–20), so
  a portrait phone gets a tall board that **fills the screen** (e.g. 360×800 on
  a 390-wide phone) instead of a small centered strip. Renders at device pixel
  ratio for crispness. The board locks at run start and rescales (not
  regenerates) if you rotate mid-run.

### 👆 Pickup works on touch (no spacebar)
- The on-screen prompt now reads **“GO: pick up / deliver”** on touch (it used
  to say “SPACE”, which doesn't exist on a phone).
- **More forgiving interaction range** on touch (46px vs 30px) so you don't need
  pixel-perfect aim with the joystick.
- The **GO** button uses a single `pointerdown` handler (no double-trigger).

### ✅ Tests
- 56 → 59: the board fits the viewport across four phone/tablet sizes; the
  prompt says GO on touch / SPACE on desktop; GO picks up from ~40px away with
  no keyboard.

---

## v0.5.1 — mobile scaling fix (2026-06-23)

Fixes a mobile bug where the stage didn't fit the screen and the on-screen
controls were pushed off the bottom (so you couldn't pick up).

- **Scaling:** the 960×640 stage is now **absolutely centered + scaled** (was a
  bare `transform: scale`, which left the layout box overflowing the viewport),
  and the page is locked (`position: fixed`, `overscroll-behavior: none`,
  `viewport-fit=cover`, no user-zoom). The whole stage — **including the joystick
  and GO button — now fits on screen** and the controls are reachable.
- Tracks `visualViewport` so it re-fits when the mobile address bar shows/hides.

### ✅ Tests
- 54 → 56: the stage + both touch controls fit within a 390×844 viewport;
  a **real** touch drag on the joystick (dispatched `touchstart`/`touchmove`)
  steers the courier, and releasing stops it.

---

## v0.5.0 — "Districts" (2026-06-23)

The map now changes between levels — a run is a climb through a shifting city.

### 🌆 District draft (the map changes every level)
- At each level-up you now **choose your next district** from 3 maps, each with
  a one-line tradeoff, then pick your perk. The chosen map loads immediately.
- **Two new districts** join the pool (now 4): **Old Town** (big blocks, long
  routes) and **Outskirts** (heavy mud, slow going) — alongside Downtown and
  Riverside. The draft excludes your current map, so the city always changes.
- **Transition handling:** on a district change, in-flight orders are
  **forgiven (no miss)** and powerups clear; **combo, perks, score, cash, and
  level all persist** — the climb carries forward.

### 🧭 Connectivity guarantee (new infra)
- `RH.isConnected(layout)` floods the walkable tiles from spawn and verifies
  **every delivery point is reachable** — no map can soft-lock a run. Built-in
  districts are validated on generation (regenerate-until-valid).

### ✅ Tests
- 51 → 54: every district generates a connected, valid map; `isConnected`
  rejects a walled-off node; `draftDistricts` returns distinct, current-excluded
  options (unit); full level-up flow — district draft → map transition (bag
  forgiven) → perk draft → resume (e2e).

---

## v0.4.3 — "Pocket Courier" (2026-06-23)

Playable on phones now that it's live on the web.

### 📱 Mobile / touch controls (4.2)
- **Virtual joystick** (bottom-left) to drive and a **GO button** (bottom-right)
  to pick up / deliver — shown only on touch devices. Feeds the same input path
  as the keyboard (`RH.input`), so all gameplay works identically.
- **Fit-to-screen scaling** on every device: the fixed 960×640 stage scales to
  the viewport (and re-fits on resize/rotate), so it works on laptops and phones
  without overflow.

### ✅ Tests
- 50 → 51: a touch-emulated device shows the controls, the virtual stick moves
  the courier, and the GO button picks up (e2e).

---

## v0.4.2 — "Wade In" (2026-06-22)

Gave water an actual gameplay role.

### 🌊 Water is now a wadeable shortcut
- Previously water was just a blue wall (mechanically identical to a building).
- Now it's **passable but very slow (35% speed)** — a real risk/reward decision
  on Riverside: cut straight across the river to save distance, or take a bridge
  to save time. Wading shows ripple feedback under the courier.
- One-value change (`TILE_MODS[WATER]`): collision auto-stops blocking it and
  the `Stats` speed funnel auto-applies the slow — the seams did the rest.

### ✅ Tests
- 49 → 50: water is non-solid + slower than mud and a body wades rather than
  being ejected (unit); the courier passes through water but is slowed (e2e).

---

## v0.4.1 — "Rough Roads" (2026-06-22)

Two risk/terrain mechanics that round out the content seams.

### 📦 Fragile orders
- A new **FRAGILE** order kind (unlocks level 2): pays a premium, but a **hard
  head-on crash into a wall shatters it** — the cargo is lost and counts as a
  miss. Glancing/corner clips are safe; only an at-speed impact breaks it.
- Crash detection compares intended vs. resolved movement (how much a wall
  "absorbed"), with a short cooldown so one impact = one break.

### 🟤 Terrain: mud (2.5)
- New walkable **`MUD`** tile that **slows you to 55%**. Scattered as patches on
  the roads of every map. This shipped with **zero movement-code changes** — mud
  is just a `TILE_MODS` entry that flows through the `Stats` speed funnel,
  exactly what the tile seam was for. (Ice/alley can follow the same way.)

### ✅ Tests
- 47 → 49: fragile shatters on a hard crash = one miss (e2e); mud is walkable +
  slow and present in layouts, fragile kind flagged (unit).

---

## v0.4.0 — "The Draft" (2026-06-22)

The roguelike hook — runs now diverge based on choices you make mid-run.

### 🃏 Between-level perk draft (3.1)
- On every level-up the run **pauses** and offers **3 random perks**; pick one
  and it applies for the rest of the run. Current pool: Lead Foot (+speed),
  Big Tipper (+pay), Patient Customers (+time), Cargo Rack (+1 slot), Insurance
  (+1 allowed miss), Hot Streak (combos build faster).
- Perks are declarative data (`RH.Balance.perks`) and feed the same `Stats`
  funnel / run flags — no new plumbing.

### 🔥 Combo scoring (3.2)
- Chained deliveries build a **score multiplier** (up to 4×); **a miss resets
  it**. Live `COMBO ×N (m×)` readout in the HUD. Rewards tight, planned routes.
- Multiplier curve is data + a pure `RH.Balance.combo.mult()` (the Hot Streak
  perk lowers the step so it ramps faster).

### ✅ Tests
- 42 → 47: combo multiplier curve + cap + faster-step, perk data integrity
  (unit); combo build/reset and the full draft flow — opens, pauses, resumes
  (e2e).

---

## v0.3.1 — "Riverside" (2026-06-22)

A second map — proving the layout seam end-to-end — plus a new tile type.

### 🗺️ Second layout (2.3)
- **Riverside** — a city split by a **river** crossed by bridges where the
  horizontal streets meet the water. Same engine, different topology.
- Each run now **picks a layout at random** (`RH.randomLayout` over the
  `RH.LAYOUTS` registry). The current map name shows in the HUD.
- Generators now share extracted helpers (`blockGrid`, `placeNodes`), so a third
  map is a few lines.

### 💧 New tile type: water
- Added `TILE.WATER` (impassable). Collision is now driven by a generic
  `RH.isSolid(tile)` check (multiplier 0 = solid), so buildings and water block
  movement the same way — and future tiles (mud/ice) slot in via `TILE_MODS`.

### ✅ Tests
- 39 → 42: Riverside validity (water + bridges, spawn on road, node counts),
  water-is-solid collision, and `randomLayout` returns a registry layout.

---

## v0.3.0 — "Specials" (2026-06-22)

Content depth — the first wave of variety, all built on the order-modifier and
powerup seams (no core rewrites).

### 📦 Order kinds (2.1)
Orders now spawn in distinct kinds, gated by level so the game escalates:
- **RUSH** (perishable) — premium pay that **decays** the longer it takes to
  arrive (pays down to a floor at expiry). Tight timer.
- **BULKY** — takes **2 bag slots**, pays more, roomier timer.
- **VIP** — **big pay, short timer**; unlocks at higher levels.
- Kinds are picked by weighted roll among level-eligible types
  (`RH.Balance.order.rollKind`). Each shows a colored **tag** (RUSH/BULKY/VIP)
  and a matching badge; bulky badges are larger.
- The bag is now **slot-based** (base 2 slots); bulky orders consume two, and
  pickup is refused when there's no room.

### ⚡ New powerups (2.2)
- **👻 Ghost** — phase through buildings for a few seconds (auto-snaps back to a
  road when it ends).
- **＋ Refuel** — *instant*: adds seconds to **every** active order at once.
- Powerups now support `instant` effects alongside timed ones.

### ✅ Tests
- 32 → 39. New: order-kind level gating + weighted roll only returns eligible
  kinds, bulky slot mechanics (e2e), ghost phasing + ejection (e2e), refuel time
  grant (e2e), and `snapToRoad`.

---

## v0.2.1 — "Clear & Fair" (2026-06-22)

Closes out Phase 1 — clarity, accessibility, and feel.

### ♿ Colorblind-safe orders (1.4)
- Each restaurant now has a **unique letter glyph (A–D)** drawn on it, on the
  carried badge, and on the lit destination house. You match orders by **symbol,
  not just color**, so the game is playable without relying on hue.

### ✨ Feel & clarity (1.3)
- **Fail condition fixed** — a run now ends at **3 total missed orders**, not 3
  in a row (a delivery no longer wipes your misses). HUD counts cumulative.
- **×2 cash, made obvious** — boosted deliveries show a blue `+$N ×2!` floating
  popup; the active readout reads `×2 CASH` (all effects got friendly names).
- **Near-miss flash** — order timer rings (on the restaurant and on the carried
  badge) **blink red** when time is nearly out.
- **Deliver / pickup pop** — an expanding ring punctuates each pickup and
  delivery.

### ✅ Tests
- 28 → 32. New coverage for this release's rules: cumulative misses survive a
  delivery (fail = 3 total, not in a row), ×2 doubles cash only + shows a ×2
  floater, orders carry their restaurant glyph, and each source has a unique
  symbol. All green.

---

## v0.2.0 — "Tuned" (2026-06-22)

A feel-and-clarity pass on top of the playable MVP. No new map content yet —
this release makes the existing loop better to play and far easier to balance.

### 🔊 Sound (new)

- Synthesized SFX via WebAudio — **no asset files**. Distinct sounds for
  pickup, delivery, powerup, level-up, miss, and game-over.
- Wired **entirely through the EventBus** (`js/audio.js` only subscribes to game
  events) — proof the seam works: zero changes to game logic.
- **Mute toggle** — 🔊 button (bottom-right) or the **M** key; preference
  persists in `localStorage`. Audio context unlocks on first interaction
  (browser autoplay-safe).

### ⚖️ Tuning as data (new)

- **All** balance numbers now live in one file, [`js/balance.js`](./js/balance.js)
  (`RH.Balance`): player stats, difficulty curve, order pay/time, upgrade defs &
  costs, powerup durations, spawn timings. Game systems read this data and
  hard-code nothing — rebalancing never touches logic.
- Upgrade and powerup definitions are now **declarative**: each describes how it
  feeds the `Stats` resolver (`mod: { stat, perLevel }`), so `makeUpgradeMods()`
  is generic.
- Curve retuned for a gentler on-ramp and firmer floors (slightly slower early
  spawns, a touch more time per order, marginally higher base pay). Still
  first-pass — flagged for playtesting.

### ✅ Tests

- Suite grew **24 → 28**: 3 new unit tests (balance shape, difficulty
  monotonicity + floors/caps, declarative upgrade→resolver mapping) and 1 new
  e2e test (mute toggle + persistence). All green.

---

## v0.1.0 — "First Shift" (2026-06-22)

The first playable build of **Rush Hour**, a 2D delivery roguelike for the web.
Drive a courier around a top-down city, pick up orders at restaurants, deliver
them to houses before the clock runs out, and survive as the pace escalates.
Bank your earnings between runs to buy permanent upgrades; grab powerups
mid-run. Three missed orders ends the run.

Built in vanilla JS + HTML5 Canvas — **no build step, no runtime dependencies.**

---

### 🎮 Gameplay

- **Top-down city with roads & obstacles.** The map is a road network threaded
  through a grid of solid building blocks. You plan routes around the buildings
  — efficient pathing under a ticking clock is the core skill.
- **Free 8-direction driving** with circle-vs-grid collision against buildings.
- **Pick up / drop off on SPACE.** Drive next to a restaurant and press SPACE to
  load an order; an on-screen prompt shows when you're in range. Drive to the
  matching house (lit green) and press SPACE to deliver.
- **Orders & timers.** Each order spawns at a restaurant with a countdown ring
  (red when nearly expired) and a dashed line to its destination. Faster
  deliveries pay a time bonus.
- **Roguelike difficulty ramp.** Every 4 deliveries raises the level: orders
  spawn faster, timers shrink, and more are active at once.
- **Fail condition.** Miss 3 orders in a row → run over. A successful delivery
  resets the streak.

### 🛒 Meta progression (between runs)

- Earnings bank to a **persistent wallet** (`localStorage`), surviving reloads.
- **Shop with 4 scaling upgrades:** Faster Bike (speed), Bigger Bag (carry
  capacity), Route Sense (more order time), Good Rep (more pay). Costs scale per
  level.

### ⚡ Powerups (during runs)

- Map pickups with timed effects: **⚡ speed**, **❄ freeze timers**,
  **×2 cash**, **🧲 magnet** (pulls nearby powerups toward you).

### ✨ Polish

- Particle bursts on pickup/deliver/powerup, screen shake on a miss, pulsing
  order rings, carry badges that orbit the courier, speed trail.

---

### 🏗️ Architecture (built for what's next)

The MVP was built on four extensibility **seams** so new mechanics slot in
without rewrites (full detail in [`ARCHITECTURE.md`](./ARCHITECTURE.md)):

1. **Layout-as-data** — a map is pure data (tile grid + placed nodes). Systems
   never read the grid's shape, so a new map is *new data, not new code*.
2. **Generic nodes + orders** — restaurants/houses are one `node` concept with a
   role + tags; an order is a contract between two nodes. New content = tags +
   order modifiers.
3. **One stat resolver** (`RH.Stats`) — upgrades, powerups, and terrain all
   funnel through a single `resolve()`, keeping complexity linear.
4. **Event bus** (`RH.EventBus`) — systems emit; juice (and later audio,
   quests, achievements) subscribe, with zero edits to game logic.

**File map**

| File | Responsibility |
|------|----------------|
| `js/core.js`   | `RH` namespace, utils, `EventBus`, `Save`, `Stats` resolver |
| `js/layout.js` | tiles, `generateDowntown()`, collision, node placement |
| `js/game.js`   | run state, systems, render, HUD, shop, main loop |
| `server.js`    | zero-dep static dev server |

---

### ✅ Quality & tests

A full test suite ships with this release — **24 tests, all green.**

- **Unit (`tests/unit.test.mjs`, 15):** `util`, `Stats` resolver (mul/add/skip),
  `EventBus` (delivery, unsubscribe, unknown-event safety), `Save`
  (defaults/round-trip/merge), layout generation (grid dims, spawn-on-road,
  4 sources + 8 sinks on building edges, solid borders), and collision
  (no-op on open road, push-out on a building edge). Runs in Node via a small
  `window` shim — no browser needed.
- **End-to-end (`tests/e2e.test.mjs`, 9, Playwright):** menu/shop render, start
  → HUD, pickup, deliver+payout, expired-order strike, 3-miss game-over +
  banking, powerup effect application, shop purchase (spend + level up), and
  persistence across reload. Every test also asserts **zero console errors**.

**Run them**

```bash
npm test          # everything (unit + e2e)
npm run test:unit # pure-logic, fast, no browser
npm run test:e2e  # full browser tests (auto-installs Chromium)
```

### ▶️ Run the game

```bash
npm start         # → http://localhost:8080
```

Controls: **WASD / Arrows** to drive · **SPACE** to pick up / deliver.

---

### Known limitations (tracked for next versions)

- Difficulty curve and upgrade costs are first-pass numbers — not yet balanced.
- No sound.
- Single map layout (`Downtown`); the layout seam supports more but only one
  ships.
- Collision push-out resolves over 2 iterations — fine in practice, but a
  courier forced deep inside a 3×3 block (never happens in normal play) may not
  fully eject in one frame.
- No mobile/touch controls.
