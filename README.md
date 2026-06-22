# 🛵 Rush Hour

A 2D delivery roguelike for the web. Drive a courier around a top-down city,
pick up orders, deliver them before the timer runs out, and survive as the pace
escalates. Bank earnings between runs for permanent upgrades; grab powerups
mid-run. Three missed orders ends the run.

Vanilla JS + HTML5 Canvas. **No build step, no runtime dependencies.**

## ▶️ Play online

**https://nitzan83.github.io/rushour/** — deployed from `main` via GitHub Pages.

## Play locally

```bash
npm start          # → http://localhost:8080
```

**Controls:** `WASD` / arrows to drive · `SPACE` to pick up / deliver (an
on-screen prompt appears when you're in range) · `M` to mute/unmute. On phones: on-screen joystick + GO button.

## Test

```bash
npm test           # unit + e2e (51 tests)
npm run test:unit  # pure-logic, fast, no browser
npm run test:e2e   # full browser tests (Playwright; auto-installs Chromium)
```

## Docs

- [`RELEASE_NOTES.md`](./RELEASE_NOTES.md) — what's in each version.
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — how the code is organized (the four
  extensibility seams).
- [`NEXT_STEPS.md`](./NEXT_STEPS.md) — the roadmap.

## Layout

```
index.html, style.css
js/core.js      EventBus, Save, Stats resolver (cross-cutting seams)
js/balance.js   all tuning numbers as data (RH.Balance)
js/layout.js    tiles, map generator, collision
js/game.js      run state, systems, render, HUD, shop, loop
js/audio.js     synthesized SFX, wired via EventBus
server.js       zero-dep static dev server
tests/          unit + e2e suites
```
