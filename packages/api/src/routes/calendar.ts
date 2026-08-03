import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  deleteGoogleOauthTokens,
  getGoogleOauthTokens,
  listCalendarEvents,
  saveGoogleOauthTokens,
  syncGoogleCalendar,
  upsertCalendarEvent,
  deleteCalendarEventById,
  getCalendarEventById,
  getActiveGoogleCredentials,
  createGoogleCalendarClient,
  getUserGoogleClient,
} from '@hermieos/mcp/src/data/calendar.js';
import { BadRequest, Unauthorized, sendError } from '../errors.js';

const eventListQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

const createEventBodySchema = z.object({
  externalId: z.string().min(1).max(512),
  calendarId: z.string().min(1).max(256).default('primary'),
  title: z.string().min(1).max(512),
  description: z.string().max(10_000).optional().nullable(),
  location: z.string().max(512).optional().nullable(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  allDay: z.boolean().optional().default(false),
  status: z.string().max(64).optional().default('confirmed'),
  attendees: z
    .array(
      z.object({
        email: z.string().email(),
        name: z.string().max(256).optional(),
        responseStatus: z.string().max(64).optional(),
      }),
    )
    .max(200)
    .optional()
    .default([]),
});

const updateEventBodySchema = createEventBodySchema.partial();

const oauthCallbackQuerySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

export async function registerCalendarRoutes(app: FastifyInstance): Promise<void> {
  // --- OAuth flow ---

  /**
   * GET /calendar/auth/url?redirect=<url> — returns the Google OAuth URL
   * the user should be redirected to. We mint a per-request `state` and
   * store it in memory so the callback can verify the round-trip.
   *
   * The `redirect` param is the URL to send the user to AFTER the OAuth
   * callback succeeds — NOT the Google OAuth redirect_uri. The OAuth
   * redirect_uri is always the API's own /calendar/auth/callback endpoint
   * so that Google redirects to a valid HTTP(S) URL (required by Google).
   *
   * We avoid cookies for the state because the auth-url fetch is usually
   * cross-origin (Electron file:// → API) and credentials:'same-origin'
   * prevents Set-Cookie from being stored.
   */

  // In-memory store for pending OAuth states. Keyed by the random state
  // value itself. The callback looks it up by userId to verify ownership.
  const pendingOAuthStates = new Map<string, { userId: string; state: string; afterUri: string; expiresAt: number }>();
  setInterval(() => {
    const now = Date.now();
    for (const [key, val] of pendingOAuthStates) {
      if (val.expiresAt < now) pendingOAuthStates.delete(key);
    }
  }, 60_000).unref();

  app.get('/calendar/auth/url', async (req, reply) => {
    if (!req.user) {
      return sendError(reply, new Unauthorized(), String(req.id));
    }
    const { clientId } = await getActiveGoogleCredentials(req.user.id);
    if (!clientId) {
      return sendError(
        reply,
        new BadRequest(
          'Google OAuth is not configured. Go to Settings → Google Calendar to connect.',
        ),
        String(req.id),
      );
    }
    const query = req.query as { redirect?: string };
    const callbackUri = `${req.protocol}://${req.headers.host}/calendar/auth/callback`;
    const afterUri = query.redirect ?? `${req.protocol}://${req.headers.host}/calendar`;
    const state = `${req.user.id}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
    pendingOAuthStates.set(state, {
      userId: req.user.id,
      state,
      afterUri,
      expiresAt: Date.now() + 600_000,
    });
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', callbackUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events openid email profile');
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('include_granted_scopes', 'true');
    url.searchParams.set('state', state);
    return { url: url.toString() };
  });

  /**
   * GET /calendar/auth/callback — exchanges the `code` for tokens and
   * stores them on the user. Redirects to the stored post-callback URL
   * (or the Calendar page) so the user lands back in the app.
   */
  app.get('/calendar/auth/callback', async (req, reply) => {
    if (!req.user) {
      return sendError(reply, new Unauthorized(), String(req.id));
    }
    const query = req.query as { code?: string; state?: string };
    const parsed = oauthCallbackQuerySchema.safeParse(query);
    if (!parsed.success) {
      return sendError(reply, new BadRequest('missing code or state'), String(req.id));
    }
    const stored = pendingOAuthStates.get(parsed.data.state);
    if (!stored || stored.userId !== req.user.id) {
      return sendError(
        reply,
        new BadRequest('oauth state mismatch — possible CSRF'),
        String(req.id),
      );
    }
    pendingOAuthStates.delete(parsed.data.state);
    const afterUri = stored.afterUri;

    const { clientId, clientSecret } = await getActiveGoogleCredentials(req.user.id);
    const callbackUri = `${req.protocol}://${req.headers.host}/calendar/auth/callback`;
    const userClient = createGoogleCalendarClient(clientId, clientSecret);
    const tokenRes = await userClient.exchangeCode(
      parsed.data.code,
      callbackUri,
    );
    const expiresAt = new Date(Date.now() + tokenRes.expiresIn * 1000);
    const userInfo = await userClient
      .getUserInfo(tokenRes.accessToken)
      .catch(() => ({ email: '' }));
    await saveGoogleOauthTokens(req.user.id, {
      accessToken: tokenRes.accessToken,
      refreshToken: tokenRes.refreshToken,
      expiresAt,
      scope: tokenRes.scope,
      email: userInfo.email,
    });
    reply.type('text/html; charset=utf-8');
    return reply.send(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Connected</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #050510; color: #e4e4e7; }
  .card { text-align: center; padding: 2rem; }
  .check { font-size: 3rem; color: #22c55e; }
  h1 { font-size: 1.25rem; margin: 0.75rem 0 0.25rem; }
  p { color: #a1a1aa; font-size: 0.875rem; }
</style></head>
<body><div class="card">
<div class="check">&#10003;</div>
<h1>Google Calendar connected</h1>
<p>${userInfo.email.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</p>
<p style="margin-top:1.5rem;font-size:0.75rem">You can close this tab and return to HermieOS.</p>
</div></body></html>`);
  });

  app.delete('/calendar/auth', async (req, reply) => {
    if (!req.user) {
      return sendError(reply, new Unauthorized(), String(req.id));
    }
    await deleteGoogleOauthTokens(req.user.id);
    return { ok: true };
  });

  app.get('/calendar/auth/status', async (req, reply) => {
    if (!req.user) {
      return sendError(reply, new Unauthorized(), String(req.id));
    }
    const tokens = await getGoogleOauthTokens(req.user.id);
    const credentials = await getActiveGoogleCredentials(req.user.id);
    return {
      connected: Boolean(tokens),
      email: tokens?.email ?? null,
      scope: tokens?.scope ?? null,
      expiresAt: tokens?.expiresAt.toISOString() ?? null,
      configured: Boolean(credentials.clientId),
      hasUserConfiguredCredentials: Boolean(tokens),
    };
  });

  // --- Events ---

  app.get('/calendar/events', async (req, reply) => {
    if (!req.user) {
      return sendError(reply, new Unauthorized(), String(req.id));
    }
    const parsed = eventListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return sendError(
        reply,
        new BadRequest('from and to must be ISO datetimes'),
        String(req.id),
      );
    }
    const from = parsed.data.from ? new Date(parsed.data.from) : new Date();
    const to = parsed.data.to
      ? new Date(parsed.data.to)
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const events = await listCalendarEvents(req.user.id, {
      from,
      to,
      limit: parsed.data.limit,
    });
    return { events };
  });

  app.post('/calendar/events', async (req, reply) => {
    if (!req.user) {
      return sendError(reply, new Unauthorized(), String(req.id));
    }
    const parsed = createEventBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(
        reply,
        new BadRequest(JSON.stringify(parsed.error.flatten())),
        String(req.id),
      );
    }
    const body = parsed.data;
    if (new Date(body.endsAt).getTime() <= new Date(body.startsAt).getTime()) {
      return sendError(
        reply,
        new BadRequest('endsAt must be after startsAt'),
        String(req.id),
      );
    }

    // Push to Google Calendar first so we capture the externalId.
    let googleExternalId = body.externalId;
    let googleRaw: Record<string, unknown> = {};
    try {
      const gc = await getUserGoogleClient(req.user.id);
      const created = await gc.client.createEvent(gc.accessToken, {
        calendarId: body.calendarId,
        event: {
          title: body.title,
          description: body.description ?? null,
          location: body.location ?? null,
          startsAt: new Date(body.startsAt),
          endsAt: new Date(body.endsAt),
          allDay: body.allDay ?? false,
          attendees: body.attendees ?? [],
        },
      });
      googleExternalId = created.externalId;
      googleRaw = { htmlLink: created.htmlLink };
    } catch {
      // Not connected to Google Calendar — save locally only.
    }

    const event = await upsertCalendarEvent(req.user.id, {
      externalId: googleExternalId,
      calendarId: body.calendarId,
      title: body.title,
      description: body.description ?? null,
      location: body.location ?? null,
      startsAt: new Date(body.startsAt),
      endsAt: new Date(body.endsAt),
      allDay: body.allDay ?? false,
      status: body.status ?? 'confirmed',
      attendees: body.attendees ?? [],
      raw: googleRaw,
    });
    return { event };
  });

  app.patch('/calendar/events/:id', async (req, reply) => {
    if (!req.user) {
      return sendError(reply, new Unauthorized(), String(req.id));
    }
    const { id } = req.params as { id: string };
    const parsed = updateEventBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(reply, new BadRequest(JSON.stringify(parsed.error.flatten())), String(req.id));
    }
    const existing = await getCalendarEventById(req.user.id, id);
    if (!existing) {
      return sendError(reply, new BadRequest('event not found'), String(req.id));
    }
    const merged = {
      externalId: parsed.data.externalId ?? existing.externalId,
      calendarId: parsed.data.calendarId ?? existing.calendarId,
      title: parsed.data.title ?? existing.title,
      description: parsed.data.description ?? existing.description,
      location: parsed.data.location ?? existing.location,
      startsAt: parsed.data.startsAt ? new Date(parsed.data.startsAt) : existing.startsAt,
      endsAt: parsed.data.endsAt ? new Date(parsed.data.endsAt) : existing.endsAt,
      allDay: parsed.data.allDay ?? existing.allDay,
      status: parsed.data.status ?? existing.status,
      attendees: parsed.data.attendees ?? existing.attendees,
      raw: existing.raw,
    };
    if (merged.endsAt.getTime() <= merged.startsAt.getTime()) {
      return sendError(reply, new BadRequest('endsAt must be after startsAt'), String(req.id));
    }

    // Push update to Google Calendar if the event exists there.
    if (existing.externalId) {
      try {
        const gc = await getUserGoogleClient(req.user.id);
        await gc.client.updateEvent(gc.accessToken, {
          eventId: existing.externalId,
          calendarId: merged.calendarId,
          event: {
            title: merged.title,
            description: merged.description,
            location: merged.location,
            startsAt: merged.startsAt,
            endsAt: merged.endsAt,
            allDay: merged.allDay,
            attendees: merged.attendees,
          },
        });
      } catch {
        // Not connected or Google push failed — save locally only.
      }
    }

    const event = await upsertCalendarEvent(req.user.id, merged);
    return { event };
  });

  app.delete('/calendar/events/:id', async (req, reply) => {
    if (!req.user) {
      return sendError(reply, new Unauthorized(), String(req.id));
    }
    const { id } = req.params as { id: string };
    const existing = await getCalendarEventById(req.user.id, id);

    // Delete from Google Calendar first if it exists there.
    if (existing?.externalId) {
      try {
        const gc = await getUserGoogleClient(req.user.id);
        await gc.client.deleteEvent(gc.accessToken, {
          eventId: existing.externalId,
          calendarId: existing.calendarId,
        });
      } catch {
        // Not connected or Google delete failed — delete locally anyway.
      }
    }

    await deleteCalendarEventById(req.user.id, id);
    return { ok: true };
  });

  app.post('/calendar/sync', async (req, reply) => {
    if (!req.user) {
      return sendError(reply, new Unauthorized(), String(req.id));
    }
    const body = (req.body ?? {}) as { from?: string; to?: string };
    const from = body.from ? new Date(body.from) : new Date();
    const to = body.to
      ? new Date(body.to)
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    try {
      const result = await syncGoogleCalendar(req.user.id, { from, to });
      return result;
    } catch (err) {
      return sendError(
        reply,
        new BadRequest(`sync failed: ${(err as Error).message}`),
        String(req.id),
      );
    }
  });
}
