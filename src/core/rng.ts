/** Seeded, deterministic RNG. The Daily uses the date as its seed, so every
 *  player in the world gets exactly the same puzzle. */

export type Rng = {
  (): number;
  int(maxExclusive: number): number;
  range(lo: number, hi: number): number;
  pick<T>(xs: readonly T[]): T;
  shuffle<T>(xs: T[]): T[];
  chance(p: number): boolean;
};

/** xmur3 string hash -> 32-bit seed. */
export function hashSeed(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

/** mulberry32 — small, fast, good enough, and identical across engines. */
export function makeRng(seed: number | string): Rng {
  let a = typeof seed === 'string' ? hashSeed(seed) : seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng = next as Rng;
  rng.int = (maxExclusive: number) => Math.floor(next() * maxExclusive);
  rng.range = (lo: number, hi: number) => lo + next() * (hi - lo);
  rng.pick = <T,>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)];
  rng.shuffle = <T,>(xs: T[]): T[] => {
    for (let i = xs.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      const t = xs[i];
      xs[i] = xs[j];
      xs[j] = t;
    }
    return xs;
  };
  rng.chance = (p: number) => next() < p;
  return rng;
}

/** YYYY-MM-DD in the player's local time — the Daily's seed key. */
export function dateKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function daysBetween(a: string, b: string): number {
  const pa = Date.parse(a + 'T00:00:00');
  const pb = Date.parse(b + 'T00:00:00');
  return Math.round((pb - pa) / 86400000);
}
