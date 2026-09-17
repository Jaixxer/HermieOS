import * as React from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Send,
  MessageSquare,
  Trash2,
  Loader2,
  RefreshCw,
  Hash,
  Sparkles,
  Search,
  Bot,
  User as UserIcon,
  AlertCircle,
  Settings as SettingsIcon,
  Pencil,
  Wrench,
  Square,
  ChevronDown,
  Menu as MenuIcon,
  Minimize2,
  Bell,
  ArrowRight,
} from 'lucide-react';
import { api, type HermesSession, type HermesMessage, type HermesInfo } from '../api';
import { TuiGateway } from '../tuiGateway';
import { useGatewayControl, gwMapGet, type GatewayControl } from '../gatewayControl';
import { cn, formatRelative } from '../lib/utils';
import { useServer } from '../server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Command — the conversation pane with Hermes Agent.
 *
 * 3-column editorial frame: nav rail | session archive (light) | the
 * conversation. Hermes answers as white hard-edged cards; your messages
 * are solid ink blocks; system lines and tool traces read as log rows.
 * Sessions are read live from Hermes' own store via GET /api/sessions.
 */

interface SlashCommand {
  cmd: string;
  label: string;
  hint: string;
  cliOnly?: boolean;
}

const SESSIONS_PAGE_SIZE = 20;

const SLASH_COMMANDS: SlashCommand[] = [
  // Session management
  { cmd: '/new', label: 'New session', hint: 'start a fresh session' },
  { cmd: '/reset', label: 'Reset context', hint: 'clear conversation history' },
  { cmd: '/undo', label: 'Undo last turn', hint: 'revert N user turns' },
  { cmd: '/retry', label: 'Retry', hint: 'resend last message to the agent' },
  { cmd: '/stop', label: 'Stop agent', hint: 'interrupt the running agent' },
  { cmd: '/steer', label: 'Steer next response', hint: 'inject steering after the next tool call' },
  { cmd: '/queue', label: 'Queue message', hint: 'queue for the next turn without interrupting' },
  { cmd: '/background', label: 'Background prompt', hint: 'run a prompt in the background' },
  { cmd: '/branch', label: 'Branch session', hint: 'fork the conversation' },
  { cmd: '/compress', label: 'Compress context', hint: 'compact conversation to save tokens' },
  { cmd: '/title', label: 'Set title', hint: 'rename this session' },
  { cmd: '/resume', label: 'Resume session', hint: 'resume a named session' },
  { cmd: '/sessions', label: 'Browse sessions', hint: 'list and resume past sessions' },
  { cmd: '/approve', label: 'Approve pending', hint: 'approve a pending dangerous command' },
  { cmd: '/deny', label: 'Deny pending', hint: 'deny a pending dangerous command' },
  { cmd: '/goal', label: 'Set goal', hint: 'set a standing goal Hermes works on' },
  { cmd: '/subgoal', label: 'Sub-goal', hint: 'add extra criteria on the active goal' },
  { cmd: '/status', label: 'Session status', hint: 'show session, model, token info' },
  // Configuration
  { cmd: '/model', label: 'Switch model', hint: '/model name --provider provider' },
  { cmd: '/fast', label: 'Fast mode', hint: 'toggle fast mode on/off' },
  { cmd: '/yolo', label: 'YOLO mode', hint: 'toggle auto-approve tool calls' },
  { cmd: '/reasoning', label: 'Reasoning effort', hint: 'low / medium / high --global' },
  { cmd: '/personality', label: 'Personality', hint: 'helpful / concise / pirate / …' },
  { cmd: '/voice', label: 'Voice mode', hint: 'toggle voice mode' },
  { cmd: '/footer', label: 'Metadata footer', hint: 'toggle runtime footer on replies' },
  { cmd: '/verbose', label: 'Verbose tools', hint: 'cycle tool progress display' },
  // Tools & Skills
  { cmd: '/skills', label: 'Manage skills', hint: 'search / install / inspect skills' },
  { cmd: '/memory', label: 'Memory', hint: 'review pending memory writes' },
  { cmd: '/learn', label: 'Learn skill', hint: 'learn a reusable skill from chat' },
  { cmd: '/tools', label: 'List tools', hint: 'show available MCP tools' },
  { cmd: '/reload-mcp', label: 'Reload MCP', hint: 'reload MCP servers from config', cliOnly: true },
  { cmd: '/reload-skills', label: 'Reload skills', hint: 'rescan skills directory', cliOnly: true },
  { cmd: '/blueprint', label: 'Blueprint', hint: 'set up automation from a blueprint' },
  // Info
  { cmd: '/help', label: 'Help', hint: 'show available commands' },
  { cmd: '/commands', label: 'All commands', hint: 'browse all commands and skills' },
  { cmd: '/usage', label: 'Usage', hint: 'show token usage and rate limits' },
  { cmd: '/version', label: 'Version', hint: 'show Hermes Agent version' },
  { cmd: '/debug', label: 'Debug report', hint: 'upload system info and logs' },
  { cmd: '/profile', label: 'Profile', hint: 'show active profile name' },
  { cmd: '/whoami', label: 'Access level', hint: 'show your slash command access level' },
];

interface SessionGroup {
  source: string;
  label: string;
  sessions: HermesSession[];
}

const SOURCE_LABELS: Record<string, string> = {
  api_server: 'API',
  hermes_browser: 'Browser',
  browser: 'Browser',
  cli: 'CLI',
  telegram: 'Telegram',
  discord: 'Discord',
  slack: 'Slack',
  desktop: 'Desktop',
  dashboard: 'Dashboard',
  email: 'Email',
  whatsapp: 'WhatsApp',
  cron: 'Cron',
};

