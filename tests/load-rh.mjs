/* Loads the browser-side pure-logic modules (core.js, layout.js) into Node
   by shimming the few browser globals they touch. game.js is NOT loaded here
   (it needs the DOM/canvas) — it's covered by the Playwright e2e tests. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// minimal localStorage shim so RH.Save works headless
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear(),
};
globalThis.window = globalThis;

const run = file => (0, eval)(fs.readFileSync(path.join(root, file), 'utf8'));
run('js/core.js');
run('js/balance.js');
run('js/layout.js');

export const RH = globalThis.window.RH;
export const resetStorage = () => store.clear();
