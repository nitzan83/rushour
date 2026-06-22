# Rush Hour — Next Steps

Where the game goes after **v0.1.0 "First Shift"**. Ordered by priority.
Effort is rough: **S** ≈ hours, **M** ≈ a day, **L** ≈ multi-day.
The "Seam" column shows which architecture seam the work rides on — items on an
existing seam are low-risk because they don't touch core systems.

---

## Phase 1 — Make the core *feel* great (do this first)

The loop works and is tested; now it needs to be **fun**. This phase is about
feel, clarity, and balance before adding more content.

| # | Item | Effort | Seam | Notes |
|---|------|--------|------|-------|
| 1.1 | **Balancing pass** | M | difficulty config | ✅ **Done (v0.2)** — all tuning extracted to `js/balance.js`; curve retuned. Still wants live playtesting to finalize numbers. |
| 1.2 | **Sound** | M | EventBus | ✅ **Done (v0.2)** — synthesized WebAudio SFX as EventBus listeners (`js/audio.js`), mute toggle + 'M' key, persisted. |
| 1.3 | **Feel tweaks** | S | — | ✅ **Done (v0.2.1)** — near-miss flash, deliver/pickup pop rings, "+$N" floating text. (Optional later: courier turn smoothing, combo readout.) |
| 1.4 | **Colorblind-safe orders** | S | — | ✅ **Done (v0.2.1)** — each restaurant has a unique A–D glyph on the source, carried badge, and destination house. |

**Phase 1 complete** (v0.2 + v0.2.1). Next up: **v0.3 "Specials"** below.

---

## Phase 2 — Content depth (exercise the seams)

Prove the architecture pays off by adding variety with little new plumbing.

| # | Item | Effort | Seam | Notes |
|---|------|--------|------|-------|
| 2.1 | **Order types / modifiers** | M | order modifiers | ✅ **Done (v0.3 + v0.4.1)** — `rush` (pay decays), `bulky` (2 slots), `vip` (big pay/tight timer), `fragile` (shatters on a hard crash), level-gated. |
| 2.2 | **More powerups** | S | Stats + effects | ✅ **Done (v0.3)** — `ghost` (phase through buildings) + `refuel` (instant +time to all orders). Room for more (e.g. `combo`). |
| 2.3 | **Second map layout** | M | layout data | ✅ **Done (v0.3.1)** — "Riverside" (river + bridges); runs pick a layout at random from `RH.LAYOUTS`. |
| 2.4 | **Procedural maps** | L | LayoutGenerator | `generateProcedural()` emitting the same `Layout` shape; seedable for daily runs. Generators already share `blockGrid`/`placeNodes` helpers. |
| 2.5 | **Terrain variety** | M | tile mods | ✅ **Mostly done** — `WATER` (v0.3.1) + `MUD` slow tiles (v0.4.1) via `TILE_MODS`. Optional: `ICE` (slippery, needs momentum) / `ALLEY`. |

---

## Phase 3 — Roguelike systems (depth & replayability)

| # | Item | Effort | Seam | Notes |
|---|------|--------|------|-------|
| 3.1 | **Between-level perk draft** | M | Stats + EventBus | ✅ **Done (v0.4)** — pick 1 of 3 perks on level-up; applies for the run via the Stats funnel / run flags. Room for more perks. |
| 3.2 | **Combo / streak scoring** | S | EventBus | ✅ **Done (v0.4)** — chained deliveries build a score multiplier (cap 4×); a miss resets it. Live HUD readout. |
| 3.3 | **Seeded daily challenge** | M | LayoutGenerator | Same map + order sequence for everyone that day; local best tracking. |
| 3.4 | **Vehicles** | M | vehicle data + upgrades | Unlockable vehicles with different stat trade-offs (van = big bag/slow, e-bike = fast/fragile). |

---

## Phase 4 — Meta, platform & retention

| # | Item | Effort | Seam | Notes |
|---|------|--------|------|-------|
| 4.1 | **Stats & achievements** | M | EventBus | Lifetime deliveries, best streak, etc. via event listeners + a stats panel. |
| 4.2 | **Mobile / touch controls** | M | — | ✅ **Done (v0.4.3)** — virtual joystick + GO button (touch devices) + fit-to-screen scaling (all devices). |
| 4.3 | **Pause & settings** | S | — | Pause menu, mute, controls remap. |
| 4.4 | **Local leaderboard** | S | — | Top scores in `localStorage`; optional hosted leaderboard later. |

---

## Phase 5 — Tech & quality (ongoing)

| # | Item | Effort | Notes |
|---|------|--------|-------|
| 5.1 | **CI** | S | GitHub Actions running `npm test` on push (unit always; e2e with the Playwright action). |
| 5.2 | **Visual regression tests** | M | Snapshot the canvas at known states; catch rendering regressions. |
| 5.3 | **Tuning as data** | S | ✅ **Done (v0.2)** — all constants live in `js/balance.js`; balance changes never touch logic. |
| 5.4 | **Perf budget** | S | If entity counts climb (traffic, particles), add object pooling and a frame-time guard. |

---

## Suggested trajectory

```
v0.2  "Tuned"     → ✅ balance-as-data + sound (shipped); feel + a11y remain
v0.3  "Specials"  → Phase 2.1–2.3 (order types, powerups, 2nd map)
v0.4  "The Draft" → ✅ perks + combo scoring (shipped) — the roguelike hook landed
v0.5  "On the Go" → Phase 4.2 (mobile) + 4.1 (achievements)
v1.0  "Open City" → Phase 2.4 procedural + 3.3 daily + polish
```

**My recommendation for the very next step:** ship **v0.2 "Tuned"** — start with
**1.1 (extract balance to data + tune)** and **1.2 (sound)**. It makes the
existing loop genuinely fun and de-risks everything after it, and both ride
existing seams so the test suite stays green with minimal new coverage needed.
