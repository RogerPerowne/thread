/**
 * Progression, mastery and streaks.
 *
 * Two ladders, deliberately: chapter completion needs only solves, so a casual
 * player is never blocked, while three-star mastery unlocks the harder modes
 * for the people who want them. No coins, no energy, no timers as
 * monetisation — unlocks are cosmetics and modes, earned by playing.
 */

import type { Level } from '../core/level.js';
import { parLength } from '../core/level.js';
import { daysBetween } from '../core/rng.js';
import { THEMES, SKINS } from '../render/theme.js';
import type { Save, LevelRecord } from './storage.js';

export const STAR_LABELS = ['Solved', 'No hints', 'Optimal'] as const;

/** Optimal means within a whisker of par — floating point should not cost a star. */
export const OPTIMAL_SLACK = 0.5;

export function starsFor(level: Level, lengthUsed: number, hintsUsed: number): number {
  let stars = 1;
  if (hintsUsed === 0) stars = 2;
  if (hintsUsed === 0 && lengthUsed <= parLength(level) + OPTIMAL_SLACK) stars = 3;
  return stars;
}

export function recordFor(save: Save, id: string): LevelRecord | null {
  return save.levels[id] ?? null;
}

export function isSolved(save: Save, id: string): boolean {
  return (save.levels[id]?.stars ?? 0) > 0;
}

export function starCount(save: Save, ids: string[]): number {
  return ids.reduce((n, id) => n + (save.levels[id]?.stars ?? 0), 0);
}

export function solvedCount(save: Save, ids: string[]): number {
  return ids.reduce((n, id) => n + (isSolved(save, id) ? 1 : 0), 0);
}

export function perfectCount(save: Save, ids: string[]): number {
  return ids.reduce((n, id) => n + ((save.levels[id]?.stars ?? 0) >= 3 ? 1 : 0), 0);
}

// ---------------------------------------------------------------------------
// Unlocks
// ---------------------------------------------------------------------------

export type UnlockRule = {
  id: string;
  label: string;
  /** Plainly stated so a locked card is a visible goal, never a mystery. */
  condition: string;
  met: (save: Save, ctx: UnlockCtx) => boolean;
};

export type UnlockCtx = {
  classicIds: string[];
  weaveIds: string[];
  chapterIds: (chapter: number) => string[];
};

export const MODE_UNLOCKS: UnlockRule[] = [
  { id: 'classic', label: 'Classic', condition: '', met: () => true },
  { id: 'daily', label: 'Daily Thread', condition: '', met: () => true },
  { id: 'zen', label: 'Zen', condition: '', met: () => true },
  {
    id: 'blitz', label: 'Blitz', condition: 'Solve 10 levels in Classic',
    met: (s, c) => solvedCount(s, c.classicIds) >= 10,
  },
  {
    id: 'weave', label: 'Weave', condition: 'Finish Chapter 7 in Classic',
    met: (s, c) => solvedCount(s, c.chapterIds(7)) >= c.chapterIds(7).length && c.chapterIds(7).length > 0,
  },
  {
    id: 'assess', label: 'Assessment', condition: 'Solve 15 levels in Classic',
    met: (s, c) => solvedCount(s, c.classicIds) >= 15,
  },
  {
    id: 'onelife', label: 'One Life', condition: 'Perfect 20 levels in Classic',
    met: (s, c) => perfectCount(s, c.classicIds) >= 20,
  },
  {
    id: 'workshop', label: 'Workshop', condition: 'Solve 30 levels in Classic',
    met: (s, c) => solvedCount(s, c.classicIds) >= 30,
  },
  /*
   * The four modes that ask something other than "copy this shape" open in the
   * order they change the game by. Shadow only takes the outline away, so it
   * comes first; Wire replaces the target with a rule and comes last.
   */
  {
    id: 'shadow', label: 'Shadow', condition: 'Finish Chapter 3 in Classic',
    met: (s, c) => c.chapterIds(3).length > 0 && solvedCount(s, c.chapterIds(3)) >= c.chapterIds(3).length,
  },
  {
    id: 'par', label: 'Par', condition: 'Finish Chapter 2 in Classic',
    met: (s, c) => c.chapterIds(2).length > 0 && solvedCount(s, c.chapterIds(2)) >= c.chapterIds(2).length,
  },
  {
    id: 'corral', label: 'Corral', condition: 'Solve 20 levels in Classic',
    met: (s, c) => solvedCount(s, c.classicIds) >= 20,
  },
  {
    id: 'wire', label: 'Wire', condition: 'Solve 25 levels in Classic',
    met: (s, c) => solvedCount(s, c.classicIds) >= 25,
  },
];

