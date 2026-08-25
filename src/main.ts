/**
 * Thread.
 *
 * A board of posts, and string that has to use all of them without touching
 * anything. Three shapes of that: one string, several coloured strings, and a
 * lattice.
 */

import './ui/styles.css';
import { App } from './ui/shell.js';
import { compile, runBetween } from './core/board.js';

/*
 * Pinch and double-tap zoom, shut off at the source. The viewport meta asks
 * for it, but iOS Safari ignores that and fires its own gesture events, and a
 * trackpad pinch arrives as a ctrl-wheel — so both are refused here as well.
 */
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
}
document.addEventListener('wheel', (e) => {
  if (e.ctrlKey) e.preventDefault();
}, { passive: false });

const root = document.getElementById('app');
if (root) {
  const app = new App(root);
  // A read-only handle for the end-to-end harness, which drives the game
  // through real pointer events and only ever reads state back.
  (window as unknown as { __thread: unknown }).__thread = {
    solved: () => [...app.solved],
    board: () => app.board,
    /*
     * Whether a run exists between two posts, which is what the harness needs
     * to pick a move a player could actually make rather than hard-coding post
     * numbers that go stale the next time the boards are built. It reads the
     * same compiled board the game plays on and decides nothing.
     */
    runIsLegal: (a: number, b: number) =>
      app.board !== null && runBetween(compile(app.board), a, b) >= 0,
  };
}
