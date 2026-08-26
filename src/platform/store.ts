/**
 * What the player has done, and what they were in the middle of.
 *
 * One record per game, in one localStorage key, written whenever it changes.
 * Everything is derived from two facts — a puzzle was finished, at a time, on
 * a date; and a puzzle is part-done, with this state — so there is no
 * bookkeeping to get out of step with itself. Streaks are counted from the
 * dates rather than incremented, which means they cannot drift, and a clock
 * that goes backwards cannot inflate them.
 *
 * Storage can fail: a private window, a browser told to refuse site data, a
 * quota. Every read and write is wrapped, and a failure means the player loses
 * their history, not the game. Nothing here is ever the reason a board will
 * not open.
 */

const KEY = 'puzzles.v1';

export type Done = {
  /** ISO date, local, e.g. "2026-08-27". */
  readonly on: string;
  /** Seconds. */
  readonly took: number;
};

export type GameRecord = {
  /** puzzle id -> when it was finished and how long it took. */
  done: Record<string, Done>;
  /** puzzle id -> the player's saved state, for anything unfinished. */
  going: Record<string, string>;
  /** The last puzzle opened, so "Continue" knows where to go. */
  last?: string;
};

type Save = { games: Record<string, GameRecord> };

const empty = (): GameRecord => ({ done: {}, going: {} });

let cache: Save | null = null;

function read(): Save {
  if (cache) return cache;
  let loaded: Save = { games: {} };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Save;
      if (parsed && typeof parsed === 'object' && parsed.games) loaded = parsed;
    }
  } catch {
    // A private window, or site data refused. Play without a history.
  }
  cache = loaded;
  return loaded;
}

function write(): void {
  if (!cache) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // Out of quota, or storage refused. The session still works.
  }
}

function recordOf(game: string): GameRecord {
  const save = read();
  save.games[game] ??= empty();
  return save.games[game];
}

/** Today, as a local ISO date. Local, because a streak is about the player's day. */
export function today(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** The day before an ISO date. */
export function dayBefore(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(y, m - 1, d);
  t.setDate(t.getDate() - 1);
  return today(t);
}

export function isDone(game: string, puzzle: string): boolean {
  return Boolean(recordOf(game).done[puzzle]);
}

export function doneCount(game: string): number {
  return Object.keys(recordOf(game).done).length;
}

export function finish(game: string, puzzle: string, seconds: number, on = today()): void {
  const rec = recordOf(game);
  // A puzzle finished twice keeps the better time; a personal best should not
  // be lost by replaying a board for fun.
  const had = rec.done[puzzle];
  if (!had || seconds < had.took) rec.done[puzzle] = { on, took: Math.round(seconds) };
  delete rec.going[puzzle];
  write();
}

/** Remember an unfinished board, so closing the app does not lose it. */
export function keep(game: string, puzzle: string, state: string): void {
  const rec = recordOf(game);
  rec.going[puzzle] = state;
  rec.last = puzzle;
  write();
}

export function resumeOf(game: string, puzzle: string): string | undefined {
  return recordOf(game).going[puzzle];
}

export function forget(game: string, puzzle: string): void {
  const rec = recordOf(game);
  delete rec.going[puzzle];
  write();
}

/** The puzzle this game was last opened at, finished or not. */
export function lastPlayed(game: string): string | undefined {
  return recordOf(game).last;
}

export function markOpened(game: string, puzzle: string): void {
  recordOf(game).last = puzzle;
  write();
}

/** Anything part-done, most recent first. */
export function unfinished(game: string): readonly string[] {
  const rec = recordOf(game);
  return Object.keys(rec.going);
}

export type Stats = {
  readonly solved: number;
  readonly best: number | null;
  readonly mean: number | null;
  /** Days in a row up to and including today, or yesterday if today is unplayed. */
  readonly streak: number;
};

export function statsOf(game: string, now = today()): Stats {
  const rec = recordOf(game);
  const all = Object.values(rec.done);
  if (all.length === 0) return { solved: 0, best: null, mean: null, streak: 0 };

  const times = all.map((d) => d.took).sort((a, b) => a - b);
  const mean = times.reduce((s, t) => s + t, 0) / times.length;

  /*
   * Count back from the most recent day played rather than forwards from
   * anywhere: a streak is "how many days in a row up to now", and today not
   * being played yet must not end it — that only happens once today is over.
   */
  const days = new Set(all.map((d) => d.on));
  let cursor = days.has(now) ? now : dayBefore(now);
  let streak = 0;
  while (days.has(cursor)) {
    streak++;
    cursor = dayBefore(cursor);
  }

  return { solved: all.length, best: times[0], mean, streak };
}

/** Wipe everything. Only ever called from a deliberate control. */
export function clearAll(): void {
  cache = { games: {} };
  write();
}

/** Seconds as m:ss, which is how a solve time is read. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
