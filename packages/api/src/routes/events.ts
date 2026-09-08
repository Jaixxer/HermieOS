import type { FastifyInstance } from 'fastify';
import { openEventStream } from '../sse-bus.js';
import { mintSseTicket, consumeSseTicket } from '../sse-tickets.js';

export async function registerEventsRoutes(app: FastifyInstance): Promise<void> {
  // POST /events/ticket — mint a short-lived single-use SSE ticket.
  // The client exchanges an authenticated request (cookie or bearer
  // header) for a ticket, then opens GET /events?ticket=... so the
  // permanent MCP token never travels in a URL.
  app.post('/events/ticket', async (req, reply) => {
    if (!req.user) {
      reply.code(401);
      return reply.send({ error: 'unauthorized' });
    }
    const { ticket, ttlSeconds } = mintSseTicket(req.user.id);
    return reply.send({ ticket, ttlSeconds });
  });

  app.get('/events', { sse: 'only' as const }, async (req, reply) => {
    // Auth: a valid ?ticket= mints the identity; otherwise fall back to
    // the session/cookie/bearer path (used by tests and same-origin UIs).
    let userId: string | null = null;
    const q = req.query as { ticket?: string };
    if (q.ticket) {
      userId = consumeSseTicket(q.ticket);
      if (!userId) {
        reply.code(401);
        req.log.warn('invalid or expired SSE ticket');
        return reply.raw.end();
      }
    } else if (req.user) {
      userId = req.user.id;
    }
    if (!userId) {
      reply.code(401);
      req.log.warn('no user on events');
      // SSE doesn't really have a way to deliver JSON errors, so we
      // just close the stream.
      return reply.raw.end();
    }

    // Keep the SSE connection alive after the handler returns.
    // Without this, @fastify/sse closes the stream when the handler completes.
    reply.sse.keepAlive();
    // Commit headers as text/event-stream before the handler returns.
    // Without sendHeaders(), fastify serializes the response as a normal
    // HTTP response with content-length: 0.
    reply.sse.sendHeaders();
    // Send an initial connected event to flush the HTTP headers.
    // The response is not flushed until the first data write.
    void reply.sse.send({ event: 'connected', data: '{}' });

    const lastEventId = (req.headers['last-event-id'] as string | undefined) ?? undefined;

    const handle = openEventStream(
      userId,
      {
        onEvent: (event) => {
          const id = event.event.id;
          const data = event.type === 'feed' ? event.event : event.event;
          void reply.sse.send({
            id,
            event: event.type,
            data: JSON.stringify(data),
          });
        },
        onError: (err) => {
          req.log.warn({ err: err.message }, 'sse stream error');
        },
      },
      lastEventId,
    );

    // Heartbeat every 15s to keep the connection alive through proxies.
    const heartbeat = setInterval(() => {
      void reply.sse.send({ event: 'ping', data: '{}' });
    }, 15_000);
    heartbeat.unref?.();

    req.raw.on('close', () => {
      clearInterval(heartbeat);
      handle.close();
    });
  });
}