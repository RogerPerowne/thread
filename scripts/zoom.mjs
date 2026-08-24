import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
const [src,out,x,y,w,h,scale] = [process.argv[2],process.argv[3],...process.argv.slice(4).map(Number)];
const b=await chromium.launch();const page=await b.newPage();
const dataUrl=`data:image/png;base64,${readFileSync(src).toString('base64')}`;
const png=await page.evaluate(async({dataUrl,x,y,w,h,scale})=>{
  const img=new Image();img.src=dataUrl;await img.decode();
  const c=document.createElement('canvas');c.width=w*scale;c.height=h*scale;
  const ctx=c.getContext('2d');ctx.imageSmoothingEnabled=false;
  ctx.drawImage(img,x,y,w,h,0,0,w*scale,h*scale);
  return c.toDataURL('image/png');
},{dataUrl,x,y,w,h,scale});
writeFileSync(out,Buffer.from(png.split(',')[1],'base64'));
await b.close();
