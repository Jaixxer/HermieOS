import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { rotateMcpToken, setSchedulerEnabled } from '../data/auth.js';
import { BadRequest, Unauthorized, sendError } from '../errors.js';

const schedulerBodySchema = z.object({
  enabled: z.boolean(),
});

export async function registerMeRoutes(app: FastifyInstance): Promise<void> {
  // GET /me — current user
  app.get('/me', async (req, reply) => {
    if (!req.user) {
      return sendError(reply, new Unauthorized(), String(req.id));
    }
    return { user: req.user };
  });

  // PATCH /me/scheduler — toggle the pause flag
  app.patch('/me/scheduler', async (req, reply) => {
    if (!req.user) {
      return sendError(reply, new Unauthorized(), String(req.id));
    }
    const parsed = schedulerBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(reply, new BadRequest('invalid_input', parsed.error.flatten()), String(req.id));
    }
    await setSchedulerEnabled(req.user.id, parsed.data.enabled);
    return { user: { ...req.user, schedulerEnabled: parsed.data.enabled } };
  });

  // POST /me/mcp-token/rotate — rotate the per-user MCP bearer token.
  // Returns the new token once. The user must update their Hermes profile.
  app.post('/me/mcp-token/rotate', async (req, reply) => {
    if (!req.user) {
      return sendError(reply, new Unauthorized(), String(req.id));
    }
    const { mcpToken } = await rotateMcpToken(req.user.id);
    return { mcpToken };
  });
}
