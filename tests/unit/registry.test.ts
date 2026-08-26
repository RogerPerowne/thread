import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { thread } from '../../src/games/thread/index.js';
import { zigzag } from '../../src/games/zigzag/index.js';
import { BANDS } from '../../src/platform/types.js';
import type { GamePackage } from '../../src/platform/types.js';

/**
 * What a game promises the platform.
 *
 * These are the contracts the shell relies on without being able to check
 * them at the point of use. The path screen builds the whole ladder out of
 * `chapters()` and assumes every puzzle is in exactly one of them, in the
 * order `puzzles()` gives — if that is ever false, the screen quietly loses
 * puzzles or shows one twice, and nothing throws.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const games: [string, GamePackage<any, any>][] = [['thread', thread], ['zigzag', zigzag]];

describe.each(games)('%s', (_name, game) => {
  it('groups every puzzle into exactly one chapter, in ladder order', () => {
    const ladder = game.puzzles().map((p) => p.id);
    const chapters = game.chapters();
    expect(chapters.length).toBeGreaterThan(0);
    const flat = chapters.flatMap((c) => c.puzzles.map((p) => p.id));
    expect(flat).toEqual(ladder);
    expect(new Set(flat).size).toBe(ladder.length);
  });

  it('names every chapter, and names them differently', () => {
    const names = game.chapters().map((c) => c.name);
    for (const n of names) expect(n.trim().length).toBeGreaterThan(0);
    expect(new Set(names).size).toBe(names.length);
  });

  it('leaves no chapter empty', () => {
    // An empty chapter is a heading on the path with nothing under it.
    for (const c of game.chapters()) expect(c.puzzles.length).toBeGreaterThan(0);
  });

  it('gives every puzzle a band the platform knows', () => {
    for (const p of game.puzzles()) expect(BANDS).toContain(p.band);
  });

  it('gives every puzzle an id of its own', () => {
    const ids = game.puzzles().map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('claims an accent the design system actually has', () => {
    /*
     * The cards and the path both build custom property names out of this —
     * `--a-thread`, `--t-thread`, `--c-thread` — so a name the palette has
     * never heard of is a silently colourless game rather than an error.
     */
    expect(game.meta.accent).toMatch(/^a-[a-z]+$/);
    const tokens = readFileSync('src/platform/design/tokens.css', 'utf8');
    const family = game.meta.accent.replace(/^a-/, '');
    for (const prefix of ['a', 't', 'c']) {
      expect(tokens, `no --${prefix}-${family} in the palette`).toContain(`--${prefix}-${family}:`);
    }
  });
});
