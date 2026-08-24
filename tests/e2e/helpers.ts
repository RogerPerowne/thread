import type { Page } from '@playwright/test';

/**
 * Every helper here drives the game through REAL pointer events. Solving a
 * level by calling internal functions would prove the rules work and nothing
 * at all about whether the game is PLAYABLE — and those are different
 * questions. The window hook is read-only: it tells the harness where the
 * pegs are, exactly as a player's eyes would.
 */

export type Current = {
  id: string;
  pegs: [number, number][];
  threads: { sol: number[]; over: number[] }[];
  rails: { peg: number; a: [number, number]; b: [number, number] }[];
  weave: boolean;
  solved: boolean;
  lastMiss?: number;
};

export async function gotoApp(page: Page, hash = ''): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('thread.seen-intro', '1');
    } catch {
      /* storage unavailable */
    }
  });
  await page.goto(`/${hash}`);
  await page.waitForFunction(() => Boolean((window as never as { __thread?: unknown }).__thread));
}

export async function openLevel(page: Page, mode: string, id: string): Promise<Current> {
  await page.evaluate(() => {
    const w = window as never as { __thread: { current: unknown } };
    w.__thread.current = null;
  });
  await page.goto(`/#/play/${mode}/${id}`);
  await page.waitForFunction(
    (want) => {
      const c = (window as never as { __thread: { current: { id: string } | null } }).__thread.current;
      return Boolean(c && c.id === want);
    },
    id,
    { timeout: 15_000 },
  );
  await page.locator('.board-svg').first().waitFor({ state: 'visible' });
  return readCurrent(page);
}

export async function readCurrent(page: Page): Promise<Current> {
  return page.evaluate(() => (window as never as { __thread: { current: unknown } }).__thread.current as never);
}

export async function isSolved(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const c = (window as never as { __thread: { current: { solved?: boolean } | null } }).__thread.current;
    return Boolean(c && c.solved);
  });
}

/** Board space (0..100) to viewport pixels, via the SVG's own box. */
export async function boardBox(page: Page): Promise<{ x: number; y: number; size: number }> {
  const box = await page.locator('.board-svg').first().boundingBox();
  if (!box) throw new Error('the board is not on screen');
  const size = Math.min(box.width, box.height);
  return { x: box.x + (box.width - size) / 2, y: box.y + (box.height - size) / 2, size };
}

export type Px = { x: number; y: number };

export async function pointMapper(page: Page): Promise<(p: [number, number]) => Px> {
  const { x, y, size } = await boardBox(page);
  return (p) => ({ x: x + (p[0] / 100) * size, y: y + (p[1] / 100) * size });
}

/** A real tap: move, press, release. */
export async function tap(page: Page, p: Px): Promise<void> {
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.up();
}

/** A real drag: press, sweep through every point, release. */
export async function drag(page: Page, points: Px[], steps = 4): Promise<void> {
  await page.mouse.move(points[0].x, points[0].y);
  await page.mouse.down();
  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1];
    const to = points[i];
    for (let s = 1; s <= steps; s++) {
      const k = s / steps;
      await page.mouse.move(from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k);
    }
  }
  await page.mouse.up();
}

/**
 * Solve a level the way a person would: slide any rail pegs into place, tap
 * out each thread and tie it off, then set the over/under on a weave.
 */
export async function solveByTapping(page: Page, level: Current): Promise<void> {
  const at = await pointMapper(page);

  // 1. Rail pegs start at the far end of their rail and have to be moved.
  for (const rail of level.rails) {
    const home = level.pegs[rail.peg];
    const da = Math.hypot(rail.a[0] - home[0], rail.a[1] - home[1]);
    const db = Math.hypot(rail.b[0] - home[0], rail.b[1] - home[1]);
    const start = da >= db ? rail.a : rail.b;
    await drag(page, [at(start), at(home)], 6);
  }

  // 2. Each thread in turn: tap every peg, then tap the last one again to tie.
  for (const thread of level.threads) {
    for (const peg of thread.sol) await tap(page, at(level.pegs[peg]));
    await tap(page, at(level.pegs[thread.sol[thread.sol.length - 1]]));
  }

  // 3. On a weave, flip the crossings that need the first strand on top.
  if (level.weave) {
    const want = new Set<number>(level.threads.flatMap((t) => t.over));
    const hits = await page.locator('.weave-hit').all();
    for (const hit of hits) {
      const k = Number(await hit.getAttribute('data-crossing'));
      if (!want.has(k)) continue;
      const box = await hit.boundingBox();
      if (!box) continue;
      await tap(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    }
  }
}

/** Drag the whole solution in one sweep and let go. */
export async function solveByDragging(page: Page, level: Current): Promise<void> {
  const at = await pointMapper(page);
  for (const rail of level.rails) {
    const home = level.pegs[rail.peg];
    const da = Math.hypot(rail.a[0] - home[0], rail.a[1] - home[1]);
    const db = Math.hypot(rail.b[0] - home[0], rail.b[1] - home[1]);
    await drag(page, [at(da >= db ? rail.a : rail.b), at(home)], 6);
  }
  for (const thread of level.threads) {
    await drag(page, thread.sol.map((p) => at(level.pegs[p])), 4);
  }
}
