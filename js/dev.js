/* ============================================================
   dev.js — developer / cheat panel for fast testing.
   Toggle with the backtick (`) key, or open with ?dev=1 in the URL.
   Drives the RH.dev API exposed by game.js. Not loaded into gameplay
   unless toggled, so it never affects normal play.
   ============================================================ */
(() => {
  'use strict';
  const RH = window.RH;
  if (!RH || !RH.dev) return;

  let on = new URLSearchParams(location.search).has('dev');

  const panel = document.createElement('div');
  panel.id = 'dev-panel';

  const readout = document.createElement('div');
  readout.className = 'dev-readout';

  function refresh() {
    const g = RH.dev.state();
    readout.textContent = g
      ? `Lv ${g.level} · ${g.layout.name} · $${g.cash} · combo ${g.combo}${g.god ? ' · GOD' : ''}`
      : '(in menu — press Start)';
  }

  // button factory; tabIndex -1 so SPACE/ENTER never "re-click" a focused button
  function btn(label, fn) {
    const b = document.createElement('button');
    b.textContent = label; b.tabIndex = -1;
    b.addEventListener('click', e => { e.preventDefault(); fn(); b.blur(); refresh(); });
    return b;
  }
  function row(label, ...els) {
    const r = document.createElement('div'); r.className = 'dev-row';
    if (label) { const s = document.createElement('span'); s.className = 'dev-label'; s.textContent = label; r.appendChild(s); }
    els.forEach(e => r.appendChild(e));
    return r;
  }

  const title = document.createElement('div'); title.className = 'dev-title'; title.textContent = 'DEV  ·  ` to hide';

  panel.append(
    title,
    readout,
    row('run', btn('Start', () => RH.dev.start()), btn('New map', () => RH.dev.newMap()), btn('God', () => RH.dev.god()), btn('End', () => RH.dev.endRun())),
    row('level', btn('−', () => RH.dev.level(-1)), btn('+', () => RH.dev.level(1)),
      btn('1', () => RH.dev.jump(1)), btn('3', () => RH.dev.jump(3)), btn('5', () => RH.dev.jump(5)),
      btn('10', () => RH.dev.jump(10)), btn('20', () => RH.dev.jump(20))),
    row('econ', btn('+$100', () => RH.dev.cash(100)), btn('Fuel full', () => RH.dev.fuel(1)), btn('Fuel empty', () => RH.dev.fuel(0))),
    row('powerups', btn('⚡', () => RH.dev.powerup('speed')), btn('❄', () => RH.dev.powerup('freeze')),
      btn('×2', () => RH.dev.powerup('cash')), btn('🧲', () => RH.dev.powerup('magnet')),
      btn('👻', () => RH.dev.powerup('ghost')), btn('＋fuel', () => RH.dev.powerup('refuel'))),
    row('orders', btn('rush', () => RH.dev.order('rush')), btn('bulky', () => RH.dev.order('bulky')),
      btn('fragile', () => RH.dev.order('fragile')), btn('vip', () => RH.dev.order('vip'))),
    row('agents', btn('car', () => RH.dev.spawnAgent('car')), btn('cyclist', () => RH.dev.spawnAgent('cyclist')),
      btn('ped', () => RH.dev.spawnAgent('ped')), btn('police', () => RH.dev.spawnAgent('police')), btn('clear', () => RH.dev.clearTraffic())),
    row('keys', mkHint('`=toggle  [ ]=level±  1-9=jump  g=god  n=newmap  c=+$')),
  );
  document.body.appendChild(panel);

  function mkHint(text) { const s = document.createElement('span'); s.className = 'dev-hint'; s.textContent = text; return s; }

  function setOn(v) { on = v; panel.style.display = on ? 'block' : 'none'; if (on) refresh(); }
  setOn(on);

  window.addEventListener('keydown', e => {
    if (e.key === '`' || e.key === '~') { e.preventDefault(); setOn(!on); return; }
    if (!on) return;
    let handled = true;
    if (e.key === ']') RH.dev.level(1);
    else if (e.key === '[') RH.dev.level(-1);
    else if (e.key.toLowerCase() === 'g') RH.dev.god();
    else if (e.key.toLowerCase() === 'n') RH.dev.newMap();
    else if (e.key.toLowerCase() === 'c') RH.dev.cash(100);
    else if (/^[1-9]$/.test(e.key)) RH.dev.jump(parseInt(e.key, 10));
    else handled = false;
    if (handled) { e.preventDefault(); refresh(); }
  });

  setInterval(() => { if (on) refresh(); }, 400); // keep the readout live
})();
