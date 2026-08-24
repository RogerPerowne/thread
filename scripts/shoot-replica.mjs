import { chromium } from '@playwright/test';
import { pathToFileURL } from 'node:url';
const b=await chromium.launch();
const p=await b.newPage({viewport:{width:771,height:1524},deviceScaleFactor:1});
await p.goto(pathToFileURL(process.argv[2]||'reference/brilliant-replica.html').href.replace('file:///home','file:///home'));
await p.waitForFunction(()=>document.documentElement.dataset.ready==='1');
await p.evaluate(()=>document.fonts.ready);
await p.screenshot({path: process.argv[3]||'reference/replica-shot.png'});
await b.close();
