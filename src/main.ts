/**
 * Thread.
 *
 * A board of posts, and string that has to use all of them without touching
 * anything. Three shapes of that: one string, several coloured strings, and a
 * lattice.
 */

import './ui/styles.css';
import { App } from './ui/shell.js';

const root = document.getElementById('app');
if (root) {
  const app = new App(root);
  // A read-only handle for the end-to-end harness, which drives the game
  // through real pointer events and only ever reads state back.
  (window as unknown as { __thread: unknown }).__thread = {
    solved: () => [...app.solved],
    board: () => app.board,
  };
}
