import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on('console', (m: any) => console.log(`[c.${m.type()}] ${m.text()}`));
page.on('response', (r: any) => {
  if (r.status() >= 400 || r.url().includes('/api') || r.url().includes('/auth') || r.url().includes('/me')) {
    console.log(`  [${r.status()}] ${r.request().method()} ${r.url()}`);
  }
});
await page.goto('http://127.0.0.1:5173/login', { waitUntil: 'networkidle' });
console.log('URL:', page.url());
console.log('PATH:', new URL(page.url()).pathname);
console.log('TITLE:', await page.title());
const inputs = await page.locator('input').all();
console.log('inputs:', inputs.length);
for (const i of inputs) {
  const t = await i.getAttribute('type');
  const p = await i.getAttribute('placeholder');
  console.log('  input type:', t, 'placeholder:', p);
}
const body = await page.locator('body').innerHTML();
console.log('first 500 chars of body:', body.substring(0, 500));
await browser.close();
