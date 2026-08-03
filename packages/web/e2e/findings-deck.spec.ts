import { test, expect } from '@playwright/test';
import { randomBytes } from 'node:crypto';

// Covers the findings deck (/scouting/findings) and the finding
// conversation (/objects/:id/discuss) with an immediate follow-up.
//
// Requires a running API + web dev server, plus a reachable Hermes
// gateway (the follow-up chat call is exercised against the gateway
// that the API is configured with; if the gateway is unreachable the
// follow-up returns 503 and the test still verifies the error path).
test('findings deck renders and a follow-up starts a finding conversation', async ({ page, request }) => {
  const email = `e2e-deck-${randomBytes(4).toString('hex')}@hermieos.local`;
  const password = 'correct-horse-battery';

  // 1. bootstrap a user via the API to obtain an MCP token
  const signupRes = await request.post('/api/auth/signup', {
    data: { email, password, displayName: 'E2E Deck User' },
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
  await expect(page.getByRole('heading', { name: /feed/i })).toBeVisible();

  // 3. seed findings via the API
  const objRes = await request.post('/api/objects', {
    headers: { authorization: `Bearer ${signupBody.mcpToken}` },
    data: {
      type: 'research',
      title: `Deck paper ${randomBytes(3).toString('hex')}`,
      summary: 'An e2e research finding about agent tool use.',
      body: { url: 'https://arxiv.org/abs/9999.99999', kind: 'research_paper', stars: 7 },
      tags: ['e2e'],
    },
  });
  expect(objRes.ok()).toBeTruthy();
  const objBody = (await objRes.json()) as { object: { id: string; title: string } };

  // 4. the deck renders the finding as a card
  await page.goto('/scouting/findings');
  await expect(page.getByText(objBody.title)).toBeVisible();
  await expect(page.getByText('Research')).toBeVisible();

  // 5. the deck card links to the finding conversation
  await page.getByRole('link', { name: /Discuss/ }).first().click();
  await expect(page).toHaveURL(/\/objects\/.+\/discuss/);

  // The hero card pins the finding context.
  await expect(page.getByText(objBody.title)).toBeVisible();

  // 6. a follow-up is dispatched: either the chat lands (gateway up) or
  //    the gateway error is surfaced — the composer must send either way.
  const composer = page.getByPlaceholder(/Raw feedback|Describe the deep work/);
  await composer.fill('Summarize this paper for a beginner.');
  await page.keyboard.press('Enter');
  await expect(
    page.getByText(/Sent\.|Hermes is on it\.|Dispatched as a background research run|is not configured/i),
  ).toBeVisible({ timeout: 30_000 });
});
