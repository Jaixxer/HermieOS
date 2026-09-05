/**
 * Gateway control — a page-level connection to the Hermes TUI gateway.
 *
 * The dashboard hosts /api/ws (the TUI gateway JSON-RPC over WebSocket).
 * One connection is shared by the whole chat page: the session list, the
 * new-session flow, and the active conversation all talk to it. This
 * keeps ONE session identity — gateway sessions are created directly
 * (no empty API-session husks) and mapped persistently so reopening a
 * conversation resumes the same gateway session for steer/interrupt.
 */
import * as React from 'react';
import { TuiGateway } from './tuiGateway';
import { api } from './api';

export type GatewayStatus = 'off' | 'connecting' | 'on';

export interface GatewayEventLike {
  type: string;
  payload: Record<string, unknown>;
}

const GW_MAP_KEY = 'hermieos_gw_session_map';

/** stored session id → gateway session id (short id used for steer etc.) */
export function gwMapGet(storedId: string): string | null {
  try {
    return JSON.parse(localStorage.getItem(GW_MAP_KEY) ?? '{}')[storedId] ?? null;
  } catch {
    return null;
  }
}
export function gwMapSet(storedId: string, gwSessionId: string): void {
  try {
    const m = JSON.parse(localStorage.getItem(GW_MAP_KEY) ?? '{}');
    m[storedId] = gwSessionId;
    localStorage.setItem(GW_MAP_KEY, JSON.stringify(m));
  } catch { /* */ }
}

export interface GatewayControl {
  status: GatewayStatus;
  gw: TuiGateway | null;
  /** ChatView registers its event handler here (single listener). */
  registerListener: (cb: (ev: GatewayEventLike) => void) => void;
  /** Create a gateway session, optionally seeded with prior history. */
  createGatewaySession: (
    seed?: Array<{ role: string; content: string }>,
    title?: string,
  ) => Promise<{ gwSessionId: string; storedId: string }>;
  /** Resume a stored session on the gateway — the agent is rebuilt on
   *  the FULL stored transcript (tool calls + results included), so the
   *  conversation has real memory and doesn't need session_search. */
  resumeGatewaySession: (
    storedId: string,
  ) => Promise<{ gwSessionId: string; storedId: string; messageCount: number }>;
}

export function useGatewayControl(): GatewayControl {
  const [status, setStatus] = React.useState<GatewayStatus>('off');
  const gwRef = React.useRef<TuiGateway | null>(null);
  const listenerRef = React.useRef<((ev: GatewayEventLike) => void) | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { wsUrl, ticket } = await api.dashboardTicket();
        const g = new TuiGateway();
        gwRef.current = g;
        g.onEvent((ev) => {
          listenerRef.current?.(ev);
        });
        await g.connect(`${wsUrl}?ticket=${encodeURIComponent(ticket)}`);
        if (!cancelled) setStatus('on');
      } catch {
        if (!cancelled) setStatus('off');
      }
    })();
    return () => {
      cancelled = true;
      gwRef.current?.close();
      gwRef.current = null;
    };
  }, []);

  const registerListener = React.useCallback((cb: (ev: GatewayEventLike) => void) => {
    listenerRef.current = cb;
  }, []);

  const createGatewaySession = React.useCallback(
    async (seed?: Array<{ role: string; content: string }>, title?: string) => {
      const g = gwRef.current;
      if (!g || !g.ready) throw new Error('gateway not connected');
      const created = await g.request<{ session_id: string; stored_session_id: string }>('session.create', {
        ...(seed && seed.length > 0 ? { messages: seed } : {}),
        ...(title ? { title } : {}),
      });
      gwMapSet(created.stored_session_id, created.session_id);
      return { gwSessionId: created.session_id, storedId: created.stored_session_id };
    },
    [],
  );

  const resumeGatewaySession = React.useCallback(async (storedId: string) => {
    const g = gwRef.current;
    if (!g || !g.ready) throw new Error('gateway not connected');
    const res = await g.request<{ session_id: string; message_count?: number }>('session.resume', {
      session_id: storedId,
    });
    gwMapSet(storedId, res.session_id);
    return { gwSessionId: res.session_id, storedId, messageCount: res.message_count ?? 0 };
  }, []);

  return { status, gw: gwRef.current, registerListener, createGatewaySession, resumeGatewaySession };
}
