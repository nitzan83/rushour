# Rush Hour — Plan (rev 3)

_Rewritten 2026-06-24. New throughline: **each level adds a hazard** — the city
gets busier and more dangerous as you climb. Built from the user's idea list,
sequenced in priority order, with the existing roadmap folded in after and
combined where it overlaps._

---

## Where we are (shipped v0.1 → v0.5.2)

Public, mobile-ready, 59 tests. Core loop + 4 upgrades + 5 order kinds + 6
powerups + perk draft + combo scoring + **district draft (map changes every
level)** + sound + colorblind glyphs + **responsive board & touch controls**.
Live at https://nitzan83.github.io/rushour/.

The four seams still carry everything: **layout-as-data**, **generic
nodes/orders**, **Stats resolver**, **EventBus**. Two new pieces of infra below
(an *agents* system and a *fuel* resource) plug into them.

---

## 🚦 North Star: "Escalating Hazards" — the city fights back

Right now difficulty escalates via timers and changing maps. This thread adds
**living hazards that ramp each level**: traffic, people, police, and the
constant pressure of fuel. Each milestone is one hazard, introduced at a higher
level so the player learns them one at a time.

### Shared infra to build first: the **Agents system** (foundation for H1–H4)
Cars, pedestrians, cyclists, and police are all **moving agents** — build one
system, reuse for all four:
- `Agent = { kind, x, y, dir, speed, r, path/AI }` living in `game.agents`.
- **Road-following AI** for vehicles: drive along the current road, pick a valid
  turn at intersections (reuses `RH.tileAt` / `isSolid`); pedestrians wander
  slowly and cross streets.
- **Player interaction is per-kind** (handled in one collision pass, dispatched
  by `kind`): bump / fine / police — see milestones.
- **Spawn counts scale with level** via the difficulty director in
  `balance.js` (e.g. `agents(level) → {cars, peds, police}`), so this *is* the
  "more obstacles each level" mechanic. New `EventBus` events (`agent:hit`,
  `fine`) drive juice/sound, no core edits.
- Rendering: a distinct shape/color per kind; counts capped + pooled for perf.

This is the riskiest/most reusable piece — build and test it with **cars first**.

---

## Hazard milestones (in priority order)

### v0.6 "Traffic" — NPC cars you bump into  · ✅ shipped
- Cars drive the roads; colliding **bumps** you (knockback + brief slow), and a
  hard bump can shatter fragile cargo (reuse the v0.4.1 crash path).
- Builds the **Agents system** above. Cars start appearing at low levels and
  **grow in number each level**.
- _Combine:_ car density feeds the same per-level difficulty curve as spawns
  /timers; on procedural maps later, scale with map size too.

### v0.7 "Mind the People" — pedestrians & cyclists, hit = a fine  · ✅ shipped
- Pedestrians (slow, on/near sidewalks) and cyclists (faster, on roads).
  **Hitting one = an instant cash fine** (`fine` event → deduct cash, red
  floater, combo break). They're avoid-targets, not walls.
- Reuses the Agents system; introduced a level or two after cars.
- _Combine:_ fines use the existing floater/EventBus juice; tune fine size in
  `balance.js`.

### v0.8 "Dash" — a burst of speed  · ✅ shipped
- A **dash**: a short, fast lunge in your current direction on a cooldown.
  Helps weave through traffic and make tight timers.
- Input: **touch** → a second button (DASH) beside GO; **desktop** → Shift (or
  double-tap a direction). Effect = a brief timed speed modifier + impulse
  through the **Stats resolver**; cooldown shown on the button/HUD.
- _Combine:_ rides the same modifier funnel as the ⚡ powerup; the powerup can
  later reduce dash cooldown.

### v0.9 "Police" — police cars  · **M**
- Police patrol like cars. **Dashing near a police car = a fine** (reckless
  driving) — so dash is powerful but risky around them.
- Depends on **v0.8 (dash)** + the Agents system. Police appear at higher
  levels; a brief "spotted" flash telegraphs the fine.
- _Combine:_ fine path from v0.7; police are an Agent kind with a proximity
  check that only triggers during a dash.

### v0.10 "Running on Empty" — fuel / charge  · **M–L**
- The bike has **fuel/charge** that drains as you drive; a HUD gauge shows it.
  **Refuel at charge stations** (a new `node` kind) — drive up to top off.
  Run dry → you crawl until you reach a station (soft-fail pressure).
- New **fuel resource** + a **station node kind** (generic-node seam) + a HUD
  gauge. A shop **"Bigger Battery"** upgrade and a perk fit naturally.
- _Combine:_ stations are just nodes (like restaurants/houses); the gauge is a
  HUD addition; tank size is a Stats-style stat. Tighten range each level.

---

## Existing roadmap — folded in after, combined where relevant

### Endless City — procedural districts  · **L**
- `generateProcedural(level)` emitting the same `Layout`; building/water/mud
  density scales with level. Validated by `RH.isConnected`.
- _Combine:_ the agents difficulty curve (cars/peds/police counts) and fuel
  range scale **together** with map complexity — one "level intensity" knob.
  Best built **after the Agents system** so generated maps can place agents and
  stations sensibly.

### Quality & platform (parallel track, any time)
| Item | Effort | Notes |
|------|--------|-------|
| **CI** | S | GitHub Actions running `npm test` on push (Pages deploy already automated). Do this soon to lock the growing suite. |
| **Stats & achievements** | M | EventBus listeners (deliveries, fines dodged, longest dash combo…) + a panel. Hooks onto the new `fine`/`agent:hit` events. |
| **Ice terrain** | S | Slippery tile (light momentum) — rounds out the `TILE_MODS` set. |

### v1.0 stretch
| Item | Effort | Notes |
|------|--------|-------|
| **Seeded daily challenge** | M | Same district + agent sequence for everyone that day; needs procedural + a seedable RNG. |
| **Local leaderboard** | S | Top scores in `localStorage`; hosted later. |

---

## Suggested trajectory
```
v0.6  "Traffic"          → Agents system + NPC cars (bump)        [foundation]
v0.7  "Mind the People"  → pedestrians & cyclists (hit = fine)
v0.8  "Dash"             → dash burst (touch DASH button + Shift)
v0.9  "Police"           → police cars (dash near = fine)
v0.10 "Running on Empty" → fuel/charge + stations + gauge
v0.11 "Endless City"     → procedural districts (scales agents+fuel together)
v1.0  "Open City"        → seeded daily + leaderboard + polish
   (parallel: CI now; achievements + ice terrain whenever)
```

**Immediate recommendation:** start **v0.6 "Traffic"** — it builds the Agents
system that v0.7/v0.9 reuse, and "cars you dodge that multiply each level" is the
biggest single jump in how the game *feels*. Quick win to do alongside: **CI**,
so the 59-test suite runs on every push as this systems-heavy phase begins.
