/**
 * Interaction-latency harness.
 *
 * "It lags while typing" is not a bundle-size problem — it is main-thread work
 * per keystroke. This measures what actually happens on a phone-class device
 * when the user types or scrolls:
 *
 *   - Event Timing API: every input/keydown event whose *processing* took
 *     longer than 16 ms (the frame budget), summed and maxed.
 *   - MutationObserver: DOM mutations per keystroke — a proxy for "how much of
 *     the page re-renders when I press a key".
 *   - rAF frame times while scrolling: p50/p95 and frames over 32 ms.
 *
 * Usage (from packages/web, against a running server):
 *   node scripts/interaction-probe.mjs            # all screens
 *   LABEL=before node scripts/interaction-probe.mjs /mission
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3101';
const LABEL = process.env.LABEL ?? 'run';

function readToken() {
  if (process.env.E2E_MCP_TOKEN) return process.env.E2E_MCP_TOKEN;
  const raw = readFileSync(join(homedir(), '.hermes', '.env'), 'utf8');
  const line = raw.split('\n').find((l) => l.startsWith('MCP_HERMIEOS_API_KEY='));
  if (!line) throw new Error('no MCP token in ~/.hermes/.env');
  return line.slice('MCP_HERMIEOS_API_KEY='.length).trim();
}

const INSTRUMENT = ([base, token]) => {
  try {
    localStorage.setItem('hermieos_server_url', base);
    localStorage.setItem('hermieos_mcp_token', token);
    localStorage.setItem('hermieos_api_base', base);
  } catch {
    /* ignore */
  }
  window.__perf = { events: [], mutations: 0, frames: [] };
  // Event Timing: input/keypress/pointer events that exceeded the frame budget.
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      if (e.duration >= 16) {
        window.__perf.events.push({ name: e.name, duration: Math.round(e.duration) });
      }
    }
  }).observe({ type: 'event', buffered: true, durationThreshold: 16 });
  new MutationObserver((records) => {
    window.__perf.mutations += records.length;
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
};

async function typingRun(page, url, selector, readyText) {
  await page.goto(url, { waitUntil: 'load' });
  if (readyText) await page.getByText(readyText, { exact: false }).first().waitFor({ timeout: 30000 });
  const input = page.locator(selector).first();
  await input.waitFor({ timeout: 30000 });
  await input.click();
  await page.evaluate(() => {
    window.__perf.events = [];
    window.__perf.mutations = 0;
  });
  const t0 = Date.now();
  await page.keyboard.type('quick brown fox jumps over', { delay: 30 });
  const wall = Date.now() - t0;
  await page.waitForTimeout(400);
  const out = await page.evaluate(() => ({
    events: window.__perf.events.slice(),
    mutations: window.__perf.mutations,
  }));
  const slow = out.events.filter((e) => e.name === 'input' || e.name === 'keydown');
  const worst = slow.reduce((m, e) => Math.max(m, e.duration), 0);
  const total = slow.reduce((s, e) => s + e.duration, 0);
  return {
    url,
    keystrokes: 25,
    wall,
    perKey: Math.round(wall / 25),
    slowEvents: slow.length,
    worstEvent: worst,
    totalEventTime: total,
    mutations: out.mutations,
    mutationsPerKey: Math.round(out.mutations / 25),
  };
}

async function scrollRun(page, url, readyText) {
  await page.goto(url, { waitUntil: 'load' });
  if (readyText) await page.getByText(readyText, { exact: false }).first().waitFor({ timeout: 30000 });
  await page.evaluate(() => {
    window.__perf.frames = [];
    let last = performance.now();
    const tick = (now) => {
      window.__perf.frames.push(Math.round(now - last));
      last = now;
      if (window.__perf.frames.length < 180) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, 420);
    await page.waitForTimeout(220);
  }
  const frames = await page.evaluate(() => window.__perf.frames.slice());
  const sorted = [...frames].sort((a, b) => a - b);
  const p = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;
  return {
    url,
    frames: frames.length,
    p50: p(0.5),
    p95: p(0.95),
    over32: frames.filter((f) => f > 32).length,
  };
}

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36',
});
await context.addInitScript(INSTRUMENT, [BASE, readToken()]);
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

const targets = process.argv[2]
  ? [[process.argv[2]]]
  : [['/mission'], ['/planner'], ['/chat']];

console.log(`\n=== ${LABEL}: typing (25 keys, 4x CPU, 390x844) ===`);
console.log('  screen      per-key   slow-events  worst   event-ms  DOM-mutations/key');
for (const [url] of targets) {
  const selector =
    url === '/mission' ? 'input[placeholder^="Add a task"]' :
    url === '/planner' ? 'input[placeholder="What needs doing?"]' :
    'textarea[placeholder^="Message"], textarea';
  try {
    const r = await typingRun(page, `${BASE}${url}`, selector, url === '/planner' ? 'NEW TASK' : undefined);
    console.log(
      `  ${url.padEnd(10)}  ${String(r.perKey).padStart(4)} ms   ${String(r.slowEvents).padStart(6)}      ${String(r.worstEvent).padStart(4)} ms  ${String(r.totalEventTime).padStart(6)}    ${r.mutationsPerKey}`,
    );
  } catch (err) {
    console.log(`  ${url.padEnd(10)}  skipped (${String(err.message).split('\n')[0].slice(0, 70)})`);
  }
}

console.log(`\n=== ${LABEL}: scroll frame times ===`);
console.log('  screen      frames  p50   p95   >32ms');
for (const [url] of targets) {
  try {
    const r = await scrollRun(page, `${BASE}${url}`, url === '/planner' ? 'NEW TASK' : undefined);
    console.log(`  ${url.padEnd(10)}  ${String(r.frames).padStart(6)}  ${String(r.p50).padStart(3)}   ${String(r.p95).padStart(3)}   ${r.over32}`);
  } catch (err) {
    console.log(`  ${url.padEnd(10)}  skipped (${String(err.message).split('\n')[0].slice(0, 70)})`);
  }
}

await browser.close();
