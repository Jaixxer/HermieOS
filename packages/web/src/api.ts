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
  body: string | null;
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
  lastRunAt: string | null;
  lastRunId: string | null;
  nextRetryAt: string | null;
  consecutiveFailures: number;
  lastError: string | null;
  /** FK to the categories table. null for non-scout subscriptions. */
  categoryId: string | null;
  /** Legacy free-form category text. Always null for new rows. */
  category: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Category {
  id: string;
  name: string;
  color: string;
  icon: string;
  sortOrder: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SearchHit {
  id: string;
  type: string;
  title: string;
  summary: string | null;
  rank: number;
  snippet: string | null;
}

export interface CalendarEvent {
  id: string;
  externalId: string;
  calendarId: string;
  title: string;
  description: string | null;
  location: string | null;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  status: string;
  attendees: Array<{ email: string; name?: string; responseStatus?: string }>;
}

export interface SignupResponse {
  user: User;
  mcpToken: string;
  token: string;
  /** The API origin the client just talked to. Persist with the
   *  session token so a page refresh can resume without going
   *  through the MCP connect flow. */
  apiBase: string;
}

export interface LoginResponse {
  user: User;
  token: string;
  apiBase: string;
}

export type TaskStatus = 'todo' | 'in_progress' | 'blocked' | 'done' | 'cancelled';
export type TaskCategory = 'work' | 'learning' | 'research' | 'health' | 'admin' | 'personal' | 'other';
export type UpcomingKind = 'appointment' | 'deadline' | 'milestone' | 'reminder' | 'event';
export type OpportunityCategory =
  | 'job'
  | 'startup'
  | 'research_paper'
  | 'saas_idea'
  | 'iot'
  | 'grant'
  | 'competition'
  | 'other';

export interface Task {
  id: string;
  userId: string;
  title: string;
  notes: string | null;
  category: TaskCategory;
  status: TaskStatus;
  priority: number;
  dueAt: string | null;
  completedAt: string | null;
  createdBy: 'user' | 'hermes' | 'system';
  batchId: string | null;
  sentToHermesAt: string | null;
  objectId: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface Upcoming {
  id: string;
  userId: string;
  title: string;
  subtitle: string | null;
  kind: UpcomingKind;
  occursAt: string;
  location: string | null;
  notes: string | null;
  createdBy: 'user' | 'hermes' | 'system';
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export class ApiError extends Error {
  constructor(public status: number, public body: unknown, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface OpportunityBucket {
  // Free-form string; matches objects(type='opportunity').body.kind values.
  // Same as OpportunityCategory union but kept as string for forward-compat.
  category: string;
  total: number;
  unread: number;
}

export interface DashboardOpportunity {
  id: string;
  title: string;
  summary: string | null;
  kind: string;
  status: string;
  priority: number;
  updatedAt: string;
}

export interface GraphNode {
  id: string;
  title: string;
  type: string;
}

export interface GraphLink {
  source: string;
  target: string;
  kind: string;
  confidence: number;
}

export interface DashboardData {
  tasks: {
    today: Task[];
    overdue: Task[];
    completedThisWeek: number;
  };
  upcoming: {
    next7Days: Upcoming[];
    next30Days: Upcoming[];
    next90Days: Upcoming[];
  };
  opportunities: {
    categories: OpportunityBucket[];
    recent: DashboardOpportunity[];
  };
  hermesFeed: {
    events: FeedEvent[];
    hasMore: boolean;
  };
  graph: {
    nodes: GraphNode[];
    links: GraphLink[];
  };
  generatedAt: string;
}

const DEFAULT_BASE = '/api';

let _base = DEFAULT_BASE;
let _token = '';

/** Set the API base URL (called by ServerProvider on connect/disconnect).
 *  In dev (no URL set) the Vite proxy mounts the API at `/api`.
 *  In Electron / remote setups the user provides the full server URL and
 *  the API routes sit at the same origin (no `/api` prefix). */
export function setApiBase(url: string): void {
  _base = url ? url.replace(/\/+$/, '') : DEFAULT_BASE;
}

// ============================================================================
// Chat (Hermes Agent gateway)
// ============================================================================
//
// The chat interface talks to the user's Hermes Agent gateway, which
// lives at a different port (default 8642) from the HermieOS API
// (3001). The Hermes base URL + bearer token are fetched once on
// demand from /me/hermes-info and cached for the session. The token
// is the same MCP token the user copies into the Connect screen —
// every authenticated HermieOS user has one.

export interface HermesInfo {
  /** Public origin of the Hermes gateway, e.g. http://localhost:8642 */
  baseUrl: string;
  /** Bearer token (the user's MCP token) */
  token: string;
}

export type HermesSessionSource =
  | 'api_server'
  | 'hermes_browser'
  | 'browser'
  | 'cli'
  | 'telegram'
  | 'discord'
  | 'slack'
  | 'desktop'
  | 'dashboard'
  | string;

export interface HermesSession {
  id: string;
  source: HermesSessionSource;
  user_id?: string | null;
  model?: string | null;
  title?: string | null;
  started_at?: number;
  ended_at?: number | null;
  end_reason?: string | null;
  message_count: number;
  tool_call_count?: number;
  input_tokens?: number;
  output_tokens?: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  reasoning_tokens?: number;
  estimated_cost_usd?: number;
  actual_cost_usd?: number;
  api_call_count?: number;
  parent_session_id?: string | null;
  last_active?: number;
  preview?: string | null;
  _lineage_root_id?: string | null;
  has_system_prompt?: boolean;
  has_model_config?: boolean;
}

export interface HermesSessionList {
  object: 'list';
  data: HermesSession[];
  limit: number;
  offset: number;
  has_more: boolean;
}

export interface HermesMessage {
  id: string | number;
  session_id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | null;
  tool_call_id?: string | null;
  tool_calls?: unknown[];
  tool_name?: string | null;
  timestamp?: number | null;
  token_count?: number | null;
  finish_reason?: string | null;
  reasoning?: string | null;
  reasoning_content?: string | null;
}

export interface HermesMessageList {
  object: 'list';
  session_id: string;
  data: HermesMessage[];
}

export interface HermesChatResult {
  object: 'hermes.session.chat.completion';
  session_id: string;
  message: { role: 'assistant'; content: string };
  usage?: Record<string, unknown>;
  runtime?: Record<string, unknown>;
}

/** Returns the current API base. Used by AuthProvider to snapshot
 *  the URL that the email login was performed against so a page
 *  refresh can recover it. */
export function getApiBase(): string {
  return _base;
}

/** Set the bearer token for API requests (called by ServerProvider). */
export function setApiToken(token: string): void {
  _token = token;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    ...(init.body ? { 'content-type': 'application/json' } : {}),
    ...(init.headers as Record<string, string> ?? {}),
  };
  if (_token) headers['authorization'] = `Bearer ${_token}`;
  const res = await fetch(`${_base}${path}`, {
    ...init,
    // Use bearer token when available; avoid CORS credentials issues on desktop.
    // Fall back to cookies for the initial web login flow.
    credentials: _token ? 'same-origin' : 'include',
    headers,
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

/**
 * Send a request to the Hermes Agent gateway using its own base URL
 * and bearer token (the user's MCP token). Returned by the chat
 * page via /me/hermes-info.
 *
 * The Hermes gateway is a different server from the HermieOS API
 * (different port, different auth). It does NOT have CORS preflight
 * for arbitrary origins, so we keep credentials off and send the
 * bearer token manually.
 */
async function hermesRequest<T>(
  info: HermesInfo,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = {
    ...(init.body ? { 'content-type': 'application/json' } : {}),
    ...(init.headers as Record<string, string> ?? {}),
    authorization: `Bearer ${info.token}`,
  };
  const url = `${info.baseUrl.replace(/\/+$/, '')}${path}`;
  const res = await fetch(url, {
    ...init,
    credentials: 'omit',
    headers,
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
  login(body: { email: string; password: string }): Promise<LoginResponse> {
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
  feed(params: { since?: string; limit?: number; kinds?: string } = {}): Promise<{ events: FeedEvent[]; hasMore: boolean }> {
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
  feedbackSummary(params: { days?: number; limit?: number } = {}): Promise<{
    since: string;
    days: number;
    rows: Array<{
      id: string;
      kind: 'like' | 'save' | 'ignore' | 'archive' | 'suggest';
      payload: Record<string, unknown>;
      createdAt: string;
      object: { id: string; type: string; title: string; summary: string | null };
    }>;
    stats: {
      total: number;
      byKind: Record<'like' | 'save' | 'ignore' | 'archive' | 'suggest', number>;
      likedOrSavedByType: Record<string, number>;
      suggestNotes: Array<{ objectId: string; objectTitle: string; note: string }>;
    };
  }> {
    const sp = new URLSearchParams();
    if (params.days) sp.set('days', String(params.days));
    if (params.limit) sp.set('limit', String(params.limit));
    const qs = sp.toString();
    return request(`/feedback/summary${qs ? `?${qs}` : ''}`);
  },
  // --- Calendar ---
  calendarAuthStatus(): Promise<{
    connected: boolean;
    email: string | null;
    scope: string | null;
    expiresAt: string | null;
    configured: boolean;
  }> {
    return request('/calendar/auth/status');
  },
  calendarAuthUrl(redirect: string): Promise<{ url: string }> {
    return request(`/calendar/auth/url?redirect=${encodeURIComponent(redirect)}`);
  },
  calendarDisconnect(): Promise<{ ok: true }> {
    return request('/calendar/auth', { method: 'DELETE' });
  },
  calendarListEvents(params: { from?: string; to?: string; limit?: number } = {}): Promise<{ events: CalendarEvent[] }> {
    const sp = new URLSearchParams();
    if (params.from) sp.set('from', params.from);
    if (params.to) sp.set('to', params.to);
    if (params.limit) sp.set('limit', String(params.limit));
    const qs = sp.toString();
    return request(`/calendar/events${qs ? `?${qs}` : ''}`);
  },
  calendarCreateEvent(body: {
    externalId: string;
    title: string;
    startsAt: string;
    endsAt: string;
    calendarId?: string;
    description?: string;
    location?: string;
    allDay?: boolean;
    attendees?: Array<{ email: string; name?: string }>;
  }): Promise<{ event: CalendarEvent }> {
    return request('/calendar/events', { method: 'POST', body: JSON.stringify(body) });
  },
  calendarUpdateEvent(id: string, body: Partial<{
    externalId: string;
    title: string;
    startsAt: string;
    endsAt: string;
    calendarId: string;
    description: string;
    location: string;
    allDay: boolean;
    attendees: Array<{ email: string; name?: string }>;
  }>): Promise<{ event: CalendarEvent }> {
    return request(`/calendar/events/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
  },
  calendarDeleteEvent(id: string): Promise<{ ok: true }> {
    return request(`/calendar/events/${id}`, { method: 'DELETE' });
  },
  calendarSync(body: { from?: string; to?: string } = {}): Promise<{ upserted: number; email: string }> {
    return request('/calendar/sync', { method: 'POST', body: JSON.stringify(body) });
  },
  subscriptions(status?: string): Promise<{ subscriptions: Subscription[] }> {
    const q = status ? `?status=${encodeURIComponent(status)}` : '';
    return request(`/subscriptions${q}`);
  },
  createSubscription(body: {
    name: string;
    target: string;
    instruction: string;
    cadence: string;
    categoryId?: string;
    categoryName?: string;
  }): Promise<{ subscription: Subscription }> {
    return request('/subscriptions', { method: 'POST', body: JSON.stringify(body) });
  },
  updateSubscription(id: string, body: Partial<{ name: string; instruction: string; cadence: string; status: string; categoryId: string | null }>): Promise<{ subscription: Subscription }> {
    return request(`/subscriptions/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
  },
  archiveSubscription(id: string): Promise<{ subscription: Subscription }> {
    return request(`/subscriptions/${id}/archive`, { method: 'POST' });
  },
  runs(limit = 20): Promise<{ runs: Array<{ id: string; kind: string; status: string; createdAt: string }> }> {
    return request(`/runs?limit=${limit}`);
  },

  // Per-scout endpoints (used by the Scouting page)
  scoutMetrics(subscriptionId: string): Promise<{
    totalRuns: number;
    succeededRuns: number;
    failedRuns: number;
    cancelledRuns: number;
    last7DaysRuns: number;
    last7DaysSucceeded: number;
    avgRuntimeMs: number | null;
    opportunitiesCreated: number;
    topSources: Array<{ source: string; count: number }>;
    lastSuccessAt: string | null;
    lastRunAt: string | null;
  }> {
    return request(`/subscriptions/${encodeURIComponent(subscriptionId)}/metrics`);
  },
  scoutRuns(subscriptionId: string, limit = 50): Promise<{ runs: Array<{
    id: string;
    userId: string;
    kind: string;
    subscriptionId: string | null;
    prompt: string;
    hermesRunId: string | null;
    attempt: number;
    status: string;
    startedAt: string | null;
    finishedAt: string | null;
    error: string | null;
    createdAt: string;
  }> }> {
    return request(`/subscriptions/${encodeURIComponent(subscriptionId)}/runs?limit=${limit}`);
  },
  scoutFindings(subscriptionId: string, limit = 20): Promise<{ objects: ObjectSummary[] }> {
    return request(`/subscriptions/${encodeURIComponent(subscriptionId)}/findings?limit=${limit}`);
  },
  runScoutNow(subscriptionId: string): Promise<{ subscription: Subscription }> {
    return request(`/subscriptions/${encodeURIComponent(subscriptionId)}/run-now`, { method: 'POST' });
  },

  // Categories
  categories(opts: { includeArchived?: boolean } = {}): Promise<{ categories: Category[] }> {
    const q = new URLSearchParams();
    if (opts.includeArchived) q.set('includeArchived', 'true');
    const qs = q.toString();
    return request(`/categories${qs ? `?${qs}` : ''}`);
  },
  createCategory(body: { name: string; color?: string; icon?: string }): Promise<{ category: Category }> {
    return request('/categories', { method: 'POST', body: JSON.stringify(body) });
  },
  updateCategory(
    id: string,
    body: { name?: string; color?: string; icon?: string; sortOrder?: number },
  ): Promise<{ category: Category }> {
    return request(`/categories/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) });
  },
  archiveCategory(id: string): Promise<{ category: Category }> {
    return request(`/categories/${encodeURIComponent(id)}/archive`, { method: 'POST' });
  },
  listObjects(params: { type?: string; limit?: number } = {}): Promise<{ objects: ObjectSummary[]; nextCursor: string | null }> {
    const qs = new URLSearchParams();
    if (params.type) qs.set('type', params.type);
    if (params.limit) qs.set('limit', String(params.limit));
    const q = qs.toString();
    return request(`/objects${q ? `?${q}` : ''}`);
  },
  createObject(body: {
    type: string;
    title: string;
    summary?: string;
    body?: Record<string, unknown>;
    status?: string;
    tags?: string[];
  }): Promise<{ object: ObjectSummary }> {
    return request('/objects', { method: 'POST', body: JSON.stringify(body) });
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
  graph(): Promise<{ nodes: Array<{ id: string; title: string; type: string; priority: number }>; links: Array<{ source: string; target: string; kind: string; confidence: number; reason: string }> }> {
    return request('/graph');
  },
  deleteAccount(body: { confirmation: string }): Promise<{ ok: true }> {
    return request('/me/delete', { method: 'POST', body: JSON.stringify(body) });
  },

  // --- Dashboard ---

  dashboard(): Promise<DashboardData> {
    return request('/dashboard');
  },

  // Tasks
  listTasks(params: { status?: TaskStatus; category?: TaskCategory; batchId?: string; limit?: number } = {}): Promise<{ tasks: Task[]; hasMore: boolean }> {
    const qs = new URLSearchParams();
    if (params.status) qs.set('status', params.status);
    if (params.category) qs.set('category', params.category);
    if (params.batchId) qs.set('batchId', params.batchId);
    if (params.limit) qs.set('limit', String(params.limit));
    const q = qs.toString();
    return request(`/tasks${q ? `?${q}` : ''}`);
  },
  createTask(body: { title: string; notes?: string; category?: TaskCategory; status?: TaskStatus; priority?: number; dueAt?: string; objectId?: string; batchId?: string }): Promise<{ task: Task }> {
    return request('/tasks', { method: 'POST', body: JSON.stringify(body) });
  },
  updateTask(id: string, body: { title?: string; notes?: string; category?: TaskCategory; status?: TaskStatus; priority?: number; dueAt?: string | null }): Promise<{ task: Task }> {
    return request(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
  },
  archiveTask(id: string): Promise<{ archived: boolean }> {
    return request(`/tasks/${id}`, { method: 'DELETE' });
  },
  sendTasksToHermes(taskIds: string[], prompt?: string): Promise<{ updated: number; prompt: string }> {
    return request('/tasks/send-to-hermes', { method: 'POST', body: JSON.stringify({ taskIds, prompt }) });
  },

  // Upcoming
  listUpcoming(params: { days?: number; kind?: UpcomingKind; limit?: number } = {}): Promise<{ items: Upcoming[]; hasMore: boolean }> {
    const qs = new URLSearchParams();
    if (params.days) qs.set('days', String(params.days));
    if (params.kind) qs.set('kind', params.kind);
    if (params.limit) qs.set('limit', String(params.limit));
    const q = qs.toString();
    return request(`/upcoming${q ? `?${q}` : ''}`);
  },
  createUpcoming(body: { title: string; subtitle?: string; kind?: UpcomingKind; occursAt: string; location?: string; notes?: string }): Promise<{ upcoming: Upcoming }> {
    return request('/upcoming', { method: 'POST', body: JSON.stringify(body) });
  },
  updateUpcoming(id: string, body: { title?: string; subtitle?: string; kind?: UpcomingKind; occursAt?: string; location?: string; notes?: string }): Promise<{ upcoming: Upcoming }> {
    return request(`/upcoming/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
  },
  archiveUpcoming(id: string): Promise<{ archived: boolean }> {
    return request(`/upcoming/${id}`, { method: 'DELETE' });
  },

  // Opportunities
  // Opportunities are now objects(type='opportunity'). Use the object methods
  // above (listObjects with type='opportunity', updateObject to mark read via
  // status='archived'). The /dashboard endpoint returns pre-aggregated buckets.

  // --- Chat (Hermes Agent gateway) ---

  /** Returns the user's Hermes base URL + MCP bearer token. */
  hermesInfo(): Promise<HermesInfo> {
    return request('/me/hermes-info');
  },

  /** List all persisted Hermes sessions across every gateway/source. */
  hermesListSessions(info: HermesInfo, params?: { limit?: number; offset?: number; source?: string }): Promise<HermesSessionList> {
    const search = new URLSearchParams();
    if (params?.limit !== undefined) search.set('limit', String(params.limit));
    if (params?.offset !== undefined) search.set('offset', String(params.offset));
    if (params?.source) search.set('source', params.source);
    const qs = search.toString();
    return hermesRequest<HermesSessionList>(info, `/api/sessions${qs ? `?${qs}` : ''}`);
  },

  /** Read all messages for a Hermes session. */
  hermesGetMessages(info: HermesInfo, sessionId: string): Promise<HermesMessageList> {
    return hermesRequest<HermesMessageList>(info, `/api/sessions/${encodeURIComponent(sessionId)}/messages`);
  },

  /** Read a single session's metadata. */
  hermesGetSession(info: HermesInfo, sessionId: string): Promise<{ object: string; session: HermesSession }> {
    return hermesRequest<{ object: string; session: HermesSession }>(info, `/api/sessions/${encodeURIComponent(sessionId)}`);
  },

  /** Create an empty session, optionally with a chosen model and id. */
  hermesCreateSession(info: HermesInfo, body: { id?: string; model?: string; source?: string }): Promise<{ object: string; session: HermesSession }> {
    return hermesRequest<{ object: string; session: HermesSession }>(info, '/api/sessions', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  /** Delete a session. */
  hermesDeleteSession(info: HermesInfo, sessionId: string): Promise<unknown> {
    return hermesRequest(info, `/api/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
  },

  /** Rename a session. Empty string clears the title. */
  hermesRenameSession(info: HermesInfo, sessionId: string, title: string): Promise<{ object: string; session: HermesSession }> {
    return hermesRequest<{ object: string; session: HermesSession }>(info, `/api/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    });
  },

  /** Send one user turn to a session and get the assistant reply. */
  hermesChat(info: HermesInfo, sessionId: string, body: {
    message: string;
    model?: string;
    system_message?: string;
    /** Per-message agent toggles, e.g. { yolo: true, model: "..." } */
    model_options?: Record<string, unknown>;
  }): Promise<HermesChatResult> {
    return hermesRequest<HermesChatResult>(
      info,
      `/api/sessions/${encodeURIComponent(sessionId)}/chat`,
      { method: 'POST', body: JSON.stringify(body) },
    );
  },
};

export function sseUrl(): string {
  return `${_base}/events`;
}
