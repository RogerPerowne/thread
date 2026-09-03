/**
 * The words a hint uses when the board has gone wrong, shared by every game.
 *
 * Each game knows what a wrong thing IS on its own board — a shape in the
 * wrong cell, a string through the wrong post, a wall the answer leaves open.
 * What it says about one is the same six times over, so it is said here, once:
 * this is not in the answer, nothing past it can be trusted, take it back.
 * Six games phrasing that six ways would be six chances to phrase it wrong.
 */

import type { Hint } from './types.js';

/**
 * A `fix`: something already on the board is not in the answer.
 *
 * `what` names the thing, in the game's words and without a verb: "The
 * triangle in row 2", "The string through this post". `claim` says what is
 * wrong in a form the gate can check, as a negation — "cell:5!=2".
 */
export function astray(what: string, focus: readonly string[], claim: readonly string[]): Hint {
  return {
    kind: 'fix',
    focus,
    reason: `${what} is not part of the answer, so nothing built on it can be trusted.`,
    move: 'Take it back, and the board can be reasoned on again.',
    claim,
  };
}
