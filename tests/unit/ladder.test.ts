import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * The ladder climbs, in every game.
 *
 * Five hundred levels are only a ladder if they are in an order that means
 * something. Two things make them one, and both are checked here rather than
 * asserted in a comment: the thirty boards INSIDE a chapter are sorted by the
 * measured score, and the chapters themselves go up.
 *
 * The measure is each game's own — how much deduction a board takes, not how
 * many cells it has — so this is a check on the ORDER, not on the measure. A
 * chapter is allowed to start easier than the last one ended, because a step
 * up in board size restarts the easy end of a new kind of puzzle; what it may
 * not do is have a lower median than the chapter two before it.
 */
const games: [string, string][] = [
  ['thread', 'boards/thread.json'],
  ['zigzag', 'puzzles/zigzag.json'],
  ['nine', 'puzzles/nine.json'],
  ['shape', 'puzzles/shape.json'],
  ['hex', 'puzzles/hex.json'],
  ['isolate', 'puzzles/isolate.json'],
];

type Shipped = { id: string; band: string; score: number; chapter: number };

describe.each(games)('%s', (name, file) => {
  const all = JSON.parse(readFileSync(file, 'utf8')) as Shipped[];
  const chapters = [...new Set(all.map((b) => b.chapter))].sort((a, b) => a - b);
  const of = (n: number) => all.filter((b) => b.chapter === n);

  it('ships five hundred levels in chapters of thirty', () => {
    expect(all.length, `${name} ships ${all.length}`).toBeGreaterThanOrEqual(480);
    expect(chapters).toEqual([...chapters].sort((a, b) => a - b));
    for (const n of chapters.slice(0, -1)) {
      expect(of(n).length, `${name} chapter ${n}`).toBe(30);
    }
  });

  it('numbers its levels in one run, in chapter order', () => {
    /* The id carries the position, and the path and the level grid both count
       on it: `<game>-14` is the fourteenth board of the ladder and nothing
       else. A gap or a repeat here is a level nobody can reach. */
    const ids = all.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(all.map((_, i) => `${name}-${i + 1}`));
  });

  it('climbs inside every chapter', () => {
    for (const n of chapters) {
      const xs = of(n).map((b) => b.score);
      expect(xs, `${name} chapter ${n} is not sorted`).toEqual([...xs].sort((a, b) => a - b));
    }
  });

  it('climbs across the chapters', () => {
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    const meds = chapters.map((n) => median(of(n).map((b) => b.score)));
    for (let i = 2; i < meds.length; i++) {
      expect(meds[i], `${name} chapter ${chapters[i]} is easier than two before it`)
        .toBeGreaterThan(meds[i - 2] - 0.001);
    }
    /* And the top of the ladder is a long way above the bottom. */
    expect(meds[meds.length - 1]).toBeGreaterThan(meds[0] * 1.2);
  });

  it('uses all four bands, and each is a real slice of the ladder', () => {
    /*
     * Cut at the quartiles of the game's own spread, so a band is a promise
     * about a quarter of the ladder rather than a word that happens to be
     * true of nine boards.
     */
    const counts: Record<string, number> = {};
    for (const b of all) counts[b.band] = (counts[b.band] ?? 0) + 1;
    for (const band of ['gentle', 'steady', 'tricky', 'severe']) {
      expect(counts[band] ?? 0, `${name} has ${counts[band] ?? 0} ${band}`)
        .toBeGreaterThan(all.length / 12);
    }
  });
});
