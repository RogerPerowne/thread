/**
 * Today's puzzle, for each game.
 *
 * No server, and no need for one: the date is the seed. Every player asking on
 * the same day gets the same puzzle out of the same shipped ladder, and asking
 * again tomorrow gets a different one. The shuffle is a hash rather than a
 * counter so that consecutive days are not consecutive puzzles — a ladder
 * walked in order would give away that Tuesday is harder than Monday.
 *
 * The daily is chosen from a game's middle band, because a daily is a thing
 * you do on the bus, not a thing you set aside an evening for. The whole
 * ladder is still there in the archive.
 */

import { hashSeed } from './rng.js';
import { today } from './store.js';
import type { AnyGame } from './registry.js';
import type { Puzzle } from './types.js';

/** The puzzle this game offers today. Null only if the game ships none. */
export function dailyOf(game: AnyGame, date = today()): Puzzle<unknown> | null {
  const all = game.puzzles();
  if (all.length === 0) return null;

  /*
   * Prefer the two middle bands. If a game has none of those — a very short
   * ladder, or one still being built — fall back to everything rather than
   * offering nothing, because a missing daily is worse than an easy one.
   */
  const middling = all.filter((p) => p.band === 'steady' || p.band === 'tricky');
  const pool = middling.length > 0 ? middling : all;
  return pool[hashSeed(`${game.meta.id}/${date}`) % pool.length];
}

/** How the date reads on the masthead. */
export function longDate(date = today()): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric',
  });
}
