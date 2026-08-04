import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Search,
  Bell,
  MessageSquare,
  Send,
  ArrowRight,
  ArrowUpRight,
  Bot,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { api } from '../api';
import type {
  TaskCategory,
  Upcoming,
} from '../api';
import { useAuth } from '../auth';
import { useServer } from '../server';
import { useSse } from '../sse';
import { cn } from '../lib/utils';
import { NavRail } from '../components/NavRail';

/**
 * The home — a editorial-styled command center.
 *
 * Design language (from the reference mockup):
 *   - Dark paper, not flat black: textured surfaces, layered depth.
 *   - Crimson is the only accent that moves the eye.
 *   - Serif italic greeting (Playfair Display) for the human touch.
 *   - Three tiles with their own character (red / white / yellow).
 *   - Briefing with halftone texture + quotation marks = Hermes speaks.
 *   - Upcoming with red date blocks = what's next.
 */

type HermesPresence = 'working' | 'idle' | 'paused' | 'unknown';

function useHermesPresence(): HermesPresence {
  const { user } = useAuth();
  const { connected } = useServer();
  const { data } = useQuery({
    queryKey: ['runs', 'presence'],
    queryFn: () => api.runs(5),
    enabled: connected,
    refetchInterval: 15_000,
  });
  if (user?.schedulerEnabled === false) return 'paused';
  const busy = (data?.runs ?? []).some((r) => r.status === 'dispatched' || r.status === 'running');
  return busy ? 'working' : 'idle';
}

function useLastSeen(): number {
  const [lastSeen] = React.useState<number>(() => {
    try { return Number(localStorage.getItem('hermieos_last_seen') ?? 0) || 0; } catch { return 0; }
  });
  React.useEffect(() => {
    return () => {
      try { localStorage.setItem('hermieos_last_seen', String(Date.now())); } catch { /* */ }
    };
  }, []);
  return lastSeen;
}

// ============================================================================
// Count-up hook + giant number
// ============================================================================

