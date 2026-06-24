/* ============================================================
   balance.js — ALL tuning numbers live here as data.
   Nothing in game logic hard-codes a balance value; it reads RH.Balance.
   This is the "tuning as data" seam: rebalancing never touches systems.
   (Values are tuned-by-reason for v0.2; real numbers want playtesting.)
   ============================================================ */
(() => {
  'use strict';
  const RH = (window.RH = window.RH || {});

  RH.Balance = {
    player: {
      baseSpeed: 205,      // px/sec before modifiers
      radius: 13,
      interactRange: 30,   // px: how close to a node to press SPACE
      baseCapacity: 2,     // bag slots before the Bigger Bag upgrade (bulky = 2 slots)
      dash: { duration: 0.18, mult: 2.6, cooldown: 1.2 }, // quick burst of speed
    },

    run: {
      maxMisses: 3,            // total missed orders that end the run
      deliveriesPerLevel: 4,   // deliveries needed to raise the level
      firstSpawnDelay: 1.0,    // sec before the first order of a run
    },

    // A "hard crash" (head-on wall hit at speed) destroys fragile cargo.
    crash: { impactFrac: 0.5, cooldown: 0.6 }, // ≥this fraction of a step blocked = crash

    // Terrain tiles that change movement (slow/mud); placed by sprinkleTerrain.
    terrain: { mudPatches: 10 },

    // Moving NPC agents (the "more hazards each level" system).
    agents: {
      maxTotal: 12,
      bumpStun: 0.35,     // sec the courier is stunned after hitting a car
      bumpCooldown: 0.7,  // sec before the same contact can bump again
      knockback: 16,      // px the courier is shoved on a bump
      fineCooldown: 0.8,  // sec before the same person can fine you again
      heatCooldown: 1.0,  // sec before the same cop can fine you again
      kinds: {
        car:     { speed: 95, r: 12, color: '#ff5c5c', bump: true },
        cyclist: { speed: 68, r: 9,  color: '#5fd9ff', fine: 8 },              // hit = fine
        ped:     { speed: 30, r: 8,  color: '#ffd27f', fine: 5 },              // hit = fine
        police:  { speed: 85, r: 12, color: '#3a6cff', bump: true, dashFine: 15, detect: 66 }, // dash near = fine
      },
      // how many of each kind at a given level (cars L1; people L2; police L3)
      countsAt(level) {
        return {
          car:     Math.min(8, 1 + Math.floor(level * 0.6)),
          cyclist: level >= 2 ? Math.min(4, Math.floor((level - 1) * 0.5)) : 0,
          ped:     level >= 2 ? Math.min(6, Math.floor((level - 1) * 0.7)) : 0,
          police:  level >= 3 ? Math.min(3, Math.floor((level - 2) * 0.6)) : 0,
        };
      },
    },

    powerupSpawn: { firstMin: 8, firstMax: 13, min: 10, max: 16 }, // sec

    order: {
      payBase: 10,             // flat pay
      payPerDist: 1 / 16,      // + pay per px of travel
      timeTravelDivisor: 110,  // + seconds of budget per px of travel
      timeBonusMax: 6,         // max bonus pay for a fast delivery
      scorePerDelivery: 100,
      scorePerTimeBonus: 10,
      decayFloor: 0.4,         // a "rush" order pays at least this fraction at expiry

      // Order kinds (the order-modifier seam). Each scales pay/time, may take
      // extra bag slots, and harder kinds unlock at higher levels.
      kinds: {
        normal: { label: null,    tint: null,      weight: 60, slots: 1, payMult: 1.0, timeMult: 1.0, minLevel: 1 },
        rush:   { label: 'RUSH',  tint: '#ff5e7e', weight: 18, slots: 1, payMult: 1.6, timeMult: 0.75, minLevel: 1, decays: true },
        bulky:  { label: 'BULKY', tint: '#c490ff', weight: 14, slots: 2, payMult: 1.9, timeMult: 1.25, minLevel: 2 },
        fragile:{ label: 'FRAGILE', tint: '#7fd9ff', weight: 11, slots: 1, payMult: 2.0, timeMult: 1.1, minLevel: 2, fragile: true },
        vip:    { label: 'VIP',   tint: '#ffcc4d', weight: 8,  slots: 1, payMult: 2.4, timeMult: 0.6,  minLevel: 3 },
      },
      // kinds available at a given level (pure → unit-testable)
      eligibleKinds(level) {
        return Object.keys(this.kinds).filter(k => (this.kinds[k].minLevel || 1) <= level);
      },
      // weighted pick among eligible kinds; rnd injectable for deterministic tests
      rollKind(level, rnd) {
        rnd = rnd || Math.random;
        const elig = this.eligibleKinds(level);
        const total = elig.reduce((s, k) => s + this.kinds[k].weight, 0);
        let r = rnd() * total;
        for (const k of elig) { r -= this.kinds[k].weight; if (r <= 0) return k; }
        return 'normal';
      },
    },

    // Combo: chained on-time deliveries multiply score; a miss resets it.
    combo: {
      step: 2,        // deliveries per +`per` to the multiplier
      per: 0.5,       // multiplier added each step
      maxBonus: 3,    // cap on the bonus (so max score mult = 1 + maxBonus)
      // score multiplier for a given combo count (pure → unit-testable)
      mult(combo, step) {
        step = step || this.step;
        return 1 + Math.min(this.maxBonus, Math.floor(combo / step) * this.per);
      },
    },

    // Perks: drafted between levels (pick 1 of 3). Effects are declarative:
    //   mod      → pushed to the run's Stats modifiers (speed/time/pay)
    //   capacity → +bag slots, maxMisses → +allowed misses, comboFast → faster combo
    perks: [
      { id: 'leadfoot',  name: 'Lead Foot',         desc: '+20% move speed',     mod: { stat: 'speed', op: 'mul', value: 1.2 } },
      { id: 'bigtipper', name: 'Big Tipper',        desc: '+25% delivery pay',   mod: { stat: 'pay', op: 'mul', value: 1.25 } },
      { id: 'patient',   name: 'Patient Customers', desc: '+20% order time',     mod: { stat: 'time', op: 'mul', value: 1.2 } },
      { id: 'rack',      name: 'Cargo Rack',        desc: '+1 bag slot',         capacity: 1 },
      { id: 'insurance', name: 'Insurance',         desc: '+1 allowed miss',     maxMisses: 1 },
      { id: 'hotstreak', name: 'Hot Streak',        desc: 'Combos build twice as fast', comboFast: true },
    ],

    // Difficulty curve: pure function of the current level.
    difficulty(level) {
      return {
        spawnEvery: Math.max(2.0, 6.0 - level * 0.30),   // sec between spawns
        timeBudget: Math.max(6.5, 17 - level * 0.65),    // base sec per order
        maxActive: Math.min(6, 2 + Math.floor(level / 2)), // simultaneous orders
      };
    },

    // Upgrades. `mod` describes how the upgrade feeds RH.Stats (per level).
    // `capacityPerLevel` is handled directly (not a resolver stat).
    upgrades: {
      speed:    { name: 'Faster Bike', desc: '+12% move speed',  max: 6, baseCost: 40, growth: 1.6, mod: { stat: 'speed', perLevel: 0.12 } },
      capacity: { name: 'Bigger Bag',  desc: '+1 order carried', max: 4, baseCost: 80, growth: 2.0, capacityPerLevel: 1 },
      time:     { name: 'Route Sense', desc: '+15% order time',  max: 5, baseCost: 60, growth: 1.7, mod: { stat: 'time', perLevel: 0.15 } },
      pay:      { name: 'Good Rep',    desc: '+15% delivery pay', max: 5, baseCost: 70, growth: 1.7, mod: { stat: 'pay', perLevel: 0.15 } },
    },

    // Powerups. Timed ones set an active effect for `dur` seconds; `mods` feed
    // RH.Stats while active. `instant` ones fire an effect once on pickup.
    powerups: {
      speed:  { color: '#4dd0ff', label: '⚡', dur: 6, mods: [{ stat: 'speed', op: 'mul', value: 1.6 }] },
      freeze: { color: '#a0e8ff', label: '❄', dur: 5, mods: [] },
      cash:   { color: '#ffcc4d', label: '×2', dur: 8, mods: [] },
      magnet: { color: '#ff8cf0', label: '🧲', dur: 7, mods: [] },
      ghost:  { color: '#b6c2ff', label: '👻', dur: 4, mods: [] },          // phase through buildings
      refuel: { color: '#5fd97f', label: '＋', instant: true, addTime: 4 },  // +seconds to all active orders
    },
  };
})();
