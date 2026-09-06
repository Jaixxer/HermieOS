import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDatabase, schema, closeDatabase, type Database } from '@hermieos/db';
import { setDb } from './db.js';
import {
  deleteCalendarEventById,
  deleteGoogleOauthTokens,
  getCalendarEventById,
  getGoogleOauthTokens,
  listCalendarEvents,
  resetGoogleCalendarClient,
  saveGoogleOauthTokens,
  setGoogleCalendarClient,
  syncGoogleCalendar,
  upsertCalendarEvent,
  type GoogleCalendarClient,
  type GoogleCalendarEvent,
} from './calendar.js';

let db: Database;
let userId: string;
const createdCalendarEventIds: string[] = [];
const createdTokenUserIds: string[] = [];

async function cleanup(): Promise<void> {
  await db.execute(
    sql`delete from calendar_events where user_id in (select id from users where email = 'cal-test@hermieos.local')`,
  );
  await db.execute(
    sql`delete from google_oauth_tokens where user_id in (select id from users where email = 'cal-test@hermieos.local')`,
  );
  await db.execute(
    sql`delete from users where email = 'cal-test@hermieos.local'`,
  );
}

beforeAll(async () => {
  db = createDatabase({ url: process.env.DATABASE_URL ?? 'postgres://hermieos:hermieos@localhost:15432/hermieos' });
  setDb(db);
});

afterAll(async () => {
  await cleanup();
  await closeDatabase(db);
});

beforeEach(async () => {
  await cleanup();
  const [u] = await db
    .insert(schema.users)
    .values({
      email: 'cal-test@hermieos.local',
      passwordHash: 'fake',
      displayName: 'Cal Test',
      mcpToken: `mcp_test_${Date.now()}_${Math.random()}`,
    })
    .returning();
  if (!u) throw new Error('user insert failed');
  userId = u.id;
  createdTokenUserIds.push(userId);
});

afterEach(() => {
  resetGoogleCalendarClient();
});

