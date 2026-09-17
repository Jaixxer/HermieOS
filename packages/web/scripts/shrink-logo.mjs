/**
 * One-off asset shrink: the app logo is drawn at 40 px (120 px on a 3x phone)
 * but the source PNG is 139 kB — it was the single biggest image cost on every
 * page load. Re-encode with Chromium's canvas (no image deps in the repo) at
 * 128 px and keep whichever of WebP/PNG is smaller.
 *
 * Run from packages/web:  node scripts/shrink-logo.mjs
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, statSync } from 'node:fs';

const SRC = 'src/assets/logo.png';
const base64 = readFileSync(SRC).toString('base64');
const before = statSync(SRC).size;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<canvas id="c"></canvas>');

const out = await page.evaluate(
  async ([b64, target]) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    // Preserve the artwork's aspect ratio (object-contain in Logo.tsx scales it
    // to fit a square box, so the file must not be squashed into one).
    const w = Math.round((target * img.naturalWidth) / img.naturalHeight);
    const h = target;
    const canvas = document.getElementById('c');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    return {
      source: { width: img.naturalWidth, height: img.naturalHeight },
      webp: canvas.toDataURL('image/webp', 0.92).split(',')[1],
      png: canvas.toDataURL('image/png').split(',')[1],
    };
  },
  [base64, 128],
);

await browser.close();

const webp = Buffer.from(out.webp, 'base64');
const png = Buffer.from(out.png, 'base64');
console.log(`source: ${out.source.width}x${out.source.height}, ${(before / 1024).toFixed(1)} kB`);
console.log(`webp 128px: ${(webp.length / 1024).toFixed(1)} kB`);
console.log(`png  128px: ${(png.length / 1024).toFixed(1)} kB`);

if (webp.length <= png.length) {
  writeFileSync('src/assets/logo.webp', webp);
  console.log('wrote src/assets/logo.webp');
} else {
  writeFileSync('src/assets/logo.png', png);
  console.log('wrote src/assets/logo.png (re-encoded)');
}
