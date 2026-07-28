import { and, asc, between, eq, gte, lte } from 'drizzle-orm';
import { schema } from '@hermieos/db';
import { getDb } from './db.js';

export type GoogleCalendarEvent = {
  externalId: string;
  calendarId: string;
  title: string;
  description: string | null;
  location: string | null;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  status: string;
  attendees: Array<{ email: string; name?: string; responseStatus?: string }>;
  raw: Record<string, unknown>;
};

export type GoogleOauthTokenRow = {
  userId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scope: string;
  email: string;
};

export type CalendarEventRow = {
  id: string;
  userId: string;
  externalId: string;
  calendarId: string;
  title: string;
  description: string | null;
  location: string | null;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  status: string;
  attendees: Array<{ email: string; name?: string; responseStatus?: string }>;
  raw: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};

// ---------- OAuth tokens ----------

export async function saveGoogleOauthTokens(
  userId: string,
  tokens: {
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
    scope: string;
    email: string;
  },
): Promise<GoogleOauthTokenRow> {
  const db = getDb();
  const [row] = await db
    .insert(schema.googleOauthTokens)
    .values({
      userId,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      scope: tokens.scope,
      email: tokens.email,
    })
    .onConflictDoUpdate({
      target: schema.googleOauthTokens.userId,
      set: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
        scope: tokens.scope,
        email: tokens.email,
        updatedAt: new Date(),
      },
    })
    .returning();
  if (!row) throw new Error('google_oauth_tokens upsert failed');
  return rowToToken(row);
}

export async function getGoogleOauthTokens(
  userId: string,
): Promise<GoogleOauthTokenRow | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.googleOauthTokens)
    .where(eq(schema.googleOauthTokens.userId, userId))
    .limit(1);
  return row ? rowToToken(row) : null;
}

export async function deleteGoogleOauthTokens(userId: string): Promise<void> {
  const db = getDb();
  await db
    .delete(schema.googleOauthTokens)
    .where(eq(schema.googleOauthTokens.userId, userId));
}

function rowToToken(row: schema.GoogleOauthToken): GoogleOauthTokenRow {
  return {
    userId: row.userId,
    accessToken: row.accessToken,
    refreshToken: row.refreshToken,
    expiresAt: row.expiresAt,
    scope: row.scope,
    email: row.email,
  };
}

// ---------- Calendar events ----------

export async function listCalendarEvents(
  userId: string,
  opts: { from: Date; to: Date; limit?: number } = {
    from: new Date(),
    to: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  },
): Promise<CalendarEventRow[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.calendarEvents)
    .where(
      and(
        eq(schema.calendarEvents.userId, userId),
        gte(schema.calendarEvents.startsAt, opts.from),
        lte(schema.calendarEvents.startsAt, opts.to),
      ),
    )
    .orderBy(asc(schema.calendarEvents.startsAt))
    .limit(opts.limit ?? 250);
  return rows.map(rowToEvent);
}

export async function getCalendarEventById(
  userId: string,
  id: string,
): Promise<CalendarEventRow | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.calendarEvents)
    .where(
      and(
        eq(schema.calendarEvents.id, id),
        eq(schema.calendarEvents.userId, userId),
      ),
    )
    .limit(1);
  return row ? rowToEvent(row) : null;
}

export async function upsertCalendarEvent(
  userId: string,
  event: GoogleCalendarEvent,
): Promise<CalendarEventRow> {
  const db = getDb();
  const [row] = await db
    .insert(schema.calendarEvents)
    .values({
      userId,
      externalId: event.externalId,
      calendarId: event.calendarId,
      title: event.title,
      description: event.description,
      location: event.location,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      allDay: event.allDay,
      status: event.status,
      attendees: event.attendees,
      raw: event.raw,
    })
    .onConflictDoUpdate({
      target: [
        schema.calendarEvents.userId,
        schema.calendarEvents.externalId,
      ],
      set: {
        title: event.title,
        description: event.description,
        location: event.location,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        allDay: event.allDay,
        status: event.status,
        attendees: event.attendees,
        raw: event.raw,
        updatedAt: new Date(),
      },
    })
    .returning();
  if (!row) throw new Error('calendar_events upsert failed');
  return rowToEvent(row);
}

export async function deleteCalendarEventByExternalId(
  userId: string,
  externalId: string,
): Promise<void> {
  const db = getDb();
  await db
    .delete(schema.calendarEvents)
    .where(
      and(
        eq(schema.calendarEvents.userId, userId),
        eq(schema.calendarEvents.externalId, externalId),
      ),
    );
}

export async function deleteCalendarEventById(
  userId: string,
  id: string,
): Promise<void> {
  const db = getDb();
  await db
    .delete(schema.calendarEvents)
    .where(
      and(
        eq(schema.calendarEvents.id, id),
        eq(schema.calendarEvents.userId, userId),
      ),
    );
}