describe('calendar data layer', () => {
  it('upserts and reads an event', async () => {
    const ev: GoogleCalendarEvent = {
      externalId: 'evt-1',
      calendarId: 'primary',
      title: 'Team standup',
      description: null,
      location: 'Zoom',
      startsAt: new Date('2026-08-01T15:00:00Z'),
      endsAt: new Date('2026-08-01T15:30:00Z'),
      allDay: false,
      status: 'confirmed',
      attendees: [{ email: 'a@example.com' }],
      raw: { source: 'test' },
    };
    const saved = await upsertCalendarEvent(userId, ev);
    expect(saved.id).toBeDefined();
    expect(saved.title).toBe('Team standup');
    expect(saved.attendees).toEqual([{ email: 'a@example.com' }]);
    createdCalendarEventIds.push(saved.id);

    const fromDb = await getCalendarEventById(userId, saved.id);
    expect(fromDb?.externalId).toBe('evt-1');

    const listed = await listCalendarEvents(userId, {
      from: new Date('2026-08-01T00:00:00Z'),
      to: new Date('2026-08-01T23:59:59Z'),
    });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.title).toBe('Team standup');
  });

  it('upserts (updates) the same event on conflict', async () => {
    const ev: GoogleCalendarEvent = {
      externalId: 'evt-conflict',
      calendarId: 'primary',
      title: 'Original',
      description: null,
      location: null,
      startsAt: new Date('2026-08-02T15:00:00Z'),
      endsAt: new Date('2026-08-02T16:00:00Z'),
      allDay: false,
      status: 'confirmed',
      attendees: [],
      raw: {},
    };
    const first = await upsertCalendarEvent(userId, ev);
    createdCalendarEventIds.push(first.id);

    const updated = await upsertCalendarEvent(userId, { ...ev, title: 'Updated' });
    expect(updated.id).toBe(first.id);
    expect(updated.title).toBe('Updated');
    const listed = await listCalendarEvents(userId, {
      from: new Date('2026-08-02T00:00:00Z'),
      to: new Date('2026-08-02T23:59:59Z'),
    });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.title).toBe('Updated');
  });

  it('deletes an event by id', async () => {
    const ev: GoogleCalendarEvent = {
      externalId: 'evt-del',
      calendarId: 'primary',
      title: 'To delete',
      description: null,
      location: null,
      startsAt: new Date('2026-08-03T15:00:00Z'),
      endsAt: new Date('2026-08-03T16:00:00Z'),
      allDay: false,
      status: 'confirmed',
      attendees: [],
      raw: {},
    };
    const saved = await upsertCalendarEvent(userId, ev);
    await deleteCalendarEventById(userId, saved.id);
    const after = await getCalendarEventById(userId, saved.id);
    expect(after).toBeNull();
  });

  it('filters by date range', async () => {
    await upsertCalendarEvent(userId, {
      externalId: 'e1',
      calendarId: 'primary',
      title: 'Inside',
      description: null,
      location: null,
      startsAt: new Date('2026-08-10T10:00:00Z'),
      endsAt: new Date('2026-08-10T11:00:00Z'),
      allDay: false,
      status: 'confirmed',
      attendees: [],
      raw: {},
    });
    await upsertCalendarEvent(userId, {
      externalId: 'e2',
      calendarId: 'primary',
      title: 'Outside',
      description: null,
      location: null,
      startsAt: new Date('2026-09-15T10:00:00Z'),
      endsAt: new Date('2026-09-15T11:00:00Z'),
      allDay: false,
      status: 'confirmed',
      attendees: [],
      raw: {},
    });
    const listed = await listCalendarEvents(userId, {
      from: new Date('2026-08-01T00:00:00Z'),
      to: new Date('2026-08-31T23:59:59Z'),
    });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.title).toBe('Inside');
  });

  it('saves and reads google oauth tokens', async () => {
    const expires = new Date(Date.now() + 3600 * 1000);
    await saveGoogleOauthTokens(userId, {
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: expires,
      scope: 'https://www.googleapis.com/auth/calendar.readonly',
      email: 'me@example.com',
    });
    const t = await getGoogleOauthTokens(userId);
    expect(t?.accessToken).toBe('a');
    expect(t?.email).toBe('me@example.com');
    expect(t?.expiresAt.toISOString()).toBe(expires.toISOString());
    await deleteGoogleOauthTokens(userId);
    const after = await getGoogleOauthTokens(userId);
    expect(after).toBeNull();
  });

  it('syncGoogleCalendar pulls events from a mocked client and refreshes tokens', async () => {
    // Plant an expired token
    await saveGoogleOauthTokens(userId, {
      accessToken: 'old',
      refreshToken: 'refresh-1',
      expiresAt: new Date(Date.now() - 60_000),
      scope: 'cal',
      email: 'me@example.com',
    });

    const listMock = vi.fn().mockResolvedValue([
      {
        externalId: 'g-evt-1',
        calendarId: 'primary',
        title: 'From Google',
        description: 'hello',
        location: 'Office',
        startsAt: new Date('2026-08-20T10:00:00Z'),
        endsAt: new Date('2026-08-20T11:00:00Z'),
        allDay: false,
        status: 'confirmed',
        attendees: [{ email: 'guest@example.com' }],
        raw: {},
      },
    ] as GoogleCalendarEvent[]);

    const fakeClient: GoogleCalendarClient = {
      async exchangeCode() {
        throw new Error('not used in this test');
      },
      async refreshToken(refreshToken: string) {
        expect(refreshToken).toBe('refresh-1');
        return { accessToken: 'new', expiresIn: 7200 };
      },
      async listEvents(accessToken: string) {
        expect(accessToken).toBe('new');
        return listMock();
      },
      async getUserInfo() {
        return { email: 'me@example.com' };
      },
      async createEvent() {
        throw new Error('not used in this test');
      },
      async updateEvent() {
        throw new Error('not used in this test');
      },
      async deleteEvent() {
        throw new Error('not used in this test');
      },
    };
    setGoogleCalendarClient(fakeClient);

    const result = await syncGoogleCalendar(userId, {
      from: new Date('2026-08-01T00:00:00Z'),
      to: new Date('2026-08-31T23:59:59Z'),
    });
    expect(result.upserted).toBe(1);
    expect(result.email).toBe('me@example.com');
    expect(listMock).toHaveBeenCalledTimes(1);

    const after = await getGoogleOauthTokens(userId);
    expect(after?.accessToken).toBe('new');

    const stored = await listCalendarEvents(userId, {
      from: new Date('2026-08-01T00:00:00Z'),
      to: new Date('2026-08-31T23:59:59Z'),
    });
    expect(stored[0]?.title).toBe('From Google');
  });

  it('syncGoogleCalendar throws when not connected', async () => {
    await expect(
      syncGoogleCalendar(userId, {
        from: new Date('2026-08-01T00:00:00Z'),
        to: new Date('2026-08-31T23:59:59Z'),
      }),
    ).rejects.toThrow(/not connected/);
  });
});
