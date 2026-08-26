/**
 * Puzzles.
 *
 * A catalogue of puzzle games that share a shell and share nothing else. Each
 * game brings its own rules, its own solver, its own designer and its own
 * board; the platform brings the screen around them, the clock, the history
 * and the register they appear in.
 *
 * Adding a game is the two lines below and a folder.
 */

import './platform/design/tokens.css';
import './platform/design/base.css';
import './platform/design/components.css';
import './platform/design/play.css';
import './platform/design/path.css';

import { App, testHandle } from './platform/app.js';
import { register } from './platform/registry.js';
import { thread } from './games/thread/index.js';
import { zigzag } from './games/zigzag/index.js';
import { nine } from './games/nine/index.js';
import { shape } from './games/shape/index.js';
import { hex } from './games/hex/index.js';

register(thread);
register(zigzag);
register(nine);
register(shape);
register(hex);

/*
 * Pinch and double-tap zoom, shut off at the source. The viewport meta asks
 * for it, but iOS Safari ignores that and fires its own gesture events, and a
 * trackpad pinch arrives as a ctrl-wheel — so both are refused here as well.
 * Scrolling is a different matter and is left alone: a list of puzzles is
 * meant to be swiped, and only a board is pinned.
 */
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
}
document.addEventListener('wheel', (e) => {
  if (e.ctrlKey) e.preventDefault();
}, { passive: false });

const root = document.getElementById('app');
if (root) {
  new App(root);
  (window as unknown as { __puzzles: unknown }).__puzzles = testHandle();
}