/*
 * Nothing in Thread is locked. Every mode, chapter, level, theme and thread is
 * open from the first launch: the game is a set of puzzles to pick from, not a
 * ladder to climb, and a player who wants to start with a clue board should
 * not have to grind twenty-five classic levels for permission.
 *
 * MODE_UNLOCKS survives as the running order — home sorts the modes by it, and
 * `condition` still reads as the intended difficulty arc — but `met` no longer
 * decides anything.
 */
export function unlockedModes(save: Save, ctx: UnlockCtx): Set<string> {
  void ctx;
  const out = new Set<string>(MODE_UNLOCKS.map((rule) => rule.id));
  for (const m of save.unlocks.modes) out.add(m);
  return out;
}

/** Open, like everything else. See `unlockedModes`. */
export function themeUnlocked(save: Save, id: string, ctx: UnlockCtx): boolean {
  void save; void id; void ctx;
  return true;
}

/** Open, like everything else. See `unlockedModes`. */
export function skinUnlocked(save: Save, id: string, ctx: UnlockCtx): boolean {
  void save; void id; void ctx;
  return true;
}

export function collectionCount(save: Save, ctx: UnlockCtx): { have: number; total: number } {
  let have = 0;
  for (const t of THEMES) if (themeUnlocked(save, t.id, ctx)) have++;
  for (const s of SKINS) if (skinUnlocked(save, s.id, ctx)) have++;
  return { have, total: THEMES.length + SKINS.length };
}

// ---------------------------------------------------------------------------
// Streaks, with mercy
// ---------------------------------------------------------------------------

/**
 * A punitive streak causes churn when it breaks; a forgiving one lasts years.
 * One freeze is earned every 10 days and spent automatically on the first
 * missed day.
 */
export function applyDailySolve(save: Save, key: string): { streak: number; usedFreeze: boolean } {
  const last = save.daily.lastSolvedKey;
  let usedFreeze = false;
  if (last === key) return { streak: save.daily.streak, usedFreeze };

  if (!last) {
    save.daily.streak = 1;
  } else {
    const gap = daysBetween(last, key);
    if (gap === 1) {
      save.daily.streak += 1;
    } else if (gap === 2 && save.daily.freezes > 0) {
      save.daily.freezes -= 1;
      save.daily.streak += 1;
      usedFreeze = true;
    } else if (gap > 1) {
      save.daily.streak = 1;
    }
  }
  save.daily.lastSolvedKey = key;
  save.daily.best = Math.max(save.daily.best, save.daily.streak);
  if (save.daily.streak > 0 && save.daily.streak % 10 === 0) {
    save.daily.freezes = Math.min(save.daily.freezes + 1, 3);
  }
  save.daily.history[key] = { solved: true, tries: save.daily.history[key]?.tries ?? 1 };
  return { streak: save.daily.streak, usedFreeze };
}

/** The last 7 days, newest first — the forgiving archive. */
export function dailyArchive(todayKey: string, count = 7): string[] {
  const out: string[] = [];
  const base = Date.parse(todayKey + 'T00:00:00');
  for (let i = 0; i < count; i++) {
    const d = new Date(base - i * 86400000);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Sharing — social with no account
// ---------------------------------------------------------------------------

/**
 * A compact result grid. The shape is drawn in box characters from the solved
 * region so the share carries the actual puzzle, not just a number.
 */
export function shareGrid(raster: Uint8Array, gridSize: number, cols = 10): string {
  const rows = cols;
  const step = gridSize / cols;
  let out = '';
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let filled = 0;
      let total = 0;
      for (let y = 0; y < step; y++) {
        for (let x = 0; x < step; x++) {
          const gx = Math.floor(c * step + x);
          const gy = Math.floor(r * step + y);
          total++;
          if (raster[gy * gridSize + gx]) filled++;
        }
      }
      const f = filled / Math.max(total, 1);
      out += f > 0.66 ? '█' : f > 0.33 ? '▓' : f > 0.08 ? '░' : '·';
    }
    out += '\n';
  }
  return out.trimEnd();
}

export function shareText(dateKey: string, tries: number, streak: number, grid: string): string {
  const t = tries === 1 ? 'first try' : `${tries} tries`;
  return `Thread ${dateKey} — ${t}${streak > 1 ? ` · ${streak} day streak` : ''}\n\n${grid}`;
}

// ---------------------------------------------------------------------------
// End every session on a win
// ---------------------------------------------------------------------------

/**
 * Three failures on one level and the game quietly offers an easier variant of
 * the same mechanic. Players leave feeling capable, and capable players come
 * back.
 */
export const MERCY_THRESHOLD = 3;

export function shouldOfferEasier(attemptsOnThisLevel: number): boolean {
  return attemptsOnThisLevel >= MERCY_THRESHOLD;
}

/** Roughly one level in fifteen is a gem — aesthetic delight, never a reward. */
export function isGem(level: Level, index: number): boolean {
  return level.gem === true || index % 15 === 7;
}
