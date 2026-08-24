import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error - plain ESM helper, no types
import { compare, THRESHOLDS } from '../../scripts/compare-reference.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE = resolve(here, '../../reference/brilliant-source.png');

test.describe('the isometric path replica still matches its reference', () => {
  test.skip(!existsSync(SOURCE), 'reference/brilliant-source.png is not present');
  test.setTimeout(120_000);

  test('every similarity metric clears its floor', async () => {
    const { scores } = await compare({ write: false });
    const failures = Object.entries(scores as Record<string, number>)
      .filter(([k, v]) => v < (THRESHOLDS as Record<string, number>)[k])
      .map(([k, v]) => `${k} ${v} < ${(THRESHOLDS as Record<string, number>)[k]}`);
    expect(failures, `run pnpm compare:reference and open reference/compare-sheet.png`).toEqual([]);
  });
});
