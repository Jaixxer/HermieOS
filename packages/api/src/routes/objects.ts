import type { FastifyInstance } from 'fastify';
import {
  getObject,
  getObjectRevision,
  listObjectRevisions,
  listObjects,
  searchObjects,
  revertObject,
  archiveObject,
} from '@hermieos/mcp/src/data/objects.js';
import { getObjectTimeline } from '@hermieos/mcp/src/data/timeline.js';

export async function registerObjectRoutes(app: FastifyInstance): Promise<void> {
  app.get('/objects', async (req, reply) => {
    if (!req.user) {
      return reply.code(401).send({ error: 'unauthorized' });
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
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const { id } = req.params as { id: string };
    const obj = await getObject(req.user.id, id);
    if (!obj) {
      return reply.code(404).send({ error: 'not_found' });
    }
    return { object: obj };
  });

  app.get('/objects/:id/timeline', async (req, reply) => {
    if (!req.user) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const { id } = req.params as { id: string };
    const q = req.query as { limit?: string; cursor?: string };
    const limit = q.limit ? Math.min(Math.max(parseInt(q.limit, 10) || 50, 1), 200) : 50;
    const result = await getObjectTimeline(req.user.id, id, limit, q.cursor);
    return result;
  });

  app.get('/objects/:id/revisions', async (req, reply) => {
    if (!req.user) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const { id } = req.params as { id: string };
    const q = req.query as { limit?: string; cursor?: string };
    const limit = q.limit ? Math.min(Math.max(parseInt(q.limit, 10) || 50, 1), 200) : 50;
    const result = await listObjectRevisions(req.user.id, id, limit, q.cursor);
    return result;
  });

  app.get('/objects/:id/revisions/:revision', async (req, reply) => {
    if (!req.user) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const { id, revision } = req.params as { id: string; revision: string };
    const rev = parseInt(revision, 10);
    if (Number.isNaN(rev) || rev < 1) {
      return reply.code(400).send({ error: 'invalid_input' });
    }
    const r = await getObjectRevision(req.user.id, id, rev);
    if (!r) {
      return reply.code(404).send({ error: 'not_found' });
    }
    return { revision: r };
  });

  app.post('/objects/:id/revert', async (req, reply) => {
    if (!req.user) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { revision?: number; reason?: string };
    if (typeof body.revision !== 'number' || body.revision < 1) {
      return reply.code(400).send({ error: 'invalid_input' });
    }
    try {
      const obj = await revertObject(req.user.id, {
        id,
        revision: body.revision,
        reason: body.reason,
        source: 'user',
      });
      return { object: obj };
    } catch (err) {
      return reply.code(400).send({ error: 'revert_failed', message: (err as Error).message });
    }
  });

  app.post('/objects/:id/archive', async (req, reply) => {
    if (!req.user) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { reason?: string };
    try {
      const obj = await archiveObject(req.user.id, {
        id,
        reason: body.reason,
        source: 'user',
      });
      return { object: obj };
    } catch (err) {
      return reply.code(400).send({ error: 'archive_failed', message: (err as Error).message });
    }
  });
}

void searchObjects; // search has its own route below
