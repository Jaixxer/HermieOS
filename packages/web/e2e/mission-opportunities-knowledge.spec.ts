import { test, expect } from '@playwright/test';
import { randomBytes } from 'node:crypto';

// Covers the Phase 10 pages: Mission (/mission), Opportunities (/opportunities),
// and Knowledge (/knowledge). Requires a running API + web dev server.
//
// Flow: bootstrap a user via the API to get an MCP token, connect through the
// ConnectPage (the app gates all routes behind a server connection), then seed
// data and exercise the three pages.
test('mission, opportunities, knowledge pages render and interact', async ({ page, request }) => {
  const email = `e2e-mok-${randomBytes(4).toString('hex')}@hermieos.local`;
  const password = 'correct-horse-battery';

  // 1. bootstrap a user via the API to obtain an MCP token
  const signupRes = await request.post('/api/auth/signup', {
    data: { email, password, displayName: 'E2E Mission User' },
  });
  expect(signupRes.ok()).toBeTruthy();
  const signupBody = (await signupRes.json()) as { mcpToken: string };
  expect(signupBody.mcpToken).toMatch(/^mcp_/);

  // 2. connect through the ConnectPage using the MCP token
  await page.goto('/');
  await expect(page.getByText(/connect to your hermieos server using your mcp token/i)).toBeVisible();
  await page.getByPlaceholder('http://192.168.1.50:3001').fill('http://localhost:3001');
  await page.getByPlaceholder('mcp_a1b2c3d4...').fill(signupBody.mcpToken);
  await page.getByRole('button', { name: /connect/i }).click();

  // lands on the dashboard after a successful connect
  await expect(page.getByRole('heading', { name: /feed/i })).toBeVisible();

  // 3. seed tasks, an opportunity object, and a research object via the API
  // (the connect flow stored the MCP token as the bearer credential)
  const taskRes = await request.post('/api/tasks', {
    headers: { authorization: `Bearer ${signupBody.mcpToken}` },
    data: { title: 'e2e mission task', category: 'work' },
  });
  expect(taskRes.ok()).toBeTruthy();

  const oppRes = await request.post('/api/objects', {
    headers: { authorization: `Bearer ${signupBody.mcpToken}` },
    data: {
      type: 'opportunity',
      title: 'e2e opportunity',
      summary: 'found by playwright',
      status: 'open',
      body: { kind: 'job' },
    },
  });
  expect(oppRes.ok()).toBeTruthy();

  const objRes = await request.post('/api/objects', {
    headers: { authorization: `Bearer ${signupBody.mcpToken}` },
    data: {
      type: 'research',
      title: 'e2e research note',
      summary: 'a knowledge item',
      status: 'active',
      body: { methodology: 'e2e' },
    },
  });
  expect(objRes.ok()).toBeTruthy();

  // 4. Mission page: shows the seeded task.
  await page.goto('/mission');
  await expect(page.getByRole('heading', { name: /today's mission/i })).toBeVisible();
  await expect(page.getByText('e2e mission task')).toBeVisible();

  // Defer the task to tomorrow, then confirm it no longer shows as today's.
  await page.getByRole('button', { name: 'Defer to tomorrow' }).click();
  await expect(page.getByText('e2e mission task')).not.toBeVisible();

  // 5. Opportunities page: shows the seeded opportunity with a feedback loop.
  await page.goto('/opportunities');
  await expect(page.getByRole('heading', { name: /opportunities/i })).toBeVisible();
  await expect(page.getByText('e2e opportunity')).toBeVisible();
  await page.getByRole('button', { name: /like/i }).first().click();
  await expect(page.getByText('e2e opportunity')).toBeVisible();

  // 6. Knowledge page: search finds the research object.
  await page.goto('/knowledge');
  await expect(page.getByRole('heading', { name: 'Knowledge', exact: true })).toBeVisible();
  await page.getByPlaceholder(/search projects/i).fill('e2e research');
  await expect(page.getByText('e2e research note')).toBeVisible();
  await page.getByRole('link', { name: /e2e research note/i }).click();
  await expect(page.getByRole('heading', { name: /e2e research note/i })).toBeVisible();
});
