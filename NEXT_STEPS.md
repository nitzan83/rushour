# Rush Hour — Plan (rev 2)

_Rewritten 2026-06-23. Centerpiece of this revision: **the map changes between
levels** — turning a run into a climb through a shifting city._

---

## Where we are (shipped v0.1 → v0.4.3)

The core loop is feature-complete, public, and tested (51 tests):

- **Core:** roads + obstacle maps, free 8-dir driving w/ collision, SPACE
  pickup/deliver, order timers, difficulty ramp, 3-miss fail.
- **Maps:** Downtown + Riverside; `WATER` (slow wadeable shortcut) and `MUD`
  (slow) tiles. **One layout per *run*, fixed for the whole run.**
- **Roguelike:** between-level **perk draft** (1 of 3), **combo** scoring.
- **Content:** 5 order kinds (rush/bulky/fragile/vip/normal), 6 powerups,
  4 shop upgrades, persistent bank.
- **Platform:** sound (mute), colorblind glyphs, **mobile/touch controls**,
  fit-to-screen scaling. Live at https://nitzan83.github.io/rushour/.

**The four seams still hold** (layout-as-data, generic nodes/orders, Stats
resolver, EventBus) — the plan below leans on all of them.

### The gap this rev targets
Today, difficulty escalates only in *time* (faster spawns, tighter timers). The
**space** stays still — the same streets for the whole run. Levels feel same-y.
Making the **map change between levels** adds a second axis of progression and
is the highest-leverage thing we can build next.

---

## 🌆 North Star: "Districts" — the city changes as you climb

Each level becomes a **district**. At the level-up beat (we already pause there
for the perk draft), the map transitions: a new district loads. The run becomes
a journey across an escalating city, not laps around one block.

### Design space — four mechanisms (how the map changes)

| # | Mechanism | What happens at level-up | Feel | Cost |
|---|-----------|--------------------------|------|------|
| **M1** | **Swap layout** | Load a fresh layout (from the registry) | "New district each level" — max variety, clean | **S** |
| **M2** | **Procedural district** | Generate a new map seeded by level; obstacle/terrain density scales up | Endless variety, difficulty via geometry | **L** |
| **M3** | **District draft** | Player picks next map from 2–3 options, each with a tradeoff | Strategic — map becomes a roguelike choice | **M** (needs M1/M2) |
| **M4** | **Mutate in place** | Keep the map, but add hazards (close roads, flood water, drop blocks) | Continuity — the city "degrades" around you | **M** |

These compose: the likely end state is **M2 + M3** — procedural districts you
*choose* between — with **M1** as the shippable first step.

### The hard parts (shared infra, build once)

1. **Transition handling.** Orders/powerups reference the old map's nodes. On
   transition: clear available orders, **forgive carried orders (no miss)**,
   clear powerups, reposition the courier to the new spawn. Combo and perks
   **persist** (they're the reward for climbing). This happens inside the
   existing level-up pause, so it reads as "entering the next district."
2. **Connectivity guarantee.** Any swapped/generated/mutated map must keep
   **every node reachable from spawn**. New helper `RH.isConnected(layout)`
   (BFS flood over non-solid tiles); generators/mutators regenerate until valid.
   Without this, a run can soft-lock. _This is the riskiest piece — build and
   test it first._
3. **Difficulty rebalance.** A new map each level adds navigation cost, so the
   time/spawn ramp likely needs softening. Order time already scales with travel
   distance (good), but the curve in `balance.js` will want a pass.
4. **Telegraph.** Show the district **name + theme** on the level-up screen
   ("Next: Riverside — mind the water"), so the change feels intentional.

### Recommended phasing

- **v0.5 "Districts" (M1 + infra):** connectivity check → swap to a random
  registry layout each level → transition handling → district name on the draft
  screen → difficulty rebalance. Ships the headline feel with low risk.
- **v0.6 "Endless City" (M2):** `generateProcedural(level)` — density of
  buildings/water/mud/closed-roads scales with level; seeded for daily runs
  later. Real depth; depends on the connectivity infra from v0.5.
- **v0.7 "Choose Your Route" (M3):** district draft — pick your next map from
  2–3 candidates with tradeoffs, alongside (or merged with) the perk draft.
- **Optional (M4):** mid-district hazard events for runs that want continuity.

---

## Roadmap (reprioritized)

### v0.5 "Districts" — ✅ shipped (M3 district draft)
| # | Item | Effort | Seam | Notes |
|---|------|--------|------|-------|
| D.1 | **Connectivity check** | S | layout | ✅ `RH.isConnected(layout)` (BFS flood); districts validate on generation. |
| D.2 | **Per-level map transition** | M | layout + EventBus | ✅ On `level:up`: swap map, forgive in-flight orders, clear powerups, reposition; combo/perks persist. |
| D.3 | **District name + telegraph** | S | — | ✅ District name in HUD; name + blurb on the draft cards. |
| D.4 | **Difficulty rebalance** | S | balance | ⏳ TODO — re-tune the spawn/timer ramp now that each level adds navigation cost. |
| C.1 | **District draft (M3)** | M | layout + UI | ✅ Choose next map from 3 options (current excluded), then the perk draft. 4 districts in the pool. |

### v0.6 "Endless City"
| # | Item | Effort | Seam | Notes |
|---|------|--------|------|-------|
| P.1 | **Procedural generator** | L | LayoutGenerator | `generateProcedural(level)`; complexity scales; validated by D.1. |
| P.2 | **Theming/visual variety** | M | render | Distinct palettes per district so they read as different places. |

### v0.7 "Choose Your Route"
| # | Item | Effort | Seam | Notes |
|---|------|--------|------|-------|
| C.1 | **District draft** | M | layout + UI | Pick next map from 2–3 options with tradeoffs; reuse the draft overlay. |

### Platform & quality (parallel track, any time)
| # | Item | Effort | Notes |
|---|------|--------|-------|
| Q.1 | **CI** | S | GitHub Actions running `npm test` on push. (Pages deploy workflow already added.) |
| Q.2 | **Stats & achievements** | M | EventBus listeners + a stats panel. |
| Q.3 | **Ice terrain** | S | Slippery tile (needs light momentum) — rounds out terrain. |

### v1.0 stretch
| # | Item | Effort | Notes |
|---|------|--------|-------|
| V.1 | **Seeded daily challenge** | M | Same district sequence for everyone that day; needs P.1. |
| V.2 | **Leaderboard** | S | Local first; hosted later. |

---

## Suggested trajectory
```
v0.5  "Districts"        → map swaps each level + connectivity infra (M1)
v0.6  "Endless City"     → procedural districts (M2)
v0.7  "Choose Your Route"→ district draft (M3)
v1.0  "Open City"        → seeded daily + leaderboard + polish
```

**Immediate recommendation:** build **v0.5 "Districts"** starting with **D.1
(connectivity check)** — it de-risks every map-change mechanism — then **D.2**
(swap-per-level) for the headline feel. Decide M1-vs-procedural-first via the
question accompanying this plan.
