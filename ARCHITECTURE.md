# Rush Hour — Architecture

A 2D delivery roguelike. This doc explains how the code is organized so that
new mechanics slot in **without rewrites**, and so the **same systems run on any
map layout**.

## Guiding principle

> Separate *what the world is* (data) from *how it behaves* (systems), and route
> every stat-bending effect through **one resolver**.

```
LAYOUT (data)   →   SYSTEMS (behavior)   →   RESOLUTION (stats / events)
 tilemap             movement, collision     resolveStat(): effective
 node placements     spawning, timers        speed/time/pay from base
 spawn rules         pickup/dropoff,         + all active modifiers
                     scoring, render         EventBus: decoupled reactions
```

Each layer is replaceable independently. You can swap the map without touching
movement; add a modifier without touching movement; add sound without touching
any system.

## The four seams (built into the MVP)

### 1. Layout-as-data — `js/layout.js`
A layout is **pure data**: a tile grid plus placed nodes. It contains no logic.

```js
Layout = {
  name, cols, rows, tile,            // grid dims + cell size
  grid: Uint8Array,                  // TILE.ROAD | TILE.BUILDING | ...
  nodes: [ Node, ... ],              // see seam 2
  spawn: { x, y },                   // where the courier starts
}
```

Because movement / orders / scoring never read the grid's *shape*, a new map
(suburban sprawl, campus, highway) is **new data, not new code**.
`generateDowntown()` is one `LayoutGenerator`; procedural maps are just another
function returning the same shape.

Terrain variety is also data: `TILE_MODS[tileType]` gives a friction/speed
multiplier, so "alley = slow", "mud", "ice" need no movement changes.

### 2. Generic nodes + orders — `js/layout.js`, `js/game.js`
Restaurants and houses are **one concept**: a `Node` with a `role` and `tags`.

```js
Node  = { id, role: 'source' | 'sink', cell, x, y, face, color, tags: [] }
Order = { id, from: nodeId, to: nodeId, color, reward, time, maxTime,
          state: 'available' | 'carried' | 'done' | 'expired',
          modifiers: [] }   // future: 'perishable', 'fragile', 'bulky', 'vip'
```

New content = **tags + order modifiers**, not new entity types. Hot food that
cools, fragile parcels, VIP customers, bulky cargo all attach here.

### 3. One stat resolver — `js/core.js` (`RH.Stats`)
Upgrades, powerups, terrain, weather, and cargo all do the same thing: bend a
number. They funnel through one function instead of scattered `if`s.

```js
RH.Stats.resolve(base, 'speed', modifiers)
// modifiers: [{ stat:'speed', op:'mul'|'add', value, source }]
```

Add "rain slows you 20%"? Register one modifier. Movement code never changes.
This single decision keeps complexity **linear**, not exponential.

### 4. Event bus — `js/core.js` (`RH.EventBus`)
Core systems **emit**; reactions **subscribe**.

```js
bus.emit('order:delivered', { order, gained })
bus.on('order:delivered', fx => spawnParticles(...))   // juice
bus.on('order:delivered', () => playSound('cha-ching')) // audio (future)
```

Particles, audio, achievements, tutorials attach as listeners — zero edits to
game logic. Current events: `order:available`, `order:pickup`,
`order:delivered`, `order:missed`, `powerup:grabbed`, `level:up`,
`run:over`, `crash`.

## File map

| File | Responsibility |
|------|----------------|
| `js/core.js`   | `RH` namespace, utils, `EventBus`, `Save` (localStorage), `Stats` resolver |
| `js/layout.js` | tile constants, `generateDowntown()`, collision queries, node placement |
| `js/game.js`   | run state, systems (movement, spawn, timers, pickup/dropoff, powerups, scoring), render, HUD, shop, main loop |
| `server.js`    | zero-dep static dev server (`npm start`) |

Systems live as plain functions called from the update loop (no ECS framework —
deliberately, it would be overkill at this size). The *seams* above give us
ECS-like extensibility without the ceremony.

## How future features slot in (no core rewrite)

| Feature | Where it lives |
|---|---|
| New map (campus, highway) | new `Layout` data / generator |
| Procedural maps | a `LayoutGenerator` emitting `Layout` |
| Traffic / pedestrians | new entity + avoidance in movement system |
| Weather, day/night | modifiers in `RH.Stats` |
| New vehicle (van, e-bike) | vehicle stat data + upgrade hooks |
| Order types (hot, fragile, VIP) | tags + order modifiers |
| Sound, particles, quests, achievements | `EventBus` listeners |
| New difficulty curves | `difficulty()` config / `DifficultyDirector` |

## Roadmap

- **M1 (current):** roads + obstacles map, free 8-dir movement w/ collision,
  SPACE pickup/dropoff, orders + timers, difficulty ramp, fail condition, HUD.
- **M2:** between-run shop + persistent upgrades (done in MVP, expand options).
- **M3:** in-run powerups (done in MVP, expand types via modifiers).
- **M4:** polish — sound (EventBus listeners), more layouts, order types,
  balancing.
