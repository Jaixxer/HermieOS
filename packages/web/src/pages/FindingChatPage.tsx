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
import { cn, formatRelative } from '../lib/utils';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Finding conversation — talk to Hermes about ONE finding.
 * Editorial frame: the finding pinned as a hard-edged hero card, a
 * thread of white/ink bubbles, and a dark console composer. Every
 * follow-up records raw feedback before dispatching.
 */

// ============================================================================
// Object-type accents
// ============================================================================

interface TypeMeta {
  label: string;
  /** Tailwind classes for the accent band + text. */
  chip: string;
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
// Quick actions
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
    return (
      <div className="flex bg-p5-cream flex-1 min-w-0 min-h-0">
        <div className="flex-1 flex items-center justify-center font-mono text-[12px] tracking-widest text-p5-dark-muted">
          LOADING FINDING…
        </div>
      </div>
    );
  }

  if (!obj) {
    return (
      <div className="flex bg-p5-cream flex-1 min-w-0 min-h-0">
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-p5-dark-muted">
          <CircleAlert className="w-8 h-8" />
          <p className="text-[14px]">This finding no longer exists.</p>
          <Link to="/scouting" className="text-[12px] font-black tracking-[0.12em] text-accent hover:underline">
            BACK TO SCOUTING
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen overflow-hidden flex bg-p5-cream text-p5-dark flex-1 min-w-0">
      <main className="flex-1 min-w-0 min-h-0 flex flex-col">
        <TopBar objectTitle={obj.title} />
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6">
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
      </main>
    </div>
  );
}

// ============================================================================
// Top bar
// ============================================================================

