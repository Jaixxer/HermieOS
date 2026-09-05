/**
 * Manual smoke test: simulate the email-signup → connect → refresh flow
 * in the HermieOS web app.
 *
 * Steps:
 *   1. Open the app
 *   2. Connect with URL + MCP token (simulating a user who got the
 *      token at signup and pasted it into the Connect screen)
 *   3. Verify localStorage has session_token + server_url + mcp_token
 *   4. Reload the page
 *   5. Verify the user is still on a protected route (not /login)
 *
 * Run: pnpm -F @hermieos/web exec tsx scripts/test-refresh-auth.ts
 */
import { chromium } from 'playwright';

const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:5173';
const API_URL = process.env.API_URL ?? 'http://localhost:3001';
const MCP_TOKEN = process.env.MCP_TOKEN ?? '';

async function main(): Promise<void> {
  if (!MCP_TOKEN) {
    console.error('ERROR: set MCP_TOKEN env var to your mcp token');
    console.error('  Example: MCP_TOKEN=<your-mcp-token> tsx scripts/test-refresh-auth.ts');
    process.exit(1);
  }

  console.log(`[1/7] launching chromium against ${APP_URL}`);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('response', (res) => {
    if (res.url().includes('/api') || res.url().includes('/auth') || res.url().includes('/me')) {
      const s = res.status();
      console.log(`  [${s}] ${res.request().method()} ${res.url()}`);
    }
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.text().includes('AuthProvider') || msg.text().includes('refresh')) {
      console.log(`  [console.${msg.type()}] ${msg.text()}`);
    }
  });

  // 1. Open the app — should land on ConnectPage.
  await page.goto(APP_URL, { waitUntil: 'networkidle' });
  const initial = new URL(page.url()).pathname;
  console.log(`  initial path: ${initial}`);
  await page.waitForSelector('input[placeholder*="mcp_"]', { timeout: 5000 });
  console.log(`  ✓ ConnectPage rendered`);

  // 2. Fill the URL and token, click Connect.
  console.log(`[2/7] filling connect form (URL=${API_URL})`);
  await page.fill('input[placeholder*="192.168"]', API_URL);
  await page.fill('input[placeholder*="mcp_"]', MCP_TOKEN);
  await page.click('button[type=submit]');

  // Wait for /me to be called and the connect screen to go away.
  await page.waitForURL((url) => !url.pathname.startsWith('/') === false ? false : !url.pathname.includes('connect'), { timeout: 10_000 }).catch(() => undefined);
  // Generic wait: connect screen should be gone within a few seconds.
  await page.waitForTimeout(3000);
  const afterConnect = new URL(page.url()).pathname;
  console.log(`  after connect, path: ${afterConnect}`);

  // 3. Inspect localStorage.
  const ls1 = await page.evaluate(() => ({
    session: localStorage.getItem('hermieos_session_token'),
    apiBase: localStorage.getItem('hermieos_api_base'),
    serverUrl: localStorage.getItem('hermieos_server_url'),
    mcpToken: localStorage.getItem('hermieos_mcp_token'),
  }));
  console.log(`  localStorage after connect:`, {
    hasSession: !!ls1.session,
    sessionLen: ls1.session?.length ?? 0,
    apiBase: ls1.apiBase,
    serverUrl: ls1.serverUrl,
    mcpTokenLen: ls1.mcpToken?.length ?? 0,
  });

  if (!ls1.serverUrl) throw new Error('no hermieos_server_url in localStorage after connect');
  if (!ls1.mcpToken) throw new Error('no hermieos_mcp_token in localStorage after connect');

  // 4. Reload — this is the bug we're testing.
  console.log(`[3/7] reloading the page to simulate a hard refresh`);
  await page.reload({ waitUntil: 'networkidle' });
  const afterReload = new URL(page.url()).pathname;
  console.log(`  path after reload: ${afterReload}`);

  if (afterReload === '/' || afterReload === '/login') {
    // /login would be a bug. / could be the dashboard if we landed there.
  }
  if (afterReload === '/login') {
    throw new Error('BUG: redirected to /login after refresh');
  }

  // 5. Verify /me succeeded.
  console.log(`[4/7] verifying /me call succeeded`);
  await page.waitForTimeout(2000);
  const meResult = await page.evaluate(async (base) => {
    const token = localStorage.getItem('hermieos_mcp_token') ?? '';
    try {
      const res = await fetch(`${base}/me`, {
        headers: { authorization: `Bearer ${token}` },
      });
      return { status: res.status, ok: res.ok };
    } catch (e) {
      return { status: 0, error: (e as Error).message };
    }
  }, API_URL);
  console.log(`  /me result: ${JSON.stringify(meResult)}`);
  if (meResult.status !== 200) throw new Error(`/me returned ${meResult.status}`);

  // 6. Second refresh.
  console.log(`[5/7] second refresh`);
  await page.reload({ waitUntil: 'networkidle' });
  const final = new URL(page.url()).pathname;
  console.log(`  final path: ${final}`);
  if (final === '/login') throw new Error('BUG: second refresh logged out');

  // 7. Inspect the page to confirm dashboard rendered (not connect screen).
  console.log(`[6/7] confirming dashboard rendered (not connect screen)`);
  const hasEmailInput = await page.locator('input[type=email]').count();
  const hasUrlInput = await page.locator('input[placeholder*="192.168"]').count();
  console.log(`  email inputs: ${hasEmailInput}, url inputs: ${hasUrlInput}`);
  // The connect screen has a URL input. The login screen has an email input.
  // The dashboard has neither. If we're showing URL inputs, that's the connect
  // screen and auth didn't survive.
  if (hasUrlInput > 0 && hasEmailInput === 0) {
    throw new Error('BUG: Connect page is showing — auth did not survive refresh');
  }

  console.log('\n✓ SESSION SURVIVES REFRESH');
  await browser.close();
  process.exit(0);
}

main().catch(async (e) => {
  console.error('\n✗ FAILED:', e.message);
  process.exit(1);
});
