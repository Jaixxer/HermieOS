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
  getGoogleCalendarClient,
  getCalendarEventById,
  getActiveGoogleCredentials,
  createGoogleCalendarClient,
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
   * store it in a short-lived cookie so the callback can verify the
   * round-trip came from us.
   */
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
    const redirectUri =
      query.redirect ?? `${req.protocol}://${req.headers.host}/calendar/auth/callback`;
    const state = `${req.user.id}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
    reply.setCookie('google_oauth_state', state, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 600,
    });
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events openid email profile');
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('include_granted_scopes', 'true');
    url.searchParams.set('state', state);
    return { url: url.toString() };
  });

  /**
   * GET /calendar/auth/callback — exchanges the `code` for tokens and
   * stores them on the user. Returns the connected email.
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
    const stateCookie = req.cookies['google_oauth_state'];
    if (!stateCookie || stateCookie !== parsed.data.state) {
      return sendError(
        reply,
        new BadRequest('oauth state mismatch — possible CSRF'),
        String(req.id),
      );
    }
    reply.clearCookie('google_oauth_state', { path: '/' });
    const { clientId, clientSecret } = await getActiveGoogleCredentials(req.user.id);
    const redirectUri = `${req.protocol}://${req.headers.host}/calendar/auth/callback`;
    const userClient = createGoogleCalendarClient(clientId, clientSecret);
    const tokenRes = await userClient.exchangeCode(
      parsed.data.code,
      redirectUri,
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
    return { ok: true, email: userInfo.email };
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
    const event = await upsertCalendarEvent(req.user.id, {
      externalId: body.externalId,
      calendarId: body.calendarId,
      title: body.title,
      description: body.description ?? null,
      location: body.location ?? null,
      startsAt: new Date(body.startsAt),
      endsAt: new Date(body.endsAt),
      allDay: body.allDay ?? false,
      status: body.status ?? 'confirmed',
      attendees: body.attendees ?? [],
      raw: {},
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
    const event = await upsertCalendarEvent(req.user.id, merged);
    return { event };
  });

  app.delete('/calendar/events/:id', async (req, reply) => {
    if (!req.user) {
      return sendError(reply, new Unauthorized(), String(req.id));
    }
    const { id } = req.params as { id: string };
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
