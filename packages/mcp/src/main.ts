import { Hono } from 'hono';
import { buildMcpApp } from './server.js';
import { ToolRegistry } from './registry.js';
import { createLogger } from './logger.js';
import { registerObjectTools } from './tools/objects.js';

const log = createLogger();
const port = Number(process.env.MCP_PORT ?? 3002);

const registry = new ToolRegistry();
registerObjectTools(registry);
// relationship/feed/notify tools land in Phase 1d/1e.

const app = buildMcpApp(registry);

log.info({ port, tools: registry.list().map((t) => t.name) }, 'mcp listening');

export default {
  port,
  fetch: app.fetch,
};
