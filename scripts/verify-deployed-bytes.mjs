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
await page.evaluate(() => localStorage.setItem('thread.seen-intro', '1'));
await page.goto(base);
await page.waitForSelector('.screen');
ok('home renders', await page.locator('.wordmark, h1').first().isVisible());

const fontOk = await page.evaluate(() => document.fonts.check('700 32px "Zilla Slab"'));
ok('the slab wordmark font actually loaded', fontOk);

for (const [mode, id, want] of [
  ['shadow', 's-1-1', 'The order is not'],
  ['par', 'p-1-1', 'pegs'],
  ['corral', 'k-1-1', 'Fence in'],
  ['wire', 'q-1-1', 'how many of its cell'],
]) {
  await page.goto(`${base}#/play/${mode}/${id}`);
  await page.waitForSelector('.board-svg', { timeout: 15000 });
  const ask = (await page.locator('.hud .ask').textContent()) ?? '';
  ok(`${mode} board loads and states its ask`, ask.includes(want), ask);
  if (mode === 'corral' || mode === 'wire') {
    const g = page.locator('.target-ghost').first();
    const fill = Number(await g.getAttribute('fill-opacity'));
    const stroke = Number(await g.getAttribute('stroke-opacity'));
    ok(`${mode} does not draw its own answer`, fill === 0 && stroke === 0, `fill ${fill} stroke ${stroke}`);
  }
}

// The one that matters: a level solved through real taps, on the live bundle.
await page.goto(`${base}#/play/wire/q-1-1`);
await page.waitForSelector('.board-svg');
const level = await page.evaluate(() => window.__thread.current);
const box = await page.locator('.board-svg').first().boundingBox();
const size = Math.min(box.width, box.height);
const at = (p) => ({ x: box.x + (box.width - size) / 2 + (p[0] / 100) * size,
                     y: box.y + (box.height - size) / 2 + (p[1] / 100) * size });
for (const i of level.threads[0].sol) { const q = at(level.pegs[i]); await page.mouse.click(q.x, q.y); }
const last = at(level.pegs[level.threads[0].sol.at(-1)]);
await page.mouse.click(last.x, last.y);
await page.waitForTimeout(600);
ok('a wire level is solved by real taps on the deployed bundle',
   await page.evaluate(() => window.__thread.current?.solved === true));

ok('no page errors and no failed requests', errs.length === 0, errs.join(' | '));

for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.detail && !c.pass ? ` — ${c.detail}` : ''}`);
await b.close();
server.close();
process.exit(checks.every((c) => c.pass) ? 0 : 1);
