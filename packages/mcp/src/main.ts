import { z } from 'zod';
import { createObjectArgsSchema } from '@hermieos/domain';
import { Hono } from 'hono';
import { buildMcpApp } from './server.js';
import { ToolRegistry } from './registry.js';
import { createLogger } from './logger.js';

const log = createLogger();
const port = Number(process.env.MCP_PORT ?? 3002);

const registry = new ToolRegistry();

// Phase 1a: register a single noop tool so the auth + transport paths are
// exercised end to end. Real tools land in Phase 1b+.
const noopSchema = createObjectArgsSchema.partial().extend({ echo: z.string().optional() });
registry.register({
  name: 'noop_echo',
  description: 'Echo the input back. Used for smoke-testing the MCP transport.',
  schema: noopSchema,
  handler: async (ctx, args) => ({ ok: true, userId: ctx.userId, echo: args }),
});

const app = buildMcpApp(registry);

log.info({ port }, 'mcp listening');

export default {
  port,
  fetch: app.fetch,
};