export function ChatPage(): React.JSX.Element {
  const { sessionId } = useParams<{ sessionId?: string }>();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { connected } = useServer();
  const gateway = useGatewayControl();

  // Hermes gateway URL + bearer token (the user's MCP token).
  // Fetched once and cached for the page lifetime.
  const hermesInfo = useQuery({
    queryKey: ['hermes-info'],
    queryFn: () => api.hermesInfo(),
    enabled: connected,
    staleTime: 60 * 60 * 1000, // 1 hour
  });

  // Latest 20 sessions, then older pages on scroll. Paginating keeps
  // the initial paint cheap for users with long histories.
  const sessionsQ = useInfiniteQuery({
    queryKey: ['hermes-sessions'],
    queryFn: ({ pageParam }) =>
      api.hermesListSessions(hermesInfo.data!, {
        limit: SESSIONS_PAGE_SIZE,
        offset: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (last, allPages) =>
      // Guard the empty-page edge: a has_more=true with zero rows must
      // not loop forever.
      last.has_more && last.data.length > 0 ? allPages.length * SESSIONS_PAGE_SIZE : undefined,
    // When the API reports the Hermes gateway is not configured
    // (neither HERMES_PUBLIC_URL nor HERMES_GATEWAY_URL set), the
    // baseUrl is a best guess and /api/sessions would 404 forever —
    // don't poll it masking the failure.
    enabled: !!hermesInfo.data && hermesInfo.data.gatewayConfigured,
    // Surface terminal errors (404/ECONNREFUSED) instead of silently
    // retrying them forever.
    retry: 1,
  });

  const allSessions = React.useMemo(
    () => sessionsQ.data?.pages.flatMap((p) => p.data) ?? [],
    [sessionsQ.data],
  );

  const activeTitle = React.useMemo(() => {
    if (!sessionId) return null;
    const s = allSessions.find((x) => x.id === sessionId);
    if (!s) return null;
    return s.title || s.preview || null;
  }, [allSessions, sessionId]);

  const renameMutation = useMutation({
    mutationFn: async (newTitle: string) => {
      if (!hermesInfo.data || !sessionId) throw new Error('no active session');
      const res = await api.hermesRenameSession(hermesInfo.data, sessionId, newTitle.trim());
      return res.session;
    },
    onSuccess: () => {
      void sessionsQ.refetch();
    },
  });

  return (
    <div className="h-screen overflow-hidden flex bg-p5-cream text-p5-dark flex-1 min-w-0">
      <main className="flex-1 min-w-0 min-h-0 flex flex-col">
        <ChatHeader
          info={hermesInfo.data ?? null}
          loading={hermesInfo.isLoading}
          error={hermesInfo.error as Error | null}
          onRetry={() => hermesInfo.refetch()}
          title={activeTitle}
          onRename={sessionId ? (t) => renameMutation.mutateAsync(t).then(() => undefined) : undefined}
        />
        <div className="flex-1 min-h-0 flex">
          {hermesInfo.data ? (
            hermesInfo.data.gatewayConfigured ? (
              <ChatBody
                info={hermesInfo.data}
                activeSessionId={sessionId ?? null}
                onSelect={(id) => nav(`/chat/${id}`)}
                sessions={allSessions}
                loading={sessionsQ.isLoading}
                error={sessionsQ.error as Error | null}
                hasMore={sessionsQ.hasNextPage ?? false}
                loadingMore={sessionsQ.isFetchingNextPage}
                onLoadMore={() => void sessionsQ.fetchNextPage()}
                onRefresh={() => void sessionsQ.refetch()}
                gateway={gateway}
              />
            ) : (
              <GatewayNotConfigured info={hermesInfo.data} onRetry={() => hermesInfo.refetch()} />
            )
          ) : hermesInfo.isLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="font-mono text-[12px] tracking-widest text-p5-dark-muted">CONNECTING TO HERMES AGENT…</div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="w-full max-w-md mx-6 border-2 border-black/15 bg-p5-panel p-8 text-center space-y-3">
                <AlertCircle className="w-8 h-8 mx-auto text-status-failed" />
                <p className="text-[15px] font-black tracking-tight text-p5-dark">
                  Couldn't connect to Hermes Agent
                </p>
                <p className="text-[12px] text-p5-dark-muted">
                  {(hermesInfo.error as Error | null)?.message ?? 'Unknown error'}
                </p>
                <button
                  type="button"
                  onClick={() => hermesInfo.refetch()}
                  className="inline-flex items-center gap-1.5 bg-accent px-4 py-2 text-[11px] font-black tracking-[0.12em] text-white transition hover:bg-accent-hover"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Retry
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

// ============================================================================
// Header bar
// ============================================================================

/**
 * The API has no Hermes gateway configured (neither HERMES_PUBLIC_URL
 * nor HERMES_GATEWAY_URL). Chat cannot work without it — show the fix
 * instead of an infinite spinner.
 */
function GatewayNotConfigured({
  info,
  onRetry,
}: {
  info: HermesInfo;
  onRetry: () => void;
}): React.JSX.Element {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="w-full max-w-md mx-6 border-2 border-black/15 bg-p5-panel p-8 text-center space-y-3">
        <AlertCircle className="w-8 h-8 mx-auto text-status-failed" />
        <p className="text-[15px] font-black tracking-tight text-p5-dark">
          Hermes gateway not configured
        </p>
        <p className="text-[12px] text-p5-dark-muted">
          The HermieOS API server has no HERMES_PUBLIC_URL or HERMES_GATEWAY_URL set, so it
          cannot tell the app where the Hermes API server (port 8642) lives.
        </p>
        <p className="text-[11px] text-p5-dark-muted font-mono break-all">
          attempted: {info.baseUrl}
        </p>
        <p className="text-[12px] text-p5-dark-muted text-left border border-black/10 bg-white p-3">
          On the server, set one of the following in <code>.env</code> and restart the API:
          <br />
          <code>HERMES_GATEWAY_URL=http://127.0.0.1:8642</code>
          <br />
          or, for browser/mobile access, <code>HERMES_PUBLIC_URL=http://&lt;host&gt;:8642</code>.
          The Hermes API server is part of <code>hermes gateway run</code> (or the compose
          <code> hermes</code> service) — a messaging-gateway-only install will not serve it.
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 bg-accent px-4 py-2 text-[11px] font-black tracking-[0.12em] text-white transition hover:bg-accent-hover"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Retry
        </button>
      </div>
    </div>
  );
}

function ChatHeader({
  info,
  loading,
  error,
  onRetry,
  title,
  onRename,
}: {
  info: HermesInfo | null;
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
  title?: string | null;
  onRename?: (newTitle: string) => Promise<void>;
}): React.JSX.Element {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(title ?? '');
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!editing) setDraft(title ?? '');
  }, [title, editing]);

  async function save(): Promise<void> {
    if (!onRename) return;
    setBusy(true);
    try {
      await onRename(draft);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="h-[52px] shrink-0 px-6 border-b border-black/10 flex items-center gap-3 bg-p5-cream">
      <Link to="/chat" className="flex items-center gap-2 min-h-[44px] text-p5-dark">
        <MessageSquare className="w-4 h-4 text-accent" />
        <span className="text-[11px] font-black tracking-[0.16em] uppercase">Command</span>
      </Link>
      <span className="text-[11px] text-p5-dark-muted">/</span>
      {editing ? (
        <form
          className="flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Session title"
            className="h-7 w-64 border border-p5-dark-line bg-white px-2 text-[12px] text-p5-dark outline-none placeholder:text-p5-dark-muted focus:border-accent"
            disabled={busy}
          />
          <button type="submit" disabled={busy} className="bg-accent px-2.5 py-1 text-[10px] font-black tracking-[0.12em] text-white transition hover:bg-accent-hover disabled:opacity-40">
            Save
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setDraft(title ?? '');
            }}
            disabled={busy}
            className="px-2.5 py-1 text-[10px] font-black tracking-[0.12em] text-p5-dark-muted transition hover:text-p5-dark"
          >
            Cancel
          </button>
        </form>
      ) : title ? (
        <button
          type="button"
          className="group flex items-center gap-1 text-[12px] text-p5-dark-muted hover:text-p5-dark transition"
          onClick={() => onRename && setEditing(true)}
          title="Click to rename"
        >
          <span className="truncate max-w-[300px] font-mono">{title}</span>
          {onRename ? <Pencil className="w-3 h-3 opacity-0 group-hover:opacity-100 transition" /> : null}
        </button>
      ) : (
        <span className="text-[12px] text-p5-dark-muted font-mono">Hermes Agent</span>
      )}
      <div className="ml-auto flex items-center gap-3">
        {info ? (
          <>
            <span
              className="text-[11px] text-p5-dark-muted font-mono"
              data-testid="hermes-base-url"
              title={info.baseUrl}
            >
              {info.baseUrl.replace(/^https?:\/\//, '')}
            </span>
            <span className="w-1.5 h-1.5 rounded-full bg-accent" />
          </>
        ) : loading ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin text-p5-dark-muted" />
        ) : error ? (
          <button
            onClick={onRetry}
            className="text-[11px] text-status-failed hover:underline flex items-center gap-1"
          >
            <AlertCircle className="w-3.5 h-3.5" />
            Reconnect
          </button>
        ) : null}
        <Link to="/settings" className="text-p5-dark-muted hover:text-p5-dark transition" title="Settings">
          <SettingsIcon className="w-4 h-4" />
        </Link>
      </div>
    </div>
  );
}

// ============================================================================
// Chat body — session archive + active conversation
// ============================================================================

function ChatBody({
  info,
  activeSessionId,
  onSelect,
  sessions,
  loading,
  error,
  hasMore,
  loadingMore,
  onLoadMore,
  onRefresh,
  gateway,
}: {
  info: HermesInfo;
  activeSessionId: string | null;
  onSelect: (id: string) => void;
  sessions: HermesSession[];
  loading: boolean;
  error: Error | null;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onRefresh: () => void;
  gateway: GatewayControl;
}): React.JSX.Element {
  const qc = useQueryClient();

  // Local filter state
  const [filter, setFilter] = React.useState('');
  const [sourceFilter, setSourceFilter] = React.useState<string | null>(null);
  // Mobile archive drawer (the panel is side-by-side on desktop)
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  // Group sessions by source so the user can find Discord/Telegram/etc.
  const groups = React.useMemo(() => {
    const filtered = sessions
      .filter((s) => {
        if (sourceFilter && s.source !== sourceFilter) return false;
        if (filter) {
          const q = filter.toLowerCase();
          if (
            !s.title?.toLowerCase().includes(q) &&
            !s.id.toLowerCase().includes(q) &&
            !s.preview?.toLowerCase().includes(q)
          ) {
            return false;
          }
        }
        return true;
      })
      .sort((a, b) => (b.last_active ?? 0) - (a.last_active ?? 0));
    const map = new Map<string, HermesSession[]>();
    for (const s of filtered) {
      const key = s.source || 'unknown';
      const list = map.get(key) ?? [];
      list.push(s);
      map.set(key, list);
    }
    return Array.from(map.entries())
      .map(([source, list]) => ({
        source,
        label: SOURCE_LABELS[source] ?? source,
        sessions: list,
      }))
      .sort((a, b) => b.sessions.length - a.sessions.length);
  }, [sessions, filter, sourceFilter]);

  const sourcesInUse = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of sessions) {
      counts.set(s.source, (counts.get(s.source) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [sessions]);

  return (
    <>
      <SessionsPanel
        groups={groups}
        activeSessionId={activeSessionId}
        onSelect={(id) => { onSelect(id); setDrawerOpen(false); }}
        onCreate={() => onSelect('__new__')}
        filter={filter}
        setFilter={setFilter}
        sourceFilter={sourceFilter}
        setSourceFilter={setSourceFilter}
        sources={sourcesInUse.map(([s, n]) => ({ source: s, label: SOURCE_LABELS[s] ?? s, count: n }))}
        loading={loading}
        error={error}
        hasMore={hasMore}
        loadingMore={loadingMore}
        onLoadMore={onLoadMore}
        onRefresh={onRefresh}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onDelete={(id) => {
          void api.hermesDeleteSession(info, id).then(() => {
            qc.invalidateQueries({ queryKey: ['hermes-sessions'] });
          });
        }}
      />
      {activeSessionId === '__new__' ? (
        <NewSessionView
          info={info}
          gateway={gateway}
          onCreated={(id) => onSelect(id)}
          onCancel={() => onSelect('__noop__')}
          onOpenArchive={() => setDrawerOpen(true)}
        />
      ) : activeSessionId ? (
        <ChatView info={info} sessionId={activeSessionId} model={sessions.find(s => s.id === activeSessionId)?.model ?? null} onSelect={onSelect} allSessions={sessions} gateway={gateway} onOpenArchive={() => setDrawerOpen(true)} />
      ) : (
        <EmptyChatState onCreate={() => onSelect('__new__')} onOpenArchive={() => setDrawerOpen(true)} />
      )}
    </>
  );
}

// ============================================================================
// Session archive (left pane)
// ============================================================================

function SessionsPanel({
  groups,
  activeSessionId,
  onSelect,
  onCreate,
  filter,
  setFilter,
  sourceFilter,
  setSourceFilter,
  sources,
  loading,
  error,
  hasMore,
  loadingMore,
  onLoadMore,
  onRefresh,
  onDelete,
  open,
  onClose,
}: {
  groups: SessionGroup[];
  activeSessionId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  filter: string;
  setFilter: (v: string) => void;
  sourceFilter: string | null;
  setSourceFilter: (v: string | null) => void;
  sources: Array<{ source: string; label: string; count: number }>;
  loading: boolean;
  error: Error | null;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onRefresh: () => void;
  onDelete: (id: string) => void;
  open: boolean;
  onClose: () => void;
}): React.JSX.Element {
  // Scroll pagination: fetch the next page of older sessions as the
  // list approaches its bottom.
  const listRef = React.useRef<HTMLDivElement>(null);
  function handleScroll(): void {
    const el = listRef.current;
    if (!el || !hasMore || loadingMore) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120) {
      onLoadMore();
    }
  }

  return (
    <>
      {open ? (
        <button
          type="button"
          aria-label="Close sessions"
          onClick={onClose}
          className="fixed inset-0 z-30 cursor-default bg-p5-ink/60 md:hidden"
        />
      ) : null}
      <aside className={cn(
        'shrink-0 border-r border-black/10 flex flex-col bg-p5-panel',
        'fixed inset-y-0 left-0 z-40 w-[85vw] max-w-[320px] transition-transform duration-200',
        open ? 'translate-x-0' : '-translate-x-full',
        'md:static md:z-auto md:w-[300px] md:max-w-none md:translate-x-0',
      )}>
      <div className="p-4 border-b border-black/10 space-y-3">
        <button
          type="button"
          onClick={onCreate}
          className="w-full min-h-[44px] inline-flex items-center justify-center gap-1.5 bg-accent px-3.5 py-2.5 text-[11px] font-black tracking-[0.12em] text-white transition hover:bg-accent-hover"
        >
          <Plus className="w-3.5 h-3.5" />
          New session
        </button>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-p5-dark-muted" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search sessions…"
            className="h-12 sm:h-9 w-full border border-p5-dark-line bg-white pl-8 pr-2 text-[16px] sm:text-[12px] text-p5-dark outline-none placeholder:text-p5-dark-muted focus:border-accent transition"
          />
        </div>
        {sources.length > 1 ? (
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              onClick={() => setSourceFilter(null)}
              className={cn(
                'border px-2.5 py-2 sm:px-1.5 sm:py-0.5 font-mono text-[10px] font-bold tracking-[0.08em] uppercase transition',
                sourceFilter === null
                  ? 'border-accent bg-accent text-white'
                  : 'border-black/15 text-p5-dark-muted hover:border-p5-dark hover:text-p5-dark',
              )}
            >
              All ({sources.reduce((a, s) => a + s.count, 0)})
            </button>
            {sources.map((s) => (
              <button
                key={s.source}
                type="button"
                onClick={() => setSourceFilter(s.source)}
                className={cn(
                  'border px-2.5 py-2 sm:px-1.5 sm:py-0.5 font-mono text-[10px] font-bold tracking-[0.08em] uppercase transition',
                  sourceFilter === s.source
                    ? 'border-accent bg-accent text-white'
                    : 'border-black/15 text-p5-dark-muted hover:border-p5-dark hover:text-p5-dark',
                )}
              >
                {s.label} ({s.count})
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div ref={listRef} onScroll={handleScroll} className="flex-1 overflow-y-auto">
        {loading && groups.length === 0 ? (
          <div className="p-6 text-center font-mono text-[11px] tracking-widest text-p5-dark-muted">LOADING…</div>
        ) : error && groups.length === 0 ? (
          <div className="p-6 text-center space-y-2">
            <p className="font-mono text-[11px] tracking-widest text-status-failed">SESSIONS UNREACHABLE</p>
            <p className="text-[11px] text-p5-dark-muted break-words">{error.message}</p>
            <button
              type="button"
              onClick={onRefresh}
              className="inline-flex items-center gap-1.5 bg-accent px-3 py-1.5 text-[10px] font-black tracking-[0.12em] text-white transition hover:bg-accent-hover"
            >
              <RefreshCw className="w-3 h-3" /> Retry
            </button>
          </div>
        ) : groups.length === 0 ? (
          <div className="p-6 text-center font-mono text-[11px] tracking-widest text-p5-dark-muted">
            {filter || sourceFilter ? 'NO SESSIONS MATCH.' : 'NO SESSIONS YET.'}
          </div>
        ) : (
          <>
            {groups.map((g) => (
              <div key={g.source} className="border-b border-black/[0.07] last:border-0">
                <div className="flex items-center justify-between bg-black/[0.03] px-4 py-2">
                  <span className="p5-kicker text-p5-dark-muted">{g.label}</span>
                  <span className="font-mono text-[10px] text-p5-dark-muted">{String(g.sessions.length).padStart(2, '0')}</span>
                </div>
                {g.sessions.map((s) => (
                  <SessionRow
                    key={s.id}
                    session={s}
                    active={s.id === activeSessionId}
                    onSelect={() => onSelect(s.id)}
                    onDelete={() => {
                      if (window.confirm(`Delete session "${s.title || s.id}"?`)) {
                        onDelete(s.id);
                      }
                    }}
                  />
                ))}
              </div>
            ))}
            {loadingMore ? (
              <div className="p-3 text-center font-mono text-[10px] tracking-widest text-p5-dark-muted">LOADING OLDER SESSIONS…</div>
            ) : hasMore ? (
              <button
                type="button"
                onClick={onLoadMore}
                className="w-full p-3 text-center font-mono text-[10px] tracking-widest text-p5-dark-muted hover:text-p5-dark transition"
              >
                LOAD OLDER SESSIONS
              </button>
            ) : null}
          </>
        )}
      </div>

      <div className="px-4 py-2.5 border-t border-black/10 flex items-center justify-between font-mono text-[10px] tracking-[0.14em] text-p5-dark-muted">
        <span>{String(sessionsTotal(groups)).padStart(2, '0')} SESSIONS</span>
        <button
          type="button"
          onClick={onRefresh}
          className="text-p5-dark-muted hover:text-p5-dark transition"
          title="Refresh"
        >
          <RefreshCw className="w-3 h-3" />
        </button>
      </div>
    </aside>
    </>
  );
}

function sessionsTotal(groups: SessionGroup[]): number {
  return groups.reduce((a, g) => a + g.sessions.length, 0);
}

function SessionDisplayTitle({ session }: { session: HermesSession }): React.JSX.Element {
  const text =
    session.title ||
    (session.preview && session.preview.length > 0
      ? session.preview.length > 60
        ? `${session.preview.slice(0, 57)}…`
        : session.preview
      : `New chat · ${session.id.slice(0, 14)}`);
  return (
    <span className="truncate font-p5-serif text-[17px] leading-tight text-p5-dark">
      {text}
    </span>
  );
}

function SessionRow({
  session,
  active,
  onSelect,
  onDelete,
}: {
  session: HermesSession;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
}): React.JSX.Element {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        'w-full text-left px-4 py-3 transition group flex items-start gap-2 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        active
          ? 'bg-accent/10 shadow-[inset_3px_0_0_0_var(--color-accent)]'
          : 'hover:bg-black/[0.03]',
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <SessionDisplayTitle session={session} />
          {session.message_count > 0 ? (
            <span className="shrink-0 font-mono text-[10px] text-p5-dark-muted">
              {session.message_count}
            </span>
          ) : null}
        </div>
        {session.preview ? (
          <div className="mt-0.5 truncate font-mono text-[11px] text-p5-dark-muted">
            {session.preview.length > 80 ? `${session.preview.slice(0, 77)}…` : session.preview}
          </div>
        ) : null}
        <div className="mt-1 font-mono text-[10px] text-p5-dark-muted">
          {session.last_active ? formatRelative(new Date(session.last_active * 1000).toISOString()) : '—'}
          {session.model ? <> · <span className="font-mono">{session.model}</span></> : null}
        </div>
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="opacity-100 md:opacity-0 md:group-hover:opacity-100 text-p5-dark-muted hover:text-status-failed transition p-1 shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center"
        title="Delete session"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ============================================================================
// Empty state / New session
// ============================================================================

function EmptyChatState({ onCreate, onOpenArchive }: { onCreate: () => void; onOpenArchive?: () => void }): React.JSX.Element {
  return (
    <section className="flex-1 min-w-0 flex flex-col">
      {onOpenArchive ? (
        <div className="h-[52px] shrink-0 px-4 border-b border-black/10 flex items-center gap-3 bg-p5-panel md:hidden">
          <button type="button" onClick={onOpenArchive} aria-label="Open sessions" className="flex h-11 w-11 items-center justify-center text-p5-dark">
            <MenuIcon className="h-5 w-5" />
          </button>
          <span className="text-[11px] font-black tracking-[0.16em] uppercase text-p5-dark">Command</span>
        </div>
      ) : null}
      <div className="flex-1 flex items-center justify-center">
      <div className="max-w-sm w-full mx-6 border-2 border-black/15 bg-p5-panel p-8 text-center space-y-3">
        <div className="mx-auto flex h-12 w-12 items-center justify-center border border-black/15">
          <Bot className="w-5 h-5 text-p5-dark-muted" />
        </div>
        <h2 className="font-p5-serif text-[26px] leading-tight text-p5-dark">Start a conversation</h2>
        <p className="text-[12px] leading-relaxed text-p5-dark-muted">
          Send Hermes Agent a task. The session is persisted across runs and visible in the list.
        </p>
        <button
          type="button"
          onClick={onCreate}
          className="inline-flex items-center justify-center gap-1.5 bg-accent px-4 py-2 min-h-[48px] w-full text-[11px] font-black tracking-[0.12em] text-white transition hover:bg-accent-hover"
        >
          <Plus className="w-3.5 h-3.5" /> New session
        </button>
      </div>
      </div>
    </section>
  );
}

function NewSessionView({
  info,
  gateway,
  onCreated,
  onCancel,
  onOpenArchive,
}: {
  info: HermesInfo;
  gateway: GatewayControl;
  onCreated: (id: string) => void;
  onCancel: () => void;
  onOpenArchive?: () => void;
}): React.JSX.Element {
  const qc = useQueryClient();
  const [title, setTitle] = React.useState('');
  const [model, setModel] = React.useState('');
  const [creating, setCreating] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  async function create(): Promise<void> {
    setCreating(true);
    setErr(null);
    try {
      const trimmedTitle = title.trim();

      // Gateway path: create the session directly on the TUI gateway so
      // the conversation identity is ONE session (no empty API husk).
      // Steer/interrupt/approvals work from the very first message.
      if (gateway.status === 'on') {
        const { storedId } = await gateway.createGatewaySession(undefined, trimmedTitle || undefined);
        qc.invalidateQueries({ queryKey: ['hermes-sessions'] });
        onCreated(storedId);
        return;
      }

      const id = `web_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      await api.hermesCreateSession(info, {
        id,
        model: model.trim() || undefined,
        source: 'api_server',
        ...(trimmedTitle ? { title: trimmedTitle } : {}),
      } as { id?: string; model?: string; source?: string; title?: string });
      // If the title wasn't sent via POST, patch it now (POST does accept title,
      // but some Hermes versions return 400 — the patch is a guaranteed path).
      if (trimmedTitle) {
        try {
          await api.hermesRenameSession(info, id, trimmedTitle);
        } catch {
          // best-effort
        }
      }
      qc.invalidateQueries({ queryKey: ['hermes-sessions'] });
      onCreated(id);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  const inputCls =
    'mt-1 w-full border border-p5-dark-line bg-white px-3 py-2 h-12 sm:h-auto text-[16px] sm:text-[13px] text-p5-dark outline-none placeholder:text-p5-dark-muted focus:border-accent transition';

  return (
    <section className="flex-1 min-w-0 flex flex-col overflow-y-auto">
      {onOpenArchive ? (
        <div className="h-[52px] shrink-0 px-4 border-b border-black/10 flex items-center gap-3 bg-p5-panel md:hidden">
          <button type="button" onClick={onOpenArchive} aria-label="Open sessions" className="flex h-11 w-11 items-center justify-center text-p5-dark">
            <MenuIcon className="h-5 w-5" />
          </button>
          <span className="text-[11px] font-black tracking-[0.16em] uppercase text-p5-dark">New session</span>
        </div>
      ) : null}
      <div className="flex-1 flex items-center justify-center py-8">
      <div className="max-w-md w-full mx-4 sm:mx-6 border-2 border-black/15 bg-p5-panel p-6 space-y-4">
        <div>
          <h2 className="font-p5-serif text-[26px] leading-tight text-p5-dark">New session</h2>
          <p className="text-[12px] text-p5-dark-muted mt-1">
            Hermes will create a fresh session. You can set a model or use the default.
          </p>
        </div>
          <div>
            <label className="p5-kicker text-p5-dark-muted">Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Refactor auth middleware"
              className={inputCls}
            />
          </div>
          {gateway.status === 'on' ? (
            <p className="border border-accent/40 bg-accent/10 px-3 py-2 font-mono text-[11px] text-accent">
              GATEWAY ON — SESSION CREATED ON THE TUI GATEWAY (STEER + APPROVALS FROM THE FIRST MESSAGE)
            </p>
          ) : (
            <div>
              <label className="p5-kicker text-p5-dark-muted">Model</label>
              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="leave blank for default"
                className={cn(inputCls, 'font-mono')}
              />
            </div>
          )}
        {err ? <div className="text-[12px] text-status-failed">{err}</div> : null}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3.5 py-2 text-[11px] font-black tracking-[0.12em] text-p5-dark-muted hover:text-p5-dark transition"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={create}
            disabled={creating}
            className="inline-flex items-center gap-1.5 bg-accent px-4 py-2 text-[11px] font-black tracking-[0.12em] text-white transition hover:bg-accent-hover disabled:opacity-40"
          >
            {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Create session
          </button>
        </div>
      </div>
      </div>
    </section>
  );
}

// ============================================================================
// Active conversation
// ============================================================================

// A blocking Hermes request (approval / clarify / sudo / secret / …).
interface PendingPrompt { kind: string; requestId: string; payload: Record<string, unknown>; }

const PROMPT_VALUE_KEY: Record<string, string> = {
  clarify: 'answer',
  'terminal.read': 'text',
  sudo: 'password',
  secret: 'value',
};
const PROMPT_SECRET_KIND: Record<string, boolean> = { sudo: true, secret: true };
const PROMPT_LABEL: Record<string, string> = {
  approval: 'HERMES IS REQUESTING APPROVAL',
  clarify: 'HERMES ASKS YOU',
  'terminal.read': 'TERMINAL READ REQUEST',
  sudo: 'SUDO PASSWORD REQUIRED',
  secret: 'SECRET REQUIRED',
};

// ============================================================================
// Prompt splash — blocking requests arrive as a full overlay, not chat
// noise. Minimize it to read the chat; the alert pill in the conversation
// header (top-right) reopens it. Backdrop click / Escape also minimizes.
// ============================================================================

function PromptSplash({
  prompt,
  index,
  total,
  input,
  onInput,
  onRespond,
  onMinimize,
  onNext,
}: {
  prompt: PendingPrompt;
  index: number;
  total: number;
  input: string;
  onInput: (v: string) => void;
  onRespond: (value?: string) => void;
  onMinimize: () => void;
  onNext?: () => void;
}): React.JSX.Element {
  const payload = prompt.payload;
  const label = PROMPT_LABEL[prompt.kind] ?? `${prompt.kind.toUpperCase()} REQUEST`;
  const choices = (Array.isArray(payload['choices']) ? payload['choices'] : []) as string[];
  const extraFields = Object.entries(payload).filter(
    ([k]) => !['request_id', 'question', 'command', 'choices', 'tool'].includes(k),
  ).slice(0, 5);
  const secret = PROMPT_SECRET_KIND[prompt.kind] ?? false;
  const question = typeof payload['question'] === 'string' ? payload['question'] : null;
  const command = typeof payload['command'] === 'string' ? payload['command'] : null;
  const tool = typeof payload['tool'] === 'string' ? payload['tool'] : null;

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onMinimize(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onMinimize]);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-6" role="dialog" aria-modal="true" aria-label={label}>
      <button type="button" aria-label="Minimize — back to chat" onClick={onMinimize} className="absolute inset-0 cursor-default bg-p5-ink/70" />
      <div className="p5-cut-panel relative w-full sm:max-w-xl max-h-[92dvh] overflow-y-auto border border-black/25 bg-p5-cream">
        <div className="absolute inset-y-0 left-0 w-1.5 bg-accent" />
        <div className="p-5 sm:p-6 md:p-8">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
            <span className="font-mono text-[11px] font-bold tracking-[0.2em] text-accent">{label}</span>
            <span className="ml-auto flex items-center gap-2">
              {total > 1 ? (
                <span className="font-mono text-[10px] font-bold tracking-[0.14em] text-p5-dark-muted">
                  {index + 1} OF {total}
                </span>
              ) : null}
              {onNext ? (
                <button
                  type="button"
                  onClick={onNext}
                  className="flex items-center gap-1 font-mono text-[10px] font-bold tracking-[0.14em] text-p5-dark-muted transition hover:text-p5-dark"
                  title="Show next pending request"
                >
                  NEXT <ArrowRight className="h-3 w-3" />
                </button>
              ) : null}
              <button
                type="button"
                onClick={onMinimize}
                className="flex items-center gap-1.5 border border-black/20 px-2.5 py-1.5 min-h-[44px] font-mono text-[10px] font-bold tracking-[0.14em] text-p5-dark-muted transition hover:border-p5-dark hover:text-p5-dark"
                title="Minimize — back to chat (reopen from the alert, top right)"
              >
                <Minimize2 className="h-3.5 w-3.5" /> MINIMIZE
              </button>
            </span>
          </div>

          {question ? (
            <p className="mt-4 font-p5-serif text-[22px] sm:text-[26px] leading-tight text-p5-dark">{question}</p>
          ) : command ? (
            <pre className="mt-4 overflow-x-auto whitespace-pre-wrap break-words border border-black/20 bg-p5-ink p-3 font-mono text-[13px] leading-relaxed text-p5-text">
              {command}
            </pre>
          ) : (
            <p className="mt-4 font-p5-serif text-[22px] sm:text-[26px] leading-tight text-p5-dark">{label}</p>
          )}

          {tool ? (
            <p className="mt-2 font-mono text-[11px] text-p5-dark-muted">{tool}</p>
          ) : null}
          {command && question ? (
            <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words border border-black/20 bg-p5-ink p-3 font-mono text-[12px] leading-relaxed text-p5-text">
              {command}
            </pre>
          ) : null}
          {extraFields.length > 0 ? (
            <div className="mt-3 font-mono text-[11px] leading-relaxed text-p5-dark-muted">
              {extraFields.map(([k, v]) => (
                <div key={k} className="flex gap-2">
                  <span className="shrink-0">{k.replace(/_/g, ' ')}:</span>
                  <span className="min-w-0 break-all text-p5-dark">
                    {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          {choices.length > 0 ? (
            <div className="mt-5 flex flex-wrap items-center gap-2">
              {choices.map((choice) => (
                <button
                  key={choice}
                  type="button"
                  onClick={() => onRespond(choice)}
                  className={cn(
                    'px-5 py-2 text-[11px] font-black tracking-[0.12em] transition',
                    prompt.kind === 'approval' && choice === 'deny'
                      ? 'border border-status-failed/60 text-status-failed hover:bg-status-failed hover:text-white'
                      : 'bg-accent text-white hover:bg-accent-hover',
                  )}
                >
                  {choice.toUpperCase()}
                </button>
              ))}
            </div>
          ) : (
            <div className="mt-5 flex flex-col sm:flex-row sm:items-center gap-2">
              <input
                value={input}
                onChange={(e) => onInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); onRespond(input); }
                }}
                type={secret ? 'password' : 'text'}
                placeholder={prompt.kind === 'approval' ? 'type choice (once/session/always/deny)' : 'your response…'}
                autoFocus
                className="h-12 sm:h-9 w-full sm:flex-1 border border-black/25 bg-white px-2.5 font-mono text-[16px] sm:text-[12px] text-p5-dark outline-none placeholder:text-p5-dark-muted focus:border-accent"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => onRespond(input)}
                  disabled={!input.trim()}
                  className="flex-1 sm:flex-none bg-accent px-4 py-2 min-h-[48px] sm:min-h-0 text-[11px] font-black tracking-[0.12em] text-white transition hover:bg-accent-hover disabled:opacity-40"
                >
                  SUBMIT
                </button>
                <button
                  type="button"
                  onClick={() => onRespond(prompt.kind === 'approval' ? 'deny' : '')}
                  className="flex-1 sm:flex-none border border-black/25 px-3 py-2 min-h-[48px] sm:min-h-0 text-[11px] font-black tracking-[0.1em] text-p5-dark-muted transition hover:border-status-failed hover:text-status-failed"
                >
                  CANCEL
                </button>
              </div>
            </div>
          )}
          <span className="mt-4 block font-mono text-[10px] tracking-[0.1em] text-p5-dark-muted">
            {prompt.kind === 'approval' ? 'DANGEROUS COMMAND — YOU ARE IN CONTROL' : 'PENDING — HERMES IS WAITING FOR YOU'}
          </span>
        </div>
      </div>
    </div>
  );
}

function ChatView({ info, sessionId, model: sessionModelProp, onSelect, allSessions: sessionsData, gateway, onOpenArchive }: { info: HermesInfo; sessionId: string; model: string | null; onSelect: (id: string) => void; allSessions: HermesSession[]; gateway: GatewayControl; onOpenArchive?: () => void }): React.JSX.Element {
  const qc = useQueryClient();

  // ── TUI gateway control channel (steer / interrupt / approvals) ──
  // Shared page-level connection (see gatewayControl.ts). Sends run
  // through prompt.submit, /steer injects mid-run, Ctrl+C interrupts,
  // and dangerous commands surface an approve/deny bar.
  const { status: gwStatus, gw, registerListener, createGatewaySession, resumeGatewaySession } = gateway;
  const gwRef = React.useRef<TuiGateway | null>(gw);
  gwRef.current = gw;
  const [gwSessionId, setGwSessionId] = React.useState<string | null>(null);
  const [gwStoredId, setGwStoredId] = React.useState<string | null>(null);
  // ── Gateway prompts — generic. Every blocking prompt Hermes emits
  // arrives as `<kind>.request` with a `request_id`; the matching
  // `<kind>.respond` unblocks it. Driven by the event type, so any
  // future prompt kind (clarify, sudo, secret, terminal.read, …) just
  // works. Approval is the only session-scoped variant. They surface
  // as a splash overlay (see PromptSplash); minimizing parks an alert
  // pill in the conversation header instead of blocking the chat.
  const [pendingPrompts, setPendingPrompts] = React.useState<PendingPrompt[]>([]);
  const [promptInput, setPromptInput] = React.useState('');
  const [splashMin, setSplashMin] = React.useState(false);
  const focusPrompt = pendingPrompts[0] ?? null;
  function cyclePrompt(): void {
    setPendingPrompts((prev) => (prev.length > 1 ? [...prev.slice(1), prev[0] as PendingPrompt] : prev));
  }
  // Interim assistant commentary — text Hermes emits between tool calls.
  const [interim, setInterim] = React.useState<string | null>(null);

  // Live tool trace — terminal commands in full detail as they run.
  interface LiveTool { id: string; name: string; status: 'running' | 'done'; detail: string; duration?: string; }
  const [liveTools, setLiveTools] = React.useState<LiveTool[]>([]);

  // Reopen/switch: ChatView stays mounted across route changes, so ALL
  // per-conversation gateway state must reset when the session changes —
  // otherwise the poll reads the old session and sends go to the wrong
  // conversation (messages "lost" in the newly selected one).
  React.useEffect(() => {
    setGwSessionId(gwMapGet(sessionId));
    setGwStoredId(null);
    setPendingPrompts([]);
    setSplashMin(false);
    setLiveTools([]);
    setInterim(null);
    setSending(false);
    setErr(null);
    queueRef.current = [];
    setQueuedCount(0);
  }, [sessionId]);

  React.useEffect(() => {
    registerListener((ev) => {
      // Any `<kind>.request` becomes a pending prompt; any
      // `<kind>.expire` clears it. Generic by construction.
      if (ev.type.endsWith('.request')) {
        const kind = ev.type.slice(0, -'.request'.length);
        const requestId = String(ev.payload['request_id'] ?? Math.random());
        setPendingPrompts((prev) => [...prev.filter((p) => p.requestId !== requestId), { kind, requestId, payload: ev.payload }]);
        setSplashMin(false);
      }
      if (ev.type.endsWith('.expire')) {
        const rid = String((ev.payload ?? {})['request_id'] ?? '');
        setPendingPrompts((prev) => prev.filter((p) => p.requestId !== rid));
      }
      if (ev.type === 'message.complete') {
        setSending(false);
        setLiveTools([]);
        setInterim(null);
        qc.invalidateQueries({ queryKey: ['hermes-messages'] });
      }
      if (ev.type === 'message.interim') {
        const text = String((ev.payload ?? {})['text'] ?? '');
        const alreadyStreamed = Boolean((ev.payload ?? {})['already_streamed']);
        if (text.trim() && !alreadyStreamed) setInterim(text);
      }
      if (ev.type === 'session.busy' || ev.type === 'prompt.error' || ev.type === 'error') {
        setSending(false);
      }
      if (ev.type === 'tool.start') {
        const id = String(ev.payload['tool_id'] ?? Math.random());
        const entry: LiveTool = { id, name: String(ev.payload['name'] ?? 'tool'), status: 'running', detail: String(ev.payload['context'] ?? '') };
        setLiveTools((prev) => [...prev.filter((t) => t.id !== id), entry].slice(-4));
      }
      if (ev.type === 'tool.progress') {
        const id = String(ev.payload['tool_id'] ?? '');
        setLiveTools((prev) => prev.map((t) => t.id === id ? { ...t, detail: String(ev.payload['context'] ?? t.detail) } : t));
      }
      if (ev.type === 'tool.complete') {
        const id = String(ev.payload['tool_id'] ?? '');
        const args = (ev.payload['args'] ?? {}) as Record<string, unknown>;
        const detail = typeof args['command'] === 'string'
          ? args['command']
          : String(ev.payload['context'] ?? '');
        const dur = typeof ev.payload['duration_s'] === 'number' ? `${ev.payload['duration_s'].toFixed(1)}s` : undefined;
        setLiveTools((prev) => prev.map((t) => t.id === id ? { ...t, status: 'done', detail, duration: dur } : t));
      }
    });
  }, [qc, registerListener]);

  const messages = useQuery({
    queryKey: ['hermes-messages', gwStoredId ?? sessionId],
    queryFn: () => api.hermesGetMessages(info, gwStoredId ?? sessionId),
    refetchInterval: 5000, // poll while active
    enabled: !!sessionId && sessionId !== '__new__',
  });

  const [input, setInput] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [slashOpen, setSlashOpen] = React.useState(false);
  const [slashQuery, setSlashQuery] = React.useState('');

  // In-flight request handle — lets /stop abort a blocking turn and
  // frees the composer immediately.
  const abortRef = React.useRef<AbortController | null>(null);
  // Messages typed while a turn is in flight queue up and flush when
  // the current response finishes — so you can queue a /steer (or any
  // follow-up) without waiting for the first response to complete.
  const queueRef = React.useRef<string[]>([]);
  const [queuedCount, setQueuedCount] = React.useState(0);

  // Local system messages (from slash command responses, not from the server)
  const [localSysMessages, setLocalSysMessages] = React.useState<Array<{ id: number; content: string; timestamp: number }>>([]);
  function sys(msg: string): void {
    const entry = { id: -Date.now(), content: msg, timestamp: Math.floor(Date.now() / 1000) };
    setLocalSysMessages((prev) => [...prev, entry]);
  }

  // Sort messages chronologically
  const orderedMessages = React.useMemo(() => {
    const list = messages.data?.data ?? [];
    return [...list].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
  }, [messages.data]);

  // Merge server messages with local system messages
  const allMessages = React.useMemo(() => {
    const sys = localSysMessages.map((m) => ({
      id: m.id,
      session_id: sessionId,
      role: 'system' as const,
      content: m.content,
      timestamp: m.timestamp,
    }));
    return [...(orderedMessages.length > 0 ? orderedMessages : []), ...sys];
  }, [orderedMessages, localSysMessages, sessionId]);

  const inputFooterRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    inputFooterRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' });
  }, [allMessages.length]);

  // Slash command suggestions
  const slashMatches = React.useMemo(() => {
    if (!slashOpen) return [];
    const q = slashQuery.toLowerCase();
    return SLASH_COMMANDS.filter(
      (c) => c.cmd.toLowerCase().startsWith(q) && q.length > 0,
    ).slice(0, 6);
  }, [slashOpen, slashQuery]);

  async function send(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (text.startsWith('/')) {
      slashHandler(text);
      return;
    }
    // A turn is in flight — queue instead of blocking the composer.
    if (sending) {
      queueRef.current = [...queueRef.current, trimmed];
      setQueuedCount(queueRef.current.length);
      setInput('');
      sys('Queued — will send when the current turn finishes.');
      return;
    }
    await sendToAgent(trimmed);
  }

  async function sendToAgent(text: string): Promise<void> {
    if (!text.trim() || sending) return;

    // Gateway path: run the turn on the live TUI gateway agent so
    // steer/interrupt/approvals work. The gateway session gets its own
    // stored id; the message poll follows it.
    if (gwRef.current?.ready) {
      setSending(true);
      setErr(null);
      const doSubmit = async (): Promise<void> => {
        const sid = gwSessionId ?? await ensureGatewaySession();
        const body: Record<string, unknown> = { message: text };
        if (storedModel) body.model = storedModel;
        await gwRef.current!.submit(sid, String(body.message));
      };
      try {
        await doSubmit();
        qc.invalidateQueries({ queryKey: ['hermes-sessions'] });
        setInput('');
        setSlashOpen(false);
        setSlashQuery('');
      } catch (e) {
        // A stale live session (gateway restarted since the page opened) —
        // resume/rebuild the session and retry once.
        if (gwSessionId) {
          setGwSessionId(null);
          try {
            await doSubmit();
            qc.invalidateQueries({ queryKey: ['hermes-sessions'] });
            setInput('');
            setSlashOpen(false);
            setSlashQuery('');
          } catch (e2) {
            setErr((e2 as Error).message);
          }
        } else {
          setErr((e as Error).message);
        }
      } finally {
        abortRef.current = null;
        // The gateway turn is async — message.complete clears `sending`.
        // A safety timeout prevents a stuck composer if the event is lost.
        window.setTimeout(() => setSending(false), 120_000);
        const next = queueRef.current[0];
        if (next) {
          queueRef.current = queueRef.current.slice(1);
          setQueuedCount(queueRef.current.length);
          void sendToAgent(next);
        }
      }
      return;
    }

    setSending(true);
    setErr(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const chatBody: Record<string, unknown> = { message: text };
      if (storedModel) chatBody.model = storedModel;
      await api.hermesChat(info, sessionId, chatBody as { message: string; model?: string }, controller.signal);
      qc.invalidateQueries({ queryKey: ['hermes-messages', sessionId] });
      qc.invalidateQueries({ queryKey: ['hermes-sessions'] });
      setInput('');
      setSlashOpen(false);
      setSlashQuery('');
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        sys('Turn interrupted.');
      } else {
        setErr((e as Error).message);
      }
    } finally {
      abortRef.current = null;
      setSending(false);
      // Flush anything queued while this turn was in flight.
      const next = queueRef.current[0];
      if (next) {
        queueRef.current = queueRef.current.slice(1);
        setQueuedCount(queueRef.current.length);
        void sendToAgent(next);
      }
    }
  }

  function respondPrompt(p: PendingPrompt, value?: string): void {
    const g = gwRef.current;
    if (!g) return;
    if (p.kind === 'approval') {
      void g.respond('approval', { session_id: gwSessionId ?? '', choice: value ?? 'deny' }).catch(() => undefined);
    } else {
      const key = PROMPT_VALUE_KEY[p.kind] ?? 'answer';
      void g.respond(p.kind, { request_id: p.requestId, [key]: value ?? '' }).catch(() => undefined);
    }
    setPendingPrompts((prev) => prev.filter((x) => x !== p));
    setPromptInput('');
  }

  // Resume-or-create the gateway session for this conversation. Resume
  // rebuilds the agent on the FULL stored transcript (tool calls and
  // results included), so the agent remembers — no session_search needed.
  async function ensureGatewaySession(): Promise<string> {
    const g = gwRef.current;
    if (!g?.ready) throw new Error('gateway not connected');
    const stored = gwStoredId ?? sessionId;
    try {
      const res = await resumeGatewaySession(stored);
      setGwSessionId(res.gwSessionId);
      setGwStoredId(stored);
      sys(`Gateway resume: conversation restored with full history (${res.messageCount} messages).`);
      return res.gwSessionId;
    } catch {
      const created = await createGatewaySession();
      setGwSessionId(created.gwSessionId);
      setGwStoredId(created.storedId);
      sys(`Gateway handoff: new gateway session (${created.storedId}).`);
      return created.gwSessionId;
    }
  }

  function stopAgent(): void {
    // Real server-side interrupt via the gateway when available.
    if (gwRef.current?.ready && gwSessionId) {
      void gwRef.current.interrupt(gwSessionId).catch(() => undefined);
      sys('Turn interrupted.');
      setSending(false);
    } else {
      abortRef.current?.abort();
    }
    queueRef.current = [];
    setQueuedCount(0);
    setInput('');
    if (!sending && !gwRef.current?.ready) sys('Nothing is running.');
  }
  // Persistent model override (set via /model command)
  const [storedModel, setStoredModel] = React.useState<string | null>(null);

  function slashHandler(cmd: string): void {
    const parsed = cmd.startsWith('/') ? cmd.slice(1).split(/\s+/) : [];
    const name = parsed[0]?.toLowerCase() ?? '';
    const arg = parsed.slice(1).join(' ');
    const sysMsg = (t: string) => sys(t);

    const CLI_ONLY = new Set([
      'reload-skills', 'reload-mcp',
    ]);

    switch (name) {
      case 'new':
      case 'reset':
        // Navigate to new session view
        stopAgent();
        onSelect('__new__');
        setInput('');
        return;

      case 'title':
        if (arg.trim()) {
          api.hermesRenameSession(info, sessionId, arg.trim())
            .then(() => qc.invalidateQueries({ queryKey: ['hermes-sessions'] }))
            .catch(() => {});
          sysMsg(`Title set to "${arg.trim()}"`);
        } else {
          sysMsg('Usage: /title <session name>');
        }
        setInput('');
        return;

      case 'model':
        if (arg.trim()) {
          setStoredModel(arg.trim());
          sysMsg(`Model set to ${arg.trim()} for subsequent messages`);
        } else {
          sysMsg(`Model: ${storedModel || sessionModelProp || 'default'}`);
        }
        setInput('');
        return;

      case 'help':
        sysMsg(
          'Available commands:\n' +
          SLASH_COMMANDS.map(c => `  ${c.cmd} — ${c.hint}`).join('\n')
        );
        setInput('');
        return;

      case 'commands':
        sysMsg(
          'All commands:\n' +
          SLASH_COMMANDS.map(c => `  ${c.cmd} — ${c.label}`).join('\n')
        );
        setInput('');
        return;

      case 'status': {
        const s = sessionsData.find(x => x.id === sessionId);
        sysMsg(
          `Session: ${sessionId.slice(0, 16)}…\n` +
          `Model: ${s?.model || 'default'}\n` +
          `Messages: ${s?.message_count ?? 0}\n` +
          `Source: ${s?.source || 'api_server'}\n` +
          `Tokens in: ${s?.input_tokens ?? 0}\n` +
          `Tokens out: ${s?.output_tokens ?? 0}`
        );
        setInput('');
        return;
      }

      case 'steer': {
        const note = arg.trim() || cmd;
        // Real mid-run steering via the TUI gateway — the note lands on
        // the next tool result while the turn keeps running.
        if (gwRef.current?.ready && gwSessionId) {
          void gwRef.current.steer(gwSessionId, note)
            .then((r) => sysMsg(`Steering note injected mid-run (${r.status}).`))
            .catch(() => sysMsg('Steering failed — gateway session not running.'));
        } else if (sending) {
          sysMsg('Steering note queued — delivered when the current turn finishes.');
          queueRef.current = [...queueRef.current, note];
          setQueuedCount(queueRef.current.length);
        } else {
          sysMsg('Steering note sent — Hermes will factor it into its next steps.');
          void sendToAgent(note);
        }
        setInput('');
        return;
      }

      case 'stop':
        sysMsg('Stopping…');
        stopAgent();
        setInput('');
        return;

      case 'retry': {
        setInput('');
        sysMsg('Retrying last message…');
        const msgs = messages.data?.data ?? [];
        const lastUser = [...msgs].reverse().find(m => m.role === 'user');
        if (lastUser?.content) {
          void send(lastUser.content);
        } else {
          sysMsg('No user message to retry.');
        }
        return;
      }

      case 'sessions':
      case 'resume':
        sysMsg('Use the session list on the left panel to browse and resume sessions.');
        setInput('');
        return;

      case 'whoami':
        sysMsg(`User: ${sessionId.slice(0, 8)}… (authenticated via HermieOS API)`);
        setInput('');
        return;

      case 'version':
        sysMsg('HermieOS Chat v0.1 — powered by Hermes Agent');
        setInput('');
        return;

      case 'undo':
        sysMsg('Undo is not supported through the API yet.');
        setInput('');
        return;

      default:
        // Most slash commands work when sent to the agent as a message —
        // the LLM recognizes them from its training data and executes them
        // conversationally (/reasoning, /model, /yolo, /goal, /personality,
        // /fast, /voice, /steer, /queue, /compress, /compact etc.).
        //
        // Only CLI-only / filesystem commands won't work through the API:
        if (CLI_ONLY.has(name)) {
          sysMsg(
            `\`${cmd}\` is only available in the interactive Hermes CLI ` +
            '(terminal or messaging platforms). It requires filesystem or ' +
            'process-level access that the web API cannot provide.'
          );
        } else if (sending) {
          sysMsg('Command queued — delivered when the current turn finishes.');
          queueRef.current = [...queueRef.current, cmd];
          setQueuedCount(queueRef.current.length);
        } else {
          void sendToAgent(cmd);
        }
        setInput('');
    }
  }

  function onChangeInput(v: string): void {
    setInput(v);
    if (v.startsWith('/')) {
      setSlashOpen(true);
      setSlashQuery(v);
    } else {
      setSlashOpen(false);
      setSlashQuery('');
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    } else if (e.key === 'Escape' && slashOpen) {
      setSlashOpen(false);
    } else if ((e.key === 'c' || e.key === 'C') && e.ctrlKey && sending) {
      // Ctrl+C interrupts the running turn (client abort; the gateway
      // cancels the agent loop when the connection drops).
      e.preventDefault();
      stopAgent();
    }
  }

  const nonSys = allMessages.filter(m => m.role !== 'system').length;

  return (
    <section className="flex-1 min-w-0 flex flex-col">
      {/* Conversation header */}
      <div className="h-[52px] shrink-0 px-4 sm:px-6 border-b border-black/10 flex items-center gap-2 sm:gap-3 bg-p5-panel">
        {onOpenArchive ? (
          <button type="button" onClick={onOpenArchive} aria-label="Open sessions" className="flex h-11 w-11 shrink-0 items-center justify-center text-p5-dark md:hidden">
            <MenuIcon className="h-5 w-5" />
          </button>
        ) : null}
        <span className="truncate font-mono text-[12px] text-p5-dark">
          {messages.data?.data?.[0]?.session_id?.slice(0, 40) ?? sessionId.slice(0, 40)}
        </span>
        {nonSys > 0 ? (
          <span className="font-mono text-[10px] tracking-[0.1em] text-p5-dark-muted">
            {nonSys} MESSAGES
          </span>
        ) : null}
        {sessionModelProp ? (
          <span className="hidden font-mono text-[10px] text-p5-dark-muted sm:inline">
            {sessionModelProp.includes('/') ? (
              <span title={sessionModelProp}>{sessionModelProp.split('/')[1] ?? sessionModelProp}</span>
            ) : (
              <span>{sessionModelProp}</span>
            )}
          </span>
        ) : null}
        {pendingPrompts.length > 0 ? (
          <button
            type="button"
            onClick={() => setSplashMin(false)}
            className="ml-auto flex items-center gap-1.5 border border-accent bg-accent/10 px-2.5 py-1 font-mono text-[10px] font-bold tracking-[0.12em] text-accent transition hover:bg-accent hover:text-white"
            title="A Hermes request is waiting — open it"
          >
            <Bell className="h-3 w-3" />
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
            {pendingPrompts.length} PENDING
          </button>
        ) : null}
        <span className={cn('flex items-center gap-1.5 font-mono text-[10px] tracking-[0.1em] text-p5-dark-muted', pendingPrompts.length > 0 ? '' : 'ml-auto')}>
          <span className={cn('h-1.5 w-1.5 rounded-full', messages.data?.session_id === sessionId ? 'bg-accent' : 'bg-amber-500')} />
          {messages.data?.session_id === sessionId ? 'LIVE' : 'SYNCING'}
        </span>
      </div>

      {/* TUI control channel down: steer/interrupt/approvals are
          unavailable. Show WHY (the ticket error carries the server's
          failure stage) instead of failing silently. */}
      {gwStatus !== 'on' && gateway.ticketError ? (
        <div className="shrink-0 border-b border-amber-300 bg-amber-50 px-4 sm:px-6 py-2">
          <p className="font-mono text-[10px] tracking-[0.08em] text-amber-800 break-words" title={gateway.ticketError}>
            STEER/INTERRUPT OFF — {gateway.ticketError}
          </p>
        </div>
      ) : null}

      {/* Messages + input share the right-side scroll. Input is the
          last child so it lives at the natural end of the scrolling
          column. The column sticks to the bottom when content is
          short (flex-1 + flex-col on the inner container), and scrolls
          when content overflows. */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="min-h-full flex flex-col">
          <div className="flex-1 px-4 py-6 sm:px-6">
            {messages.isLoading ? (
              <div className="py-12 text-center font-mono text-[11px] tracking-widest text-p5-dark-muted">READING THE SESSION…</div>
            ) : allMessages.length === 0 ? (
              <div className="py-12 text-center text-p5-dark-muted">
                <Sparkles className="w-6 h-6 mx-auto mb-2" />
                <p className="font-mono text-[12px] tracking-[0.12em]">EMPTY SESSION — SEND A MESSAGE TO GET STARTED.</p>
              </div>
            ) : (
              <div className="max-w-3xl mx-auto space-y-4">
                {allMessages
                  .filter((m) => !(m.role === 'assistant' && !m.content))
                  .map((m) => (
                    <MemoMessageBubble key={String(m.id)} message={m} />
                  ))}
                {sending ? (
                  <div className="flex items-center gap-3">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center border border-black/15 text-p5-dark-muted">
                      <Bot className="h-3.5 w-3.5" />
                    </div>
                    <div className="flex items-center gap-2 font-mono text-[11px] tracking-[0.12em] text-p5-dark-muted">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
                      {interim ? interim : 'HERMES IS THINKING…'}
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </div>

          {/* Console input lives at the end of the right-side scroll column */}
          <div ref={inputFooterRef} className="border-t border-black/10 p-4 bg-p5-ink-2">
            <div className="max-w-3xl mx-auto relative">
              {slashOpen ? (
                <SlashCommandMenu matches={slashMatches} onPick={(cmd) => setInput(cmd + ' ')} />
              ) : null}
              {liveTools.length > 0 ? (
                <div className="mb-2 border border-white/15 bg-p5-ink-3">
                  <div className="flex items-center justify-between border-b border-white/10 px-3 py-1.5">
                    <span className="p5-kicker text-p5-muted">LIVE TOOL TRACE</span>
                    <span className="font-mono text-[9px] tracking-[0.12em] text-p5-muted">{liveTools.length} ACTIVE</span>
                  </div>
                  {liveTools.map((t) => (
                    <div key={t.id} className="border-b border-white/[0.06] px-3 py-1.5 last:border-0">
                      <div className="flex items-center gap-2 font-mono text-[11px]">
                        <Wrench className={cn('h-3 w-3 shrink-0', t.status === 'running' ? 'text-accent' : 'text-emerald-400')} />
                        <span className="font-bold text-p5-text">{t.name}</span>
                        <span className={cn(t.status === 'running' ? 'animate-pulse text-accent' : 'text-emerald-400')}>
                          {t.status === 'running' ? 'RUNNING' : 'DONE'}
                        </span>
                        {t.duration ? <span className="text-p5-muted">· {t.duration}</span> : null}
                      </div>
                      {t.detail ? (
                        <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-p5-muted">
                          {t.detail}
                        </pre>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
              {pendingPrompts.length > 0 ? (
                <div className="mb-2 flex items-center gap-2 border border-accent/40 bg-accent/[0.06] px-3 py-1.5 font-mono text-[10px] tracking-[0.12em] text-accent">
                  <Bell className="h-3 w-3 shrink-0" />
                  {pendingPrompts.length} REQUEST{pendingPrompts.length === 1 ? '' : 'S'} WAITING — TAP THE ALERT, TOP RIGHT
                </div>
              ) : null}
              <div className="flex items-end gap-2 border border-white/15 bg-p5-ink-3 focus-within:border-accent transition">
                <textarea
                  value={input}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => onChangeInput(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder="Message Hermes Agent…"
                  className="min-h-[40px] max-h-[160px] flex-1 resize-none border-0 bg-transparent p-3 text-[13px] text-p5-text outline-none placeholder:text-p5-muted focus:ring-0"
                  rows={1}
                />
                {sending ? (
                  <button
                    type="button"
                    onClick={stopAgent}
                    aria-label="Stop"
                    title="Interrupt the running turn"
                    className="m-1.5 flex h-11 w-11 sm:h-9 sm:w-9 shrink-0 items-center justify-center border border-white/40 text-white transition hover:border-accent hover:text-accent"
                  >
                    <Square className="h-3.5 w-3.5" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void send(input)}
                    disabled={!input.trim()}
                    aria-label=""
                    className="m-1.5 flex h-11 w-11 sm:h-9 sm:w-9 shrink-0 items-center justify-center bg-accent text-white transition hover:bg-accent-hover disabled:opacity-40"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                )}
              </div>
              {err ? <div className="mt-2 text-[12px] text-status-failed font-mono">{err}</div> : null}
              <div className="mt-2 hidden sm:flex items-center gap-4 font-mono text-[10px] tracking-[0.1em] text-p5-muted">
                <span className="flex items-center gap-1"><kbd className="text-p5-text">ENTER</kbd> SEND</span>
                <span className="flex items-center gap-1"><kbd className="text-p5-text">SHIFT+ENTER</kbd> NEWLINE</span>
                <span className="flex items-center gap-1"><kbd className="text-p5-text">/</kbd> COMMANDS</span>
                <span className="flex items-center gap-1"><kbd className="text-p5-text">ctrl</kbd>+<kbd className="text-p5-text">C</kbd> INTERRUPT</span>
                {sending ? (
                  <span className="ml-auto flex items-center gap-1.5 text-accent">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
                    RUNNING — TYPING QUEUES YOUR NEXT MESSAGE
                  </span>
                ) : queuedCount > 0 ? (
                  <span className="ml-auto text-accent">QUEUED: {queuedCount}</span>
                ) : null}
                <span className={cn('ml-auto flex items-center gap-1.5', gwStatus === 'on' ? 'text-emerald-400' : 'text-p5-muted/70')}>
                  {gwStatus === 'connecting' ? (
                    <>GATEWAY CONNECTING…</>
                  ) : gwStatus === 'on' ? (
                    <>GATEWAY ON — STEER + INTERRUPT LIVE</>
                  ) : (
                    <>GATEWAY OFF — SYNC MODE</>
                  )}
                </span>
                <span className="hidden lg:inline text-p5-muted/70">DANGEROUS COMMANDS ARE GATED BY HERMES GUARDRAILS</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      {focusPrompt && !splashMin ? (
        <PromptSplash
          prompt={focusPrompt}
          index={0}
          total={pendingPrompts.length}
          input={promptInput}
          onInput={setPromptInput}
          onRespond={(v) => respondPrompt(focusPrompt, v)}
          onMinimize={() => setSplashMin(true)}
          onNext={pendingPrompts.length > 1 ? cyclePrompt : undefined}
        />
      ) : null}
    </section>
  );
}

// ============================================================================
// Message rendering
// ============================================================================

function MarkdownContent({ content }: { content: string | null }): React.JSX.Element {
  if (!content || !content.trim()) return <span className="text-p5-muted">—</span>;
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-accent/60 underline-offset-2 transition hover:decoration-accent"
          >
            {children}
          </a>
        ),
        code: ({ className, children, ...props }) => {
          const isInline = !className;
          return isInline ? (
            <code className="rounded bg-black/[0.05] px-1 py-0.5 text-[12px] font-mono [.bg-p5-ink_&]:bg-white/10" {...props}>
              {children}
            </code>
          ) : (
            <pre className="my-2 overflow-x-auto rounded bg-black/[0.06] p-3 text-[12px] font-mono [.bg-p5-ink_&]:bg-white/10">
              <code className={className} {...props}>
                {children}
              </code>
            </pre>
          );
        },
        pre: ({ children }) => <>{children}</>,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

function MessageBubble({ message }: { message: HermesMessage }): React.JSX.Element {
  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';
  const isTool = message.role === 'tool';
  const isSystem = message.role === 'system';
  const isCommand = isUser && typeof message.content === 'string' && message.content.startsWith('/');
  const when = message.timestamp ? formatRelative(new Date(message.timestamp * 1000).toISOString()) : null;
  const [toolExpanded, setToolExpanded] = React.useState(false);

  if (isTool) {
    // Terminal (and other) tool rows show the FULL command + output —
    // the stored content is a JSON envelope: {output, exit_code, error}
    // for shell tools, or tool-specific fields (bytes_written, paths…).
    let output = '';
    let exitCode: unknown = null;
    let error: unknown = null;
    let extra: Array<[string, string]> = [];
    const raw = typeof message.content === 'string' ? message.content : '';
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (parsed && typeof parsed === 'object') {
        output = String(parsed['output'] ?? '');
        exitCode = parsed['exit_code'];
        error = parsed['error'];
        // Tool-specific envelope fields (no output/exit) → key/value detail.
        if (!output && exitCode === undefined) {
          extra = Object.entries(parsed)
            .filter(([k]) => !['output', 'exit_code', 'error'].includes(k))
            .slice(0, 6)
            .map(([k, v]) => [k.replace(/_/g, ' '), typeof v === 'object' ? JSON.stringify(v) : String(v)]);
        }
      }
    } catch {
      output = raw;
    }
    let command: string | null = null;
    const toolCalls = (message as unknown as { tool_calls?: unknown }).tool_calls;
    if (Array.isArray(toolCalls) && toolCalls[0]) {
      const tc = toolCalls[0] as { arguments?: unknown };
      if (typeof tc.arguments === 'string') {
        try { command = (JSON.parse(tc.arguments) as { command?: string }).command ?? null; } catch { /* */ }
      } else if (tc.arguments && typeof tc.arguments === 'object') {
        command = (tc.arguments as { command?: string }).command ?? null;
      }
    }
    return (
      <div className="max-w-3xl mx-auto pl-2">
        <div className="border border-white/15 bg-p5-ink-3">
          <button
            type="button"
            onClick={() => setToolExpanded((v) => !v)}
            className="flex w-full items-center gap-2 border-b border-white/10 px-3 py-1.5 text-left font-mono text-[11px] text-p5-muted transition hover:bg-white/[0.04]"
          >
            <Wrench className="h-3 w-3 shrink-0 text-accent" />
            <span className="font-bold text-p5-text">{message.tool_name ?? 'tool'}</span>
            <span className="min-w-0 flex-1 truncate text-p5-muted">
              {command ?? output.replace(/\n/g, ' ').slice(0, 80) ?? ''}
            </span>
            {typeof exitCode === 'number' ? (
              <span className={String(exitCode) === '0' ? 'shrink-0 text-emerald-400' : 'shrink-0 text-status-failed'}>
                EXIT {String(exitCode)}
              </span>
            ) : null}
            <ChevronDown className={cn('h-3 w-3 shrink-0 transition-transform', toolExpanded && 'rotate-180')} />
          </button>
          {toolExpanded ? (
            <div className="border-t border-white/10">
              {command ? (
                <pre className="overflow-x-auto whitespace-pre-wrap break-words border-b border-white/10 px-3 py-2 font-mono text-[12px] text-p5-text">
                  {command}
                </pre>
              ) : null}
              {output ? (
                <pre className="max-h-[260px] overflow-y-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-[11px] leading-relaxed text-p5-muted">
                  {output}
                </pre>
              ) : null}
              {extra.length > 0 ? (
                <div className="px-3 py-2 font-mono text-[11px] leading-relaxed text-p5-muted">
                  {extra.map(([k, v]) => (
                    <div key={k} className="flex gap-2">
                      <span className="shrink-0 text-p5-muted/70">{k}:</span>
                      <span className="min-w-0 break-all text-p5-text">{v}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  if (isSystem) {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="border border-black/10 px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-p5-dark-muted">
          {message.content}
        </div>
      </div>
    );
  }

  if (isCommand) {
    return (
      <div className="flex gap-3 flex-row-reverse">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center bg-accent text-[10px] text-white">
          <UserIcon className="w-3.5 h-3.5" />
        </div>
        <div className="min-w-0 flex-1 flex flex-col items-end">
          <div className="mb-1 flex items-center gap-2 text-[10px] text-p5-dark-muted">
            <span className="font-black tracking-[0.1em]">YOU</span>
            {when ? <span>{when}</span> : null}
          </div>
          <div className="max-w-full break-all border border-black/20 bg-black/[0.04] px-3 py-2 font-mono text-[13px] leading-relaxed text-p5-dark">
            <Hash className="mr-1 inline-block h-3.5 w-3.5 align-middle text-p5-dark-muted" />
            {message.content}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex gap-3', isUser && 'flex-row-reverse')}>
      <div
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center text-[10px]',
          isAssistant
            ? 'border border-black/15 text-p5-dark-muted'
            : 'bg-accent text-white',
        )}
      >
        {isAssistant ? <Bot className="w-3.5 h-3.5" /> : <UserIcon className="w-3.5 h-3.5" />}
      </div>
      <div className={cn('min-w-0 flex-1', isUser && 'flex flex-col items-end')}>
        <div className="mb-1 flex items-center gap-2 text-[10px]">
          <span className={cn('font-black tracking-[0.1em]', isUser ? 'text-p5-dark-muted' : 'text-accent')}>
            {isUser ? 'YOU' : 'HERMES'}
          </span>
          {when ? <span className="text-p5-dark-muted">{when}</span> : null}
        </div>
        <div
          className={cn(
            'px-3.5 py-2.5 text-[14px] leading-relaxed break-words overflow-hidden',
            isAssistant
              ? 'border-2 border-black/15 bg-p5-panel text-p5-dark'
              : 'bg-p5-ink text-p5-text',
          )}
        >
          <MemoMarkdownContent content={message.content} />
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Slash command menu
// ============================================================================

function SlashCommandMenu({
  matches,
  onPick,
}: {
  matches: SlashCommand[];
  onPick: (cmd: string) => void;
}): React.JSX.Element {
  if (matches.length === 0) return <></>;
  return (
    <div className="absolute bottom-full mb-1 left-0 right-4 sm:right-12 max-w-md overflow-hidden border border-white/15 bg-p5-ink-2 shadow-[0_16px_40px_rgba(0,0,0,0.5)] max-h-[40dvh] overflow-y-auto">
      <div className="border-b border-white/10 bg-p5-ink-3 px-3 py-1.5 p5-kicker text-p5-muted">
        Slash commands
      </div>
      {matches.map((c) => (
        <button
          key={c.cmd}
          type="button"
          onClick={() => { if (!c.cliOnly) onPick(c.cmd); }}
          className={cn(
            'w-full text-left px-3 py-3 sm:py-2 flex items-center gap-3 transition min-h-[44px] sm:min-h-0',
            c.cliOnly
              ? 'opacity-40 cursor-not-allowed'
              : 'hover:bg-white/[0.05]',
          )}
          title={c.cliOnly ? 'Only available in the Hermes CLI / messaging platforms (Telegram, Discord, Slack)' : c.hint}
        >
          <Hash className={cn('w-3.5 h-3.5 mt-0.5 shrink-0', c.cliOnly ? 'text-p5-muted' : 'text-p5-muted')} />
          <div className="min-w-0">
            <div className="text-[13px]">
              <span className={cn('font-mono', c.cliOnly ? 'text-p5-muted' : 'text-p5-text')}>{c.cmd}</span>
              <span className={cn('ml-2', c.cliOnly ? 'text-p5-muted' : 'text-p5-muted')}>{c.label}</span>
            </div>
            <div className="text-[11px] text-p5-muted">{c.hint}</div>
          </div>
        </button>
      ))}
    </div>
  );
}

/**
 * Memoised renderers.
 *
 * The composer lives in the same component as the transcript, so without this
 * every keystroke re-rendered every message — re-parsing markdown and
 * re-highlighting code blocks on each character typed. Message objects are
 * stable (they come from the query cache), so memo skips the whole transcript
 * while the user types.
 */
const MemoMessageBubble = React.memo(MessageBubble);
const MemoMarkdownContent = React.memo(MarkdownContent);
