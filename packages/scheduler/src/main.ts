import { HermesClient } from './hermes-client.js';
import { schedule, tickOnce } from './tick.js';
import { createLogger } from './logger.js';

const log = createLogger();
const tickMs = Number(process.env.SCHEDULER_TICK_MS ?? 60_000);
const dryRun = process.env.SCHEDULER_DRY_RUN === '1' || process.env.SCHEDULER_DRY_RUN === 'true';
const oneShot = process.env.SCHEDULER_ONE_SHOT === '1' || process.env.SCHEDULER_ONE_SHOT === 'true';

const baseUrl = process.env.HERMES_GATEWAY_URL;
const apiKey = process.env.HERMES_API_KEY;

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

  const stop = (): void => {
    handle.stop();
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
