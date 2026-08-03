import { useEffect, useRef } from 'react';
import { sseUrl } from './api';
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
 */
export function useSse(handlers: SseHandlers): void {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });

  useEffect(() => {
    const es = new EventSource(sseUrl(), { withCredentials: true } as EventSourceInit);

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
      // EventSource auto-reconnects; nothing to do.
    };

    return () => {
      es.close();
    };
  }, []);
}