function TopBar({ objectTitle }: { objectTitle: string }): React.JSX.Element {
  return (
    <div className="h-[52px] shrink-0 border-b border-black/10 px-6 flex items-center gap-3 bg-p5-cream">
      <Link to={`/objects/${''}`} className="flex items-center gap-2 font-mono text-[11px] tracking-[0.12em] text-p5-dark-muted transition hover:text-p5-dark">
        <ArrowLeft className="h-4 w-4" />
        FINDING
      </Link>
      <span className="text-[11px] text-p5-dark-muted">/</span>
      <MessageSquare className="h-3.5 w-3.5 text-accent" />
      <span className="truncate font-black tracking-[0.14em] text-p5-dark uppercase">Conversation</span>
      <span className="hidden truncate font-mono text-[11px] text-p5-dark-muted sm:inline">· {objectTitle}</span>
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
    <section className="relative overflow-hidden border-2 border-black/15 bg-p5-panel">
      <div className={cn('h-1.5 w-full', meta.band)} />
      <div className="p-4 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn('border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em]', meta.chip)}>
            {meta.label}
          </span>
          {kind ? <span className="font-mono text-[10px] text-p5-dark-muted">kind: {kind}</span> : null}
          {scoutName ? (
            <span className="inline-flex items-center gap-1 font-mono text-[10px] text-p5-dark-muted">
              <FlaskConical className="h-3 w-3" /> {scoutName}
            </span>
          ) : null}
        </div>
        <h1 className="relative mt-3 inline-block font-p5-serif text-[clamp(24px,3vw,36px)] leading-[0.95] text-p5-dark">
          {obj.title}
          <span className="absolute -bottom-2 left-0 h-[5px] w-full bg-accent" />
        </h1>
        {obj.summary ? <p className="mt-4 max-w-2xl text-[13px] leading-relaxed text-p5-dark-muted">{obj.summary}</p> : null}
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 font-mono text-[11px] text-p5-dark-muted">
          {url ? (
            <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-[420px] items-center gap-1 truncate font-bold text-accent hover:underline">
              <ExternalLink className="h-3 w-3 shrink-0" />
              {url}
            </a>
          ) : null}
          {stars != null ? (
            <span className="inline-flex items-center gap-1"><Star className="h-3 w-3 text-amber-500" /> {stars.toLocaleString()}</span>
          ) : null}
          {author ? <span>{author}</span> : null}
          {published ? <span>{published}</span> : null}
          {source ? <span>{source}</span> : null}
          <span>{formatRelative(obj.updatedAt)}</span>
        </div>
        {obj.tags.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {obj.tags.map((t) => (
              <span key={t} className="border border-black/15 bg-black/[0.03] px-2 py-0.5 font-mono text-[10px] text-p5-dark-muted">{t}</span>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

// ============================================================================
// Thread
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
      <div className="border-2 border-dashed border-p5-dark-line p-10 text-center space-y-2">
        <MessageSquare className="mx-auto h-8 w-8 text-p5-dark-muted" />
        <p className="font-p5-serif text-[22px] text-p5-dark">Start the conversation</p>
        <p className="mx-auto max-w-md text-[12px] text-p5-dark-muted">
          Ask Hermes to dig into this finding — summarize it, plan a project around it, or
          research it deeper. The conversation stays attached to this finding.
        </p>
      </div>
    );
  }

  if (messages.isLoading && ordered.length === 0) {
    return <div className="py-10 text-center font-mono text-[11px] tracking-widest text-p5-dark-muted">LOADING CONVERSATION…</div>;
  }

  if (ordered.length === 0) {
    return (
      <div className="border-2 border-dashed border-p5-dark-line p-10 text-center space-y-2">
        <Bot className="mx-auto h-8 w-8 text-p5-dark-muted" />
        <p className="font-p5-serif text-[22px] text-p5-dark">Nothing here yet</p>
        <p className="mx-auto max-w-md text-[12px] text-p5-dark-muted">
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
  const hasContent = typeof message.content === 'string' && message.content.trim().length > 0;

  if (role === 'tool') {
    return (
      <div className="max-w-3xl pl-9">
        <div className="flex items-center gap-1.5 py-1 font-mono text-[11px] text-p5-dark-muted">
          <Wrench className="h-3 w-3 shrink-0" />
          <span className="text-p5-dark">{message.tool_name ?? 'tool'}</span>
          <span className="truncate">· {hasContent ? String(message.content).slice(0, 90) : ''}</span>
        </div>
      </div>
    );
  }

  if (role === 'system') {
    return (
      <div className="max-w-3xl pl-9">
        <div className="whitespace-pre-wrap border border-black/10 px-3 py-2 font-mono text-[11px] text-p5-dark-muted">
          {message.content}
        </div>
      </div>
    );
  }

  const isUser = role === 'user';

  // Empty assistant replies carry no signal — skip the empty bubble.
  if (!isUser && !hasContent) return <></>;

  return (
    <div className={cn('flex gap-3', isUser && 'flex-row-reverse')}>
      <div
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center',
          isUser ? 'bg-p5-ink text-p5-cream' : 'border border-black/15 text-p5-dark-muted',
        )}
      >
        {isUser ? <UserIcon className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
      </div>
      <div className={cn('min-w-0 flex-1', isUser && 'flex flex-col items-end')}>
        <div className="mb-1 flex items-center gap-2 text-[10px]">
          <span className={cn('font-black tracking-[0.1em]', isUser ? 'text-p5-dark-muted' : 'text-accent')}>
            {isUser ? 'YOU' : 'HERMES'}
          </span>
          {message.timestamp ? <span className="text-p5-dark-muted">{formatRelative(new Date(message.timestamp * 1000).toISOString())}</span> : null}
        </div>
        <div
          className={cn(
            'px-3.5 py-2.5 text-[14px] leading-relaxed break-words overflow-hidden',
            isUser
              ? 'bg-p5-ink text-p5-text max-w-[85%]'
              : cn('border-2 border-black/15 bg-p5-panel text-p5-dark border-l-4', accentClass),
          )}
        >
          <MarkdownContent content={message.content} />
        </div>
      </div>
    </div>
  );
}

function MarkdownContent({ content }: { content: string | null }): React.JSX.Element {
  if (!content || !content.trim()) return <span className="text-p5-dark-muted">—</span>;
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer" className="underline decoration-accent/60 underline-offset-2">
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
    <div className="shrink-0 border-t border-black/10 bg-p5-ink-2">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3">
        {/* Quick actions */}
        <div className="mb-2.5 flex gap-2 overflow-x-auto sm:flex-wrap pb-1 -mx-1 px-1">
          <span className="mr-1 self-center p5-kicker text-p5-muted">Follow up:</span>
          {QUICK_ACTIONS.map((qa) => {
            const Icon = qa.icon;
            return (
              <button
                key={qa.id}
                type="button"
                onClick={() => send(qa.prompt)}
                disabled={sendMut.isPending}
                className="inline-flex shrink-0 items-center gap-1.5 border border-white/25 px-2.5 py-1.5 min-h-[40px] sm:min-h-0 font-mono text-[10px] font-bold tracking-[0.1em] text-p5-muted transition hover:border-white/70 hover:text-p5-text disabled:opacity-50"
              >
                <Icon className="h-3 w-3" />
                {qa.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-end gap-2 border border-white/15 bg-p5-ink-3 transition focus-within:border-accent">
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
            className="min-h-[40px] max-h-[160px] flex-1 resize-none border-0 bg-transparent p-3 text-[16px] sm:text-[13px] text-p5-text outline-none placeholder:text-p5-muted focus:ring-0"
            rows={1}
          />
          <div className="flex shrink-0 items-center gap-2 p-1.5">
            <button
              type="button"
              onClick={() => setBackground((b) => !b)}
              title="Run as a tracked background run instead of a chat reply"
              className={cn(
                'inline-flex items-center gap-1.5 border px-2 py-1.5 font-mono text-[10px] font-bold tracking-[0.1em] transition',
                background
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-white/25 text-p5-muted hover:border-white/70 hover:text-p5-text',
              )}
            >
              <ListChecks className="h-3 w-3" />
              Background
            </button>
            <button
              type="button"
              onClick={() => send(input)}
              disabled={!input.trim() || sendMut.isPending}
              aria-label="Send follow-up"
              className="flex h-11 w-11 sm:h-9 sm:w-9 items-center justify-center bg-accent text-white transition hover:bg-accent-hover disabled:opacity-40"
            >
              {sendMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {note ? <div className="mt-2 flex items-center gap-1.5 font-mono text-[11px] text-accent"><ListChecks className="h-3 w-3" /> {note}</div> : null}
        {err ? <div className="mt-2 font-mono text-[11px] text-status-failed">{err}</div> : null}
        <div className="mt-1.5 hidden sm:flex items-center gap-4 font-mono text-[10px] tracking-[0.1em] text-p5-muted">
          <span><kbd className="text-p5-text">ENTER</kbd> SEND</span>
          <span><kbd className="text-p5-text">SHIFT+ENTER</kbd> NEWLINE</span>
          <span>EVERY FOLLOW-UP TRAINS THE FEED — HERMES LEARNS WHAT YOU CARE ABOUT.</span>
        </div>
      </div>
    </div>
  );
}
