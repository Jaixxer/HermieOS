import { buildApp } from './server.js';

const port = Number(process.env.API_PORT ?? 3001);
const host = process.env.API_HOST ?? '0.0.0.0';

async function main() {
  const app = await buildApp();
  await app.listen({ port, host });
  app.log.info({ port, host }, 'api listening');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
