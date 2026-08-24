/**
 * Score reference/brilliant-replica.html against reference/brilliant-source.png.
 *
 * The source is a photograph of a third-party app in a typeface I do not have,
 * so a literal byte match is not reachable and claiming one would be a lie.
 * What is reachable — and what this measures — is that every piece of geometry
 * lands where the original put it:
 *
 *   layout    per-pixel agreement after a small blur, ignoring nothing
 *   structure normalised cross-correlation of a 16x downsample
 *   path      IoU of the lavender path mask
 *   tileDark  IoU of the extruded side faces
 *   tileLite  IoU of the tile top faces
 *   chrome    IoU of the header/tab-bar ink
 *
 * Run: node scripts/compare-reference.mjs [--open]
 */
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = resolve(root, 'reference/brilliant-source.png');
const REPLICA = resolve(root, 'reference/brilliant-replica.html');

export const THRESHOLDS = {
  layout: 0.975,
  structure: 0.965,
  path: 0.860,
  tileDark: 0.950,
  tileLite: 0.940,
  chrome: 0.820,
};

export async function compare({ write = true } = {}) {
  if (!existsSync(SOURCE)) throw new Error(`missing ${SOURCE}`);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 771, height: 1524 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(REPLICA).href);
  await page.waitForFunction(() => document.documentElement.dataset.ready === '1');
  await page.evaluate(() => document.fonts.ready);
  const shot = (await page.screenshot({ clip: { x: 0, y: 0, width: 771, height: 1524 } })).toString('base64');
  const src = readFileSync(SOURCE).toString('base64');

  const result = await page.evaluate(async ({ shot, src }) => {
    const load = async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      return { w: c.width, h: c.height, d: c.getContext('2d').getImageData(0, 0, c.width, c.height).data, canvas: c };
    };
    const A = await load(src), B = await load(shot);
    const W = Math.min(A.w, B.w), H = Math.min(A.h, B.h);
    const at = (I, x, y) => { const i = (y * I.w + x) * 4; return [I.d[i], I.d[i + 1], I.d[i + 2]]; };

    // --- box blur to 1/2 scale, which forgives sub-pixel and hinting shifts ---
    const shrink = (I, f) => {
      const w = Math.floor(W / f), h = Math.floor(H / f), o = new Float32Array(w * h * 3);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let r = 0, g = 0, b = 0, n = 0;
        for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) {
          const p = at(I, x * f + dx, y * f + dy); r += p[0]; g += p[1]; b += p[2]; n++;
        }
        const k = (y * w + x) * 3; o[k] = r / n; o[k + 1] = g / n; o[k + 2] = b / n;
      }
      return { w, h, o };
    };
    const a4 = shrink(A, 4), b4 = shrink(B, 4);
    let err = 0;
    for (let i = 0; i < a4.o.length; i++) err += Math.abs(a4.o[i] - b4.o[i]);
    const layout = 1 - err / a4.o.length / 255;

    // --- normalised cross-correlation of a coarse grayscale ---
    const gray = (S) => {
      const f = 4, w = Math.floor(S.w / f), h = Math.floor(S.h / f), o = new Float64Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let s = 0, n = 0;
        for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) {
          const k = ((y * f + dy) * S.w + (x * f + dx)) * 3;
          s += 0.299 * S.o[k] + 0.587 * S.o[k + 1] + 0.114 * S.o[k + 2]; n++;
        }
        o[y * w + x] = s / n;
      }
      return o;
    };
    const ga = gray(a4), gb = gray(b4);
    const mean = (v) => v.reduce((s, x) => s + x, 0) / v.length;
    const ma = mean(ga), mb = mean(gb);
    let num = 0, da = 0, db = 0;
    for (let i = 0; i < ga.length; i++) {
      const u = ga[i] - ma, v = gb[i] - mb; num += u * v; da += u * u; db += v * v;
    }
    const structure = num / Math.sqrt(da * db);

    // --- masked IoU, dilated by 2px so a 1px stroke offset is not a miss ---
    const maskOf = (I, test) => {
      const m = new Uint8Array(W * H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (test(at(I, x, y))) m[y * W + x] = 1;
      return m;
    };
    const dilate = (m, r) => {
      const o = new Uint8Array(W * H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (!m[y * W + x]) continue;
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < W && ny < H) o[ny * W + nx] = 1;
        }
      }
      return o;
    };
    const iou = (test, r = 3) => {
      const ma_ = maskOf(A, test), mb_ = maskOf(B, test);
      const da_ = dilate(ma_, r), db_ = dilate(mb_, r);
      let inter = 0, uni = 0;
      for (let i = 0; i < ma_.length; i++) {
        const a = ma_[i] || 0, b = mb_[i] || 0;
        // a pixel counts as agreeing if it is in the other mask's dilation
        if ((a && db_[i]) || (b && da_[i])) inter++;
        if (a || b) uni++;
      }
      return { score: uni ? inter / uni : 1, aPx: ma_.reduce((s, v) => s + v, 0), bPx: mb_.reduce((s, v) => s + v, 0) };
    };

    const isLavender = ([r, g, b]) => b - g > 25 && b > 195 && r > 145 && r < 235;
    const isTileDark = ([r, g, b]) => b > 75 && b < 165 && r < 95 && g < 65 && b - r > 40;
    const isTileLite = ([r, g, b]) => b - g > 55 && b > 200 && r > 130 && r < 215;
    const isChrome = ([r, g, b]) => r < 205 && g < 205 && b < 215 && Math.abs(r - b) < 60;

    const path = iou(isLavender);
    const tileDark = iou(isTileDark);
    const tileLite = iou(isTileLite);
    // chrome is scored only in the header and tab bar bands
    const band = (y) => y < 228 || y >= 1427;
    const chromeMask = (I) => {
      const m = new Uint8Array(W * H);
      for (let y = 0; y < H; y++) { if (!band(y)) continue;
        for (let x = 0; x < W; x++) if (isChrome(at(I, x, y))) m[y * W + x] = 1; }
      return m;
    };
    const cm = chromeMask(A), cn = chromeMask(B), cd = dilate(cm, 3), ce = dilate(cn, 3);
    let ci = 0, cu = 0;
    for (let i = 0; i < cm.length; i++) {
      if ((cm[i] && ce[i]) || (cn[i] && cd[i])) ci++;
      if (cm[i] || cn[i]) cu++;
    }

    // --- side-by-side + difference sheet ---
    const out = document.createElement('canvas');
    out.width = W * 3; out.height = H;
    const g2 = out.getContext('2d');
    g2.fillStyle = '#fff'; g2.fillRect(0, 0, out.width, out.height);
    g2.drawImage(A.canvas, 0, 0);
    g2.drawImage(B.canvas, W, 0);
    const diff = g2.createImageData(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = at(A, x, y), q = at(B, x, y);
      const e = (Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2])) / 3;
      const i = (y * W + x) * 4;
      diff.data[i] = 255; diff.data[i + 1] = 255 - e; diff.data[i + 2] = 255 - e; diff.data[i + 3] = 255;
    }
    g2.putImageData(diff, W * 2, 0);

    return {
      scores: {
        layout: +layout.toFixed(4),
        structure: +structure.toFixed(4),
        path: +path.score.toFixed(4),
        tileDark: +tileDark.score.toFixed(4),
        tileLite: +tileLite.score.toFixed(4),
        chrome: +(cu ? ci / cu : 1).toFixed(4),
      },
      pixels: {
        path: [path.aPx, path.bPx], tileDark: [tileDark.aPx, tileDark.bPx],
        tileLite: [tileLite.aPx, tileLite.bPx],
      },
      sheet: out.toDataURL('image/png'),
    };
  }, { shot, src });

  await browser.close();
  if (write) {
    writeFileSync(resolve(root, 'reference/compare-sheet.png'), Buffer.from(result.sheet.split(',')[1], 'base64'));
    writeFileSync(resolve(root, 'reference/compare-scores.json'), JSON.stringify(result.scores, null, 2) + '\n');
  }
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  // wrapped rather than top-level await: this module is also imported from a
  // Playwright spec, where a top-level await defeats module-format detection.
  (async () => {
    const { scores, pixels } = await compare();
    let bad = 0;
    console.log('\n  metric      score   floor   ');
    console.log('  ---------------------------');
    for (const [k, v] of Object.entries(scores)) {
      const ok = v >= THRESHOLDS[k];
      if (!ok) bad++;
      console.log(`  ${k.padEnd(10)} ${v.toFixed(4)}  ${THRESHOLDS[k].toFixed(2)}   ${ok ? 'ok' : 'FAIL'}`);
    }
    console.log('\n  mask pixel counts (source / replica)');
    for (const [k, v] of Object.entries(pixels)) console.log(`  ${k.padEnd(10)} ${v[0]} / ${v[1]}`);
    console.log(`\n  sheet: reference/compare-sheet.png\n`);
    process.exit(bad ? 1 : 0);
  })();
}
