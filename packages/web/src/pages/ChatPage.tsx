import * as React from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
} from 'lucide-react';
import { api, type HermesSession, type HermesMessage, type HermesInfo, type HermesSessionList, type HermesMessageList } from '../api';
import { Sidebar } from '../components/Sidebar';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Card, CardContent } from '../components/ui/card';
import { Input, Textarea } from '../components/ui/input';
import { Loading } from '../components/Loading';
import { formatRelative, cn } from '../lib/utils';
import { useServer } from '../server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Minimalist chat interface over the user's Hermes Agent gateway.
 *
 * Design:
 *  - 3-column layout: Sidebar (nav) | Sessions list | Active chat
 *  - Sessions are read live from Hermes' own SQLite store via
 *    GET /api/sessions — we don't store our own chat history.
 *  - Group sessions by gateway/source so the user can find sessions
 *    from Discord/Telegram/Cron/etc.
 *  - Slash commands inline at the message box: /model, /yolo, etc.
 */

interface SlashCommand {
  cmd: string;
  label: string;
  hint: string;
  cliOnly?: boolean;
}

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

  // Hermes gateway URL + bearer token (the user's MCP token).
  // Fetched once and cached for the page lifetime.
  const hermesInfo = useQuery({
    queryKey: ['hermes-info'],
    queryFn: () => api.hermesInfo(),
    enabled: connected,
    staleTime: 60 * 60 * 1000, // 1 hour
  });

  const sessionsQ = useQuery({
    queryKey: ['hermes-sessions'],
    queryFn: () => api.hermesListSessions(hermesInfo.data!, { limit: 200 }),
    enabled: !!hermesInfo.data,
    refetchInterval: 30_000,
  });

  const activeTitle = React.useMemo(() => {
    if (!sessionId) return null;
    const s = sessionsQ.data?.data?.find((x) => x.id === sessionId);
    if (!s) return null;
    return s.title || s.preview || null;
  }, [sessionsQ.data, sessionId]);

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
    <div className="h-screen overflow-hidden flex bg-page text-text-primary">
      <Sidebar activePath="/chat" className="hidden lg:flex" />
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
            <ChatBody
              info={hermesInfo.data}
              activeSessionId={sessionId ?? null}
              onSelect={(id) => nav(`/chat/${id}`)}
              sessions={sessionsQ}
            />
          ) : hermesInfo.isLoading ? (
            <Loading text="Connecting to Hermes Agent…" className="flex-1" />
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <Card className="max-w-md w-full mx-6">
                <CardContent className="p-8 text-center space-y-3">
                  <AlertCircle className="w-8 h-8 mx-auto text-status-failed" />
                  <p className="text-[14px] font-medium text-text-primary">
                    Couldn't connect to Hermes Agent
                  </p>
                  <p className="text-[12px] text-text-tertiary">
                    {(hermesInfo.error as Error | null)?.message ?? 'Unknown error'}
                  </p>
                  <Button onClick={() => hermesInfo.refetch()} variant="secondary">
                    <RefreshCw className="w-3.5 h-3.5" /> Retry
                  </Button>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </main>
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
    <div className="h-[52px] shrink-0 px-6 border-b border-border-default flex items-center gap-3 bg-surface-0/95 backdrop-blur">
      <Link to="/chat" className="flex items-center gap-2 text-text-primary">
        <MessageSquare className="w-4 h-4 text-accent-text" />
        <span className="text-[14px] font-semibold">Chat</span>
      </Link>
      <span className="text-[11px] text-text-quaternary">/</span>
      {editing ? (
        <form
          className="flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Session title"
            className="h-7 text-[12px] w-64"
            disabled={busy}
          />
          <Button type="submit" size="sm" disabled={busy}>
            Save
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setEditing(false);
              setDraft(title ?? '');
            }}
            disabled={busy}
          >
            Cancel
          </Button>
        </form>
      ) : title ? (
        <button
          type="button"
          className="group flex items-center gap-1 text-[12px] text-text-tertiary hover:text-text-primary transition"
          onClick={() => onRename && setEditing(true)}
          title="Click to rename"
        >
          <span className="truncate max-w-[300px]">{title}</span>
          {onRename ? <Pencil className="w-3 h-3 opacity-0 group-hover:opacity-100 transition" /> : null}
        </button>
      ) : (
        <span className="text-[12px] text-text-tertiary">Hermes Agent</span>
      )}
      <div className="ml-auto flex items-center gap-3">
        {info ? (
          <>
            <span
              className="text-[11px] text-text-quaternary font-mono"
              data-testid="hermes-base-url"
              title={info.baseUrl}
            >
              {info.baseUrl.replace(/^https?:\/\//, '')}
            </span>
            <span className="w-1.5 h-1.5 rounded-full bg-status-success" />
          </>
        ) : loading ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin text-text-quaternary" />
        ) : error ? (
          <button
            onClick={onRetry}
            className="text-[11px] text-status-failed hover:underline flex items-center gap-1"
          >
            <AlertCircle className="w-3.5 h-3.5" />
            Reconnect
          </button>
        ) : null}
        <Link to="/settings" className="text-text-tertiary hover:text-text-primary transition" title="Settings">
          <SettingsIcon className="w-4 h-4" />
        </Link>
      </div>
    </div>
  );
}

