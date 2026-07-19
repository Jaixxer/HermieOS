import { Hono } from 'hono';
import { createLogger } from './logger.js';

const log = createLogger();
const app = new Hono();

app.get('/healthz', (c) => c.json({ status: 'ok', service: 'hermieos-mcp' }));

const port = Number(process.env.MCP_PORT ?? 3002);
log.info({ port }, 'mcp listening');

export default {
  port,
  fetch: app.fetch,
};
