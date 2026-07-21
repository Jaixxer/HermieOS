export interface User {
  id: string;
  email: string;
  displayName: string;
  schedulerEnabled: boolean;
  createdAt: string;
}

export interface FeedEvent {
  id: string;
  userId: string;
  kind: string;
  objectId: string | null;
  title: string;
  payload: Record<string, unknown>;
  createdAt: string;
  readAt: string | null;
}

export interface ObjectSummary {
  id: string;
  type: string;
  status: string;
  title: string;
  summary: string | null;
  priority: number;
  tags: string[];
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ObjectDetail extends ObjectSummary {
  body: Record<string, unknown>;
  related: Array<{ id: string; type: string; title: string; reason: string | null; confidence: number }>;
}

export interface ObjectRevision {
  id: string;
  objectId: string;
  revision: number;
  title: string;
  summary: string | null;
  body: Record<string, unknown>;
  priority: number;
  tags: string[];
  reason: string | null;
  createdBy: string;
  createdAt: string;
}

export interface ObjectEvent {
  id: string;
  objectId: string;
  kind: string;
  payload: Record<string, unknown>;
  actor: string;
  createdAt: string;
}

export interface Subscription {
  id: string;
  name: string;
  target: string;
  instruction: string;
  cadence: string;
  status: string;
  nextRunAt: string | null;
  consecutiveFailures: number;
  lastError: string | null;
  createdAt: string;
}

export interface SearchHit {
  id: string;
  type: string;
  title: string;
  summary: string | null;
  rank: number;
  snippet: string | null;
}

export interface SignupResponse {
  user: User;
  mcpToken: string;
}

export class ApiError extends Error {
  constructor(public status: number, public body: unknown, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

const BASE = '/api';

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = await res.text().catch(() => null);
    }
    const message = (body && typeof body === 'object' && 'message' in body
      ? String((body as { message: unknown }).message)
      : `HTTP ${res.status}`);
    throw new ApiError(res.status, body, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  signup(body: { email: string; password: string; displayName?: string }): Promise<SignupResponse> {
    return request('/auth/signup', { method: 'POST', body: JSON.stringify(body) });
  },
  login(body: { email: string; password: string }): Promise<{ user: User }> {
    return request('/auth/login', { method: 'POST', body: JSON.stringify(body) });
  },
  logout(): Promise<{ ok: true }> {
    return request('/auth/logout', { method: 'POST' });
  },
  me(): Promise<{ user: User }> {
    return request('/me');
  },
  updateMe(body: { displayName?: string }): Promise<{ user: User }> {
    return request('/me', { method: 'PATCH', body: JSON.stringify(body) });
  },
  setScheduler(enabled: boolean): Promise<{ user: User }> {
    return request('/me/scheduler', { method: 'PATCH', body: JSON.stringify({ enabled }) });
  },
  rotateMcpToken(): Promise<{ mcpToken: string }> {
    return request('/me/mcp-token/rotate', { method: 'POST' });
  },
  feed(params: { since?: string; limit?: number; kinds?: string } = {}): Promise<{ events: FeedEvent[] }> {
    const q = new URLSearchParams();
    if (params.since) q.set('since', params.since);
    if (params.limit) q.set('limit', String(params.limit));
    if (params.kinds) q.set('kinds', params.kinds);
    const qs = q.toString();
    return request(`/feed${qs ? `?${qs}` : ''}`);
  },
  unreadCount(): Promise<{ unread: number }> {
    return request('/feed/unread-count');
  },
  markFeedRead(upTo: string): Promise<{ ok: true }> {
    return request('/feed/mark-read', { method: 'POST', body: JSON.stringify({ upTo }) });
  },
  object(id: string): Promise<{ object: ObjectDetail }> {
    return request(`/objects/${id}`);
  },
  objectTimeline(id: string, params: { limit?: number; cursor?: string } = {}): Promise<{ events: ObjectEvent[]; nextCursor: string | null }> {
    const q = new URLSearchParams();
    if (params.limit) q.set('limit', String(params.limit));
    if (params.cursor) q.set('cursor', params.cursor);
    const qs = q.toString();
    return request(`/objects/${id}/timeline${qs ? `?${qs}` : ''}`);
  },
  objectRevisions(id: string, params: { limit?: number; cursor?: string } = {}): Promise<{ revisions: ObjectRevision[]; nextCursor: string | null }> {
    const q = new URLSearchParams();
    if (params.limit) q.set('limit', String(params.limit));
    if (params.cursor) q.set('cursor', params.cursor);
    const qs = q.toString();
    return request(`/objects/${id}/revisions${qs ? `?${qs}` : ''}`);
  },
  objectRevision(id: string, revision: number): Promise<{ revision: ObjectRevision }> {
    return request(`/objects/${id}/revisions/${revision}`);
  },
  revertObject(id: string, revision: number): Promise<{ object: ObjectSummary }> {
    return request(`/objects/${id}/revert`, { method: 'POST', body: JSON.stringify({ revision }) });
  },
  archiveObject(id: string): Promise<{ object: ObjectSummary }> {
    return request(`/objects/${id}/archive`, { method: 'POST' });
  },
  search(q: string, params: { type?: string; limit?: number } = {}): Promise<{ hits: SearchHit[] }> {
    const sp = new URLSearchParams({ q });
    if (params.type) sp.set('type', params.type);
    if (params.limit) sp.set('limit', String(params.limit));
    return request(`/search?${sp.toString()}`);
  },
  recordFeedback(objectId: string, body: { kind: 'like' | 'save' | 'ignore' | 'archive' | 'suggest'; note?: string }): Promise<{ ok: true }> {
    return request(`/objects/${objectId}/feedback`, { method: 'POST', body: JSON.stringify(body) });
  },
  subscriptions(status?: string): Promise<{ subscriptions: Subscription[] }> {
    const q = status ? `?status=${encodeURIComponent(status)}` : '';
    return request(`/subscriptions${q}`);
  },
  createSubscription(body: { name: string; target: string; instruction: string; cadence: string }): Promise<{ subscription: Subscription }> {
    return request('/subscriptions', { method: 'POST', body: JSON.stringify(body) });
  },
  updateSubscription(id: string, body: Partial<{ name: string; instruction: string; cadence: string; status: string }>): Promise<{ subscription: Subscription }> {
    return request(`/subscriptions/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
  },
  archiveSubscription(id: string): Promise<{ subscription: Subscription }> {
    return request(`/subscriptions/${id}/archive`, { method: 'POST' });
  },
  runs(limit = 20): Promise<{ runs: Array<{ id: string; kind: string; status: string; createdAt: string }> }> {
    return request(`/runs?limit=${limit}`);
  },
  pushVapidKey(): Promise<{ publicKey: string }> {
    return request('/me/push-vapid-key');
  },
  savePushSubscription(body: { endpoint: string; keys: { auth: string; p256dh: string }; userAgent?: string }): Promise<{ ok: true }> {
    return request('/me/push-subscription', { method: 'POST', body: JSON.stringify(body) });
  },
  removePushSubscription(body: { endpoint: string }): Promise<{ ok: true }> {
    return request('/me/push-subscription', { method: 'DELETE', body: JSON.stringify(body) });
  },
};

export function sseUrl(): string {
  return `${BASE}/events`;
}
