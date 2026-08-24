import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
mkdirSync('shots/new', { recursive: true });
const b = await chromium.launch();
for (const [w, h, tag] of [[390, 844, 'iphone14'], [360, 640, 'small'], [414, 896, 'plus'], [844, 390, 'landscape']]) {
  const page = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  await page.goto('http://127.0.0.1:4173/#/play/classic/c-1-1');
  await page.waitForSelector('.board svg', { timeout: 10000 });
  const got = page.locator('.sheet button', { hasText: 'Got it' });
  if (await got.count()) { await got.click(); await page.waitForTimeout(450); }
  await page.waitForTimeout(500);
  const m = await page.evaluate(() => {
    const r = (s) => { const e = document.querySelector(s); if (!e) return null;
      const b = e.getBoundingClientRect(); return { t: Math.round(b.top), b: Math.round(b.bottom), h: Math.round(b.height), w: Math.round(b.width) }; };
    return {
      vh: innerHeight, vw: innerWidth,
      docH: document.documentElement.scrollHeight,
      bodyH: document.body.scrollHeight,
      screen: r('.screen'), hud: r('.hud'), board: r('.board'),
      surface: r('.boardsurface'), controls: r('.controls'), topbar: r('.topbar'),
      overflowY: document.documentElement.scrollHeight - innerHeight,
    };
  });
  console.log(tag, JSON.stringify(m));
  await page.screenshot({ path: `shots/new/play-${tag}.png` });
  await page.close();
}
await b.close();
