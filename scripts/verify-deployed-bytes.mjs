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

await page.goto(base);
await page.waitForSelector('.screen');
ok('home renders its masthead', (await page.locator('.wordmark').textContent()) === 'THREAD');
ok('one card per mode', (await page.locator('.gamecard').count()) === 3);

const fontOk = await page.evaluate(() => document.fonts.check('700 32px "Zilla Slab"'));
ok('the slab wordmark font actually loaded', fontOk);

await page.goto(`${base}#/m/classic`);
await page.waitForSelector('.gamecard');
ok('classic has six chapters', (await page.locator('.gamecard').count()) === 6);

await page.goto(`${base}#/c/classic/1`);
await page.waitForSelector('.ptile');
ok('the chapter path draws its tiles', (await page.locator('.ptile').count()) === 10);
ok('the tile you are up to carries its light', (await page.locator('.halo').count()) === 1);

// The one that matters: a board solved through real drags, on the shipped
// bundle, with the string drawn taut around every post.
for (const [mode, n] of [['classic', 30], ['coloured', 25], ['grid', 20]]) {
  await page.goto(`${base}#/p/${mode}/${n}`);
  await page.waitForSelector('.board-svg', { timeout: 15000 });
  const board = await page.evaluate(() => window.__thread.board());
  ok(`${mode} ${n} loaded`, !!board && board.mode === mode);
  const box = await page.locator('.board-svg').boundingBox();
  const side = Math.min(box.width, box.height);
  const at = (p) => ({
    x: box.x + (box.width - side) / 2 + ((p[0] - 8) / 84) * side,
    y: box.y + (box.height - side) / 2 + ((p[1] - 8) / 84) * side,
  });
  for (const path of board.solution) {
    const f = at(board.posts[path[0]]);
    await page.mouse.move(f.x, f.y);
    await page.mouse.down();
    for (let i = 1; i < path.length; i++) {
      const a = at(board.posts[path[i - 1]]);
      const c = at(board.posts[path[i]]);
      for (let s = 1; s <= 3; s++) {
        await page.mouse.move(a.x + (c.x - a.x) * s / 3, a.y + (c.y - a.y) * s / 3);
      }
    }
    await page.mouse.up();
  }
  ok(`${mode} ${n} solved by real drags on the deployed bundle`,
     (await page.locator('.screen.play.won').count()) > 0);
  const d = await page.locator('.string').first().getAttribute('d');
  ok(`${mode} ${n} draws its string taut, wrapping the posts`, (d ?? '').includes('A'));
}

ok('no page errors and no failed requests', errs.length === 0, errs.join(' | '));

for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.detail && !c.pass ? ` — ${c.detail}` : ''}`);
await b.close();
server.close();
process.exit(checks.every((c) => c.pass) ? 0 : 1);