function rowToEvent(row: schema.CalendarEvent): CalendarEventRow {
  return {
    id: row.id,
    userId: row.userId,
    externalId: row.externalId,
    calendarId: row.calendarId,
    title: row.title,
    description: row.description,
    location: row.location,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    allDay: row.allDay,
    status: row.status,
    attendees: row.attendees ?? [],
    raw: row.raw ?? {},
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ---------- Google Calendar API client (abstracted for tests) ----------

/**
 * Abstraction over the Google Calendar API so we can mock it in tests.
 * The real implementation uses fetch against `https://www.googleapis.com/`.
 * Tests inject a mock via `setGoogleCalendarClient`.
 */
export interface GoogleCalendarClient {
  exchangeCode(code: string, redirectUri: string): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    scope: string;
    idToken?: string;
  }>;
  refreshToken(refreshToken: string): Promise<{
    accessToken: string;
    expiresIn: number;
  }>;
  listEvents(accessToken: string, opts: {
    timeMin: Date;
    timeMax: Date;
    calendarId?: string;
  }): Promise<GoogleCalendarEvent[]>;
  getUserInfo(accessToken: string): Promise<{ email: string }>;
}

let _client: GoogleCalendarClient = defaultGoogleCalendarClient();

export function getGoogleCalendarClient(): GoogleCalendarClient {
  return _client;
}

export function setGoogleCalendarClient(c: GoogleCalendarClient): void {
  _client = c;
}

export function resetGoogleCalendarClient(): void {
  _client = defaultGoogleCalendarClient();
}

function defaultGoogleCalendarClient(): GoogleCalendarClient {
  return {
    async exchangeCode(code, redirectUri) {
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: process.env.GOOGLE_OAUTH_CLIENT_ID ?? '',
          client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? '',
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }).toString(),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`google oauth exchange failed: ${res.status} ${body}`);
      }
      const data = (await res.json()) as Record<string, unknown>;
      return {
        accessToken: String(data.access_token),
        refreshToken: String(data.refresh_token),
        expiresIn: Number(data.expires_in),
        scope: String(data.scope ?? ''),
        idToken: data.id_token ? String(data.id_token) : undefined,
      };
    },
    async refreshToken(refreshToken) {
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          refresh_token: refreshToken,
          client_id: process.env.GOOGLE_OAUTH_CLIENT_ID ?? '',
          client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? '',
          grant_type: 'refresh_token',
        }).toString(),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`google oauth refresh failed: ${res.status} ${body}`);
      }
      const data = (await res.json()) as Record<string, unknown>;
      return {
        accessToken: String(data.access_token),
        expiresIn: Number(data.expires_in),
      };
    },
    async listEvents(accessToken, opts) {
      const url = new URL(
        `https://www.googleapis.com/calendar/v3/calendars/${
          encodeURIComponent(opts.calendarId ?? 'primary')
        }/events`,
      );
      url.searchParams.set('timeMin', opts.timeMin.toISOString());
      url.searchParams.set('timeMax', opts.timeMax.toISOString());
      url.searchParams.set('singleEvents', 'true');
      url.searchParams.set('orderBy', 'startTime');
      url.searchParams.set('maxResults', '250');
      const res = await fetch(url.toString(), {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`google calendar listEvents failed: ${res.status} ${body}`);
      }
      const data = (await res.json()) as { items?: Array<Record<string, unknown>> };
      const items = data.items ?? [];
      return items.map(googleEventToLocal).filter(notNull);
    },
    async getUserInfo(accessToken) {
      const res = await fetch(
        'https://www.googleapis.com/oauth2/v2/userinfo',
        { headers: { authorization: `Bearer ${accessToken}` } },
      );
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`google userinfo failed: ${res.status} ${body}`);
      }
      const data = (await res.json()) as { email?: string };
      return { email: data.email ?? '' };
    },
  };
}

function googleEventToLocal(item: Record<string, unknown>): GoogleCalendarEvent | null {
  if (!item.id) return null;
  const start = item.start as { dateTime?: string; date?: string } | undefined;
  const end = item.end as { dateTime?: string; date?: string } | undefined;
  if (!start || !end) return null;
  const allDay = Boolean(start.date) && !start.dateTime;
  const startsAt = allDay && start.date ? new Date(`${start.date}T00:00:00Z`) : new Date(start.dateTime ?? start.date ?? Date.now());
  const endsAt = allDay && end.date ? new Date(`${end.date}T23:59:59Z`) : new Date(end.dateTime ?? end.date ?? Date.now());
  const attendees = Array.isArray(item.attendees)
    ? (item.attendees as Array<{ email?: string; displayName?: string; responseStatus?: string }>).map((a) => ({
        email: String(a.email ?? ''),
        name: a.displayName ?? undefined,
        responseStatus: a.responseStatus ?? undefined,
      }))
    : [];
  return {
    externalId: String(item.id),
    calendarId: String(item.calendarId ?? 'primary'),
    title: String(item.summary ?? '(no title)'),
    description: item.description ? String(item.description) : null,
    location: item.location ? String(item.location) : null,
    startsAt,
    endsAt,
    allDay,
    status: String(item.status ?? 'confirmed'),
    attendees,
    raw: item,
  };
}

function notNull<T>(v: T | null): v is T {
  return v !== null;
}

// ---------- Sync helper ----------

/**
 * Pull events from Google Calendar and upsert them locally for the
 * given user. Refreshes the access token if it's expired. Returns
 * the number of events upserted.
 */
export async function syncGoogleCalendar(
  userId: string,
  opts: { from: Date; to: Date } = {
    from: new Date(),
    to: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  },
): Promise<{ upserted: number; email: string }> {
  let tokens = await getGoogleOauthTokens(userId);
  if (!tokens) {
    throw new Error('google calendar not connected');
  }
  // Refresh if expired
  if (tokens.expiresAt.getTime() < Date.now() + 30_000) {
    const refreshed = await getGoogleCalendarClient().refreshToken(
      tokens.refreshToken,
    );
    const expiresAt = new Date(Date.now() + refreshed.expiresIn * 1000);
    tokens = await saveGoogleOauthTokens(userId, {
      accessToken: refreshed.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt,
      scope: tokens.scope,
      email: tokens.email,
    });
  }
  const events = await getGoogleCalendarClient().listEvents(tokens.accessToken, {
    timeMin: opts.from,
    timeMax: opts.to,
  });
  for (const event of events) {
    await upsertCalendarEvent(userId, event);
  }
  return { upserted: events.length, email: tokens.email };
}
