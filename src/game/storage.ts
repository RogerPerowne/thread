/**
 * Versioned localStorage with a migration step. Storage can be unavailable
 * (private windows, blocked site data, embedded webviews) and the game must
 * still be playable, so nothing here ever throws.
 */

export const SCHEMA_VERSION = 3;

export type LevelRecord = {
  /** 1 = solved, 2 = no hints, 3 = optimal length. */
  stars: number;
  /** Best length used. */
  best: number;
  attempts: number;
  /** Best similarity reached on a failed attempt, for the "so close" nudge. */
  bestSimilarity: number;
};

export type DailyRecord = { solved: boolean; tries: number; shared?: boolean };

export type AssessmentRecord = {
  at: number;
  score: number;
  margin: number;
  percentile: number;
  theta: number;
  profile: { planning: number; precision: number; speed: number; spatial: number; learning: number };
};

export type Settings = {
  theme: string;
  skin: string;
  muted: boolean;
  motion: 'auto' | 'reduced' | 'full';
  highContrast: boolean;
  leftHanded: boolean;
};

export type Save = {
  v: number;
  levels: Record<string, LevelRecord>;
  /** Ordered ids of every shape ever solved — the Gallery poster. */
  gallery: string[];
  hiddenTheta: number;
  /** Mechanics the player has met, for the transfer signal. */
  seenMechanics: string[];
  daily: {
    streak: number;
    best: number;
    freezes: number;
    lastSolvedKey: string | null;
    history: Record<string, DailyRecord>;
  };
  assess: { lastAt: number; history: AssessmentRecord[] };
  unlocks: { themes: string[]; skins: string[]; modes: string[] };
  settings: Settings;
  stats: {
    solved: number;
    perfect: number;
    firstTry: number;
    totalAttempts: number;
    blitzBest: number;
    oneLifeBest: number;
    zenSolved: number;
    playSeconds: number;
  };
  /** Levels authored in the Workshop, as share codes. */
  workshop: string[];
  lastPlayed: { mode: string; levelId: string } | null;
};

export function emptySave(): Save {
  return {
    v: SCHEMA_VERSION,
    levels: {},
    gallery: [],
    hiddenTheta: 0,
    seenMechanics: [],
    daily: { streak: 0, best: 0, freezes: 0, lastSolvedKey: null, history: {} },
    assess: { lastAt: 0, history: [] },
    unlocks: { themes: ['paper'], skins: ['silk'], modes: ['classic', 'daily', 'zen'] },
    settings: {
      theme: 'paper', skin: 'silk', muted: false, motion: 'auto',
      highContrast: false, leftHanded: false,
    },
    stats: {
      solved: 0, perfect: 0, firstTry: 0, totalAttempts: 0,
      blitzBest: 0, oneLifeBest: 0, zenSolved: 0, playSeconds: 0,
    },
    workshop: [],
    lastPlayed: null,
  };
}

const KEY = 'thread.save';

/** Bring any older save forward. Never discards a player's progress. */
export function migrate(raw: unknown): Save {
  const base = emptySave();
  if (!raw || typeof raw !== 'object') return base;
  const old = raw as Partial<Save> & { v?: number };

  const merged: Save = {
    ...base,
    ...old,
    v: SCHEMA_VERSION,
    levels: { ...base.levels, ...(isPlainObject(old.levels) ? old.levels : {}) },
    gallery: Array.isArray(old.gallery) ? old.gallery : base.gallery,
    seenMechanics: Array.isArray(old.seenMechanics) ? old.seenMechanics : base.seenMechanics,
    daily: {
      ...base.daily,
      ...(isPlainObject(old.daily) ? old.daily : {}),
      history: isPlainObject(old.daily?.history) ? { ...old.daily.history } : {},
    },
    assess: {
      ...base.assess,
      ...(isPlainObject(old.assess) ? old.assess : {}),
      history: Array.isArray(old.assess?.history) ? old.assess.history : [],
    },
    unlocks: {
      themes: unique([...base.unlocks.themes, ...(old.unlocks?.themes ?? [])]),
      skins: unique([...base.unlocks.skins, ...(old.unlocks?.skins ?? [])]),
      modes: unique([...base.unlocks.modes, ...(old.unlocks?.modes ?? [])]),
    },
    settings: { ...base.settings, ...(isPlainObject(old.settings) ? old.settings : {}) },
    stats: { ...base.stats, ...(isPlainObject(old.stats) ? old.stats : {}) },
    workshop: Array.isArray(old.workshop) ? old.workshop : [],
    lastPlayed: isPlainObject(old.lastPlayed) ? old.lastPlayed : null,
  };

  // v1 stored stars as a bare number; v2 added attempts; v3 added similarity.
  for (const id of Object.keys(merged.levels)) {
    const rec = merged.levels[id] as unknown;
    if (typeof rec === 'number') {
      merged.levels[id] = { stars: rec, best: Infinity, attempts: 1, bestSimilarity: 1 };
    } else {
      const r = rec as Partial<LevelRecord>;
      merged.levels[id] = {
        stars: r.stars ?? 1,
        best: Number.isFinite(r.best) ? (r.best as number) : Infinity,
        attempts: r.attempts ?? 1,
        bestSimilarity: r.bestSimilarity ?? 0,
      };
    }
  }
  return merged;
}

/** A saved value is only usable if it is a real object, not a string or array. */
function isPlainObject(v: unknown): v is Record<string, any> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function unique<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

export function load(): Save {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptySave();
    return migrate(JSON.parse(raw));
  } catch {
    return emptySave();
  }
}

export function save(s: Save): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Storage unavailable or full. The session still plays; only the record is lost.
  }
}

export function resetSave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
}
