import { useCallback, useEffect, useRef } from 'react';
import { sseUrl, mintSseTicket } from './api';
import type { FeedEvent, ObjectEvent } from './api';

interface SseHandlers {
  onFeed?: (e: FeedEvent) => void;
  onObjectEvent?: (objectId: string, e: ObjectEvent) => void;
  onNotification?: (n: { id: string; title: string; body: string; objectId?: string | null }) => void;
  onPong?: () => void;
}

/**
 * SSE client for GET /events.
 *
 * The server emits *named* events over the wire (`event: feed`,
 * `event: notification`, `event: run`, `event: ping`, plus an initial
 * `event: connected`). EventSource's `onmessage` only fires for unnamed
 * messages, so we must use addEventListener per event name.
 *
 * Auth: EventSource cannot set an Authorization header, and the
 * permanent MCP token must never ride in a URL. So a short-lived,
 * single-use ticket is minted via POST /events/ticket, then the stream
 * is opened with `?ticket=`. On error/expiry we mint a fresh ticket and
 * reconnect automatically.
 */
export function useSse(handlers: SseHandlers): void {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });

  const connect = useCallback(() => {
    let es: EventSource | null = null;
    let closed = false;

    const open = async () => {
      try {
        const { ticket } = await mintSseTicket();
        if (closed) return;

        es = new EventSource(sseUrl(ticket), { withCredentials: true } as EventSourceInit);

        const parse = <T,>(raw: string): T | null => {
          try {
            return JSON.parse(raw) as T;
          } catch {
            return null;
          }
        };

        es.addEventListener('feed', (e: MessageEvent<string>) => {
          const ev = parse<FeedEvent>(e.data);
          if (ev) ref.current.onFeed?.(ev);
        });

        es.addEventListener('notification', (e: MessageEvent<string>) => {
          const ev = parse<{ id: string; title: string; body: string; objectId?: string | null }>(e.data);
          if (ev) ref.current.onNotification?.(ev);
        });

        es.addEventListener('object_event', (e: MessageEvent<string>) => {
          const ev = parse<{ objectId: string; event: ObjectEvent }>(e.data);
          if (ev) ref.current.onObjectEvent?.(ev.objectId, ev.event);
        });

        es.addEventListener('ping', () => {
          ref.current.onPong?.();
        });

        es.onerror = () => {
          // Tickets are single-use, so on any error (expiry, network
          // drop, server restart) we close and re-mint before retrying.
          es?.close();
          if (!closed) {
            setTimeout(open, 1_000);
          }
        };
      } catch {
        // Ticket mint failed (e.g. token expired) — retry.
        if (!closed) {
          setTimeout(open, 5_000);
        }
      }
    };

    void open();

    return () => {
      closed = true;
      es?.close();
    };
  }, []);

  useEffect(() => connect(), [connect]);
}