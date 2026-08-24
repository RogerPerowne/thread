import { test, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));

/**
 * Every screen, at every handset size, with nothing running off the edge and
 * nothing too small to press. Layout regressions are cheap to introduce and
 * expensive to spot by eye, so this walks the whole app rather than sampling.
 */
test('every screen fits every phone', async ({ baseURL }) => {
  test.setTimeout(180_000);
  const script = resolve(here, '../../scripts/fit-audit.mjs');
  try {
    const { stdout } = await run('node', [script, `${baseURL}/`], { maxBuffer: 8 << 20 });
    expect(stdout).toContain('every screen fits every viewport');
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    throw new Error(`fit audit failed:\n${err.stdout ?? ''}${err.stderr ?? ''}`);
  }
});
