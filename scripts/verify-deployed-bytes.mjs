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
/*
 * Anything the page preloads, too. Fonts are linked from the HTML rather than
 * referenced from a stylesheet, so a mirror that only follows CSS `url()`
 * serves 404s for them — and then reports the site as broken when the fault is
 * the mirror's.
 */
for (const m of html.matchAll(/(?:href|src)="([^"]+\.(?:woff2|woff|ttf|png|svg|ico))"/g)) {
  const rel = m[1].replace(`${prefix}/`, '').replace(/^\//, '');
  try { fetchTo(rel); } catch { /* the site does not have it; the check below will say so */ }
}
for (const a of assets.filter((a) => a.endsWith('.css'))) {
  const css = await readFile(join(ROOT, a), 'utf8');
  for (const m of css.matchAll(/url\(([^)]+)\)/g)) {
    const rel = m[1].replace(/^["']|["']$/g, '').replace(`${prefix}/`, '').replace(/^\//, '');
    if (!rel.startsWith('data:')) fetchTo(rel);
  }
}
console.log(`mirrored ${site} — ${assets.length} assets`);
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.svg': 'image/svg+xml', '.png': 'image/png',
};
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
    const [vx, vy, vw, vh] = (await svg.getAttribute('viewBox')).split(/\s+/).map(Number);
    /* Both axes off the element's own window. Fitted with xMidYMid meet, so
       the scale is the smaller ratio and the slack is split evenly either
       side. This read the height through `vw` and called the board square,
       which it was until a board's shape started following what it holds —
       and then every board that is not square was dragged through empty
       space. Same arithmetic as threadMapper in tests/e2e/helpers.ts. */
    const scale = Math.min(box.width / vw, box.height / vh);
    const ox = box.x + (box.width - scale * vw) / 2;
    const oy = box.y + (box.height - scale * vh) / 2;
    const at = (p) => ({ x: ox + (p[0] - vx) * scale, y: oy + (p[1] - vy) * scale });
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
    /* The window and the cell middles off the handle, same as the e2e
       helper: a copy of the grid arithmetic here would be right until the
       board grew something under the grid, and then silently wrong. */
    const { view, mids } = await page.evaluate(() => {
      const b = window.__puzzles.board();
      return { view: b.view, mids: b.mids() };
    });
    const side = Math.min(box.width / view.W, box.height / view.H);
    const ox = box.x + (box.width - side * view.W) / 2 - view.x * side;
    const oy = box.y + (box.height - side * view.H) / 2 - view.y * side;
    const at = (c) => ({ x: ox + mids[c].x * side, y: oy + mids[c].y * side });
    const f = at(zig.answer[0]);
    await page.mouse.move(f.x, f.y);
    await page.mouse.down();
    for (const c of zig.answer.slice(1)) {
      const q = at(c);
      await page.mouse.move(q.x, q.y, { steps: 3 });
    }
    await page.mouse.up();
  } else if (game === 'nine') {
    const svg = page.locator('.nine-svg');
    const box = await svg.boundingBox();
    const v = handle.view;
    const side = Math.min(box.width / v.W, box.height / v.H);
    const left = box.x + (box.width - side * v.W) / 2;
    const top = box.y + (box.height - side * v.H) / 2;
    const at = (x, y) => ({ x: left + (x - v.ox) * side, y: top + (y - v.oy) * side });
    for (let cell = 0; cell < handle.nine.answer.length; cell++) {
      const digit = handle.nine.answer[cell];
      const s = await page.evaluate((d) => window.__puzzles.board().slot(d), digit);
      const c = await page.evaluate((k) => window.__puzzles.board().cellBox(k), cell);
      const f = at(s.x + 9.5, s.y + 9.5);
      const t = at(c.x + c.size / 2, c.y + c.size / 2);
      await page.mouse.move(f.x, f.y);
      await page.mouse.down();
      await page.mouse.move((f.x + t.x) / 2, (f.y + t.y) / 2);
      await page.mouse.move(t.x, t.y);
      await page.mouse.up();
    }
  } else if (game === 'shape') {
    const svg = page.locator('.shape-svg');
    const box = await svg.boundingBox();
    const v = handle.view;
    const side = Math.min(box.width / v.W, box.height / v.H);
    const left = box.x + (box.width - side * v.W) / 2;
    const top = box.y + (box.height - side * v.H) / 2;
    const at = (x, y) => ({ x: left + x * side, y: top + y * side });
    /* Choose a mark from the palette, then tap every cell that wants it —
       which is how the game is meant to be played. */
    const picks = [...new Set(handle.shape.answer)].sort((a, b) => a - b);
    for (const pick of picks) {
      const chip = await page.evaluate((k) => window.__puzzles.board().chipBox(k), pick);
      const c = at(chip.x + chip.size / 2, chip.y + chip.size / 2);
      await page.mouse.move(c.x, c.y);
      await page.mouse.down();
      await page.mouse.up();
      for (let cell = 0; cell < handle.shape.answer.length; cell++) {
        if (handle.shape.answer[cell] !== pick) continue;
        const box = await page.evaluate((k) => window.__puzzles.board().cellBox(k), cell);
        const q = at(box.x + box.size / 2, box.y + box.size / 2);
        await page.mouse.move(q.x, q.y);
        await page.mouse.down();
        await page.mouse.up();
      }
    }
  } else if (game === 'hex') {
    const svg = page.locator('.hex-svg');
    const box = await svg.boundingBox();
    const v = handle.view;
    const side = Math.min(box.width / v.W, box.height / v.H);
    const left = box.x + (box.width - side * v.W) / 2;
    const top = box.y + (box.height - side * v.H) / 2;
    const at = (x, y) => ({ x: left + (x - v.ox) * side, y: top + (y - v.oy) * side });
    for (let space = 0; space < handle.hex.answer.length; space++) {
      const tile = handle.hex.answer[space];
      const s = await page.evaluate((t) => window.__puzzles.board().slot(t), tile);
      const c = await page.evaluate((k) => window.__puzzles.board().space(k), space);
      const f = at(s.x, s.y);
      const t = at(c.x, c.y);
      await page.mouse.move(f.x, f.y);
      await page.mouse.down();
      await page.mouse.move((f.x + t.x) / 2, (f.y + t.y) / 2);
      await page.mouse.move(t.x, t.y);
      await page.mouse.up();
    }
  } else if (game === 'isolate') {
    const svg = page.locator('.iso-svg');
    const box = await svg.boundingBox();
    const v = handle.view;
    const side = Math.min(box.width / v.W, box.height / v.H);
    const left = box.x + (box.width - side * v.W) / 2;
    const top = box.y + (box.height - side * v.H) / 2;
    const at = (x, y) => ({ x: left + x * side, y: top + y * side });
    for (const edge of handle.isolate.answer) {
      if (handle.isolate.given.includes(edge)) continue;
      const spot = await page.evaluate((e) => window.__puzzles.board().edgeSpot(e), edge);
      const q = at(spot.x, spot.y);
      await page.mouse.move(q.x, q.y);
      await page.mouse.down();
      await page.mouse.up();
    }
  } else {
    /*
     * A game with no driver here is a game this check silently stops checking.
     * Saying so is the whole point: the last time a game was added, this file
     * carried on printing PASS for the two it knew and nothing at all for the
     * new one.
     */
    ok(`${game} has a driver in this check`, false, 'add one to verify-deployed-bytes.mjs');
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
