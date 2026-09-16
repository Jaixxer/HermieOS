import { test, expect } from '@playwright/test';
import { randomBytes } from 'node:crypto';

/**
 * Planner (/planner) — day scheduling, deadlines, delegation briefs and the
 * shared progress log.
 *
 * Auth note: signup is gated off on a hardened server (`SIGNUP_ENABLED`), so
 * this spec drives the app's MCP-token connection mode instead of creating a
 * user through the API. Set E2E_MCP_TOKEN to a token for a user on the running
 * server (and E2E_API_BASE if the API is not on :3101); the spec skips cleanly
 * without one. Anything it creates is archived again at the end.
 *
 * Why /planner and not /tasks: the API owns GET /tasks (the JSON list), so the
 * page route deliberately avoids that path — a hard load of /tasks returns
 * JSON, not the app.
 */

const TOKEN = process.env.E2E_MCP_TOKEN ?? '';
const API_BASE = process.env.E2E_API_BASE ?? 'http://127.0.0.1:3101';

test.skip(!TOKEN, 'set E2E_MCP_TOKEN to run the planner spec');

// The dev server optimizes deps and HMR-reloads on first load, which can tear
// the page out from under Playwright mid-run — warm it up first and allow for
// the cold start on a small box.
test.setTimeout(120_000);
test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await page.goto('/');
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.waitForTimeout(2000);
  await page.close();
});

const localDatetime = (offsetHours: number): string => {
  const d = new Date(Date.now() + offsetHours * 3600_000);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

test('planner schedules a task to a day, logs progress and shows the deadline', async ({ page, request }) => {
  const title = `e2e planner ${randomBytes(3).toString('hex')}`;
  const guidance = 'e2e: keep it to one page and stop before submitting.';
  const update = 'e2e: first progress entry';

  await page.addInitScript(
    ([base, token]) => {
      localStorage.setItem('hermieos_server_url', base);
      localStorage.setItem('hermieos_mcp_token', token);
      localStorage.setItem('hermieos_api_base', base);
    },
    [API_BASE, TOKEN],
  );

  try {
    // 1. The page renders (hard load — the deep-link path must serve the SPA).
    await page.goto('/planner');
    await expect(page.getByText('NEW TASK')).toBeVisible();
    await expect(page.locator('button[aria-pressed]')).toHaveCount(7); // Mon..Sun

    // 2. Create a task: assigned to today, with a deadline two hours out and
    //    a standing brief for Hermes.
    await page.getByPlaceholder('What needs doing?').fill(title);
    await page.locator('input[type="datetime-local"]').first().fill(localDatetime(2));
    await page.getByRole('button', { name: /NOTES & GUIDANCE FOR HERMES/i }).click();
    await page.getByPlaceholder(/How should Hermes go about this/i).fill(guidance);
    await page.getByRole('button', { name: /ADD TASK/i }).click();

    const card = page.locator('li', { hasText: title }).first();
    await expect(card).toBeVisible();
    await expect(card.getByText(/DEADLINE TODAY/i)).toBeVisible();
    await expect(card.getByText(/^ON /)).toBeVisible();

    // 3. Progress: a note plus a percent, both attributed to the user.
    await card.getByRole('button', { name: 'Show progress log' }).click();
    await card.getByPlaceholder(/What moved\? What's left\?/).fill(update);
    await card.locator('input[type="number"]').fill('25');
    await card.getByRole('button', { name: /LOG UPDATE/i }).click();

    await expect(card.getByText(update, { exact: true })).toBeVisible();
    await expect(card.getByText('YOU', { exact: true }).first()).toBeVisible();
    await expect(card.getByText('25%', { exact: true }).first()).toBeVisible();
    await expect(card.getByText(guidance)).toBeVisible();

    // 4. It also lands on today's board, with the deadline and progress.
    await page.goto('/mission');
    await expect(page.getByRole('heading', { name: /today's mission/i })).toBeVisible();
    await expect(page.getByText(title)).toBeVisible();
    await expect(page.getByText(/DEADLINE (TODAY|TOMORROW)/i).first()).toBeVisible();

    // 5. The other views resolve: delegated (empty for this task) and the
    //    30-day deadline view (which must list it).
    await page.goto('/planner');
    await page.getByRole('button', { name: /DEADLINES 30D/i }).click();
    await expect(page.getByText(title)).toBeVisible();
    await page.getByRole('button', { name: /DELEGATED/i }).click();
    await expect(page.getByText(title)).not.toBeVisible();
  } finally {
    // Cleanup: archive whatever this spec created.
    const list = await request.get(`${API_BASE}/tasks?status=todo&limit=200`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    if (list.ok()) {
      const body = (await list.json()) as { tasks?: Array<{ id: string; title: string }> };
      for (const t of body.tasks ?? []) {
        if (t.title === title) {
          await request.delete(`${API_BASE}/tasks/${t.id}`, { headers: { authorization: `Bearer ${TOKEN}` } });
        }
      }
    }
    const inProgress = await request.get(`${API_BASE}/tasks?status=in_progress&limit=200`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    if (inProgress.ok()) {
      const body = (await inProgress.json()) as { tasks?: Array<{ id: string; title: string }> };
      for (const t of body.tasks ?? []) {
        if (t.title === title) {
          await request.delete(`${API_BASE}/tasks/${t.id}`, { headers: { authorization: `Bearer ${TOKEN}` } });
        }
      }
    }
  }
});
