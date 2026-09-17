import * as React from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Search,
  Bell,
  MessageSquare,
  Send,
  ArrowRight,
  ArrowUpRight,
  Plus,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { api } from '../api';
import type {
  Upcoming,
} from '../api';
import { useAuth } from '../auth';
import { useServer } from '../server';
import { useSse } from '../sse';
import { cn } from '../lib/utils';

/**
 * The home — a command center.
 *
 * Design language (from the design reference):
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
    refetchInterval: 60_000,
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

function CountNumber({ value, className }: { value: number; className?: string }): React.JSX.Element {
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

function HermesBriefing({
  lastSeen,
  newSinceAway,
  totalOpps,
}: {
  lastSeen: number;
  newSinceAway: number;
  totalOpps: number;
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
  let detail = '';
  if (user?.schedulerEnabled === false) {
    statement = 'HERMES IS PAUSED — YOUR SCOUTS ARE SLEEPING.';
    detail = 'WAKE THEM IN SETTINGS WHEN YOU ARE READY.';
  } else if (activeRun) {
    statement = 'HERMES IS ON THE JOB.';
    detail = 'WORKING RIGHT NOW — WILL REPORT BACK WHEN DONE.';
  } else if (workedMs > 0) {
    statement = `HERMES WORKED FOR ${formatDuration(workedMs)}.`;
    detail = newSinceAway > 0
      ? `${newSinceAway} THING${newSinceAway === 1 ? '' : 'S'} SINCE YOUR LAST VISIT.`
      : 'NOTHING CHANGED SINCE YOUR LAST VISIT.';
  } else if (newSinceAway > 0) {
    statement = 'THE SCOUTS RETURNED.';
    detail = `${newSinceAway} THING${newSinceAway === 1 ? '' : 'S'} SINCE YOUR LAST VISIT${totalOpps > 0 ? ` — ${totalOpps} DECISION${totalOpps === 1 ? '' : 'S'} WAITING FOR YOUR CALL.` : '.'}`;
  } else {
    statement = 'ALL CAUGHT UP — HERMES IS AWAKE AND WATCHING.';
    detail = 'EVERYTHING IS IN ORDER. NOTHING NEEDS YOU THIS MINUTE.';
  }

  return (
    <section className="relative mt-5 min-h-[250px] overflow-hidden bg-p5-ink-2 p-4 sm:p-6 md:p-7 p5-cut-panel p5-anim-slide" style={{ animationDelay: '60ms' }}>
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
          <Link to="/feed" aria-label="Open Hermes briefing" className="flex h-11 w-11 items-center justify-center border border-white/30 text-p5-text hover:border-accent hover:text-accent transition">
            <ArrowUpRight className="h-5 w-5" />
          </Link>
        </div>
        {/* Big quotation marks */}
        <div className="mt-3 flex items-start gap-3">
          <span className="text-white/20 text-[48px] sm:text-[64px] leading-[0.65] font-serif select-none shrink-0">“</span>
          <p className="font-p5-serif text-[clamp(20px,2.3vw,30px)] leading-[1.08] text-p5-text mt-1 max-w-[520px]">
            {statement}
          </p>
        </div>
        {detail ? (
          <p className="mt-2 pl-0 sm:pl-[76px] text-[11px] font-mono tracking-[0.14em] text-p5-muted">{detail}</p>
        ) : null}
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
        <Link to="/calendar" className="text-[11px] font-black tracking-[0.15em] text-accent hover:opacity-80 transition flex items-center gap-1 min-h-[44px]">
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
        <Link to="/calendar" className="mt-3 min-h-[44px] text-[11px] font-black tracking-[0.15em] text-accent hover:opacity-80 transition flex items-center gap-1">
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

  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.dashboard(),
    enabled: connected,
    refetchInterval: 60_000,
  });

  const captureTaskMut = useMutation({
    mutationFn: async ({ title, delegate }: { title: string; delegate: boolean }) => {
      const created = await api.createTask({ title, category: 'work' });
      if (delegate) {
        await api.delegateTask(created.task.id, { context: title });
      }
      return created;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      void qc.invalidateQueries({ queryKey: ['tasks', 'mission'] });
    },
  });

  const presence = useHermesPresence();
  const lastSeen = useLastSeen();
  const [taskText, setTaskText] = React.useState('');
  const [delegateToHermes, setDelegateToHermes] = React.useState(false);

  useSse({ onFeed: () => qc.invalidateQueries({ queryKey: ['dashboard'] }) });

  const userName = user?.displayName ?? 'there';
  void serverUrl;

  const newSinceAway = (data?.hermesFeed.events ?? []).filter(
    (e) => new Date(e.createdAt).getTime() > lastSeen,
  ).length;

  const buckets = data?.opportunities.categories ?? [];
  const totalOpps = buckets.reduce((a, b) => a + (b.unread ?? 0), 0);
  const decisionOpps = (data?.opportunities.recent ?? []).filter((o) => o.status === 'open');
  const tasksToday = data?.tasks.today.length ?? 0;

  const upcoming = [
    ...(data?.upcoming.next7Days ?? []),
    ...(data?.upcoming.next30Days ?? []),
    ...(data?.upcoming.next90Days ?? []),
  ];

  const addTask = (): void => {
    const t = taskText.trim();
    if (!t || captureTaskMut.isPending) return;
    captureTaskMut.mutate({ title: t, delegate: delegateToHermes });
    setTaskText('');
    setDelegateToHermes(false);
  };

  const now = new Date();
  const hour = now.getHours();
  const greet = hour < 5 ? 'WORKING LATE' : hour < 12 ? 'GOOD MORNING' : hour < 17 ? 'GOOD AFTERNOON' : 'GOOD EVENING';
  const dateStr = now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase();

  return (
    <div className="flex bg-p5-cream text-p5-dark flex-1 min-w-0 min-h-0">

      <main className="flex-1 min-w-0 min-h-0 overflow-y-auto px-4 py-6 sm:px-6 sm:py-8 md:px-10 lg:py-10">
        <div className="mx-0 max-w-[1128px]">

          {/* ─── Header: serif greeting + actions ─── */}
          <header className="relative min-h-[172px]">
            <div className="min-w-0 pt-1">
              <div className="p5-kicker text-p5-dark">{dateStr}</div>
              <h1 className="mt-3">
                <span className="block font-p5-serif text-[clamp(40px,11vw,86px)] leading-[0.88] text-p5-dark">
                  {greet},
                </span>
                <span className="relative mt-2 inline-block max-w-full break-words font-p5-serif text-[clamp(40px,11vw,86px)] leading-[0.88] text-p5-dark">
                  {userName.toUpperCase()}.
                  <span className="absolute -bottom-2.5 left-0 h-[6px] w-full bg-accent" />
                </span>
              </h1>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2 sm:absolute sm:right-0 sm:top-0 sm:mt-0 sm:gap-3">
              <PresencePill presence={presence} />
              <Link
                to="/chat"
                className="inline-flex min-h-[44px] items-center gap-2 text-[11px] font-black tracking-[0.12em] px-4 py-2.5 bg-accent text-white hover:bg-accent-hover transition"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                CHAT WITH HERMES
              </Link>
              <button className="h-11 w-11 sm:h-9 sm:w-9 border border-p5-dark-line flex items-center justify-center text-p5-dark-muted hover:text-p5-dark transition" aria-label="Search">
                <Search className="w-4 h-4" />
              </button>
              <button className="h-11 w-11 sm:h-9 sm:w-9 border border-p5-dark-line flex items-center justify-center text-p5-dark-muted hover:text-p5-dark transition relative" aria-label="Notifications">
                <Bell className="w-4 h-4" />
                <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-accent" />
              </button>
            </div>
          </header>

          {/* ─── Briefing — the morning report, right under the greeting ─── */}
          <HermesBriefing lastSeen={lastSeen} newSinceAway={newSinceAway} totalOpps={totalOpps} />

          {isLoading ? (
            <div className="text-center text-p5-dark-muted py-16 font-mono text-[12px]">LOADING YOUR WORKSPACE…</div>
          ) : error ? (
            <div className="text-center text-accent py-16 font-mono text-[12px]">
              FAILED TO LOAD YOUR WORKSPACE.
            </div>
          ) : data ? (
            <>
              {/* ─── Things waiting for you — three distinct editorial posters ─── */}
              <section className="mt-6">
                <div className="mb-4 p5-kicker text-p5-dark-muted">THINGS WAITING FOR YOU</div>
                <div className="grid grid-cols-1 gap-5 md:grid-cols-12">
                  {/* RESEARCH — the dark one: red rail, red number with rule, halftone corner */}
                  <Link
                    to="/scouting/findings"
                    className="relative min-h-[236px] overflow-hidden bg-p5-ink-2 p-6 p5-cut-panel p5-hover-lift p5-anim-slide group md:col-span-5"
                    style={{ animationDelay: '120ms' }}
                  >
                    <div className="absolute inset-y-0 left-0 w-1.5 bg-accent" />
                    <div className="pointer-events-none absolute right-0 top-0 h-28 w-28 opacity-40 p5-halftone-red" style={{ clipPath: 'polygon(38% 0, 100% 0, 100% 100%)' }} />
                    <Search className="absolute -right-2 -bottom-2 w-28 h-28 text-p5-ink-3 opacity-60 -rotate-12 pointer-events-none" />
                    {newSinceAway > 0 ? (
                      <span className="absolute top-4 right-4 flex items-center gap-1.5">
                        <span className="w-2 h-2 bg-accent rounded-full animate-pulse" />
                        <span className="p5-kicker text-accent">NEW</span>
                      </span>
                    ) : null}
                    <div className="p5-kicker text-accent">NEW FINDINGS</div>
                    <div className="relative mt-1 inline-block">
                      <CountNumber value={newSinceAway} className="text-accent" />
                      <span className="absolute -bottom-1 left-0 h-[5px] w-full bg-accent" />
                    </div>
                    <p className="mt-2 max-w-[240px] text-[12px] leading-snug text-p5-muted">
                      {newSinceAway > 0
                        ? 'The scouts brought these back while you were away.'
                        : 'The scouts are still watching.'}
                    </p>
                    <div className="absolute bottom-5 left-6 flex items-center gap-1 min-h-[44px] text-[11px] font-black tracking-[0.12em] text-accent group-hover:opacity-80 transition">
                      OPEN THE DECK <ArrowRight className="w-3 h-3" />
                    </div>
                  </Link>

                  {/* TASKS — the white one: black chip kicker, notched corner, heavy bottom rule */}
                  <Link
                    to="/mission"
                    className="relative min-h-[236px] overflow-hidden border border-black/20 border-b-4 border-b-p5-ink bg-p5-panel p-6 p5-panel p5-hover-lift p5-anim-slide group md:col-span-4 md:mt-1.5"
                    style={{ animationDelay: '180ms' }}
                  >
                    <CheckCircle2 className="absolute -right-2 -bottom-2 w-24 h-24 text-black/[0.04] pointer-events-none" />
                    <span className="inline-block bg-p5-ink px-2.5 py-1 font-mono text-[9px] font-bold tracking-[0.2em] text-white">TODAY'S MISSION</span>
                    <CountNumber value={tasksToday} className="text-p5-ink mt-2" />
                    <p className="mt-1 max-w-[200px] text-[12px] leading-snug text-p5-ink/70">
                      {tasksToday === 0
                        ? "You're clear. Build something."
                        : `${tasksToday} task${tasksToday === 1 ? '' : 's'} waiting on you.`}
                    </p>
                    <div className="absolute bottom-5 left-6 flex items-center gap-1 min-h-[44px] text-[11px] font-black tracking-[0.12em] text-p5-ink/80 group-hover:text-p5-ink transition">
                      OPEN MISSIONS <ArrowRight className="w-3 h-3" />
                    </div>
                  </Link>

                  {/* APPROVALS — the stamp: yellow chip kicker, misregistered ring around the number,
                      and the actual pending decisions listed below instead of a dead count */}
                  <div
                    className="relative min-h-[340px] overflow-hidden border border-black/20 border-b-4 border-b-[#e2a700] bg-p5-panel p-6 p5-cut-panel p5-anim-slide md:col-span-3 md:mt-3"
                    style={{ animationDelay: '240ms' }}
                  >
                    <AlertCircle className="absolute -right-2 -bottom-2 w-24 h-24 text-black/[0.04] pointer-events-none" />
                    <span className="inline-block bg-[#e2a700] px-2.5 py-1 font-mono text-[9px] font-bold tracking-[0.2em] text-[#1c1a17]">APPROVALS</span>
                    <div className="mt-3 flex items-center gap-2">
                      <div className="relative inline-block">
                        <span className="pointer-events-none absolute -inset-3 rounded-full border-2 border-[#e2a700]/45 rotate-6" />
                        <span className="pointer-events-none absolute -inset-3 rounded-full border-2 border-[#e2a700]/75 -rotate-6" />
                        <CountNumber value={totalOpps} className="text-[#d97706]" />
                      </div>
                      <span className="text-[10px] font-mono font-bold tracking-[0.12em] uppercase text-p5-ink/60">
                        {totalOpps === 0 ? 'ALL CLEAR' : 'WAITING FOR YOUR CALL'}
                      </span>
                    </div>
                    {totalOpps > 0 ? (
                      <ul className="mt-3">
                        {decisionOpps.slice(0, 4).map((opp) => (
                          <li key={opp.id}>
                            <Link
                              to={`/objects/${opp.id}`}
                              className="group flex items-center gap-2 border-t border-black/10 py-2 first:border-t-0"
                            >
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[12px] font-bold leading-tight text-p5-ink transition group-hover:text-[#d97706]">
                                  {opp.title}
                                </span>
                                <span className="mt-0.5 flex items-center gap-2">
                                  <span className="border border-black/15 bg-black/[0.03] px-1 py-px font-mono text-[8px] font-bold uppercase tracking-[0.14em] text-p5-ink/60">
                                    {opp.kind.replace(/_/g, ' ') || 'finding'}
                                  </span>
                                  <span className="font-mono text-[8px] font-bold tracking-[0.14em] text-p5-ink/40">
                                    P{opp.priority}
                                  </span>
                                </span>
                              </span>
                              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-black/25 transition group-hover:translate-x-0.5 group-hover:text-[#d97706]" />
                            </Link>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 text-[12px] leading-snug text-p5-ink/70">The inbox is quiet.</p>
                    )}
                    <div className="absolute bottom-4 left-6 flex items-center gap-1 min-h-[44px] text-[11px] font-black tracking-[0.12em] transition" style={{ color: '#d97706' }}>
                      VIEW ALL IN FINDINGS <ArrowRight className="w-3 h-3" />
                    </div>
                  </div>
                </div>
              </section>

              {/* ─── Quick Add Task — capture work, not a chat ─── */}
              <section className="relative mt-6 overflow-hidden bg-p5-ink-2 p-6 md:p-7 p5-cut-panel p5-anim-slide" style={{ animationDelay: '300ms' }}>
                <div className="absolute inset-y-0 left-0 w-1 bg-accent" />
                <div className="relative">
                  <div className="p5-kicker text-accent">QUICK ADD TASK</div>
                  <form className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4" onSubmit={(e) => { e.preventDefault(); addTask(); }}>
                    <Plus className="hidden w-5 h-5 text-accent shrink-0 sm:block" />
                    <input
                      value={taskText}
                      onChange={(e) => setTaskText(e.target.value)}
                      placeholder="What needs to get done?"
                      enterKeyHint="done"
                      className="w-full sm:w-auto sm:flex-1 min-w-0 bg-transparent border-0 border-b border-p5-line focus:border-accent outline-none text-[16px] sm:text-[15px] text-p5-text placeholder:text-p5-muted pb-1 h-12 sm:h-auto"
                    />
                    <button
                      type="submit"
                      disabled={!taskText.trim() || captureTaskMut.isPending}
                      className="inline-flex items-center justify-center gap-1.5 text-[11px] font-black tracking-[0.12em] px-4 py-2 min-h-[48px] w-full sm:w-auto bg-accent text-white hover:bg-accent-hover transition disabled:opacity-40 shrink-0"
                    >
                      {captureTaskMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowRight className="w-3.5 h-3.5" />}
                      CAPTURE
                    </button>
                  </form>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={delegateToHermes}
                    onClick={() => setDelegateToHermes((v) => !v)}
                    className={cn(
                      'mt-4 flex w-full items-center justify-between gap-4 border px-4 py-3 text-left transition',
                      delegateToHermes ? 'border-accent bg-accent/10' : 'border-white/25 hover:border-white/50',
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center border transition', delegateToHermes ? 'border-accent bg-accent text-white' : 'border-white/40 text-p5-muted')}>
                        <Send className="h-4 w-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[12px] font-bold tracking-[0.12em] text-p5-text">DELEGATE TO HERMES</span>
                        <span className="mt-0.5 block text-[11px] leading-snug text-p5-muted">Hermes takes the assignment — research, monitor progress, report back.</span>
                      </span>
                    </span>
                    <span className={cn('relative h-5 w-10 shrink-0 border transition-colors', delegateToHermes ? 'border-accent bg-accent' : 'border-white/40 bg-transparent')}>
                      <span className={cn('absolute top-1/2 h-3 w-3 -translate-y-1/2 transition-all', delegateToHermes ? 'left-[20px] bg-white' : 'left-1 bg-white/40')} />
                    </span>
                  </button>
                </div>
              </section>

              {/* ─── Upcoming — everything else below the fold ─── */}
              <div className="mt-6">
                <UpcomingPanel items={upcoming} />
              </div>
            </>
          ) : null}

          <footer className="mt-12 text-center text-[10px] font-mono tracking-[0.25em] text-p5-dark-muted">
            HERMIEOS · A PLACE TO THINK WITH HERMES
          </footer>
        </div>
      </main>
    </div>
  );
}

// ============================================================================
// Presence pill
// ============================================================================

function PresencePill({ presence }: { presence: HermesPresence }): React.JSX.Element {
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
