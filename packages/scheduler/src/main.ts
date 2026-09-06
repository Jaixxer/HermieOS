import { loadRootEnv } from '@hermieos/domain';
import { HermesClient } from '@hermieos/gateway';
import { schedule, tickOnce } from './tick.js';
import { startRunTracker } from './run-tracker.js';
import { createLogger } from './logger.js';

// Load repo-root .env for `pnpm dev:scheduler`.
loadRootEnv();

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgres://hermieos:hermieos@localhost:15432/hermieos';
}

const log = createLogger();
const tickMs = Number(process.env.SCHEDULER_TICK_MS ?? 60_000);
const dryRun = process.env.SCHEDULER_DRY_RUN === '1' || process.env.SCHEDULER_DRY_RUN === 'true';
const oneShot = process.env.SCHEDULER_ONE_SHOT === '1' || process.env.SCHEDULER_ONE_SHOT === 'true';

const baseUrl = process.env.HERMES_GATEWAY_URL;
const apiKey = process.env.HERMES_API_KEY;
const runTrackerPollMs = Number(process.env.RUN_TRACKER_POLL_MS ?? 5_000);
const runDeadlineMs = Number(process.env.RUN_DEADLINE_MS ?? 5 * 60_000);

let client: HermesClient | null = null;
if (!dryRun && baseUrl && apiKey) {
  client = new HermesClient({
    baseUrl,
    apiKey,
    timeoutMs: Number(process.env.SCHEDULER_HTTP_TIMEOUT_MS ?? 10_000),
  });
} else if (!dryRun) {
  // eslint-disable-next-line no-console
  console.warn('SCHEDULER_DRY_RUN not set and HERMES_GATEWAY_URL / HERMES_API_KEY missing — falling back to dry-run.');
}

async function main(): Promise<void> {
  if (oneShot) {
    const summary = await tickOnce(client as HermesClient, { dryRun });
    log.info({ summary }, 'one-shot tick complete');
    process.exit(0);
  }

  if (!client) {
    throw new Error('cannot schedule without a Hermes client');
  }
  const handle = schedule(client, tickMs, { dryRun });
  log.info({ tickMs, dryRun }, 'scheduler started');

  // Run tracker runs alongside the tick loop. Same HermesClient,
  // same DB. Different SQL tables, no contention.
  const tracker = startRunTracker(client, {
    pollIntervalMs: runTrackerPollMs,
    deadlineMs: runDeadlineMs,
  });
  log.info({ pollMs: runTrackerPollMs, deadlineMs: runDeadlineMs }, 'run tracker started');

  const stop = (): void => {
    handle.stop();
    tracker.stop();
    log.info('scheduler stopped');
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
