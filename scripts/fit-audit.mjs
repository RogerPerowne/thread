/**
 * Does every screen fit every phone?
 *
 * Not "does it look right on the one I tested on". This walks every route at
 * every size from the smallest phone still in use to the largest, in both
 * orientations, and fails on anything a player would actually hit:
 *
 *   - the page scrolling sideways
 *   - a control running off the bottom, or off either edge
 *   - a tap target smaller than 44px, or one that something else covers
 *   - the layout moving after it has settled
 *
 * The last one is the one that matters most on a board you play with a thumb:
 * a board that shifts because a word appeared is a board you mis-tap.
 *
 *   node scripts/fit-audit.mjs [http://127.0.0.1:4173]
 */

import { chromium } from '@playwright/test';

const BASE = (process.argv[2] ?? 'http://127.0.0.1:4173').replace(/\/$/, '') + '/';

/** Real phones, smallest to largest, plus one landscape. */
const VIEWPORTS = [
  ['iPhone SE 1st gen', 320, 568],
  ['iPhone SE 3rd gen', 375, 667],
  ['iPhone 13 mini', 375, 812],
  ['iPhone 15', 393, 852],
  ['Pixel 8', 412, 915],
  ['iPhone 15 Pro Max', 430, 932],
  ['Galaxy Fold, folded', 344, 882],
  ['landscape', 852, 393],
];

const ROUTES = [
  ['home', '#/'],
  ['chapters', '#/m/classic'],
  ['path', '#/c/classic/1'],
  ['path deep', '#/c/grid/5'],
  ['play first', '#/p/classic/1'],
  ['play biggest', '#/p/classic/60'],
  ['play coloured', '#/p/coloured/50'],
  ['play grid', '#/p/grid/50'],
];

const browser = await chromium.launch();
const problems = [];

for (const [vname, w, h] of VIEWPORTS) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => problems.push(`${vname} · pageerror · ${String(e).slice(0, 140)}`));

  for (const [rname, hash] of ROUTES) {
    const where = `${vname} · ${rname}`;
    await page.goto(BASE + hash);
    await page.waitForSelector('.screen', { timeout: 10000 }).catch(() => {
      problems.push(`${where} · never rendered a screen`);
    });
    await page.waitForTimeout(450);

    // --- has it settled? ----------------------------------------------------
    const before = await page.evaluate(() => {
      const r = (s) => document.querySelector(s)?.getBoundingClientRect();
      const b = r('.boardsurface') ?? r('.cardlist') ?? r('.scroll');
      return b ? [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)] : null;
    });
    await page.waitForTimeout(700);
    const after = await page.evaluate(() => {
      const r = (s) => document.querySelector(s)?.getBoundingClientRect();
      const b = r('.boardsurface') ?? r('.cardlist') ?? r('.scroll');
      return b ? [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)] : null;
    });
    if (before && after && before.join() !== after.join()) {
      problems.push(`${where} · the stage moved after settling: ${before} -> ${after}`);
    }

    const found = await page.evaluate(() => {
      const out = [];
      const vw = innerWidth;
      const vh = innerHeight;

      if (document.documentElement.scrollWidth > vw + 1) {
        out.push(`page scrolls sideways (${document.documentElement.scrollWidth} > ${vw})`);
      }

      const named = (el) => el.tagName.toLowerCase()
        + (typeof el.className === 'string' && el.className
          ? '.' + el.className.trim().split(/\s+/).join('.') : '');

      // A strip the player can swipe may run past the edge, and so may
      // anything inside an SVG, whose own viewBox does the clipping.
      const scrolls = (el) => {
        for (let n = el; n; n = n.parentElement) {
          if (n instanceof SVGElement) return true;
          const cs = getComputedStyle(n);
          if (/auto|scroll/.test(cs.overflowX) && n.scrollWidth > n.clientWidth + 1) return true;
        }
        return false;
      };

      for (const el of document.querySelectorAll('.screen *')) {
        if (el instanceof SVGElement) continue;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        const b = el.getBoundingClientRect();
        if (b.width === 0 || b.height === 0) continue;
        if ((b.right > vw + 1 || b.left < -1) && !scrolls(el)) {
          out.push(`${named(el)} runs off the side (${Math.round(b.left)}..${Math.round(b.right)} of ${vw})`);
        }
      }

      /*
       * Can you get to it? A card below the fold in a list you can swipe is
       * how lists work; a card below the fold in a screen that does not scroll
       * is a card nobody can press. Rather than guess from the CSS, scroll the
       * thing into view and look again — what survives that is genuinely
       * unreachable.
       */
      const reachable = (el) => {
        el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
        const b = el.getBoundingClientRect();
        if (b.bottom > vh + 1 || b.top < -1) return { ok: false, why: 'still off screen after scrolling to it' };
        const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
        if (hit && !el.contains(hit) && !hit.contains(el)) {
          return { ok: false, why: `still covered by ${named(hit)} after scrolling to it` };
        }
        return { ok: true };
      };

      // Controls have to be reachable and big enough for a thumb.
      const suspects = [];
      for (const el of document.querySelectorAll('button, [tabindex="0"]')) {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        const b = el.getBoundingClientRect();
        if (b.width === 0 || b.height === 0) continue;

        if (b.width < 43.5 || b.height < 43.5) {
          out.push(`${named(el)} is ${Math.round(b.width)}x${Math.round(b.height)}, under 44`);
        }

        const offscreen = b.bottom > vh + 1 || b.top < -1;
        const cx = b.x + b.width / 2;
        const cy = b.y + b.height / 2;
        const covered = !offscreen && (() => {
          const hit = document.elementFromPoint(cx, cy);
          return hit && !el.contains(hit) && !hit.contains(el);
        })();
        if (offscreen || covered) suspects.push(el);
      }
      for (const el of suspects) {
        const r = reachable(el);
        if (!r.ok) out.push(`${named(el)} ${r.why}`);
      }
      return out;
    });

    for (const f of found) problems.push(`${where} · ${f}`);
  }
  await page.close();
}

await browser.close();

if (problems.length === 0) {
  console.log(`Every screen fits every phone (${ROUTES.length} routes x ${VIEWPORTS.length} sizes).`);
  process.exit(0);
}
console.error(`${problems.length} problem${problems.length === 1 ? '' : 's'}:\n`);
for (const p of problems) console.error(`  ${p}`);
process.exit(1);
