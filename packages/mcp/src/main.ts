import { loadRootEnv } from '@hermieos/domain';
import { serve } from '@hono/node-server';
import { buildMcpApp } from './server.js';
import { ToolRegistry } from './registry.js';
import { createLogger } from './logger.js';
import { registerObjectTools } from './tools/objects.js';
import { registerRelationshipAndSubscriptionTools } from './tools/misc.js';
import { registerNotifyTool } from './tools/notify.js';
import { registerRunsTool } from './tools/runs.js';
import { registerDashboardTools } from './tools/dashboard.js';

// Load repo-root .env for `pnpm dev:mcp`.
loadRootEnv();

const log = createLogger();
const port = Number(process.env.MCP_PORT ?? 3002);

const registry = new ToolRegistry();
registerObjectTools(registry);
registerRelationshipAndSubscriptionTools(registry);
registerNotifyTool(registry);
registerRunsTool(registry);
registerDashboardTools(registry);

const app = buildMcpApp(registry);

serve(
  { fetch: app.fetch, port },
  (info) => {
    log.info({ port: info.port, tools: registry.list().map((t) => t.name) }, 'mcp listening');
  },
);
