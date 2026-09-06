import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { createDatabase, schema, closeDatabase } from '@hermieos/db';
import { setDb } from './data/auth.js';
import { SESSION_COOKIE_NAME, registerAuthDecorators, getSessionUser } from './auth-middleware.js';
import { sendError, NotFound, BadRequest, Unauthorized } from './errors.js';

const URL = process.env.DATABASE_URL ?? 'postgres://hermieos:hermieos@localhost:15432/hermieos';

describe('error responses', () => {
  let app: FastifyInstance;
  let db: ReturnType<typeof createDatabase>;

  beforeEach(async () => {
    db = createDatabase({ url: URL });
    setDb(db);
    await db.execute(sql`delete from sessions where user_id in (select id from users where email = 'err@shape.test')`);
    await db.execute(sql`delete from users where email = 'err@shape.test'`);
    app = Fastify({ genReqId: () => 'test-req-id' });
    await app.register(cookie, { secret: 'test' });
    registerAuthDecorators(app);
    app.addHook('onRequest', async (req) => {
      if (req.url === '/healthz') return;
      req.user = await getSessionUser(req);
    });
    app.setErrorHandler((err, req, reply) => {
      if (err instanceof Unauthorized || err instanceof BadRequest || err instanceof NotFound) {
        return sendError(reply, err, String(req.id));
      }
      throw err;
    });
    app.get('/throw-401', async () => {
      throw new Unauthorized('not allowed');
    });
    app.get('/throw-400', async () => {
      throw new BadRequest('bad input', { field: 'x' });
    });
    app.get('/throw-404', async () => {
      throw new NotFound('not here');
    });
    app.get('/send-401', async (_req, reply) => {
      return sendError(reply, new Unauthorized('manual'), String('test-req-id'));
    });
  });

  afterAll(async () => {
    await db.execute(sql`delete from sessions where user_id in (select id from users where email = 'err@shape.test')`);
    await db.execute(sql`delete from users where email = 'err@shape.test'`);
    await closeDatabase(db);
  });

  it('thrown Unauthorized produces { error, message, requestId }', async () => {
    const res = await app.inject({ method: 'GET', url: '/throw-401' });
    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body).toEqual({
      error: 'unauthorized',
      message: 'not allowed',
      requestId: 'test-req-id',
    });
  });

  it('thrown BadRequest includes details', async () => {
    const res = await app.inject({ method: 'GET', url: '/throw-400' });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe('invalid_input');
    expect(body.message).toBe('bad input');
    expect(body.details).toEqual({ field: 'x' });
    expect(body.requestId).toBe('test-req-id');
  });

  it('thrown NotFound returns 404 with the same shape', async () => {
    const res = await app.inject({ method: 'GET', url: '/throw-404' });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error).toBe('not_found');
    expect(body.requestId).toBe('test-req-id');
  });

  it('explicit sendError works the same way', async () => {
    const res = await app.inject({ method: 'GET', url: '/send-401' });
    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.message).toBe('manual');
  });
});

void SESSION_COOKIE_NAME;
void schema;
