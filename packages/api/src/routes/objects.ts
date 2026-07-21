import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createObject,
  getObject,
  getObjectRevision,
  listObjectRevisions,
  listObjects,
  revertObject,
  archiveObject,
} from '@hermieos/mcp/src/data/objects.js';
import { getObjectTimeline } from '@hermieos/mcp/src/data/timeline.js';
import { getRelatedObjectsSummary } from '@hermieos/mcp/src/data/relationships.js';
import { BadRequest, NotFound, Unauthorized, sendError } from '../errors.js';

const objectTypes = [
  'project',
  'research',
  'discovery',
  'decision',
  'opportunity',
  'learning_path',
  'note',
  'collection',
] as const;
const objectStatuses = [
  'active',
  'in_progress',
  'completed',
  'open',
  'resolved',
  'archived',
] as const;

const createObjectBodySchema = z.object({
  type: z.enum(objectTypes),
  title: z.string().min(1).max(200),
  summary: z.string().max(1000).optional(),
  body: z.record(z.string(), z.unknown()).default({}),
  status: z.enum(objectStatuses).optional(),
  tags: z.array(z.string().min(1).max(50)).max(20).default([]),
});

export async function registerObjectRoutes(app: FastifyInstance): Promise<void> {
  // POST /objects — create a new object from the web client / API.
  // This is the user-facing wrapper around the MCP create_object tool.
  app.post('/objects', async (req, reply) => {
    if (!req.user) {
      return sendError(reply, new Unauthorized(), String(req.id));
    }
    const parsed = createObjectBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(
        reply,
        new BadRequest('invalid_input', parsed.error.flatten()),
        String(req.id),
      );
    }
    const obj = await createObject(req.user.id, {
      type: parsed.data.type,
      title: parsed.data.title,
      summary: parsed.data.summary,
      body: parsed.data.body,
      status: parsed.data.status,
      tags: parsed.data.tags,
      source: 'user',
    });
    reply.code(201);
    return { object: obj };
  });

  app.get('/objects', async (req, reply) => {
    if (!req.user) {
      return sendError(reply, new Unauthorized(), String(req.id));
    }
    const q = req.query as {
      type?: string;
      status?: string;
      tag?: string;
      limit?: string;
      cursor?: string;
    };
    const limit = q.limit ? Math.min(Math.max(parseInt(q.limit, 10) || 50, 1), 200) : 50;
    const result = await listObjects(req.user.id, {
      type: q.type as never,
      status: q.status as never,
      tag: q.tag,
      limit,
      cursor: q.cursor,
    });
    return result;
  });

  app.get('/objects/:id', async (req, reply) => {
    if (!req.user) {
      return sendError(reply, new Unauthorized(), String(req.id));
    }
    const { id } = req.params as { id: string };
    const obj = await getObject(req.user.id, id);
    if (!obj) {
      return sendError(reply, new NotFound('object not found'), String(req.id));
    }
    const related = await getRelatedObjectsSummary(req.user.id, id);
    return { object: { ...obj, related } };
  });

  app.get('/objects/:id/timeline', async (req, reply) => {
    if (!req.user) {
      return sendError(reply, new Unauthorized(), String(req.id));
    }
    const { id } = req.params as { id: string };
    const q = req.query as { limit?: string; cursor?: string };
    const limit = q.limit ? Math.min(Math.max(parseInt(q.limit, 10) || 50, 1), 200) : 50;
    const result = await getObjectTimeline(req.user.id, id, limit, q.cursor);
    return result;
  });

  app.get('/objects/:id/revisions', async (req, reply) => {
    if (!req.user) {
      return sendError(reply, new Unauthorized(), String(req.id));
    }
    const { id } = req.params as { id: string };
    const q = req.query as { limit?: string; cursor?: string };
    const limit = q.limit ? Math.min(Math.max(parseInt(q.limit, 10) || 50, 1), 200) : 50;
    const result = await listObjectRevisions(req.user.id, id, limit, q.cursor);
    return result;
  });

  app.get('/objects/:id/revisions/:revision', async (req, reply) => {
    if (!req.user) {
      return sendError(reply, new Unauthorized(), String(req.id));
    }
    const { id, revision } = req.params as { id: string; revision: string };
    const rev = parseInt(revision, 10);
    if (Number.isNaN(rev) || rev < 1) {
      return sendError(reply, new BadRequest('revision must be a positive integer'), String(req.id));
    }
    const r = await getObjectRevision(req.user.id, id, rev);
    if (!r) {
      return sendError(reply, new NotFound('revision not found'), String(req.id));
    }
    return { revision: r };
  });

  app.post('/objects/:id/revert', async (req, reply) => {
    if (!req.user) {
      return sendError(reply, new Unauthorized(), String(req.id));
    }
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { revision?: number; reason?: string };
    if (typeof body.revision !== 'number' || body.revision < 1) {
      return sendError(reply, new BadRequest('revision must be a positive integer'), String(req.id));
    }
    const obj = await revertObject(req.user.id, {
      id,
      revision: body.revision,
      reason: body.reason,
      source: 'user',
    });
    return { object: obj };
  });

  app.post('/objects/:id/archive', async (req, reply) => {
    if (!req.user) {
      return sendError(reply, new Unauthorized(), String(req.id));
    }
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { reason?: string };
    const obj = await archiveObject(req.user.id, {
      id,
      reason: body.reason,
      source: 'user',
    });
    return { object: obj };
  });
}
