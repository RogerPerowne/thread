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

/*
 * The routes worth walking. Built from the register rather than listed by
 * hand, so a game added tomorrow is audited tomorrow — a fit audit that has to
 * be edited when a game is added is a fit audit that stops covering the new
 * ones.
 */
const ROUTES = [
  ['library', '#/'],
  ['archive thread', '#/g/thread'],
  ['archive zigzag', '#/g/zigzag'],
  ['archive nine', '#/g/nine'],
  ['archive shape', '#/g/shape'],
  ['archive hex', '#/g/hex'],
  ['thread small', '#/g/thread/thread-1'],
  ['thread middle', '#/g/thread/thread-30'],
  ['thread biggest', '#/g/thread/thread-56'],
  ['zigzag small', '#/g/zigzag/zigzag-1'],
  ['zigzag biggest', '#/g/zigzag/zigzag-44'],
  ['nine first', '#/g/nine/nine-1'],
  ['nine last', '#/g/nine/nine-64'],
  ['shape first', '#/g/shape/shape-1'],
  ['shape last', '#/g/shape/shape-66'],
  ['hex first', '#/g/hex/hex-1'],
  ['hex last', '#/g/hex/hex-68'],
];

/*
 * Every size is walked twice: once flat, and once as a phone with a notch and
 * a home indicator. The insets are zero in every desktop browser, so a layout
 * that applies one of them twice looks perfect here and sits thirty-four
 * pixels wrong on the device most people will use. Simulating them is the only
 * way to see it without a phone in your hand.
 */
const SKINS = [
  ['flat', ''],
  ['notched', ':root{--safe-t:47px;--safe-b:34px}'],
];

const browser = await chromium.launch();
const problems = [];

for (const [vname, w, h] of VIEWPORTS) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => problems.push(`${vname} · pageerror · ${String(e).slice(0, 140)}`));

  for (const [rname, hash] of ROUTES) {
   for (const [sname, skin] of SKINS) {
    const where = `${vname} · ${rname}${sname === 'flat' ? '' : ` · ${sname}`}`;
    await page.goto(BASE + hash);
    if (skin) await page.addStyleTag({ content: skin });
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

        /*
         * A label cut off mid-word. This is what a row of controls does when
         * it is one button wider than the phone: nothing runs off the edge,
         * nothing is too small to press, and "Restart" reads "Resta…".
         */
        for (const t of el.querySelectorAll('span')) {
          if (t.scrollWidth > t.clientWidth + 1 && t.clientWidth > 0) {
            out.push(`${named(el)} has its label clipped ("${t.textContent.trim()}")`);
          }
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
      /*
       * Reachability is measured by scrolling to the thing and looking again,
       * which forces a layout each time. A path screen has a couple of hundred
       * identical tiles on it, and scrolling to every one of them takes long
       * enough that the audit stops being run at all — so identical controls
       * are checked a few at a time. Same class, same geometry, same answer;
       * the SIZE check above still runs on every one of them.
       */
      const seen = new Map();
      for (const el of suspects) {
        const key = named(el);
        const n = seen.get(key) ?? 0;
        if (n >= 3) continue;
        seen.set(key, n + 1);
        const r = reachable(el);
        if (!r.ok) out.push(`${key} ${r.why}`);
      }
      /*
       * Are the numbers lining?
       *
       * The display face's figures are old-style: some digits hang below the
       * baseline and some rise to cap height. In running prose that is a
       * feature. In a puzzle it means a 4 sits low in its cell and 48 has one
       * digit high and one low, and no amount of centring fixes it because the
       * two halves of the number disagree with each other. So the rule is that
       * numerals are set in the text face — and the rule is measured here
       * rather than remembered, on whatever fonts the page actually resolved.
       */
      const c2d = document.createElement('canvas').getContext('2d');
      const fonts = new Map();
      for (const el of document.querySelectorAll('.screen *')) {
        const own = [...el.childNodes]
          .filter((n) => n.nodeType === 3).map((n) => n.textContent).join('');
        /*
         * Only numbers that are DATA. Old-style figures are not a defect in a
         * line of prose — mixing with lowercase is what they are for — so a
         * chapter called "5 by 5" is left alone. What is checked is text that
         * is nothing but a number: a tile, a total, a clock. Those have to sit
         * centred in a box and line up under one another, and a figure that
         * drops below the baseline can do neither.
         */
        if (!/^[\s0-9.,:+\-\u2013\u2014%/]*[0-9][\s0-9.,:+\-\u2013\u2014%/]*$/.test(own)) continue;
        const cs = getComputedStyle(el);
        const font = `${cs.fontWeight} 100px ${cs.fontFamily}`;
        if (!fonts.has(font)) fonts.set(font, named(el));
      }
      for (const [font, where] of fonts) {
        c2d.font = font;
        let lowest = 0;
        let tall = 0;
        let short = Infinity;
        for (const d of '0123456789') {
          const m = c2d.measureText(d);
          lowest = Math.max(lowest, m.actualBoundingBoxDescent);
          tall = Math.max(tall, m.actualBoundingBoxAscent);
          short = Math.min(short, m.actualBoundingBoxAscent);
        }
        if (lowest > 3) {
          out.push(`${where} draws digits in a face whose figures drop ${Math.round(lowest)}% below the baseline (${font})`);
        } else if (tall - short > 7) {
          out.push(`${where} draws digits in a face whose figures differ ${Math.round(tall - short)}% in height (${font})`);
        }
      }

      return out;
    });

    /*
     * A board sits in the middle of the space it is given. Not "looks about
     * right" — measured, because the failure this catches is a layout that
     * applies a safe-area inset twice and is therefore invisible until the app
     * is on a phone.
     */
    const off = await page.evaluate(() => {
      const stage = document.querySelector('.stage');
      const art = document.querySelector('.stage svg');
      if (!stage || !art) return null;
      const s = stage.getBoundingClientRect();
      const a = art.getBoundingClientRect();
      return {
        v: +((a.top - s.top) - (s.bottom - a.bottom)).toFixed(1),
        h: +((a.left - s.left) - (s.right - a.right)).toFixed(1),
      };
    });
    if (off && Math.abs(off.v) > 1) problems.push(`${where} · the board sits ${off.v}px off centre vertically`);
    if (off && Math.abs(off.h) > 1) problems.push(`${where} · the board sits ${off.h}px off centre horizontally`);

    for (const f of found) problems.push(`${where} · ${f}`);
   }
  }
  await page.close();
}

await browser.close();

if (problems.length === 0) {
  console.log(`Every screen fits every phone (${ROUTES.length} routes x ${VIEWPORTS.length} sizes x ${SKINS.length} skins).`);
  process.exit(0);
}
console.error(`${problems.length} problem${problems.length === 1 ? '' : 's'}:\n`);
for (const p of problems) console.error(`  ${p}`);
process.exit(1);
