import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { buildApp } from '../server.js';
import { setDb } from '../data/auth.js';
import { setDb as setMcpDb } from '@hermieos/mcp/src/data/db.js';
import { setGoogleCalendarClient, resetGoogleCalendarClient, type GoogleCalendarClient, type GoogleCalendarEvent } from '@hermieos/mcp/src/data/calendar.js';
import { createDatabase, schema, closeDatabase, type Database } from '@hermieos/db';

let db: Database;
let app: Awaited<ReturnType<typeof buildApp>>;
let cookie: string;

async function cleanup(): Promise<void> {
  await db.execute(sql`delete from calendar_events where user_id in (select id from users where email = 'cal-api@hermieos.local')`);
  await db.execute(sql`delete from google_oauth_tokens where user_id in (select id from users where email = 'cal-api@hermieos.local')`);
  await db.execute(sql`delete from sessions where user_id in (select id from users where email = 'cal-api@hermieos.local')`);
  await db.execute(sql`delete from users where email = 'cal-api@hermieos.local'`);
}

beforeAll(async () => {
  db = createDatabase({ url: process.env.DATABASE_URL ?? 'postgres://hermieos:hermieos@localhost:5432/hermieos' });
  setDb(db);
  setMcpDb(db);
  app = await buildApp();
  await cleanup();
});
afterAll(async () => {
  await cleanup();
  await closeDatabase(db);
});
beforeEach(async () => {
  await cleanup();
  const res = await app.inject({
    method: 'POST',
    url: '/auth/signup',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({
      email: 'cal-api@hermieos.local',
      password: 'correct-horse-battery',
      displayName: 'Cal API',
    }),
  });
  expect(res.statusCode).toBe(200);
  const setCookie = res.headers['set-cookie'] as string | undefined;
  cookie = setCookie?.split(';')[0] ?? '';
});

async function call(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const headers: Record<string, string> = { cookie };
  let payload: string | undefined;
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await app.inject({
    method,
    url,
    headers,
    payload,
  });
  let parsed: Record<string, unknown> = {};
  try {
    parsed = res.json() as Record<string, unknown>;
  } catch {
    parsed = {};
  }
  return { status: res.statusCode, body: parsed };
}

describe('calendar API', () => {
  it('reports disconnected status before OAuth', async () => {
    const r = await call('GET', '/calendar/auth/status');
    expect(r.status).toBe(200);
    expect(r.body.connected).toBe(false);
    expect(r.body.email).toBeNull();
  });

  it('rejects unauthenticated requests', async () => {
    const res = await app.inject({ method: 'GET', url: '/calendar/events' });
    expect(res.statusCode).toBe(401);
  });

  it('returns configured=false when GOOGLE_OAUTH_CLIENT_ID is unset', async () => {
    const previous = process.env.GOOGLE_OAUTH_CLIENT_ID;
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    try {
      const r = await call('GET', '/calendar/auth/status');
      expect(r.body.configured).toBe(false);
    } finally {
      if (previous !== undefined) process.env.GOOGLE_OAUTH_CLIENT_ID = previous;
    }
  });

  it('returns 400 when GOOGLE_OAUTH_CLIENT_ID is unset and /url is hit', async () => {
    const previous = process.env.GOOGLE_OAUTH_CLIENT_ID;
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    try {
      const r = await call('GET', '/calendar/auth/url');
      expect(r.status).toBe(400);
    } finally {
      if (previous !== undefined) process.env.GOOGLE_OAUTH_CLIENT_ID = previous;
    }
  });

  it('creates, lists, updates, and deletes an event', async () => {
    const create = await call('POST', '/calendar/events', {
      externalId: 'api-evt-1',
      title: 'Quarterly review',
      startsAt: '2026-09-01T15:00:00Z',
      endsAt: '2026-09-01T16:00:00Z',
      allDay: false,
      description: 'Plan the next quarter',
      location: 'Conference room A',
    });
    expect(create.status).toBe(200);
    const event = create.body.event as { id: string; title: string };
    expect(event.id).toBeDefined();
    expect(event.title).toBe('Quarterly review');

    const list = await call('GET', '/calendar/events?from=2026-09-01T00:00:00Z&to=2026-09-01T23:59:59Z');
    expect(list.status).toBe(200);
    const listEv = list.body.events as Array<{ id: string; title: string }>;
    expect(listEv.length).toBe(1);
    expect(listEv[0]!.title).toBe('Quarterly review');

    const update = await call('PATCH', `/calendar/events/${event.id}`, {
      title: 'Quarterly review (rescheduled)',
    });
    expect(update.status).toBe(200);
    expect((update.body.event as { title: string }).title).toBe('Quarterly review (rescheduled)');

    const del = await call('DELETE', `/calendar/events/${event.id}`);
    expect(del.status).toBe(200);

    const afterDel = await call('GET', '/calendar/events?from=2026-09-01T00:00:00Z&to=2026-09-01T23:59:59Z');
    expect((afterDel.body.events as unknown[]).length).toBe(0);
  });

  it('rejects malformed datetimes on create', async () => {
    const r = await call('POST', '/calendar/events', {
      externalId: 'bad',
      title: 'Bad',
      startsAt: 'not-a-date',
      endsAt: '2026-09-01T16:00:00Z',
    });
    expect(r.status).toBe(400);
  });

  it('rejects end <= start', async () => {
    const r = await call('POST', '/calendar/events', {
      externalId: 'bad-2',
      title: 'Bad',
      startsAt: '2026-09-01T15:00:00Z',
      endsAt: '2026-09-01T15:00:00Z',
    });
    expect(r.status).toBe(400);
  });

  it('syncs events from a mocked Google client', async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'test-client-id';
    let userId = '';
    try {
      // Reuse the cookie from beforeEach's signup
      const me = await call('GET', '/me');
      userId = (me.body.user as { id: string }).id;

      const dbImport = await import('@hermieos/mcp/src/data/calendar.js');
      await dbImport.saveGoogleOauthTokens(userId, {
        accessToken: 'tok',
        refreshToken: 'ref',
        expiresAt: new Date(Date.now() + 3600_000),
        scope: 'cal',
        email: 'me@example.com',
      });

      const fakeEvents: GoogleCalendarEvent[] = [
        {
          externalId: 'g-1',
          calendarId: 'primary',
          title: 'Synced from Google',
          description: null,
          location: 'Office',
          startsAt: new Date('2026-09-15T10:00:00Z'),
          endsAt: new Date('2026-09-15T11:00:00Z'),
          allDay: false,
          status: 'confirmed',
          attendees: [],
          raw: {},
        },
      ];

      const fakeClient: GoogleCalendarClient = {
        async exchangeCode() {
          throw new Error('not used');
        },
        async refreshToken() {
          return { accessToken: 'tok', expiresIn: 3600 };
        },
        async listEvents() {
          return fakeEvents;
        },
        async getUserInfo() {
          return { email: 'me@example.com' };
        },
      };
      setGoogleCalendarClient(fakeClient);

      const r = await call('POST', '/calendar/sync', {
        from: '2026-09-01T00:00:00Z',
        to: '2026-09-30T23:59:59Z',
      });
      expect(r.status).toBe(200);
      expect(r.body.upserted).toBe(1);

      const list = await call('GET', '/calendar/events?from=2026-09-01T00:00:00Z&to=2026-09-30T23:59:59Z');
      const events = list.body.events as Array<{ title: string }>;
      expect(events[0]?.title).toBe('Synced from Google');
    } finally {
      resetGoogleCalendarClient();
      delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    }
  });
});
