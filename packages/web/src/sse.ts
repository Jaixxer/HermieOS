import { useEffect, useRef } from 'react';
import { sseUrl } from './api';
import type { FeedEvent, ObjectEvent } from './api';

type SseEvent =
  | { type: 'feed'; event: FeedEvent }
  | { type: 'object_event'; objectId: string; event: ObjectEvent }
  | { type: 'notification'; id: string; title: string; body: string }
  | { type: 'ping' };

interface SseHandlers {
  onFeed?: (e: FeedEvent) => void;
  onObjectEvent?: (objectId: string, e: ObjectEvent) => void;
  onNotification?: (n: { id: string; title: string; body: string }) => void;
  onPong?: () => void;
}

export function useSse(handlers: SseHandlers): void {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });

  useEffect(() => {
    const es = new EventSource(sseUrl(), { withCredentials: true } as EventSourceInit);

    const onMessage = (raw: MessageEvent<string>) => {
      let parsed: SseEvent | null = null;
      try {
        parsed = JSON.parse(raw.data) as SseEvent;
      } catch {
        return;
      }
      const h = ref.current;
      if (!parsed) return;
      switch (parsed.type) {
        case 'feed':
          h.onFeed?.(parsed.event);
          break;
        case 'object_event':
          h.onObjectEvent?.(parsed.objectId, parsed.event);
          break;
        case 'notification':
          h.onNotification?.(parsed);
          break;
        case 'ping':
          h.onPong?.();
          break;
      }
    };

    es.onmessage = onMessage;
    es.onerror = () => {
      // EventSource auto-reconnects; nothing to do.
    };

    return () => {
      es.close();
    };
  }, []);
}
