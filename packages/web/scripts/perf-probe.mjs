/**
 * Phone-load harness.
 *
 * Measures what a phone actually pays to open a screen: bytes of JS/CSS, request
 * count, time to interactive-ish (key element painted), and long tasks — under
 * 4x CPU throttle and a 4G-ish link, because that is the situation the phone is
 * in. Run it before and after a change to see the difference rather than guess.
 *
 * Usage (from packages/web, needs the app served somewhere):
 *   node scripts/perf-probe.mjs /planner "NEW TASK"
 *   BASE_URL=http://127.0.0.1:3101 E2E_MCP_TOKEN=... node scripts/perf-probe.mjs / /
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3101';
const route = process.argv[2] ?? '/';
const readyText = process.argv[3] ?? '';
const LABEL = process.env.LABEL ?? 'run';

function readToken() {
  if (process.env.E2E_MCP_TOKEN) return process.env.E2E_MCP_TOKEN;
  const raw = readFileSync(join(homedir(), '.hermes', '.env'), 'utf8');
  const line = raw.split('\n').find((l) => l.startsWith('MCP_HERMIEOS_API_KEY='));
  if (!line) throw new Error('no MCP token');
  return line.slice('MCP_HERMIEOS_API_KEY='.length).trim();
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
await context.addInitScript(
  ([base, token]) => {
    try {
      localStorage.setItem('hermieos_server_url', base);
      localStorage.setItem('hermieos_mcp_token', token);
      localStorage.setItem('hermieos_api_base', base);
      // capture long tasks + paint timings for the probe
      window.__longTasks = [];
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) window.__longTasks.push(Math.round(e.duration));
      }).observe({ entryTypes: ['longtask'] });
    } catch {
      /* ignore */
    }
  },
  [BASE, readToken()],
);

const page = await context.newPage();
const cdp = await context.newCDPSession(page);
// Mid-range phone, mid-range link.
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
await cdp.send('Network.emulateNetworkConditions', {
  offline: false,
  latency: 120,
  downloadThroughput: (1.6 * 1024 * 1024) / 8,
  uploadThroughput: (750 * 1024) / 8,
});

const t0 = Date.now();
await page.goto(`${BASE}${route}`, { waitUntil: 'load' });
const loadMs = Date.now() - t0;

let readyMs = null;
if (readyText) {
  try {
    await page.getByText(readyText, { exact: false }).first().waitFor({ timeout: 30000 });
    readyMs = Date.now() - t0;
  } catch {
    readyMs = -1;
  }
}

const metrics = await page.evaluate(() => {
  const resources = performance.getEntriesByType('resource');
  const sumBy = (pred) =>
    resources
      .filter(pred)
      .reduce((acc, r) => acc + (r.encodedBodySize || r.transferSize || 0), 0);
  const nav = performance.getEntriesByType('navigation')[0];
  return {
    jsBytes: sumBy((r) => /\.js(\?|$)/.test(r.name)),
    cssBytes: sumBy((r) => /\.css(\?|$)/.test(r.name)),
    imgBytes: sumBy((r) => /\.(png|jpe?g|webp|svg)(\?|$)/.test(r.name)),
    fontBytes: sumBy((r) => /\.(woff2?|ttf)(\?|$)/.test(r.name)),
    requests: resources.length,
    jsRequests: resources.filter((r) => /\.js(\?|$)/.test(r.name)).length,
    domContentLoaded: Math.round(nav?.domContentLoadedEventEnd ?? 0),
    domInteractive: Math.round(nav?.domInteractive ?? 0),
    longTasks: (window.__longTasks ?? []).length,
    longestTask: Math.max(0, ...(window.__longTasks ?? [])),
  };
});

const kb = (n) => `${(n / 1024).toFixed(0)} kB`;
console.log(`\n=== ${LABEL} — ${route} @ 390x844, 4x CPU, ~1.6 Mbps ===`);
console.log(`  JS            ${kb(metrics.jsBytes)} in ${metrics.jsRequests} requests`);
console.log(`  CSS           ${kb(metrics.cssBytes)}`);
console.log(`  images        ${kb(metrics.imgBytes)}`);
console.log(`  fonts         ${kb(metrics.fontBytes)}`);
console.log(`  requests      ${metrics.requests}`);
console.log(`  DOM interactive ${metrics.domInteractive} ms`);
console.log(`  load          ${metrics.domContentLoaded} ms (wall ${loadMs} ms)`);
if (readyMs !== null) console.log(`  ready ("${readyText}") ${readyMs === -1 ? 'NOT FOUND' : `${readyMs} ms`}`);
console.log(`  long tasks    ${metrics.longTasks} (longest ${metrics.longestTask} ms)`);

await browser.close();
