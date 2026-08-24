/**
 * Runtime level generation for the endless modes.
 *
 * These use exactly the same designers as the hand-built campaign and the same
 * quality gate, so a generated puzzle is made of the same material as an
 * authored one — it is simply chosen by a seed rather than by a person. The
 * Daily's seed is the date, so every player in the world gets the same puzzle.
 */

import type { Level, Mode } from '../core/level.js';
import { validateLevel } from '../core/level.js';
import { quickCheck } from '../core/gate.js';
import { makeRng } from '../core/rng.js';
import { CLASSIC_CHAPTERS, type Maker } from '../core/design.js';

/** Difficulty bands, expressed as which chapters may be drawn from. */
const EASY = [1, 2, 3];
const MID = [1, 2, 3, 4, 5, 6, 10, 14];
const HARD = [3, 4, 5, 6, 10, 11, 12, 13, 14, 15];

function makerFor(chapter: number): Maker {
  return CLASSIC_CHAPTERS[chapter - 1].make;
}

/**
 * Generate until the gate accepts. Deterministic: the same seed always walks
 * the same sequence of candidates and therefore lands on the same level.
 */
function generate(seed: string, chapters: number[], mode: Mode, id: string, tries = 260): Level {
  const rng = makeRng(seed);
  for (let i = 0; i < tries; i++) {
    const chapter = chapters[rng.int(chapters.length)];
    const body = makerFor(chapter)(rng, i);
    if (!body) continue;
    let level: Level;
    try {
      level = validateLevel({ ...body, id, mode, chapter });
    } catch {
      continue;
    }
    if (quickCheck(level).ok) return level;
  }
  // A guaranteed fallback so a mode can never fail to start.
  return fallback(id, mode);
}

function fallback(id: string, mode: Mode): Level {
  const pegs: [number, number][] = [];
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 3;
    pegs.push([Math.round((50 + 32 * Math.cos(a)) * 10) / 10, Math.round((50 + 32 * Math.sin(a)) * 10) / 10]);
  }
  return validateLevel({
    id, mode, chapter: 1, pegs,
    threads: [{ color: '#7A4FBF', sol: [0, 1, 2, 3, 4, 5] }],
  });
}

/** Everyone gets the same puzzle today. */
export function dailyLevel(dateKey: string): Level {
  // The band drifts across the week so Monday is gentle and the weekend bites.
  const day = new Date(dateKey + 'T00:00:00').getDay();
  const band = day === 0 || day === 6 ? HARD : day <= 2 ? EASY : MID;
  return generate(`daily:${dateKey}`, band, 'daily', `daily-${dateKey}`);
}

/** Simple generated loops; each solve adds three seconds. */
export function blitzLevel(seed: string, index: number): Level {
  const band = index < 5 ? EASY : index < 14 ? MID : HARD;
  return generate(`blitz:${seed}:${index}`, band, 'blitz', `blitz-${index}`);
}

/** No budget, no timer. For the people who play to calm down. */
export function zenLevel(seed: string, index: number): Level {
  const level = generate(`zen:${seed}:${index}`, [1, 3, 4, 13, 14], 'zen', `zen-${index}`);
  // Zen never carries a spool: nothing here should feel like a constraint.
  const { budget, ...rest } = level as Level & { budget?: number };
  void budget;
  return rest as Level;
}

/** An endless ladder. One wrong closed loop ends the run. */
export function oneLifeLevel(seed: string, index: number): Level {
  const band = index < 4 ? EASY : index < 10 ? MID : HARD;
  return generate(`onelife:${seed}:${index}`, band, 'onelife', `onelife-${index}`);
}

/** A shareable seed link: challenge a friend with the exact same ladder. */
export function seedFromUrl(): string | null {
  if (typeof location === 'undefined') return null;
  const m = /[#&]seed=([A-Za-z0-9_-]{1,32})/.exec(location.hash);
  return m ? m[1] : null;
}

export function randomSeed(): string {
  const bytes = new Uint8Array(6);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 8);
}
