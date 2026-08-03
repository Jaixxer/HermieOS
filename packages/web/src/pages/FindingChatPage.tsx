import * as React from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Bot,
  User as UserIcon,
  Send,
  Loader2,
  ExternalLink,
  Star,
  BookOpen,
  Rocket,
  Compass,
  GraduationCap,
  MessageSquare,
  Wrench,
  CircleAlert,
  FlaskConical,
  ListChecks,
} from 'lucide-react';
import { api, type ObjectDetail, type HermesInfo, type HermesMessage } from '../api';
import { useScouts } from '../hooks/data';
import { useServer } from '../server';
import { Button } from '../components/ui/button';
import { cn, formatRelative } from '../lib/utils';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Finding conversation — a dedicated surface for talking to Hermes
 * about ONE finding.
 *
 * Deliberately its own page, not a mode of the Chat page. The finding
 * is pinned as a hero context card (so Hermes and the user always
 * know what is being discussed), and the follow-up box records raw
 * feedback as a `suggest` row before dispatching — either into the
 * finding's chat session (immediate) or as a tracked background
 * research run.
 */

// ============================================================================
// Object-type accent palette (editorial-lite: hard blocks, one bold hue)
// ============================================================================

interface TypeMeta {
  label: string;
  /** Tailwind classes for the accent block + text on white. */
  chip: string;
  /** Solid accent color used for bands and borders. */
  band: string;
  hard: string;
}

const TYPE_META: Record<string, TypeMeta> = {
  research: { label: 'Research', chip: 'bg-sky-50 text-sky-700 border-sky-200', band: 'bg-sky-600', hard: 'text-sky-700' },
  opportunity: { label: 'Opportunity', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200', band: 'bg-emerald-600', hard: 'text-emerald-700' },
  discovery: { label: 'Discovery', chip: 'bg-cyan-50 text-cyan-700 border-cyan-200', band: 'bg-cyan-600', hard: 'text-cyan-700' },
  project: { label: 'Project', chip: 'bg-amber-50 text-amber-700 border-amber-200', band: 'bg-amber-500', hard: 'text-amber-600' },
  decision: { label: 'Decision', chip: 'bg-rose-50 text-rose-700 border-rose-200', band: 'bg-rose-600', hard: 'text-rose-700' },
  learning_path: { label: 'Learning Path', chip: 'bg-violet-50 text-violet-700 border-violet-200', band: 'bg-violet-600', hard: 'text-violet-700' },
  note: { label: 'Note', chip: 'bg-slate-100 text-slate-700 border-slate-200', band: 'bg-slate-600', hard: 'text-slate-700' },
  collection: { label: 'Collection', chip: 'bg-slate-100 text-slate-700 border-slate-200', band: 'bg-slate-600', hard: 'text-slate-700' },
};

function typeMeta(type: string): TypeMeta {
  return TYPE_META[type] ?? { label: type, chip: 'bg-slate-100 text-slate-700 border-slate-200', band: 'bg-slate-600', hard: 'text-slate-700' };
}

// ============================================================================
// Quick actions — one-tap follow-ups that steer Hermes in a direction
// ============================================================================

interface QuickAction {
  id: string;
  label: string;
  icon: React.ElementType;
  prompt: string;
}

const QUICK_ACTIONS: QuickAction[] = [
  {
    id: 'explain',
    label: 'Explain simply',
    icon: GraduationCap,
    prompt: "Explain this finding's key ideas to me simply — I'm new to this area.",
  },
  {
    id: 'summarize',
    label: 'Summary + guide',
    icon: BookOpen,
    prompt: 'Create a great summary of this for a beginner, plus a short guide to understand it.',
  },
  {
    id: 'project',
    label: 'Make a project',
    icon: Rocket,
    prompt: 'I want to make a project around this. Draft a plan: milestones, first steps, what I need to learn.',
  },
  {
    id: 'deeper',
    label: 'Deeper research',
    icon: Compass,
    prompt: 'Research this deeper: related work, alternatives, open problems, and where it is headed.',
  },
];

// ============================================================================
// Page
// ============================================================================

export function FindingChatPage(): React.JSX.Element {
  const { id = '' } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { connected } = useServer();

  const objectQ = useQuery({
    queryKey: ['object', id],
    queryFn: () => api.object(id),
    enabled: connected && !!id,
  });

  const sessionQ = useQuery({
    queryKey: ['discuss-session', id],
    queryFn: () => api.discussSession(id),
    enabled: connected && !!id,
  });

  const hermesInfo = useQuery({
    queryKey: ['hermes-info'],
    queryFn: () => api.hermesInfo(),
    enabled: connected,
    staleTime: 60 * 60 * 1000,
  });

  const { data: scouts } = useScouts();
  const obj = objectQ.data?.object ?? null;
  const session = sessionQ.data ?? null;

  const scoutName = React.useMemo(() => {
    if (!obj) return null;
    const subId = typeof obj.body['subscriptionId'] === 'string' ? obj.body['subscriptionId'] : null;
    if (!subId) return null;
    return scouts?.find((s) => s.id === subId)?.name ?? null;
  }, [obj, scouts]);

  if (objectQ.isLoading) {
    return <div className="min-h-screen flex items-center justify-center text-[13px] text-text-tertiary">Loading finding…</div>;
  }

  if (!obj) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 text-text-tertiary">
        <CircleAlert className="w-8 h-8" />
        <p className="text-[14px]">This finding no longer exists.</p>
        <Link to="/scouting" className="text-[13px] text-accent-text hover:underline">Back to scouting</Link>
      </div>
    );
  }

  return (
    <div className="h-screen overflow-hidden flex flex-col bg-page text-text-primary">
      <TopBar objectTitle={obj.title} />
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-6 py-6 space-y-6">
          <FindingHero obj={obj} scoutName={scoutName} />
          {session && hermesInfo.data ? (
            <FindingThread
              obj={obj}
              info={hermesInfo.data}
              sessionId={session.sessionId}
              exists={session.exists}
            />
          ) : null}
        </div>
      </div>
      {session && hermesInfo.data ? (
        <FollowUpComposer
          obj={obj}
          onSent={(background) => {
            qc.invalidateQueries({ queryKey: ['hermes-messages', session.sessionId] });
            if (!background) {
              qc.invalidateQueries({ queryKey: ['discuss-session', obj.id] });
            }
          }}
        />
      ) : null}
    </div>
  );
}

