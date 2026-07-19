import { Hono } from 'hono';
import { buildMcpApp } from './server.js';
import { ToolRegistry } from './registry.js';
import { createLogger } from './logger.js';
import { registerObjectTools } from './tools/objects.js';
import { registerRelationshipAndSubscriptionTools } from './tools/misc.js';

const log = createLogger();
const port = Number(process.env.MCP_PORT ?? 3002);

const registry = new ToolRegistry();
registerObjectTools(registry);
registerRelationshipAndSubscriptionTools(registry);
// notify_user (Phase 1e) and get_recent_runs (Phase 1f) come next.

const app = buildMcpApp(registry);

log.info({ port, tools: registry.list().map((t) => t.name) }, 'mcp listening');

export default {
  port,
  fetch: app.fetch,
};
