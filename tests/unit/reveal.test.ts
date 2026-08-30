import { describe, it, expect } from 'vitest';
import { thread } from '../../src/games/thread/index.js';
import { zigzag } from '../../src/games/zigzag/index.js';
import { nine } from '../../src/games/nine/index.js';
import { shape } from '../../src/games/shape/index.js';
import { hex } from '../../src/games/hex/index.js';
import { isolate } from '../../src/games/isolate/index.js';
import type { GamePackage } from '../../src/platform/types.js';

/**
 * Showing the answer, on every game there is.
 *
 * The control that does this is in the platform's row of five and knows
 * nothing about any board, so what it relies on is exactly this: that
 * `reveal()` leaves a board the game's own judge calls solved. A game whose
 * reveal is subtly wrong — a path laid backwards, a set of walls missing the
 * given ones — would show a board that looks finished and reads as broken, and
 * there is no other place that could catch it.
 *
 * Every board of every game, not a sample. It is the cheapest gate here and it
 * covers the one claim the shell makes on a game's behalf.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const games: [string, GamePackage<any, any>][] = [
  ['thread', thread], ['zigzag', zigzag], ['nine', nine],
  ['shape', shape], ['hex', hex], ['isolate', isolate],
];

describe.each(games)('%s', (name, game) => {
  it('reveals a board its own rules call solved', () => {
    for (const puzzle of game.puzzles()) {
      const session = game.begin(puzzle);
      session.reveal();
      expect(session.verdict().solved, `${name} ${puzzle.id} is not solved by its own answer`)
        .toBe(true);
      expect(session.verdict().fault).toBe('');
      expect(session.verdict().progress).toBe(1);
    }
  });

  it('leaves the reveal on the undo stack', () => {
    /*
     * Not a one-way door. A player who presses it, sees the answer and wants
     * their own board back gets it, and nothing has been written to the
     * history either way.
     */
    const puzzle = game.puzzles()[0];
    const session = game.begin(puzzle);
    expect(session.canUndo()).toBe(false);
    session.reveal();
    expect(session.canUndo()).toBe(true);
    session.undo();
    expect(session.verdict().solved).toBe(false);
  });
});
