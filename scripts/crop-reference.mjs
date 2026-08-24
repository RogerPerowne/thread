/**
 * Pull the app screenshot out of the source image and save it as the reference
 * the replica is measured against. The upload is a photo of a Reddit page with
 * an embedded phone screenshot, so the useful part has to be cut out first.
 */
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const src = process.argv[2];
const out = process.argv[3];
const [x, y, w, h] = process.argv.slice(4).map(Number);

const b = await chromium.launch();
const page = await b.newPage();
const dataUrl = `data:image/png;base64,${readFileSync(src).toString('base64')}`;
const png = await page.evaluate(async ({ dataUrl, x, y, w, h }) => {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
  return c.toDataURL('image/png');
}, { dataUrl, x, y, w, h });
mkdirSync(out.replace(/\/[^/]+$/, ''), { recursive: true });
writeFileSync(out, Buffer.from(png.split(',')[1], 'base64'));
console.log(`wrote ${out} (${w}x${h})`);
await b.close();
