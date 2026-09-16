import { defineConfig } from '@playwright/test';

/**
 * E2E config.
 *
 * Two ways to run:
 *  1. Default — boots the vite dev server on :5173 and drives that. The specs
 *     bootstrap users through `POST /api/auth/signup`, so the API behind the
 *     proxy must have SIGNUP_ENABLED=true.
 *  2. `E2E_BASE_URL=<origin>` — targets an already-running server (the
 *     API-served production bundle, e.g. http://127.0.0.1:3101) and does NOT
 *     boot the dev server. Use this on a small box: the dev server plus a
 *     browser is enough to starve the renderer.
 */
const EXTERNAL_BASE = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: EXTERNAL_BASE ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  webServer: EXTERNAL_BASE
    ? undefined
    : {
        command: 'pnpm dev',
        url: 'http://localhost:5173',
        reuseExistingServer: true,
        timeout: 30_000,
      },
});
