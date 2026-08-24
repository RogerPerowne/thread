/**
 * Does every screen actually fit a phone?
 *
 * Walks each route at a range of real handset sizes and reports anything that
 * runs off the viewport, overflows its own parent, or is too small to press.
 * Layout regressions are cheap to introduce and expensive to notice by eye.
 */
import { chromium } from '@playwright/test';

const BASE = process.argv[2] || 'http://127.0.0.1:4173/';
const VIEWPORTS = [
  ['iphone-se', 375, 667], ['iphone-14', 390, 844], ['pixel-7', 412, 915],
  ['galaxy-s8', 360, 740], ['small', 320, 568], ['landscape', 844, 390],
];
const ROUTES = [
  ['home', '#/home'], ['chapters', '#/chapters/classic'], ['path', '#/levels/classic/1'],
  ['wire-path', '#/levels/wire/1'], ['corral', '#/play/corral/k-1-1'], ['wire', '#/play/wire/q-1-1'],
  ['play', '#/play/classic/c-1-1'], ['weave', '#/play/weave/w-1-1'],
  ['gallery', '#/gallery'], ['stats', '#/stats'], ['settings', '#/settings'],
  ['assess', '#/assess'], ['workshop', '#/workshop'], ['daily', '#/play/daily'],
];

const b = await chromium.launch();
const problems = [];
for (const [vname, w, h] of VIEWPORTS) {
  const page = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => problems.push(`${vname} pageerror ${String(e).slice(0, 120)}`));
  for (const [rname, hash] of ROUTES) {
    await page.goto(BASE + hash);
    await page.waitForSelector('.screen, .playwrap', { timeout: 10000 });
    const got = page.locator('.sheet button', { hasText: 'Got it' });
    if (await got.count()) { await got.click(); await page.waitForTimeout(300); }
    await page.waitForTimeout(250);
    const found = await page.evaluate(() => {
      const out = [];
      const vw = innerWidth, vh = innerHeight;
      if (document.documentElement.scrollWidth > vw + 1) {
        out.push(`page scrolls sideways (${document.documentElement.scrollWidth} > ${vw})`);
      }
      const named = (el) => el.tagName.toLowerCase()
        + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : '');
      // A strip the player can swipe is allowed to run past the edge; so is
      // anything inside an SVG, whose own viewBox does the clipping.
      const scrollsSideways = (el) => {
        for (let p = el.parentElement; p; p = p.parentElement) {
          const cs = getComputedStyle(p);
          if (/auto|scroll/.test(cs.overflowX) && p.scrollWidth > p.clientWidth + 1) return true;
          if (cs.overflowX === 'hidden' || cs.overflow === 'hidden') return true;
        }
        return false;
      };
      for (const el of document.querySelectorAll('body *')) {
        if (el.ownerSVGElement) continue;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || cs.position === 'fixed') continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if ((r.right > vw + 1.5 || r.left < -1.5) && !scrollsSideways(el)) {
          out.push(`${named(el)} off-side (${Math.round(r.left)}..${Math.round(r.right)} of ${vw})`);
        }
        // Anything inside a non-scrolling ancestor must stay inside it.
        const p = el.parentElement;
        if (p) {
          const pcs = getComputedStyle(p);
          const pr = p.getBoundingClientRect();
          const scrolls = /auto|scroll/.test(pcs.overflowY + pcs.overflowX);
          if (!scrolls && pcs.overflow === 'visible' && pr.height > 0
              && (r.bottom > pr.bottom + 2 || r.top < pr.top - 2)
              && p.classList.contains('sheet')) {
            out.push(`${named(el)} spills out of .sheet`);
          }
        }
        // Touch targets. What matters is the area that actually responds, so
        // this hit-tests around the centre rather than trusting the box: a
        // small mark with a padded ::after is a fair 44px target.
        if ((el.tagName === 'BUTTON' || el.getAttribute('role') === 'button')
            && !el.hasAttribute('disabled') && (r.height < 44 || r.width < 44)) {
          const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
          const hits = (x, y) => {
            const t = document.elementFromPoint(x, y);
            return !!t && (t === el || el.contains(t) || t.parentElement === el);
          };
          const reach = [[cx - 21, cy], [cx + 21, cy], [cx, cy - 21], [cx, cy + 21]].every(([x, y]) => hits(x, y));
          if (!reach) out.push(`${named(el)} target ${Math.round(r.width)}x${Math.round(r.height)}, no 44px reach`);
        }
      }
      return [...new Set(out)];
    });
    for (const f of found) problems.push(`${vname.padEnd(11)} ${rname.padEnd(9)} ${f}`);
  }
  await page.close();
}
await b.close();
if (problems.length) {
  console.log(problems.join('\n'));
  console.log(`\n${problems.length} problems`);
  process.exit(1);
}
console.log('every screen fits every viewport');
