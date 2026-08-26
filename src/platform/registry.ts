/**
 * The register of games.
 *
 * Adding a game is registering a package. Nothing else in the platform knows
 * any game's name: the router reads ids from here, the library builds its
 * cards from here, the store keys its records by them. The test for whether
 * this is working is simple — a `grep` for a game's id outside its own folder
 * should turn up exactly one line, its registration.
 */

import type { GamePackage, GameMeta, Puzzle } from './types.js';

/*
 * The packages are typed over their own puzzle and state types, which differ
 * per game and are none of the platform's business. `Any` here is the
 * existential: the register holds games whose types it deliberately does not
 * know, and every use goes through the interface rather than the data.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyGame = GamePackage<any, any>;

const games: AnyGame[] = [];

/** Put a game on the shelf. Order here is the order the library shows. */
export function register(game: AnyGame): void {
  if (games.some((g) => g.meta.id === game.meta.id)) {
    throw new Error(`two games claim the id "${game.meta.id}"`);
  }
  games.push(game);
}

export function allGames(): readonly AnyGame[] {
  return games;
}

export function gameById(id: string): AnyGame | undefined {
  return games.find((g) => g.meta.id === id);
}

export function metaById(id: string): GameMeta | undefined {
  return gameById(id)?.meta;
}

/** One puzzle, by game and puzzle id. */
export function puzzleById(gameId: string, puzzleId: string): Puzzle<unknown> | undefined {
  return gameById(gameId)?.puzzles().find((p) => p.id === puzzleId);
}
