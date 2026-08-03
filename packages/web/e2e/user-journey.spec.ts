import { test, expect } from '@playwright/test';
import { randomBytes } from 'node:crypto';

test('user journey: signup via API → connect → create an object via API → see it on the feed → object detail → settings', async ({ page, request }) => {
  const email = `e2e-${randomBytes(4).toString('hex')}@hermieos.local`;
  const password = 'correct-horse-battery';

  // 1. bootstrap a user via the API to obtain an MCP token
  const signupRes = await request.post('/api/auth/signup', {
    data: { email, password, displayName: 'E2E User' },
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

  // 3. create an object via the API (MCP token is the bearer credential)
  const createRes = await request.post('/api/objects', {
    headers: { authorization: `Bearer ${signupBody.mcpToken}` },
    data: { type: 'project', title: 'e2e-Project', summary: 'created in playwright', body: { note: 'from e2e' } },
  });
  expect(createRes.ok()).toBeTruthy();
  const createBody = (await createRes.json()) as { object: { id: string; title: string } };
  expect(createBody.object.title).toBe('e2e-Project');

  // 4. navigate to the feed page and find the object
  await page.goto('/feed');
  await expect(page.getByRole('heading', { name: /feed/i })).toBeVisible();
  const card = page.getByRole('link', { name: /e2e-Project/i });
  await expect(card.first()).toBeVisible();

  // 5. open the object detail page directly
  await page.goto(`/objects/${createBody.object.id}`);
  await expect(page.getByRole('heading', { name: /e2e-Project/i })).toBeVisible();

  // 5. settings page: pause toggle
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: /settings/i })).toBeVisible();
  await page.getByRole('button', { name: /pause hermes/i }).click();
  await expect(page.getByText(/paused/i).first()).toBeVisible();
  await page.getByRole('button', { name: /resume hermes/i }).click();
  await expect(page.getByText(/running/i).first()).toBeVisible();
});
