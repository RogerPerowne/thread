/**
 * Smoke-test the DEPLOYED BYTES, from a sandbox that cannot browse out.
 *
 * `verify-deploy.mjs` points a browser straight at the live site, which is the
 * right check when the browser can reach it. In a sandboxed session it cannot:
 * curl goes through the agent proxy, Chromium does not, and every request from
 * the page is reset. So this fetches the deployed files with curl, serves them
 * from disk at the same path the site uses, and plays THOSE bytes — which is a
 * check on what shipped, not on a fresh local build of the same source.
 *
 *   node scripts/verify-deployed-bytes.mjs [https://rogerperowne.github.io/thread/]
 */

import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdtemp } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { extname, join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

const site = (process.argv[2] ?? 'https://rogerperowne.github.io/thread/').replace(/\/$/, '');
const prefix = new URL(site).pathname.replace(/\/$/, '');

// --- mirror ----------------------------------------------------------------
const ROOT = await mkdtemp(join(tmpdir(), 'thread-live-'));
const fetchTo = (rel) => {
  const dest = join(ROOT, rel);
  execFileSync('mkdir', ['-p', dirname(dest)]);
  execFileSync('curl', ['-sSf', `${site}/${rel}`, '-o', dest]);
  return dest;
};
const html = await readFile(fetchTo('index.html'), 'utf8');
const assets = [...new Set([...html.matchAll(/assets\/[\w.-]+/g)].map((m) => m[0]))];
for (const a of assets) fetchTo(a);
for (const a of assets.filter((a) => a.endsWith('.css'))) {
  const css = await readFile(join(ROOT, a), 'utf8');
  for (const m of css.matchAll(/url\(([^)]+)\)/g)) {
    const rel = m[1].replace(/^["']|["']$/g, '').replace(`${prefix}/`, '').replace(/^\//, '');
    if (!rel.startsWith('data:')) fetchTo(rel);
  }
}
console.log(`mirrored ${site} — ${assets.length} assets`);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === prefix || p === `${prefix}/`) p = `${prefix}/index.html`;
  try {
    const body = await readFile(join(ROOT, p.slice(prefix.length)));
    res.writeHead(200, { 'content-type': TYPES[extname(p)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('no');
  }
});
await new Promise((r) => server.listen(4180, '127.0.0.1', r));

const base = `http://127.0.0.1:4180${prefix}/`;
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('requestfailed', (r) => errs.push(`request failed ${r.url()} ${r.failure()?.errorText}`));

const checks = [];
const ok = (name, pass, detail = '') => checks.push({ name, pass, detail });

// --- the library ----------------------------------------------------------
await page.goto(base);
await page.waitForSelector('.masthead .wordmark', { timeout: 15000 });
ok('the library renders its masthead', (await page.locator('.masthead .wordmark').textContent()) === 'Puzzles');

const games = await page.evaluate(() => window.__puzzles.games());
ok('every registered game has a card',
  games.length > 1 && (await page.locator('[data-card]').count()) === games.length);
ok('one puzzle is featured', (await page.locator('.card.feature').count()) === 1);

// --- one board of each game, played on the deployed bundle -----------------
for (const game of games) {
  const ids = await page.evaluate((g) => window.__puzzles.puzzles(g), game);
  ok(`${game} ships a ladder`, ids.length > 10);

  const id = ids[Math.floor(ids.length / 3)];
  await page.goto(`${base}#/g/${game}/${id}`);
  await page.waitForSelector('.stage svg', { timeout: 15000 });

  const handle = await page.evaluate(() => window.__puzzles.board());
  ok(`${game} ${id} opens and publishes its board`, Boolean(handle));

  if (game === 'thread') {
    const board = handle.board;
    const svg = page.locator('.board-svg').first();
    const box = await svg.boundingBox();
    const [vx, vy, vw] = (await svg.getAttribute('viewBox')).split(/\s+/).map(Number);
    const side = Math.min(box.width, box.height);
    const at = (p) => ({
      x: box.x + (box.width - side) / 2 + ((p[0] - vx) / vw) * side,
      y: box.y + (box.height - side) / 2 + ((p[1] - vy) / vw) * side,
    });
    for (const path of board.solution) {
      const f = at(board.posts[path[0]]);
      await page.mouse.move(f.x, f.y);
      await page.mouse.down();
      for (const p of path.slice(1)) {
        const q = at(board.posts[p]);
        await page.mouse.move(q.x, q.y, { steps: 4 });
      }
      await page.mouse.up();
    }
  } else if (game === 'zigzag') {
    const zig = handle.zig;
    const svg = page.locator('.zig-svg');
    const box = await svg.boundingBox();
    const W = zig.w * 10 + 2;
    const H = zig.h * 10 + 2;
    const side = Math.min(box.width / W, box.height / H);
    const ox = box.x + (box.width - side * W) / 2 + side;
    const oy = box.y + (box.height - side * H) / 2 + side;
    const at = (c) => ({
      x: ox + ((c % zig.w) * 10 + 5) * side,
      y: oy + (Math.floor(c / zig.w) * 10 + 5) * side,
    });
    const f = at(zig.answer[0]);
    await page.mouse.move(f.x, f.y);
    await page.mouse.down();
    for (const c of zig.answer.slice(1)) {
      const q = at(c);
      await page.mouse.move(q.x, q.y, { steps: 3 });
    }
    await page.mouse.up();
  }

  await page.waitForTimeout(500);
  ok(`${game} ${id} solved by real drags on the deployed bytes`,
    (await page.locator('.screen.play.won').count()) > 0);
}

ok('no page errors and no failed requests', errs.length === 0, errs.join('; '));

for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
const bad = checks.filter((c) => !c.pass).length;

await b.close();
await new Promise((r) => server.close(r));
process.exit(bad === 0 ? 0 : 1);
