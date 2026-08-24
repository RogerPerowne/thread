/**
 * Smoke-test a DEPLOYED build.
 *
 * The end-to-end suite proves the app works against a local preview; this
 * proves the thing actually sitting on the web works too — that the base path
 * is right, the fonts and level data really shipped, and a level can be solved
 * through real pointer events on the live site.
 *
 *   node scripts/verify-deploy.mjs https://rogerperowne.github.io/thread/
 */

import { chromium } from '@playwright/test';

const url = (process.argv[2] ?? 'https://rogerperowne.github.io/thread/').replace(/\/$/, '') + '/';
const shots = process.argv[3] ?? null;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });

const problems = [];
page.on('pageerror', (e) => problems.push(`page error: ${e}`));
page.on('requestfailed', (r) => problems.push(`request failed: ${r.url()}`));

const fail = (msg) => {
  console.error(`FAIL  ${msg}`);
  process.exitCode = 1;
};
const ok = (msg) => console.log(`ok    ${msg}`);

try {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 45_000 });
  await page.waitForFunction(() => Boolean(window.__thread), null, { timeout: 20_000 });
  ok('the app boots');

  const counts = await page.evaluate(() => {
    const ids = window.__thread.levelIds();
    return { classic: ids.classic.length, weave: ids.weave.length, assess: ids.assess.length };
  });
  const total = counts.classic + counts.weave + counts.assess;
  if (total < 300) fail(`only ${total} levels loaded (${JSON.stringify(counts)})`);
  else ok(`${total} levels loaded (${JSON.stringify(counts)})`);

  const mark = await page.locator('.wordmark').innerText();
  if (mark.trim() !== 'THREAD') fail(`wordmark reads "${mark}"`);
  else ok('the masthead renders');

  const faces = await page.evaluate(() =>
    [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family));
  if (!faces.includes('Zilla Slab') || !faces.includes('Libre Franklin')) {
    fail(`fonts did not load: ${faces.join(', ') || 'none'}`);
  } else ok('both typefaces loaded');

  if (shots) await page.screenshot({ path: `${shots}/live-home.png` });

  // Solve the first level the way a person would, on the deployed build.
  await page.goto(`${url}#/play/classic/c-1-1`);
  await page.waitForFunction(() => window.__thread?.current, null, { timeout: 20_000 });
  const level = await page.evaluate(() => window.__thread.current);
  const box = await page.locator('.board-svg').boundingBox();
  const size = Math.min(box.width, box.height);
  const at = (p) => ({
    x: box.x + (box.width - size) / 2 + (p[0] / 100) * size,
    y: box.y + (box.height - size) / 2 + (p[1] / 100) * size,
  });
  const path = level.threads[0].sol.map((i) => at(level.pegs[i]));
  await page.mouse.move(path[0].x, path[0].y);
  await page.mouse.down();
  for (let i = 1; i < path.length; i++) {
    for (let s = 1; s <= 4; s++) {
      const k = s / 4;
      await page.mouse.move(
        path[i - 1].x + (path[i].x - path[i - 1].x) * k,
        path[i - 1].y + (path[i].y - path[i - 1].y) * k,
      );
    }
  }
  await page.mouse.up();
  await page.waitForTimeout(500);

  const solved = await page.evaluate(() => window.__thread.current.solved);
  if (!solved) fail('a level could not be solved by dragging on the live site');
  else ok('a level solves by dragging');

  if (shots) await page.screenshot({ path: `${shots}/live-play.png` });

  if (problems.length) {
    for (const p of problems.slice(0, 6)) fail(p);
  } else ok('no console errors or failed requests');
} catch (e) {
  fail(String(e).split('\n')[0]);
} finally {
  await browser.close();
}

console.log(process.exitCode ? `\n${url} has problems.` : `\n${url} looks healthy.`);