function useCountUp(target: number, duration = 650): number {
  const [value, setValue] = React.useState(0);
  React.useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(target * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return value;
}

function P5Number({ value, className }: { value: number; className?: string }): React.JSX.Element {
  const shown = useCountUp(value);
  return <div className={cn('p5-giant tabular-nums', className ?? 'text-p5-text')}>{shown}</div>;
}

// ============================================================================
// Briefing — the collaborator's morning report
// ============================================================================

function formatDuration(ms: number): string {
  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}H ${m}M`;
  if (m > 0) return `${m}M`;
  return `${Math.max(1, Math.round(ms / 1000))}S`;
}

function taskReason(t: { dueAt: string | null }): string {
  if (!t.dueAt) return 'YOUR TOP PRIORITY';
  const due = new Date(t.dueAt);
  const today = new Date();
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startDue = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const days = Math.round((startDue.getTime() - startToday.getTime()) / 86_400_000);
  if (days < 0) return 'IT IS OVERDUE';
  if (days === 0) return 'IT IS DUE TODAY';
  if (days === 1) return 'IT IS DUE TOMORROW';
  return `DUE ${due.toLocaleDateString(undefined, { weekday: 'long' }).toUpperCase()}`;
}

function P5Briefing({
  lastSeen,
  newSinceAway,
}: {
  lastSeen: number;
  newSinceAway: number;
}): React.JSX.Element {
  const { user } = useAuth();
  const { connected } = useServer();
  const runsQ = useQuery({
    queryKey: ['runs', 'briefing'],
    queryFn: () => api.runs(20),
    enabled: connected,
    refetchInterval: 30_000,
  });
  const tasksQ = useQuery({
    queryKey: ['tasks', 'briefing'],
    queryFn: () => api.listTasks({ limit: 50 }),
    enabled: connected,
    refetchInterval: 60_000,
  });

  const runs = runsQ.data?.runs ?? [];
  const activeRun = runs.find((r) => r.status === 'dispatched' || r.status === 'running');
  const doneRuns = runs.filter(
    (r) => (r.status === 'succeeded' || r.status === 'completed') && new Date(r.createdAt).getTime() > lastSeen,
  );
  const workedMs = doneRuns.reduce((acc, r) => {
    if (!r.startedAt || !r.finishedAt) return acc;
    return acc + Math.max(0, new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime());
  }, 0);

  const openTasks = (tasksQ.data?.tasks ?? []).filter((t) => t.status !== 'done' && t.status !== 'cancelled');
  const nextTask = [...openTasks].sort((a, b) => {
    const da = a.dueAt ? new Date(a.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
    const db = b.dueAt ? new Date(b.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
    return da !== db ? da - db : (b.priority ?? 0) - (a.priority ?? 0);
  })[0];

  // ---- briefing line ----
  let statement = '';
  if (user?.schedulerEnabled === false) {
    statement = 'HERMES IS PAUSED — YOUR SCOUTS ARE SLEEPING.';
  } else if (activeRun) {
    statement = 'HERMES IS WORKING RIGHT NOW.';
  } else if (workedMs > 0 || newSinceAway > 0) {
    statement = workedMs > 0
      ? `HERMES WORKED FOR ${formatDuration(workedMs)} — ${newSinceAway > 0 ? `${newSinceAway} THING${newSinceAway === 1 ? '' : 'S'} SINCE YOUR LAST VISIT.` : 'NOTHING CHANGED.'}`
      : `ALL CAUGHT UP — ${newSinceAway} THING${newSinceAway === 1 ? '' : 'S'} SINCE YOUR LAST VISIT.`;
  } else {
    statement = 'ALL CAUGHT UP — HERMES IS AWAKE AND WATCHING.';
  }

  return (
    <section className="relative min-h-[250px] overflow-hidden bg-p5-ink-2 p-6 md:p-7 p5-cut-panel p5-anim-slide" style={{ animationDelay: '300ms' }}>
      {/* Halftone texture — the red dot fill in the top-right corner */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(rgba(213,0,28,0.35) 1.2px, transparent 1.2px)',
          backgroundSize: '8px 8px',
          backgroundPosition: 'top right',
          maskImage: 'linear-gradient(to bottom left, black 0%, transparent 60%)',
          WebkitMaskImage: 'linear-gradient(to bottom left, black 0%, transparent 60%)',
        }}
      />
      <div className="relative">
        <div className="flex items-center justify-between">
          <div className="p5-kicker text-p5-text">HERMES BRIEFING</div>
          <Link to="/feed" aria-label="Open Hermes briefing" className="flex h-10 w-10 items-center justify-center border border-white/30 text-p5-text hover:border-accent hover:text-accent transition">
            <ArrowUpRight className="h-5 w-5" />
          </Link>
        </div>
        {/* Big quotation marks */}
        <div className="mt-3 flex items-start gap-3">
          <span className="text-white/20 text-[64px] leading-[0.65] font-serif select-none shrink-0">&ldquo;</span>
          <p className="font-p5-serif text-[clamp(20px,2.3vw,30px)] leading-[1.08] text-p5-text mt-1 max-w-[520px]">
            {statement}
          </p>
        </div>
        {/* task recommendation */}
        {nextTask ? (
            <div className="mt-5 border-l-2 border-accent pl-3 text-[12px] leading-relaxed text-p5-muted">
              <div>Today you should finish:</div>
              <div className="font-bold uppercase tracking-wide text-accent">{nextTask.title}</div>
              <div>{taskReason(nextTask)}.</div>
            </div>
        ) : null}
      </div>
    </section>
  );
}

// ============================================================================
// Latest — a terse ticker (no panel in the mockup, but kept for data richness)
// ============================================================================

// ============================================================================
// Upcoming — date blocks
// ============================================================================

function UpcomingPanel({ items }: { items: Upcoming[] }): React.JSX.Element {
  const visible = items.slice(0, 4);
  return (
    <section className="relative min-h-[250px] overflow-hidden bg-p5-ink-2 p-6 p5-cut-panel p5-anim-slide" style={{ animationDelay: '380ms' }}>
      <div className="mb-5 flex items-center justify-between">
        <div className="p5-kicker text-p5-text">UPCOMING</div>
        <Link to="/calendar" className="text-[11px] font-black tracking-[0.15em] text-accent hover:opacity-80 transition flex items-center gap-1">
          CALENDAR <ArrowRight className="w-3 h-3" />
        </Link>
      </div>
      {visible.length === 0 ? (
        <div className="text-[12px] text-p5-muted py-3">Nothing scheduled. The horizon is clear.</div>
      ) : (
        <ul className="divide-y divide-p5-line/50">
           {visible.map((u) => {
            const d = new Date(u.occursAt);
            const month = d.toLocaleString(undefined, { month: 'short' }).toUpperCase();
            const day = String(d.getDate());
            const days = Math.max(0, Math.ceil((d.getTime() - Date.now()) / 86_400_000));
            return (
              <li key={u.id} className="mb-1 flex items-center gap-3 border border-white/20 px-3 py-2.5 last:mb-0">
                <div className="flex w-12 shrink-0 flex-col items-center justify-center border-r border-white/20 pr-3">
                  <span className="text-[10px] font-mono font-bold leading-none text-accent">{month}</span>
                  <span className="mt-1 text-[22px] font-black leading-none text-p5-text">{day}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="truncate text-[13px] font-bold text-p5-text">{u.title}</div>
                  <div className="font-mono text-[10px] text-p5-muted">IN {days === 0 ? 'TODAY' : `${days} DAY${days === 1 ? '' : 'S'}`}</div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {visible.length > 0 ? (
        <Link to="/calendar" className="mt-3 text-[11px] font-black tracking-[0.15em] text-accent hover:opacity-80 transition flex items-center gap-1">
          VIEW FULL CALENDAR <ArrowRight className="w-3 h-3" />
        </Link>
      ) : null}
    </section>
  );
}

// ============================================================================
// Page
// ============================================================================

export function DashboardPage(): React.JSX.Element {
  const { user } = useAuth();
  const { url: serverUrl, connected } = useServer();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.dashboard(),
    enabled: connected,
    refetchInterval: 60_000,
  });

  const createTaskMut = useMutation({
    mutationFn: (input: { title: string; category: TaskCategory }) => api.createTask(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      void qc.invalidateQueries({ queryKey: ['tasks', 'mission'] });
    },
  });

  const presence = useHermesPresence();
  const lastSeen = useLastSeen();
  const [askText, setAskText] = React.useState('');
  const [taskText, setTaskText] = React.useState('');
  const [showTaskInput, setShowTaskInput] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const hermesInfo = useQuery({
    queryKey: ['hermes-info'],
    queryFn: () => api.hermesInfo(),
    enabled: connected,
    staleTime: 60 * 60 * 1000,
  });

  const [sending, setSending] = React.useState(false);

  async function send(): Promise<void> {
    const text = askText.trim();
    if (!text || sending) return;
    const info = hermesInfo.data;
    if (!info) { setErr('Hermes gateway not reachable.'); return; }
    setSending(true);
    setErr(null);
    try {
      const id = `web_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      await api.hermesCreateSession(info, { id, source: 'api_server' });
      await api.hermesChat(info, id, { message: text });
      navigate(`/chat/${id}`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  useSse({ onFeed: () => qc.invalidateQueries({ queryKey: ['dashboard'] }) });

  const userName = user?.displayName ?? 'there';
  void serverUrl;

  const newSinceAway = (data?.hermesFeed.events ?? []).filter(
    (e) => new Date(e.createdAt).getTime() > lastSeen,
  ).length;

  const buckets = data?.opportunities.categories ?? [];
  const totalOpps = buckets.reduce((a, b) => a + (b.total ?? 0), 0);
  const tasksToday = data?.tasks.today.length ?? 0;

  const upcoming = [
    ...(data?.upcoming.next7Days ?? []),
    ...(data?.upcoming.next30Days ?? []),
    ...(data?.upcoming.next90Days ?? []),
  ];

  const addTask = (): void => {
    const t = taskText.trim();
    if (!t) return;
    createTaskMut.mutate({ title: t, category: 'work' });
    setTaskText('');
  };

  const now = new Date();
  const hour = now.getHours();
  const greet = hour < 5 ? 'WORKING LATE' : hour < 12 ? 'GOOD MORNING' : hour < 17 ? 'GOOD AFTERNOON' : 'GOOD EVENING';
  const dateStr = now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase();

  return (
    <div className="min-h-screen flex bg-p5-cream text-p5-dark">
      <NavRail activePath="/" />

      <main className="flex-1 min-w-0 overflow-y-auto px-6 py-8 md:px-10 lg:px-10 lg:py-10">
        <div className="mx-0 max-w-[1128px]">

          {/* ─── Header: serif greeting + actions ─── */}
          <header className="relative min-h-[222px]">
            <div className="min-w-0 pt-2">
              <div className="p5-kicker text-p5-dark">{dateStr}</div>
              <h1 className="mt-5">
                <span className="block font-p5-serif text-[clamp(58px,6.2vw,94px)] leading-[0.86] text-p5-dark">
                  {greet},
                </span>
                <span className="relative mt-2 inline-block font-p5-serif text-[clamp(58px,6.2vw,94px)] leading-[0.86] text-p5-dark">
                  {userName.toUpperCase()}.
                  <span className="absolute -bottom-3 left-0 h-[7px] w-full bg-accent" />
                </span>
              </h1>
            </div>
            <div className="absolute right-0 top-0 flex items-center gap-3">
              <P5PresencePill presence={presence} />
              <Link
                to="/chat"
                className="inline-flex items-center gap-2 text-[11px] font-black tracking-[0.12em] px-4 py-2.5 bg-accent text-white hover:bg-accent-hover transition"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                CHAT WITH HERMES
              </Link>
              <button className="w-9 h-9 border border-p5-dark-line flex items-center justify-center text-p5-dark-muted hover:text-p5-dark transition" aria-label="Search">
                <Search className="w-4 h-4" />
              </button>
              <button className="w-9 h-9 border border-p5-dark-line flex items-center justify-center text-p5-dark-muted hover:text-p5-dark transition relative" aria-label="Notifications">
                <Bell className="w-4 h-4" />
                <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-accent" />
              </button>
            </div>
          </header>

          {/* ─── Ask Hermes bar ─── */}
          <section className="relative mt-5 min-h-[174px] overflow-hidden bg-p5-ink-2 p-6 md:p-7 p5-cut-panel p5-anim-slide" style={{ animationDelay: '60ms' }}>
            {/* halftone texture on the ask bar */}
            <div className="absolute inset-0 pointer-events-none opacity-30" style={{
              backgroundImage: 'radial-gradient(rgba(255,255,255,0.07) 1px, transparent 1.5px)',
              backgroundSize: '8px 8px',
            }} />
            <div className="absolute inset-y-0 left-0 w-1 bg-accent" />
            <div className="relative flex items-center gap-4">
              <div className="w-10 h-10 bg-accent text-white flex items-center justify-center shrink-0">
                <Bot className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="p5-kicker text-accent">ASK HERMES</div>
                <form className="mt-1.5 flex items-center gap-3" onSubmit={(e) => { e.preventDefault(); void send(); }}>
                  <input
                    value={askText}
                    onChange={(e) => setAskText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
                    placeholder="Research, summarize, plan, dig into a finding…"
                    className="flex-1 min-w-0 bg-transparent border-0 border-b border-p5-line focus:border-accent outline-none text-[14px] text-p5-text placeholder:text-p5-muted pb-1"
                  />
                  <button
                    type="submit"
                    disabled={!askText.trim() || sending}
                    className="inline-flex items-center gap-1.5 text-[11px] font-black tracking-[0.12em] px-4 py-2 bg-accent text-white hover:bg-accent-hover transition disabled:opacity-40 shrink-0"
                  >
                    {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                    SEND
                  </button>
                </form>
                <div className="mt-2 flex flex-wrap gap-2">
                  {['What should I focus on today?', 'Find me a research paper I would like', 'Summarize what my scouts found'].map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setAskText(s)}
                      className="border border-white/25 px-2 py-1 text-[10px] font-mono text-p5-muted hover:border-white/60 hover:text-p5-text transition"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {err ? <div className="relative mt-2 text-[12px] text-accent font-mono">{err}</div> : null}
          </section>

          {isLoading ? (
            <div className="text-center text-p5-dark-muted py-16 font-mono text-[12px]">LOADING YOUR WORKSPACE…</div>
          ) : error ? (
            <div className="text-center text-accent py-16 font-mono text-[12px]">
              FAILED TO LOAD YOUR WORKSPACE.
            </div>
          ) : data ? (
            <>
              {/* ─── Three tiles ─── */}
              <section className="mt-6">
                <div className="mb-4 p5-kicker text-p5-dark-muted">3 THINGS WAITING FOR YOU</div>
                <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
                  {/* RESEARCH — dark card, red number */}
                  <Link
                    to="/scouting/findings"
                    className="relative min-h-[208px] overflow-hidden bg-p5-ink-2 p-6 p5-cut-panel p5-hover-lift p5-anim-slide group"
                    style={{ animationDelay: '120ms' }}
                  >
                    <div className="absolute inset-y-0 left-0 w-1 bg-accent" />
                    <Search className="absolute -right-2 -bottom-2 w-24 h-24 text-p5-ink-3 opacity-60 -rotate-12 pointer-events-none" />
                    {newSinceAway > 0 ? (
                      <span className="absolute top-4 right-4 flex items-center gap-1.5">
                        <span className="w-2 h-2 bg-accent rounded-full animate-pulse" />
                        <span className="p5-kicker text-accent">NEW</span>
                      </span>
                    ) : null}
                    <div className="p5-kicker text-accent">RESEARCH</div>
                    <div className="mt-2 flex items-center gap-4">
                      <P5Number value={newSinceAway} className="text-accent" />
                      <p className="max-w-[150px] text-[12px] leading-snug text-p5-muted">
                      {newSinceAway > 0
                        ? 'New findings are ready. What the scouts brought back while you were away.'
                        : 'No new findings. The scouts are watching.'}
                      </p>
                    </div>
                    <div className="absolute bottom-4 left-6 flex items-center gap-1 text-[11px] font-black tracking-[0.12em] text-accent group-hover:opacity-80 transition">
                      OPEN THE DECK <ArrowRight className="w-3 h-3" />
                    </div>
                  </Link>

                  {/* TASKS — white card */}
                  <div
                    className="relative min-h-[208px] overflow-hidden border border-black/20 border-b-4 border-b-p5-ink bg-p5-panel p-6 p5-cut-panel p5-hover-lift p5-anim-slide group"
                    style={{ animationDelay: '180ms' }}
                  >
                    <CheckCircle2 className="absolute -right-2 -bottom-2 w-24 h-24 text-black/[0.04] pointer-events-none" />
                    <div className="flex items-center justify-between">
                      <div className="p5-kicker text-p5-ink/50">TASKS</div>
                      <button
                        type="button"
                        aria-label="Add task for today"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setShowTaskInput((current) => !current);
                        }}
                        className="relative z-10 text-[10px] font-black tracking-[0.12em] text-p5-ink/55 hover:text-accent transition"
                      >
                        + ADD TASK
                      </button>
                    </div>
                    <div className="mt-2 flex items-center gap-4">
                      <P5Number value={tasksToday} className="text-p5-ink" />
                      <p className="max-w-[150px] text-[12px] leading-snug text-p5-ink/70">
                      {tasksToday === 0
                        ? 'No tasks today. Nice. Time to build something great.'
                        : `${tasksToday} task${tasksToday === 1 ? '' : 's'} on the board.`}
                      </p>
                    </div>
                    {showTaskInput ? (
                      <form className="relative z-10 mt-2 flex items-center gap-2" onSubmit={(event) => { event.preventDefault(); addTask(); }} onClick={(event) => event.stopPropagation()}>
                        <input
                          autoFocus
                          value={taskText}
                          onChange={(event) => setTaskText(event.target.value)}
                          placeholder="Add a task for today…"
                          className="min-w-0 flex-1 border-b border-black/25 bg-transparent px-0 py-1 text-[11px] text-p5-ink outline-none placeholder:text-p5-ink/45 focus:border-accent"
                        />
                        <button type="submit" disabled={!taskText.trim() || createTaskMut.isPending} className="text-[10px] font-black tracking-[0.12em] text-accent">ADD</button>
                      </form>
                    ) : null}
                    <Link to="/mission" className="absolute bottom-4 left-6 flex items-center gap-1 text-[11px] font-black tracking-[0.12em] text-p5-ink/80 group-hover:text-p5-ink transition">
                      OPEN MISSIONS <ArrowRight className="w-3 h-3" />
                    </Link>
                  </div>

                  {/* APPROVALS — white card, yellow number */}
                  <Link
                    to="/opportunities"
                    className="relative min-h-[208px] overflow-hidden border border-black/20 border-b-4 border-b-[#e2a700] bg-p5-panel p-6 p5-cut-panel p5-hover-lift p5-anim-slide group"
                    style={{ animationDelay: '240ms' }}
                  >
                    <AlertCircle className="absolute -right-2 -bottom-2 w-24 h-24 text-black/[0.04] pointer-events-none" />
                    <div className="p5-kicker" style={{ color: '#d97706' }}>APPROVALS</div>
                    <div className="mt-2 flex items-center gap-4">
                      <P5Number value={totalOpps} className="text-[#d97706]" />
                      <p className="max-w-[150px] text-[12px] leading-snug text-p5-ink/70">
                      Waiting for your call. Opportunities need your decision.
                      </p>
                    </div>
                    <div className="absolute bottom-4 left-6 flex items-center gap-1 text-[11px] font-black tracking-[0.12em] transition" style={{ color: '#d97706' }}>
                      VIEW & TRIAGE <ArrowRight className="w-3 h-3" />
                    </div>
                  </Link>
                </div>
              </section>

              {/* ─── Briefing + Upcoming side by side ─── */}
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-5 mt-6">
                <div className="lg:col-span-3">
                  <P5Briefing lastSeen={lastSeen} newSinceAway={newSinceAway} />
                </div>
                <div className="lg:col-span-2">
                  <UpcomingPanel items={upcoming} />
                </div>
              </div>
            </>
          ) : null}

          <footer className="mt-12 text-center text-[10px] font-mono tracking-[0.25em] text-p5-dark-muted">
            HERMIEOS &middot; A PLACE TO THINK WITH HERMES
          </footer>
        </div>
      </main>
    </div>
  );
}

// ============================================================================
// Presence pill
// ============================================================================

function P5PresencePill({ presence }: { presence: HermesPresence }): React.JSX.Element {
  const meta: Record<HermesPresence, { label: string; dot: string }> = {
    working: { label: 'HERMES IS WORKING', dot: 'bg-accent animate-pulse' },
    idle: { label: 'HERMES IS ONLINE', dot: 'bg-accent' },
    paused: { label: 'HERMES IS PAUSED', dot: 'bg-amber-500' },
    unknown: { label: 'HERMES STATUS UNKNOWN', dot: 'bg-p5-muted' },
  };
  const m = meta[presence];
  return (
    <div className="inline-flex items-center gap-2 border border-p5-dark-line px-3 py-2 text-[11px] font-black tracking-[0.12em] text-p5-dark">
      <span className={cn('w-2 h-2 rounded-full', m.dot)} />
      {m.label}
    </div>
  );
}
