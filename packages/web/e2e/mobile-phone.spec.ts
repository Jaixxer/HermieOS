import { test, expect, devices } from '@playwright/test';
import { randomBytes } from 'node:crypto';

/**
 * Phone usability + calendar agenda.
 *
 * Runs on a real phone viewport (390x844, touch, 3x DPR) against a running
 * server, and asserts the things that make a screen usable with a thumb:
 * no horizontal overflow, 44 px tap targets, a composer that fits, and a
 * calendar that tells you WHAT is due on a day rather than only how many.
 *
 * Auth: MCP-token mode (see planner.spec.ts). Needs E2E_MCP_TOKEN; skips
 * without it. Anything it creates is archived in the cleanup step.
 */
const TOKEN = process.env.E2E_MCP_TOKEN ?? '';
const API_BASE = process.env.E2E_API_BASE ?? 'http://127.0.0.1:3101';

test.skip(!TOKEN, 'set E2E_MCP_TOKEN to run the phone spec');

// Several page loads on a slow box (plus lazy route chunks) — the default 30 s
// is not enough for the whole journey.
test.setTimeout(180_000);
test.use({ ...devices['Pixel 8'], viewport: { width: 390, height: 844 } });

const dayKey = (offset = 0): string => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const localDatetime = (offsetHours: number): string => {
  const d = new Date(Date.now() + offsetHours * 3600_000);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** Everything must fit the viewport: an app that scrolls sideways on a phone
 *  is the classic "unusable on mobile" symptom. */
async function expectNoHorizontalOverflow(page: import('@playwright/test').Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    win: window.innerWidth,
  }));
  expect(
    overflow.doc,
    `document scrollWidth ${overflow.doc} exceeds viewport ${overflow.win} — the page scrolls sideways`,
  ).toBeLessThanOrEqual(overflow.win + 1);
}

/** Thumb-sized targets: anything the user taps in the main flow must be >= 44px. */
async function expectTapTargets(page: import('@playwright/test').Page, labels: string[]): Promise<void> {
  for (const label of labels) {
    const el = page.getByRole('button', { name: label }).first();
    if ((await el.count()) === 0) continue; // not on this screen
    const box = await el.boundingBox();
    expect(box, `${label} has no layout box`).not.toBeNull();
    const smallest = Math.min(box!.width, box!.height);
    expect(smallest, `${label} is ${Math.round(box!.width)}x${Math.round(box!.height)} — under 44px`).toBeGreaterThanOrEqual(44);
  }
}

test('planner and calendar are usable with a thumb', async ({ page, request }) => {
  const title = `phone e2e ${randomBytes(3).toString('hex')}`;

  await page.addInitScript(
    ([base, token]) => {
      localStorage.setItem('hermieos_server_url', base);
      localStorage.setItem('hermieos_mcp_token', token);
      localStorage.setItem('hermieos_api_base', base);
    },
    [API_BASE, TOKEN],
  );

  try {
    // ---- planner ------------------------------------------------------
    await page.goto('/planner');
    await expect(page.getByText('NEW TASK')).toBeVisible({ timeout: 30000 });
    await expectNoHorizontalOverflow(page);

    // the week strip is a swipeable row of day cells, and the last one is reachable
    const dayCells = page.locator('button[aria-pressed]');
    await expect(dayCells).toHaveCount(7);
    const lastCell = dayCells.nth(6);
    await lastCell.scrollIntoViewIfNeeded();
    await expect(lastCell).toBeVisible();
    await lastCell.click();
    await expect(lastCell).toHaveAttribute('aria-pressed', 'true');
    // Back to today's board before creating anything (the strip is Mon..Sun).
    const todayIdx = (new Date().getDay() + 6) % 7;
    await dayCells.nth(todayIdx).click();
    await expect(dayCells.nth(todayIdx)).toHaveAttribute('aria-pressed', 'true');

    // create a task assigned to today (with a deadline) — the composer must be
    // fully operable at phone width
    await page.getByPlaceholder('What needs doing?').fill(title);
    await page.locator('input[type="date"]').first().fill(dayKey(0));
    await page.locator('input[type="datetime-local"]').first().fill(localDatetime(2));
    await expectTapTargets(page, ['ADD TASK']);
    await page.getByRole('button', { name: /ADD TASK/i }).click();

    const card = page.locator('li', { hasText: title }).first();
    await expect(card).toBeVisible({ timeout: 20000 });
    await expect(card.getByText(/DEADLINE TODAY/i)).toBeVisible();
    await expectTapTargets(page, ['Mark as done', 'Delegate to Hermes', 'Archive task', 'Show progress log']);

    // log progress with a thumb
    await card.getByRole('button', { name: 'Show progress log' }).click();
    await card.getByPlaceholder(/What moved\? What's left\?/).fill('phone e2e progress');
    await card.locator('input[type="number"]').fill('35');
    await card.getByRole('button', { name: /LOG UPDATE/i }).click();
    await expect(card.getByText('phone e2e progress').first()).toBeVisible({ timeout: 20000 });
    await expectNoHorizontalOverflow(page);

    // ---- calendar: a day must say WHAT is due, not just how many ------
    await page.goto('/calendar');
    await expect(page.getByText('SELECTED DAY')).toBeVisible({ timeout: 30000 });
    await expectNoHorizontalOverflow(page);

    // The agenda under the month grid lists the day's items with their titles.
    const agenda = page.getByTestId('day-agenda');
    await expect(agenda.getByText(title)).toBeVisible({ timeout: 20000 });
    await expect(agenda.getByText(/TASK|PLANNED/).first()).toBeVisible();

    // Tapping an empty day switches the agenda and says so plainly.
    const emptyDay = page.locator('[data-day]').nth(41);
    await emptyDay.scrollIntoViewIfNeeded();
    await emptyDay.click();
    await expect(page.getByText('NOTHING ON THIS DAY.')).toBeVisible();

    // back to today: the task is listed again (scoped to the agenda — the
    // desktop chips for the same day are in the DOM but hidden at this width)
    await page.locator(`[data-day="${dayKey(0)}"]`).click();
    await expect(page.getByTestId('day-agenda').getByText(title)).toBeVisible();

    // ---- today's mission on a phone -----------------------------------
    await page.goto('/mission');
    await expect(page.getByRole('heading', { name: /today's mission/i })).toBeVisible({ timeout: 30000 });
    await expectNoHorizontalOverflow(page);
    const ticket = page.locator('li', { hasText: title }).first();
    await expect(ticket).toBeVisible({ timeout: 20000 });
    await expect(ticket.getByText(/DEADLINE TODAY/i)).toBeVisible();
    await expect(ticket.getByText('35% DONE')).toBeVisible();
    await expectTapTargets(page, ['Mark as done', 'Delegate to Hermes', 'Archive task']);
  } finally {
    // Cleanup — archive whatever this run created.
    for (const status of ['todo', 'in_progress']) {
      const list = await request.get(`${API_BASE}/tasks?status=${status}&limit=200`, {
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      if (!list.ok()) continue;
      const body = (await list.json()) as { tasks?: Array<{ id: string; title: string }> };
      for (const t of body.tasks ?? []) {
        if (t.title === title) {
          await request.delete(`${API_BASE}/tasks/${t.id}`, { headers: { authorization: `Bearer ${TOKEN}` } });
        }
      }
    }
  }
});
