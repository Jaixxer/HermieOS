import type { FastifyInstance } from 'fastify';
import sse from '@fastify/sse';
import { openEventStream } from '../sse-bus.js';

export async function registerEventsRoutes(app: FastifyInstance): Promise<void> {
  // GET /events — Server-Sent Events for the current user.
  // Resumes from `Last-Event-ID` header if present.
  app.get('/events', { sse: true }, async (req, reply) => {
    if (!req.user) {
      reply.code(401);
      // SSE doesn't really have a way to deliver JSON errors, so we
      // just close the stream.
      return reply.raw.end();
    }

    const lastEventId = (req.headers['last-event-id'] as string | undefined) ?? undefined;
    const userId = req.user.id;

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