// ============================================================================
// Top bar
// ============================================================================

function TopBar({ objectTitle }: { objectTitle: string }): React.JSX.Element {
  return (
    <div className="h-[52px] shrink-0 px-6 border-b border-border-default flex items-center gap-3 bg-surface-0/95 backdrop-blur">
      <Link to={`/objects/${''}`} className="flex items-center gap-2 text-text-tertiary hover:text-text-primary transition">
        <ArrowLeft className="w-4 h-4" />
        <span className="text-[13px]">Finding</span>
      </Link>
      <span className="text-[11px] text-text-quaternary">/</span>
      <MessageSquare className="w-3.5 h-3.5 text-accent-text" />
      <span className="text-[13px] font-medium text-text-primary truncate">Conversation</span>
      <span className="text-[11px] text-text-quaternary truncate hidden sm:inline">· {objectTitle}</span>
    </div>
  );
}

// ============================================================================
// Finding hero — the pinned context card
// ============================================================================

function FindingHero({ obj, scoutName }: { obj: ObjectDetail; scoutName: string | null }): React.JSX.Element {
  const meta = typeMeta(obj.type);
  const body = obj.body ?? {};
  const url = typeof body['url'] === 'string' ? body['url'] : null;
  const stars = typeof body['stars'] === 'number' ? body['stars'] : null;
  const author = typeof body['author'] === 'string' ? body['author'] : null;
  const published = typeof body['publishedDate'] === 'string' ? body['publishedDate'] : null;
  const kind = typeof body['kind'] === 'string' ? body['kind'] : null;
  const source = typeof body['source'] === 'string' ? body['source'] : null;

  return (
    <section className="relative overflow-hidden rounded-xl border border-border-default bg-surface-0 shadow-sm">
      {/* Hard accent band + diagonal cut */}
      <div className={cn('h-1.5 w-full', meta.band)} />
      <div className="absolute top-1.5 right-0 w-24 h-24 bg-gradient-to-bl from-transparent to-black/[0.03] [clip-path:polygon(100%_0,100%_100%,0_100%)]" />
      <div className="p-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn('text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded border', meta.chip)}>
            {meta.label}
          </span>
          {kind ? <span className="text-[10px] font-mono text-text-quaternary">kind: {kind}</span> : null}
          {scoutName ? (
            <span className="text-[10px] font-mono text-text-quaternary inline-flex items-center gap-1">
              <FlaskConical className="w-3 h-3" /> {scoutName}
            </span>
          ) : null}
        </div>
        <h1 className="mt-3 text-[26px] leading-tight font-bold tracking-tight text-text-primary">
          {obj.title}
        </h1>
        {obj.summary ? <p className="mt-2 text-[13px] text-text-secondary leading-relaxed max-w-2xl">{obj.summary}</p> : null}
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-text-tertiary">
          {url ? (
            <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent-text hover:underline max-w-[420px] truncate">
              <ExternalLink className="w-3 h-3 shrink-0" />
              {url}
            </a>
          ) : null}
          {stars != null ? (
            <span className="inline-flex items-center gap-1"><Star className="w-3 h-3 text-amber-500" /> {stars.toLocaleString()}</span>
          ) : null}
          {author ? <span>{author}</span> : null}
          {published ? <span>{published}</span> : null}
          {source ? <span className="font-mono">{source}</span> : null}
          <span>{formatRelative(obj.updatedAt)}</span>
        </div>
        {obj.tags.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {obj.tags.map((t) => (
              <span key={t} className="text-[10px] px-2 py-0.5 rounded-full bg-surface-2 text-text-tertiary">{t}</span>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

// ============================================================================
// Thread — bespoke message list for the finding conversation
// ============================================================================

function FindingThread({
  obj,
  info,
  sessionId,
  exists,
}: {
  obj: ObjectDetail;
  info: HermesInfo;
  sessionId: string;
  exists: boolean;
}): React.JSX.Element {
  const meta = typeMeta(obj.type);
  const messages = useQuery({
    queryKey: ['hermes-messages', sessionId],
    queryFn: () => api.hermesGetMessages(info, sessionId),
    refetchInterval: 4_000,
    enabled: !!sessionId,
  });

  const ordered = React.useMemo(() => {
    const list = messages.data?.data ?? [];
    return [...list].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
  }, [messages.data]);

  const endRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    endRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' });
  }, [ordered.length]);

  if (!exists && !messages.isLoading && (messages.data?.data.length ?? 0) === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border-default p-10 text-center space-y-2">
        <MessageSquare className="w-8 h-8 mx-auto text-text-quaternary" />
        <p className="text-[14px] font-medium text-text-primary">Start the conversation</p>
        <p className="text-[12px] text-text-tertiary max-w-md mx-auto">
          Ask Hermes to dig into this finding — summarize it, plan a project around it, or
          research it deeper. The conversation stays attached to this finding.
        </p>
      </div>
    );
  }

  if (messages.isLoading && ordered.length === 0) {
    return <div className="py-10 text-center text-[12px] text-text-quaternary">Loading conversation…</div>;
  }

  if (ordered.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border-default p-10 text-center space-y-2">
        <Bot className="w-8 h-8 mx-auto text-text-quaternary" />
        <p className="text-[14px] font-medium text-text-primary">Nothing here yet</p>
        <p className="text-[12px] text-text-tertiary max-w-md mx-auto">
          Your first follow-up seeds Hermes with the finding's full context.
        </p>
      </div>
    );
  }

  return (
    <section className="space-y-4">
      {ordered.map((m) => (
        <FindingBubble key={String(m.id)} message={m} accentClass={meta.band} />
      ))}
      <div ref={endRef} />
    </section>
  );
}

function FindingBubble({ message, accentClass }: { message: HermesMessage; accentClass: string }): React.JSX.Element {
  const role = message.role;

  if (role === 'tool') {
    return (
      <div className="max-w-3xl pl-9">
        <div className="text-[10px] font-mono text-text-quaternary flex items-center gap-1.5 py-1">
          <Wrench className="w-3 h-3 shrink-0" />
          <span className="text-text-tertiary">{message.tool_name ?? 'tool'}</span>
          <span className="truncate">· {typeof message.content === 'string' ? message.content.slice(0, 90) : ''}</span>
        </div>
      </div>
    );
  }

  if (role === 'system') {
    return (
      <div className="max-w-3xl pl-9">
        <div className="text-[11px] font-mono text-text-quaternary bg-surface-1 border border-border-default rounded-md px-3 py-2 whitespace-pre-wrap">
          {message.content}
        </div>
      </div>
    );
  }

  const isUser = role === 'user';
  return (
    <div className={cn('flex gap-3', isUser && 'flex-row-reverse')}>
      <div
        className={cn(
          'w-7 h-7 shrink-0 rounded-md flex items-center justify-center',
          isUser ? 'bg-text-primary text-page' : 'bg-surface-2 text-text-primary border border-border-default',
        )}
      >
        {isUser ? <UserIcon className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
      </div>
      <div className={cn('min-w-0 flex-1', isUser && 'flex flex-col items-end')}>
        <div className="text-[10px] text-text-quaternary mb-1 flex items-center gap-2">
          <span className="font-medium">{isUser ? 'You' : 'Hermes'}</span>
          {message.timestamp ? <span>{formatRelative(new Date(message.timestamp * 1000).toISOString())}</span> : null}
        </div>
        <div
          className={cn(
            'rounded-lg px-3.5 py-2.5 text-[14px] leading-relaxed break-words overflow-hidden',
            'prose prose-sm prose-a:text-accent-text prose-pre:bg-surface-2 prose-pre:border-0 prose-code:text-[13px] prose-code:bg-surface-2 prose-code:px-1 prose-code:rounded',
            isUser
              ? 'bg-text-primary text-page max-w-[85%]'
              : cn('bg-surface-1 border border-border-default text-text-primary border-l-4', accentClass),
          )}
        >
          <MarkdownContent content={message.content} />
        </div>
      </div>
    </div>
  );
}

function MarkdownContent({ content }: { content: string | null }): React.JSX.Element {
  if (!content) return <>(no content)</>;
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer" className="underline">
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

// ============================================================================
// Composer — raw feedback + instant execution
// ============================================================================

function FollowUpComposer({
  obj,
  onSent,
}: {
  obj: ObjectDetail;
  onSent: (background: boolean) => void;
}): React.JSX.Element {
  const [input, setInput] = React.useState('');
  const [background, setBackground] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<string | null>(null);

  const sendMut = useMutation({
    mutationFn: (message: string) =>
      api.followUp(obj.id, { message, runInBackground: background }),
    onSuccess: (res) => {
      setInput('');
      setNote(res.background ? 'Dispatched as a background research run — results land in your Feed.' : 'Sent. Hermes is on it.');
      window.setTimeout(() => setNote(null), 6000);
      onSent(res.background);
    },
    onError: (e) => setErr((e as Error).message),
  });

  function send(text: string): void {
    const trimmed = text.trim();
    if (!trimmed || sendMut.isPending) return;
    setErr(null);
    sendMut.mutate(trimmed);
  }

  return (
    <div className="shrink-0 border-t border-border-default bg-surface-0/95 backdrop-blur">
      <div className="max-w-4xl mx-auto px-6 py-3">
        {/* Quick actions */}
        <div className="flex flex-wrap gap-2 mb-2.5">
          <span className="text-[10px] uppercase tracking-wider text-text-quaternary self-center mr-1">Follow up:</span>
          {QUICK_ACTIONS.map((qa) => {
            const Icon = qa.icon;
            return (
              <button
                key={qa.id}
                type="button"
                onClick={() => send(qa.prompt)}
                disabled={sendMut.isPending}
                className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1.5 rounded-md border border-border-default bg-surface-0 text-text-secondary hover:border-accent hover:text-accent-text hover:bg-accent-soft transition disabled:opacity-50"
              >
                <Icon className="w-3 h-3" />
                {qa.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-end gap-2 border border-border-default rounded-lg p-2 bg-surface-0 focus-within:border-accent transition">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder={background ? 'Describe the deep work — a tracked run will do it.' : 'Raw feedback: what should Hermes do with this finding?'}
            className="min-h-[40px] max-h-[160px] resize-none border-0 p-1 text-[13px] focus:ring-0 bg-transparent flex-1 outline-none"
            rows={1}
          />
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setBackground((b) => !b)}
              title="Run as a tracked background run instead of a chat reply"
              className={cn(
                'inline-flex items-center gap-1.5 text-[10px] font-medium px-2 py-1.5 rounded-md border transition',
                background
                  ? 'border-accent bg-accent-soft text-accent-text'
                  : 'border-border-default text-text-tertiary hover:text-text-primary',
              )}
            >
              <ListChecks className="w-3 h-3" />
              Background
            </button>
            <Button
              onClick={() => send(input)}
              disabled={!input.trim() || sendMut.isPending}
              size="icon"
              className="rounded-lg"
              aria-label="Send follow-up"
            >
              {sendMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </div>
        </div>

        {note ? <div className="mt-2 text-[11px] text-accent-text flex items-center gap-1.5"><ListChecks className="w-3 h-3" /> {note}</div> : null}
        {err ? <div className="mt-2 text-[11px] text-status-failed">{err}</div> : null}
        <div className="mt-1.5 text-[10px] text-text-quaternary flex items-center gap-3">
          <span><kbd className="font-mono">⏎</kbd> send</span>
          <span><kbd className="font-mono">⇧⏎</kbd> newline</span>
          <span>Every follow-up trains the feed — Hermes learns what you care about.</span>
        </div>
      </div>
    </div>
  );
}
