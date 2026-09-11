// Screenshots every running surface into checkin/shots/. Needs the surfaces up (bash checkin/start.sh) and Google Chrome installed.
// Run: cd checkin && npm install && npm run shots
import puppeteer from 'puppeteer-core';
const out = new URL('./shots/', import.meta.url).pathname;
const targets = [['storefront','http://localhost:5173/'],['account','http://localhost:5199/account'],['portal','http://localhost:5175/'],['billing','http://localhost:5179/billing'],['pricing','http://localhost:5180/pricing'],['merged','http://localhost:5200/office/billing']];
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-sandbox'] });
for (const [name, url] of targets) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await new Promise(r => setTimeout(r, 2500));
    await page.screenshot({ path: `${out}/${name}.png` });
    console.log(name, 'ok');
  } catch (e) { console.log(name, 'FAIL', e.message); }
  await page.close();
}
await browser.close();
