import { buildApp } from './server.js';
import { createLogger } from './logger.js';

const log = createLogger();

// Default DATABASE_URL for local development; production should set it explicitly.
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgres://hermieos:hermieos@localhost:5432/hermieos';
}
if (!process.env.COOKIE_SECRET) {
  process.env.COOKIE_SECRET = 'dev-only-cookie-secret-change-me';
}

const port = Number(process.env.API_PORT ?? process.env.PORT ?? 3001);
const host = process.env.API_HOST ?? '0.0.0.0';

async function main(): Promise<void> {
  const app = await buildApp();
  await app.listen({ port, host });
  log.info({ port, host }, 'api listening');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