function ChatBody({
  info,
  activeSessionId,
  onSelect,
  sessions,
}: {
  info: HermesInfo;
  activeSessionId: string | null;
  onSelect: (id: string) => void;
  sessions: ReturnType<typeof useQuery<HermesSessionList>>;
}): React.JSX.Element {
  const qc = useQueryClient();

  // Local filter state
  const [filter, setFilter] = React.useState('');
  const [sourceFilter, setSourceFilter] = React.useState<string | null>(null);

  // Group sessions by source so the user can find Discord/Telegram/etc.
  const groups = React.useMemo(() => {
    const all = sessions.data?.data ?? [];
    const filtered = all
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
  }, [sessions.data, filter, sourceFilter]);

  const sourcesInUse = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of sessions.data?.data ?? []) {
      counts.set(s.source, (counts.get(s.source) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [sessions.data]);

  return (
    <>
      <SessionsPanel
        groups={groups}
        activeSessionId={activeSessionId}
        onSelect={onSelect}
        onCreate={() => onSelect('__new__')}
        filter={filter}
        setFilter={setFilter}
        sourceFilter={sourceFilter}
        setSourceFilter={setSourceFilter}
        sources={sourcesInUse.map(([s, n]) => ({ source: s, label: SOURCE_LABELS[s] ?? s, count: n }))}
        loading={sessions.isLoading}
        onRefresh={() => sessions.refetch()}
        onDelete={(id) => {
          void api.hermesDeleteSession(info, id).then(() => {
            qc.invalidateQueries({ queryKey: ['hermes-sessions'] });
          });
        }}
      />
      {activeSessionId === '__new__' ? (
        <NewSessionView
          info={info}
          onCreated={(id) => onSelect(id)}
          onCancel={() => onSelect('__noop__')}
        />
      ) : activeSessionId ? (
        <ChatView info={info} sessionId={activeSessionId} model={(sessions.data?.data ?? []).find(s => s.id === activeSessionId)?.model ?? null} onSelect={onSelect} allSessions={sessions.data?.data ?? []} />
      ) : (
        <EmptyChatState onCreate={() => onSelect('__new__')} />
      )}
    </>
  );
}

// ============================================================================
// Sessions panel (middle column)
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
  onRefresh,
  onDelete,
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
  onRefresh: () => void;
  onDelete: (id: string) => void;
}): React.JSX.Element {
  return (
    <aside className="w-[280px] shrink-0 border-r border-border-default flex flex-col bg-surface-0/50">
      <div className="p-3 border-b border-border-default space-y-2">
        <Button onClick={onCreate} className="w-full">
          <Plus className="w-3.5 h-3.5" />
          New session
        </Button>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-quaternary" />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search sessions…"
            className="pl-8 h-8 text-[12px]"
          />
        </div>
        {sources.length > 1 ? (
          <div className="flex flex-wrap gap-1">
            <button
              onClick={() => setSourceFilter(null)}
              className={cn(
                'text-[10px] px-1.5 py-0.5 rounded-md transition',
                sourceFilter === null
                  ? 'bg-accent text-accent-fg font-medium'
                  : 'bg-surface-2 text-text-tertiary hover:bg-surface-3',
              )}
            >
              All ({sources.reduce((a, s) => a + s.count, 0)})
            </button>
            {sources.map((s) => (
              <button
                key={s.source}
                onClick={() => setSourceFilter(s.source)}
                className={cn(
                  'text-[10px] px-1.5 py-0.5 rounded-md transition',
                  sourceFilter === s.source
                    ? 'bg-accent text-accent-fg font-medium'
                    : 'bg-surface-2 text-text-tertiary hover:bg-surface-3',
                )}
              >
                {s.label} ({s.count})
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && groups.length === 0 ? (
          <div className="p-4 text-[12px] text-text-quaternary text-center">Loading…</div>
        ) : groups.length === 0 ? (
          <div className="p-4 text-[12px] text-text-quaternary text-center">
            {filter || sourceFilter ? 'No sessions match.' : 'No sessions yet.'}
          </div>
        ) : (
          groups.map((g) => (
            <div key={g.source} className="border-b border-border-default last:border-0">
              <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-text-quaternary bg-surface-1/50 flex items-center justify-between">
                <span>{g.label}</span>
                <span>{g.sessions.length}</span>
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
          ))
        )}
      </div>

      <div className="px-3 py-2 border-t border-border-default flex items-center justify-between text-[10px] text-text-quaternary">
        <span>{(sessionsTotal(groups))} sessions</span>
        <button
          onClick={onRefresh}
          className="hover:text-text-primary transition"
          title="Refresh"
        >
          <RefreshCw className="w-3 h-3" />
        </button>
      </div>
    </aside>
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
    <span className="text-[13px] font-medium text-text-primary truncate">
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
        'w-full text-left px-3 py-2.5 hover:bg-surface-1 transition group flex items-start gap-2 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        active && 'bg-accent/10 border-l-2 border-accent',
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <SessionDisplayTitle session={session} />
          {session.message_count > 0 ? (
            <span className="text-[10px] text-text-quaternary shrink-0">
              {session.message_count}
            </span>
          ) : null}
        </div>
        {session.preview ? (
          <div className="text-[11px] text-text-tertiary truncate mt-0.5">
            {session.preview.length > 80 ? `${session.preview.slice(0, 77)}…` : session.preview}
          </div>
        ) : null}
        <div className="text-[10px] text-text-quaternary mt-1">
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
        className="opacity-0 group-hover:opacity-100 text-text-quaternary hover:text-status-failed transition p-1 shrink-0"
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

function EmptyChatState({ onCreate }: { onCreate: () => void }): React.JSX.Element {
  return (
    <section className="flex-1 flex items-center justify-center">
      <Card className="max-w-sm">
        <CardContent className="p-8 text-center space-y-3">
          <Bot className="w-10 h-10 mx-auto text-text-quaternary" />
          <h2 className="text-[16px] font-semibold text-text-primary">Start a conversation</h2>
          <p className="text-[12px] text-text-tertiary leading-relaxed">
            Send Hermes Agent a task. The session is persisted across runs and visible in the list.
          </p>
          <Button onClick={onCreate}>
            <Plus className="w-3.5 h-3.5" /> New session
          </Button>
        </CardContent>
      </Card>
    </section>
  );
}

function NewSessionView({
  info,
  onCreated,
  onCancel,
}: {
  info: HermesInfo;
  onCreated: (id: string) => void;
  onCancel: () => void;
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
      const id = `web_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      const trimmedTitle = title.trim();
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

  return (
    <section className="flex-1 flex items-center justify-center">
      <Card className="max-w-md w-full mx-6">
        <CardContent className="p-6 space-y-4">
          <div>
            <h2 className="text-[16px] font-semibold text-text-primary">New session</h2>
            <p className="text-[12px] text-text-tertiary mt-1">
              Hermes will create a fresh session. You can set a model or use the default.
            </p>
          </div>
          <div>
            <label className="block text-[12px] font-medium text-text-secondary mb-1">Title</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Refactor auth middleware"
            />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-text-secondary mb-1">Model</label>
            <Input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="leave blank for default"
              className="font-mono"
            />
          </div>
          {err ? <div className="text-[12px] text-status-failed">{err}</div> : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button onClick={create} disabled={creating}>
              {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              Create session
            </Button>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

// ============================================================================
// Active chat view
// ============================================================================

function ChatView({ info, sessionId, model: sessionModelProp, onSelect, allSessions: sessionsData }: { info: HermesInfo; sessionId: string; model: string | null; onSelect: (id: string) => void; allSessions: HermesSession[] }): React.JSX.Element {
  const qc = useQueryClient();
  const messages = useQuery({
    queryKey: ['hermes-messages', sessionId],
    queryFn: () => api.hermesGetMessages(info, sessionId),
    refetchInterval: 5000, // poll while active
    enabled: !!sessionId && sessionId !== '__new__',
  });

  const [input, setInput] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [slashOpen, setSlashOpen] = React.useState(false);
  const [slashQuery, setSlashQuery] = React.useState('');

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
    if (!text.trim() || sending) return;
    if (text.startsWith('/')) {
      slashHandler(text);
      return;
    }
    await sendToAgent(text);
  }

  async function sendToAgent(text: string): Promise<void> {
    if (!text.trim() || sending) return;
    setSending(true);
    setErr(null);
    try {
      const chatBody: Record<string, unknown> = { message: text };
      if (storedModel) chatBody.model = storedModel;
      await api.hermesChat(info, sessionId, chatBody as { message: string; model?: string });
      qc.invalidateQueries({ queryKey: ['hermes-messages', sessionId] });
      qc.invalidateQueries({ queryKey: ['hermes-sessions'] });
      setInput('');
      setSlashOpen(false);
      setSlashQuery('');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSending(false);
    }
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

      case 'stop':
        sysMsg('API-based sessions cannot be interrupted (synchronous).');
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
    }
  }

  return (
    <section className="flex-1 min-w-0 flex flex-col">
      {/* Header */}
      <div className="h-[52px] shrink-0 px-6 border-b border-border-default flex items-center gap-3 bg-surface-0/95 backdrop-blur">
        <span className="text-[13px] font-medium text-text-primary truncate">
          {messages.data?.data?.[0]?.session_id?.slice(0, 40) ?? sessionId.slice(0, 40)}
        </span>
        {allMessages.filter(m => m.role !== 'system').length > 0 ? (
          <span className="text-[11px] text-text-quaternary">
            {allMessages.filter(m => m.role !== 'system').length} messages
          </span>
        ) : null}
        {sessionModelProp ? (
          <span className="text-[11px] text-text-quaternary font-mono hidden sm:inline">
            {sessionModelProp.includes('/') ? (
              <span title={sessionModelProp}>{sessionModelProp.split('/')[1] ?? sessionModelProp}</span>
            ) : (
              <span>{sessionModelProp}</span>
            )}
          </span>
        ) : null}
        <span className="ml-auto text-[11px] text-text-quaternary font-mono">
          {messages.data?.session_id === sessionId ? 'live' : 'syncing'}
        </span>
      </div>

      {/* Messages + input share the right-side scroll. Input is the
          last child so it lives at the natural end of the scrolling
          column. The column sticks to the bottom when content is
          short (flex-1 + flex-col on the inner container), and scrolls
          when content overflows. */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="min-h-full flex flex-col">
          <div className="flex-1 px-6 py-6">
            {messages.isLoading ? (
              <Loading text="Loading messages…" />
             ) : allMessages.length === 0 ? (
              <div className="text-center text-text-quaternary py-12">
                <Sparkles className="w-6 h-6 mx-auto mb-2" />
                <p className="text-[13px]">Empty session. Send a message to get started.</p>
              </div>
            ) : (
              <div className="max-w-3xl mx-auto space-y-4">
                {allMessages.map((m) => (
                  <MessageBubble key={String(m.id)} message={m} />
                ))}
              </div>
            )}
          </div>

          {/* Input lives at the end of the right-side scroll column */}
          <div ref={inputFooterRef} className="border-t border-border-default p-4 bg-surface-0/95">
            <div className="max-w-3xl mx-auto relative">
              {slashOpen ? (
                <SlashCommandMenu matches={slashMatches} onPick={(cmd) => setInput(cmd + ' ')} />
              ) : null}
              <div className="flex items-end gap-2 border border-border-default rounded-lg p-2 bg-surface-0 focus-within:border-accent">
            <Textarea
              value={input}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => onChangeInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Message Hermes Agent…"
              className="min-h-[40px] max-h-[160px] resize-none border-0 p-1 focus:ring-0"
              rows={1}
            />
                <Button
                  onClick={() => void send(input)}
                  disabled={!input.trim() || sending}
                  size="icon"
                >
                  {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                </Button>
              </div>
              {err ? <div className="mt-2 text-[12px] text-status-failed">{err}</div> : null}
              <div className="mt-1.5 text-[10px] text-text-quaternary flex items-center gap-3">
                <span className="flex items-center gap-1">
                  <kbd className="font-mono">⏎</kbd> send
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="font-mono">⇧⏎</kbd> newline
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="font-mono">/</kbd> slash commands
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function MarkdownContent({ content }: { content: string | null }): React.JSX.Element {
  if (!content) return <>(no content)</>;
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent-text hover:underline"
          >
            {children}
          </a>
        ),
        code: ({ className, children, ...props }) => {
          const isInline = !className;
          return isInline ? (
            <code className="bg-surface-2 px-1 py-0.5 rounded text-[13px] font-mono" {...props}>
              {children}
            </code>
          ) : (
            <pre className="bg-surface-2 rounded-md p-3 my-2 overflow-x-auto text-[13px] font-mono">
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

  if (isTool) {
    return (
      <div className="max-w-3xl mx-auto pl-10">
        <div className="text-[10px] text-text-quaternary font-mono leading-relaxed flex items-center gap-1.5 py-0.5">
          <Wrench className="w-3 h-3 shrink-0" />
          <span className="text-text-tertiary">{message.tool_name ?? 'tool'}</span>
          {message.tool_call_id ? (
            <span className="text-text-quaternary">· {message.tool_call_id.slice(0, 8)}</span>
          ) : null}
          {message.content ? (
            <span className="text-text-quaternary truncate">
              · {message.content.length > 80 ? `${message.content.slice(0, 77)}…` : message.content}
            </span>
          ) : null}
        </div>
      </div>
    );
  }

  if (isSystem) {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="text-[11px] text-text-quaternary bg-surface-1 border border-border-default rounded-md px-3 py-2 leading-relaxed whitespace-pre-wrap font-mono">
          {message.content}
        </div>
      </div>
    );
  }

  if (isCommand) {
    return (
      <div className="flex gap-3 flex-row-reverse">
        <div className="w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-[10px] bg-accent text-accent-fg">
          <UserIcon className="w-3.5 h-3.5" />
        </div>
        <div className="min-w-0 flex-1 flex flex-col items-end">
          <div className="flex items-center gap-2 text-[10px] text-text-quaternary mb-1">
            <span>You</span>
            {message.timestamp ? (
              <span>{formatRelative(new Date(message.timestamp * 1000).toISOString())}</span>
            ) : null}
          </div>
          <div className="bg-surface-2 border border-border-default rounded-lg px-3 py-2 text-[13px] font-mono leading-relaxed break-all text-text-tertiary max-w-full">
            <Hash className="w-3.5 h-3.5 inline-block mr-1 text-text-quaternary align-middle" />
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
          'w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-[10px]',
          isAssistant
            ? 'bg-surface-2 text-text-primary border border-border-default'
            : 'bg-accent text-accent-fg',
        )}
      >
        {isAssistant ? <Bot className="w-3.5 h-3.5" /> : <UserIcon className="w-3.5 h-3.5" />}
      </div>
      <div className={cn('min-w-0 flex-1', isUser && 'flex flex-col items-end')}>
        <div className="text-[10px] text-text-quaternary mb-1 flex items-center gap-2">
          <span>{isUser ? 'You' : 'Hermes'}</span>
          {message.timestamp ? (
            <span>{formatRelative(new Date(message.timestamp * 1000).toISOString())}</span>
          ) : null}
        </div>
        <div
          className={cn(
            'rounded-lg px-3 py-2 text-[14px] leading-relaxed break-words overflow-hidden',
            'prose prose-sm prose-a:text-accent-text prose-pre:bg-surface-2 prose-pre:border-0 prose-code:text-[13px] prose-code:bg-surface-2 prose-code:px-1 prose-code:rounded',
            isAssistant
              ? 'bg-surface-1 border border-border-default text-text-primary'
              : 'bg-accent text-accent-fg [&_a]:text-accent-fg [&_a]:underline',
          )}
        >
          <MarkdownContent content={message.content} />
        </div>
      </div>
    </div>
  );
}

function SlashCommandMenu({
  matches,
  onPick,
}: {
  matches: SlashCommand[];
  onPick: (cmd: string) => void;
}): React.JSX.Element {
  if (matches.length === 0) return <></>;
  return (
    <div className="absolute bottom-full mb-1 left-0 right-12 max-w-md bg-surface-0 border border-border-default rounded-lg shadow-lg overflow-hidden">
      <div className="text-[10px] uppercase tracking-wider text-text-quaternary px-3 py-1.5 bg-surface-1 border-b border-border-default">
        Slash commands
      </div>
      {matches.map((c) => (
        <button
          key={c.cmd}
          onClick={() => { if (!c.cliOnly) onPick(c.cmd); }}
          className={cn(
            'w-full text-left px-3 py-2 flex items-start gap-3 transition',
            c.cliOnly
              ? 'opacity-40 cursor-not-allowed'
              : 'hover:bg-surface-1',
          )}
          title={c.cliOnly ? 'Only available in the Hermes CLI / messaging platforms (Telegram, Discord, Slack)' : c.hint}
        >
          <Hash className={cn('w-3.5 h-3.5 mt-0.5 shrink-0', c.cliOnly ? 'text-text-quaternary' : 'text-accent-text')} />
          <div className="min-w-0">
            <div className="text-[13px] font-medium">
              <span className={cn('font-mono', c.cliOnly ? 'text-text-quaternary' : 'text-accent-text')}>{c.cmd}</span>
              <span className={cn('ml-2', c.cliOnly ? 'text-text-quaternary' : 'text-text-tertiary')}>{c.label}</span>
            </div>
            <div className="text-[11px] text-text-tertiary">{c.hint}</div>
          </div>
        </button>
      ))}
    </div>
  );
}