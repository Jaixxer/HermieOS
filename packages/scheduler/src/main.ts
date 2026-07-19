import { Scheduler } from './scheduler.js';
import { createLogger } from './logger.js';

const log = createLogger();
const tickMs = Number(process.env.SCHEDULER_TICK_MS ?? 60_000);
const s = new Scheduler(async () => {
  log.info('tick (placeholder)');
});

log.info({ tickMs }, 'scheduler starting');
s.start(tickMs);

// Keep the process alive
process.on('SIGINT', () => {
  log.info('scheduler stopping (SIGINT)');
  s.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  log.info('scheduler stopping (SIGTERM)');
  s.stop();
  process.exit(0);
});
