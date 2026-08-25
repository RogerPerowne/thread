import { describe, it, expect } from 'vitest';
import {
  starsFor, applyDailySolve, dailyArchive, shareGrid, shareText,
  unlockedModes, themeUnlocked, skinUnlocked, MODE_UNLOCKS, shouldOfferEasier, collectionCount,
} from '../../src/game/progress.js';
import { emptySave, migrate, SCHEMA_VERSION } from '../../src/game/storage.js';
import { validateLevel, parLength, type Level } from '../../src/core/level.js';
import { makeRaster, rasterizeLoop, GRID } from '../../src/core/region.js';
import { THEMES, SKINS } from '../../src/render/theme.js';

const square = validateLevel({
  id: 'sq', mode: 'classic', chapter: 1,
  pegs: [[20, 20], [80, 20], [80, 80], [20, 80]],
  threads: [{ color: '#000', sol: [0, 1, 2, 3] }],
}) as Level;

const ctx = {
  classicIds: Array.from({ length: 40 }, (_, i) => `c${i}`),
  weaveIds: ['w0', 'w1'],
  chapterIds: (ch: number) => (ch === 7 ? ['c7a', 'c7b'] : []),
};

describe('stars', () => {
  it('one for solving, two for no hints, three for optimal length', () => {
    const par = parLength(square);
    expect(starsFor(square, par * 1.4, 2)).toBe(1);
    expect(starsFor(square, par * 1.4, 0)).toBe(2);
    expect(starsFor(square, par, 0)).toBe(3);
  });
  it('a hint always costs the second and third star', () => {
    expect(starsFor(square, parLength(square), 1)).toBe(1);
  });
  it('floating point never costs a star', () => {
    expect(starsFor(square, parLength(square) + 1e-9, 0)).toBe(3);
  });
});

describe('streaks, with mercy', () => {
  it('counts consecutive days', () => {
    const s = emptySave();
    applyDailySolve(s, '2026-08-20');
    applyDailySolve(s, '2026-08-21');
    applyDailySolve(s, '2026-08-22');
    expect(s.daily.streak).toBe(3);
  });
  it('solving the same day twice does not double count', () => {
    const s = emptySave();
    applyDailySolve(s, '2026-08-20');
    applyDailySolve(s, '2026-08-20');
    expect(s.daily.streak).toBe(1);
  });
  it('breaks on a two-day gap with no freeze in hand', () => {
    const s = emptySave();
    applyDailySolve(s, '2026-08-20');
    applyDailySolve(s, '2026-08-23');
    expect(s.daily.streak).toBe(1);
  });
  it('spends a freeze to survive a single missed day', () => {
    const s = emptySave();
    for (let d = 1; d <= 10; d++) applyDailySolve(s, `2026-08-${String(d).padStart(2, '0')}`);
    expect(s.daily.streak).toBe(10);
    expect(s.daily.freezes).toBe(1); // earned one every 10 days
    const r = applyDailySolve(s, '2026-08-12'); // missed the 11th
    expect(r.usedFreeze).toBe(true);
    expect(s.daily.streak).toBe(11);
    expect(s.daily.freezes).toBe(0);
  });
  it('remembers the best streak even after a break', () => {
    const s = emptySave();
    for (let d = 1; d <= 5; d++) applyDailySolve(s, `2026-08-0${d}`);
    applyDailySolve(s, '2026-08-20');
    expect(s.daily.streak).toBe(1);
    expect(s.daily.best).toBe(5);
  });
  it('offers a 7-day archive, newest first', () => {
    const a = dailyArchive('2026-08-24');
    expect(a).toHaveLength(7);
    expect(a[0]).toBe('2026-08-24');
    expect(a[6]).toBe('2026-08-18');
  });
});

describe('sharing', () => {
  it('renders the solved shape as a compact grid', () => {
    const r = makeRaster();
    rasterizeLoop([[25, 25], [75, 25], [75, 75], [25, 75]], 1, r);
    const grid = shareGrid(r, GRID);
    expect(grid.split('\n')).toHaveLength(10);
    expect(grid).toContain('█');
    expect(grid).toContain('·');
  });
  it('the share text carries the date, the tries and the streak', () => {
    const t = shareText('2026-08-24', 1, 12, 'xx');
    expect(t).toContain('2026-08-24');
    expect(t).toContain('first try');
    expect(t).toContain('12 day streak');
  });
});

describe('nothing is locked', () => {
  it('opens every mode on an empty save', () => {
    const modes = unlockedModes(emptySave(), ctx);
    for (const rule of MODE_UNLOCKS) {
      expect(modes.has(rule.id), `${rule.id} was not open`).toBe(true);
    }
  });
  it('opens every theme and every thread on an empty save', () => {
    const s = emptySave();
    for (const t of THEMES) expect(themeUnlocked(s, t.id, ctx), `theme ${t.id}`).toBe(true);
    for (const sk of SKINS) expect(skinUnlocked(s, sk.id, ctx), `thread ${sk.id}`).toBe(true);
  });
  it('counts the whole collection as owned from the start', () => {
    const c = collectionCount(emptySave(), ctx);
    expect(c.total).toBe(14);
    expect(c.have).toBe(c.total);
  });
});

describe('ending on a win', () => {
  it('offers an easier variant after three failures', () => {
    expect(shouldOfferEasier(2)).toBe(false);
    expect(shouldOfferEasier(3)).toBe(true);
  });
});

describe('save migration', () => {
  it('an empty save is valid', () => {
    expect(migrate(null).v).toBe(SCHEMA_VERSION);
  });
  it('junk does not throw', () => {
    expect(() => migrate('nonsense')).not.toThrow();
    expect(() => migrate(42)).not.toThrow();
    expect(migrate({ levels: 'broken' }).levels).toEqual({});
  });
  it('brings a v1 save forward without losing progress', () => {
    const old = { v: 1, levels: { 'c-1-1': 3, 'c-1-2': 1 }, stats: { solved: 2 } };
    const m = migrate(old);
    expect(m.v).toBe(SCHEMA_VERSION);
    expect(m.levels['c-1-1'].stars).toBe(3);
    expect(m.levels['c-1-2'].stars).toBe(1);
    expect(m.stats.solved).toBe(2);
    expect(m.daily.streak).toBe(0);
  });
  it('keeps unlocks the player already had', () => {
    const m = migrate({ v: 2, unlocks: { themes: ['neon'], skins: [], modes: ['blitz'] } });
    expect(m.unlocks.themes).toContain('neon');
    expect(m.unlocks.themes).toContain('paper');
    expect(m.unlocks.modes).toContain('blitz');
  });
});
