/**
 * Finding conversation routes.
 *
 * A "finding conversation" is a Hermes gateway chat session whose id is
 * deterministically derived from the finding's object id:
 *
 *     finding-<objectId>
 *
 * Because the id is deterministic, the same conversation is resumed on
 * every visit — no mapping table in our DB. Sessions and messages are
 * owned by the Hermes gateway's own store; HermieOS only references
 * them and seeds context into the first message.
 *
 * POST /objects/:id/follow-up — record the user's raw feedback as a
 *   `suggest` row (so the ranking loop learns), then either post the
 *   message into the finding's chat session (default, immediate) or
 *   dispatch a tracked background `research` run (runInBackground).
 * GET  /objects/:id/discuss  — does a conversation already exist?
 *   Returns the session id + whether it exists.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HermesClient } from '@hermieos/gateway';
import { getObject } from '@hermieos/mcp/src/data/objects.js';
import { ensureGatewaySession, gatewayFromEnv } from '../gateway-sessions.js';
import { recordFeedback } from '@hermieos/mcp/src/data/feedback.js';
import { createRun, markRunDispatched } from '@hermieos/mcp/src/data/runs.js';
import {
  BadRequest,
  NotFound,
  ServiceUnavailable,
  Unauthorized,
  sendError,
} from '../errors.js';

const followUpBodySchema = z.object({
  message: z.string().min(1).max(5000),
  runInBackground: z.boolean().optional().default(false),
});

const HERMIEOS_WORKER_INSTRUCTIONS =
  'You are the HermieOS background worker. Load the `hermieos` skill with skill_view("hermieos") and follow its instructions exactly. Route the dispatch envelope to the sub-skill it specifies, and use only the mcp_hermieos_* tools to record state changes. Be terse.';

/** Deterministic session id for a finding's conversation. */
export function findingSessionId(objectId: string): string {
  return `finding-${objectId}`;
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** Body keys the Object Detail page renders as structured rows. */
const CONTEXT_BODY_KEYS = [
  'url',
  'kind',
  'stars',
  'author',
  'license',
  'language',
  'publishedDate',
  'cost',
  'source',
  'target',
  'category_id',
  'subscriptionId',
] as const;

/**
 * Build the context block that precedes the user's message in the
 * finding conversation, so Hermes knows exactly what is being
 * discussed without re-fetching anything.
 */
export function buildFindingContext(obj: {
  title: string;
  type: string;
  summary: string | null;
  body: Record<string, unknown>;
}): string {
  const lines: string[] = [];
  lines.push(`Finding: ${obj.title}`);
  lines.push(`Type: ${obj.type}`);
  if (obj.summary) lines.push(`Summary: ${truncate(obj.summary, 600)}`);
  const meta: string[] = [];
  for (const key of CONTEXT_BODY_KEYS) {
    const v = obj.body[key];
    if (v === undefined || v === null || v === '') continue;
    meta.push(`${key}: ${truncate(String(v), 200)}`);
  }
  if (meta.length > 0) lines.push(`Body:\n${meta.join('\n')}`);
  return lines.join('\n');
}

export async function registerDiscussRoutes(app: FastifyInstance): Promise<void> {
  // GET /objects/:id/discuss — does the finding's conversation exist?
  app.get('/objects/:id/discuss', async (req, reply) => {
    if (!req.user) {
      return sendError(reply, new Unauthorized(), String(req.id));
    }
    const { id } = req.params as { id: string };
    const obj = await getObject(req.user.id, id);
    if (!obj) {
      return sendError(reply, new NotFound('object not found'), String(req.id));
    }
    const gateway = gatewayFromEnv();
    if (!gateway) {
      return { sessionId: findingSessionId(id), exists: false };
    }
    const sessionId = findingSessionId(id);
    try {
      await gateway.getSession(sessionId);
      return { sessionId, exists: true };
    } catch {
      return { sessionId, exists: false };
    }
  });

  // POST /objects/:id/follow-up — raw feedback, executed immediately.
  app.post('/objects/:id/follow-up', async (req, reply) => {
    if (!req.user) {
      return sendError(reply, new Unauthorized(), String(req.id));
    }
    const { id } = req.params as { id: string };
    const parsed = followUpBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(reply, new BadRequest('invalid_input', parsed.error.flatten()), String(req.id));
    }
    const { message, runInBackground } = parsed.data;

    const obj = await getObject(req.user.id, id);
    if (!obj) {
      return sendError(reply, new NotFound('object not found'), String(req.id));
    }

    // 1. Record the raw feedback so the ranking loop learns from it.
    //    A follow-up is the strongest possible signal on a finding.
    await recordFeedback(req.user.id, obj.id, 'suggest', {
      note: message,
      source: 'finding-follow-up',
      followUp: true,
    });

    const sessionId = findingSessionId(obj.id);
    const gateway = gatewayFromEnv();
    if (!gateway) {
      return sendError(
        reply,
        new ServiceUnavailable('Hermes gateway is not configured (HERMES_GATEWAY_URL / HERMES_API_KEY)'),
        String(req.id),
      );
    }

    if (runInBackground) {
      // 2a. Background path: a tracked research run. The scheduler's
      //     run tracker settles it; results land as objects + feed events.
      const context = buildFindingContext(obj);
      const envelope = {
        event: 'research',
        objective: message,
        context: {
          query: message,
          object: {
            id: obj.id,
            type: obj.type,
            title: obj.title,
            summary: obj.summary,
            url: typeof obj.body['url'] === 'string' ? obj.body['url'] : null,
            context,
          },
        },
        trigger: 'user',
      };
      const { id: runId } = await createRun({
        userId: req.user.id,
        kind: 'ad_hoc',
        prompt: JSON.stringify(envelope),
      });
      const dispatched = await gateway.dispatchRun({
        hermieosRunId: runId,
        userId: req.user.id,
        kind: 'ad_hoc',
        input: JSON.stringify(envelope),
        instructions: HERMIEOS_WORKER_INSTRUCTIONS,
      });
      await markRunDispatched(runId, dispatched.hermesRunId);
      return { sessionId, runId, background: true };
    }

    // 2b. Chat path: ensure the finding's session exists, then post the
    //     message with the finding context attached.
    await ensureGatewaySession(gateway, sessionId, obj.title);

    const context = buildFindingContext(obj);
    await gateway.chat(sessionId, { message: `${context}\n\n${message}` });
    return { sessionId, background: false };
  });
}

