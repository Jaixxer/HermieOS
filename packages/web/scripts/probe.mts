import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on('console', (m: any) => console.log(`[c.${m.type()}] ${m.text()}`));
page.on('response', (r: any) => {
  if (r.url().includes('/api') || r.url().includes('/auth') || r.url().includes('/me')) {
    console.log(`  [${r.status()}] ${r.request().method()} ${r.url()}`);
  }
});
await page.goto('http://127.0.0.1:5174/', { waitUntil: 'networkidle' });
console.log('URL:', page.url());
console.log('PATH:', new URL(page.url()).pathname);
const html = await page.content();
console.log('HAS EMAIL:', html.includes('type="email"'));
console.log('HAS URL INPUT:', html.includes('placeholder="http'));
console.log('HAS PASSWORD:', html.includes('type="password"'));
console.log('TITLE TEXT:', (await page.locator('h1').first().textContent().catch(() => 'no h1')));
await browser.close();
