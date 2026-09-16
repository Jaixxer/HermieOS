import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Send,
  Loader2,
  Trash2,
  ExternalLink,
  ArrowRight,
  AlertCircle,
} from 'lucide-react';
import { api, type Task, type TaskCategory, type TaskStatus, type TaskAnalytics } from '../api';
import { useServer } from '../server';
import { Sheet } from '../components/ui/sheet';
import { cn } from '../lib/utils';
import { gsap } from 'gsap';

/**
 * Today's Mission — the dark board.
 *
 * Every other screen is cream paper; this one is the night-ops room.
 * Entering it drops the view into hyperspace (a canvas starfield that
 * warps into streaks, then settles into a slow drift) and the briefing
 * heading floats. Same palette, inverted composition.
 */

// ============================================================================
// Hyperspace field — canvas starfield with a warp-in on mount
// ============================================================================

interface WarpStar {
  x: number;
  y: number;
  z: number;
  hue: 'cream' | 'red';
  size: number;
}

function HyperspaceField({ warp, active }: { warp: React.RefObject<{ v: number }>; active: boolean }): React.JSX.Element {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const activeRef = React.useRef(active);
  activeRef.current = active;

  React.useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const ctx = el.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let width = 0;
    let height = 0;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);

    const stars: Array<{ x: number; y: number; z: number; hue: 'cream' | 'red'; size: number }> = Array.from({ length: 220 }, () => ({
      x: (Math.random() - 0.5) * 2,
      y: (Math.random() - 0.5) * 2,
      z: Math.random() * 0.9 + 0.1,
      hue: Math.random() < 0.08 ? 'red' : 'cream',
      size: Math.random() * 1.6 + 0.4,
    }));

    const resize = (): void => {
      width = window.innerWidth;
      height = window.innerHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      el.width = width * dpr;
      el.height = height * dpr;
      el.style.width = `${width}px`;
      el.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const FOCAL = 420;
    let last = performance.now();

    // Frozen end-state: stars as faint static points.
    const drawStatic = (): void => {
      ctx.clearRect(0, 0, width, height);
      const cx = width / 2;
      const cy = height / 2 - 40;
      for (const st of stars) {
        if (st.z <= 0.02 || st.z >= 1) continue;
        const sx = cx + (st.x * FOCAL) / st.z;
        const sy = cy + (st.y * FOCAL) / st.z;
        const rgb = st.hue === 'red' ? '213,0,28' : '242,239,231';
        ctx.fillStyle = `rgba(${rgb},0.5)`;
        ctx.beginPath();
        ctx.arc(sx, sy, st.size * 0.7, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const frame = (now: number): void => {
      if (!activeRef.current) {
        drawStatic();
        cancelAnimationFrame(raf);
        return;
      }
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      ctx.clearRect(0, 0, width, height);

      const cx = width / 2;
      const cy = height / 2 - 40;
      const v = warp.current?.v ?? 0;
      const speed = 0.3 + v * 4.6;

      for (const st of stars) {
        const prevZ = st.z;
        st.z -= speed * dt;
        if (st.z <= 0.02) {
          st.x = (Math.random() - 0.5) * 2;
          st.y = (Math.random() - 0.5) * 2;
          st.z = 1;
          continue;
        }
        const sx = cx + (st.x * FOCAL) / st.z;
        const sy = cy + (st.y * FOCAL) / st.z;
        const px = cx + (st.x * FOCAL) / prevZ;
        const py = cy + (st.y * FOCAL) / prevZ;

        const alpha = 0.25 + v * 0.55 + (1 - st.z) * 0.2;
        const rgb = st.hue === 'red' ? '213,0,28' : '242,239,231';

        ctx.strokeStyle = `rgba(${rgb},${Math.min(1, alpha)})`;
        ctx.lineWidth = st.size * (0.6 + v);
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(sx, sy);
        ctx.stroke();

        if (v < 0.2) {
          ctx.fillStyle = `rgba(${rgb},${0.5 + alpha * 0.4})`;
          ctx.beginPath();
          ctx.arc(sx, sy, st.size * 0.7, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [warp]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0"
      style={{ background: 'transparent' }}
    />
  );
}

const CATEGORY_LABEL: Record<TaskCategory, string> = {
  work: 'Work',
  learning: 'Learning',
  research: 'Research',
  health: 'Health',
  admin: 'Admin',
  personal: 'Personal',
  other: 'Other',
};

const CATEGORY_TONE: Record<TaskCategory, string> = {
  work: 'text-sky-600 border-sky-600/50',
  learning: 'text-emerald-600 border-emerald-600/50',
  research: 'text-purple-600 border-purple-600/50',
  health: 'text-rose-600 border-rose-600/50',
  admin: 'text-amber-600 border-amber-500/60',
  personal: 'text-pink-600 border-pink-600/50',
  other: 'text-p5-dark-muted border-black/25',
};

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function isToday(iso: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  return startOfDay(d).getTime() === startOfDay(new Date()).getTime();
}

function categoryTone(cat: TaskCategory): string {
  return CATEGORY_TONE[cat] ?? CATEGORY_TONE['other']!;
}

/** Deadline as a short label + urgency tone, evaluated against local today. */
function deadlineLabel(iso: string): { text: string; tone: string } {
  const d = new Date(iso);
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const diffDays = Math.round((startOfDay(d).getTime() - startOfDay(new Date()).getTime()) / 86_400_000);
  if (diffDays < 0) {
    return {
      text: `DEADLINE MISSED · ${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase()} ${time}`,
      tone: 'text-status-failed font-black',
    };
  }
  if (diffDays === 0) return { text: `DEADLINE TODAY ${time}`, tone: 'text-accent font-black' };
  if (diffDays === 1) return { text: `DEADLINE TOMORROW ${time}`, tone: 'text-amber-400' };
  return {
    text: `DEADLINE ${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase()} ${time}`,
    tone: '',
  };
}

// ============================================================================
// Radial mission dial — 270° arc gauge with tick marks
// ============================================================================

function MissionDial({ rate, completed, total, overdue }: { rate: number; completed: number; total: number; overdue: number }): React.JSX.Element {
  const R = 84;
  const C = 2 * Math.PI * R;
  const ARC = 0.75; // 270°
  const sweep = Math.max(0, Math.min(1, rate));
  const ticks = Array.from({ length: 25 });
  const pct = Math.round(rate * 100);

  return (
    <div className="relative flex flex-col items-center">
      <div className="relative">
        <svg viewBox="0 0 200 200" className="h-52 w-52">
          <g>
            {ticks.map((_, i) => {
              const angle = (i / (ticks.length - 1)) * 270 - 225;
              const rad = (angle * Math.PI) / 180;
              const inner = R + 22;
              const outer = i === 0 || i === ticks.length - 1 ? R + 30 : R + 24;
              const x1 = 100 + inner * Math.cos(rad);
              const y1 = 100 + inner * Math.sin(rad);
              const x2 = 100 + outer * Math.cos(rad);
              const y2 = 100 + outer * Math.sin(rad);
              return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(242,239,231,0.18)" strokeWidth={i === 0 || i === ticks.length - 1 ? 2.5 : 1.5} />;
            })}
          </g>
          <circle
            cx="100" cy="100" r={R} fill="none" stroke="rgba(242,239,231,0.10)" strokeWidth="14"
            strokeDasharray={`${C * ARC} ${C}`} strokeLinecap="butt"
            transform="rotate(135 100 100)"
          />
          <circle
            cx="100" cy="100" r={R} fill="none" stroke="#D5001C" strokeWidth="14"
            strokeDasharray={`${C * ARC * sweep} ${C}`} strokeLinecap="butt"
            transform="rotate(135 100 100)"
            style={{ transition: 'stroke-dasharray 0.6s cubic-bezier(0.2,0.8,0.2,1)' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-p5-serif text-[52px] leading-none text-p5-text tabular-nums">{pct}%</span>
          <span className="mt-1 font-mono text-[9px] tracking-[0.2em] text-p5-muted">MISSION CLEARED</span>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 font-mono text-[10px] tracking-[0.14em] text-p5-muted">
        <span><span className="font-black text-p5-text">{completed}</span> / {total} OBJECTIVES</span>
        {overdue > 0 ? (
          <span className="flex items-center gap-1 text-status-failed">
            <AlertCircle className="h-3 w-3" /> {overdue} OVERDUE
          </span>
        ) : (
          <span>ON SCHEDULE</span>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Objective ticket — cream strip pinned on the dark board
// ============================================================================

function ObjectiveTicket({
  task,
  index,
  onToggle,
  onDefer,
  onArchive,
  onDelegate,
  busy,
}: {
  task: Task;
  index: number;
  onToggle: (t: Task) => void;
  onDefer: (t: Task) => void;
  onArchive: (t: Task) => void;
  onDelegate: (t: Task) => void;
  busy: boolean;
}): React.JSX.Element {
  const done = task.status === 'done';
  const overdue = !done && !!task.dueAt && !isToday(task.dueAt) && startOfDay(new Date(task.dueAt)).getTime() < startOfDay(new Date()).getTime();
  const num = String(index + 1).padStart(2, '0');

  return (
    <li
      className={cn(
        'group relative flex flex-wrap items-center gap-x-3 gap-y-3 sm:gap-4 border-2 bg-p5-panel px-4 py-4 sm:px-5 transition',
        done ? 'border-white/10 opacity-55' : 'border-white/25 hover:border-white/70',
        overdue && 'border-l-4 border-l-accent',
      )}
    >
      {/* red notch when overdue */}
      {overdue ? <span className="absolute right-0 top-0 h-5 w-5 bg-accent" style={{ clipPath: 'polygon(0 0, 100% 0, 100% 100%)' }} /> : null}

      <span className={cn('w-8 shrink-0 font-mono text-[13px] font-bold tabular-nums', done ? 'text-p5-dark-muted/40' : 'text-p5-dark-muted')}>
        {num}
      </span>

      {/* Status glyph */}
      <button
        type="button"
        onClick={() => onToggle(task)}
        disabled={busy}
        aria-label={done ? 'Mark as not done' : 'Mark as done'}
        className={cn(
          'flex h-11 w-11 sm:h-6 sm:w-6 shrink-0 items-center justify-center border-2 transition',
          done ? 'border-accent bg-accent' : 'border-black/30 hover:border-accent',
        )}
      >
        {done ? <span className="text-[13px] font-black leading-none text-white">✓</span> : null}
      </button>

      <div className="min-w-0 flex-1">
        <div className={cn('font-p5-serif text-[19px] leading-tight text-p5-dark', done && 'text-p5-dark-muted/40 line-through')}>
          {task.title}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[10px] tracking-[0.08em] text-p5-dark-muted">
          {task.dueAt && !done ? (
            <span className={deadlineLabel(task.dueAt).tone}>{deadlineLabel(task.dueAt).text}</span>
          ) : null}
          {task.status === 'in_progress' ? <span className="text-accent">IN PROGRESS</span> : null}
          {task.sentToHermesAt ? <span className="text-accent">Delegated to Hermes</span> : null}
        </div>

        {/* Progress — written by the user and by Hermes in the same log. */}
        {task.progressPercent > 0 ? (
          <div className="mt-2 flex items-center gap-2">
            <div className="h-1 w-full max-w-[180px] bg-black/10">
              <div className="h-full bg-accent transition-[width] duration-300" style={{ width: `${task.progressPercent}%` }} />
            </div>
            <span className="font-mono text-[9px] tabular-nums text-p5-dark-muted">{task.progressPercent}%</span>
          </div>
        ) : null}
        {task.latestUpdate ? (
          <div className="mt-1 truncate font-mono text-[10px] text-p5-dark-muted">
            <span className={task.latestUpdate.actor === 'hermes' ? 'text-accent' : ''}>
              {task.latestUpdate.actor === 'hermes' ? 'HERMES' : 'YOU'}
            </span>
            : {task.latestUpdate.body}
          </div>
        ) : null}
      </div>

      <span className={cn('shrink-0 border px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.14em]', categoryTone(task.category))}>
        {CATEGORY_LABEL[task.category]}
      </span>

      {/* Status stamp — always visible */}
      {(() => {
        const stamp = done
          ? { label: 'CLEARED', cls: 'border-black/40 text-p5-dark-muted' }
          : task.status === 'in_progress'
            ? { label: 'ACTIVE', cls: 'border-accent text-accent' }
            : overdue
              ? { label: 'OVERDUE', cls: 'border-status-failed text-status-failed' }
              : task.sentToHermesAt
                ? { label: 'DELEGATED', cls: 'border-accent/60 text-accent' }
                : { label: 'PENDING', cls: 'border-black/25 text-p5-dark-muted' };
        return (
          <span
            className={cn('shrink-0 border px-2 py-1 font-mono text-[9px] font-black tracking-[0.14em]', stamp.cls)}
            style={{ transform: 'rotate(-2deg)' }}
          >
            {stamp.label}
          </span>
        );
      })()}

      <div className="flex shrink-0 items-center gap-1.5 sm:gap-1 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100">
        {task.sentToHermesAt ? (
          <a
            href={`/chat/task-${task.id}`}
            title="Open the conversation with Hermes"
            aria-label="Open Hermes conversation"
            className="flex h-11 w-11 sm:h-7 sm:w-7 items-center justify-center border border-accent/60 text-accent transition hover:bg-accent hover:text-white"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : !done ? (
          <>
            <button
              type="button"
              title="Delegate to Hermes"
              aria-label="Delegate to Hermes"
              disabled={busy}
              onClick={() => onDelegate(task)}
              className="flex h-11 w-11 sm:h-7 sm:w-7 items-center justify-center border border-black/20 text-p5-dark-muted transition hover:border-accent hover:bg-accent hover:text-white disabled:opacity-40"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              title="Defer to tomorrow"
              aria-label="Defer to tomorrow"
              disabled={busy}
              onClick={() => onDefer(task)}
              className="flex h-11 w-11 sm:h-7 sm:w-7 items-center justify-center border border-black/20 text-p5-dark-muted transition hover:border-p5-dark hover:bg-p5-dark hover:text-white disabled:opacity-40"
            >
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </>
        ) : null}
        <button
          type="button"
          title="Archive"
          aria-label="Archive task"
          disabled={busy}
          onClick={() => onArchive(task)}
          className="flex h-11 w-11 sm:h-7 sm:w-7 items-center justify-center border border-black/20 text-p5-dark-muted transition hover:border-status-failed hover:text-status-failed disabled:opacity-40"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </li>
  );
}

// ============================================================================
// Page
// ============================================================================

export function MissionPage(): React.JSX.Element {
  const { connected } = useServer();
  const qc = useQueryClient();
  const [draft, setDraft] = React.useState('');
  const [category, setCategory] = React.useState<TaskCategory>('work');
  const [showOverdue, setShowOverdue] = React.useState(false);

  const invalidate = (): void => {
    void qc.invalidateQueries({ queryKey: ['tasks'] });
    void qc.invalidateQueries({ queryKey: ['mission-analytics'] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const tasksQ = useQuery({
    queryKey: ['tasks', 'mission'],
    // The backend defines "today" as in-progress + created today/overdue
    // (dashboard.ts: createdAt-bucketed). Reuse that bucket so the mission
    // board matches what the dashboard reports instead of a local dueAt filter.
    queryFn: () => api.dashboard(),
    enabled: connected,
    refetchInterval: 60_000,
  });

  const analyticsQ = useQuery({
    queryKey: ['mission-analytics'],
    queryFn: () => api.taskAnalytics(7),
    enabled: connected,
    refetchInterval: 60_000,
  });

  const createMut = useMutation({
    mutationFn: (input: { title: string; category: TaskCategory }) => api.createTask(input),
    onSuccess: invalidate,
  });
  const updateMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: TaskStatus }) => api.updateTask(id, { status }),
    onSuccess: invalidate,
  });
  const deferMut = useMutation({
    mutationFn: (id: string) => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(23, 59, 59, 999);
      return api.updateTask(id, { dueAt: tomorrow.toISOString() });
    },
    onSuccess: invalidate,
  });
  const archiveMut = useMutation({
    mutationFn: (id: string) => api.archiveTask(id),
    onSuccess: invalidate,
  });
  const delegateMut = useMutation({
    mutationFn: ({ id, context }: { id: string; context?: string }) => api.delegateTask(id, { context }),
    onSuccess: invalidate,
  });

  // Delegate dialog — the task stays on your mission; Hermes gets the
  // brief (with optional context) and reports back in its own thread.
  const [delegating, setDelegating] = React.useState<Task | null>(null);
  const [delegateContext, setDelegateContext] = React.useState('');

  const openDelegate = (task: Task): void => {
    setDelegateContext('');
    setDelegating(task);
  };
  const confirmDelegate = (): void => {
    if (!delegating) return;
    delegateMut.mutate(
      { id: delegating.id, context: delegateContext.trim() || undefined },
      { onSuccess: () => setDelegating(null) },
    );
  };

  const dash = tasksQ.data;
  const todayFromDash = dash?.tasks.today ?? [];
  const overdueFromDash = dash?.tasks.overdue ?? [];
  // Merge today + overdue from the backend dashboard, dedupe by id,
  // keep a stable order (already sorted by priority/dueAt server-side).
  const all = [...todayFromDash, ...overdueFromDash].filter(
    (t, i, arr) => arr.findIndex((x) => x.id === t.id) === i,
  );
  const listed = showOverdue ? all : todayFromDash;
  const overdueTasks = overdueFromDash;

  const analytics: TaskAnalytics | undefined = analyticsQ.data;
  const completedCount = analytics?.today.completed ?? 0;
  const totalCount = analytics?.today.total ?? 0;
  const completionRate = totalCount > 0 ? completedCount / totalCount : 0;

  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    const title = draft.trim();
    if (!title) return;
    createMut.mutate({ title, category });
    setDraft('');
  };

  const today = new Date();
  const dayStamp = today.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase();

  // Page entry: content reveal + hyperspace warp run as ONE timeline,
  // then the starfield freezes (static frame, loop stopped).
  const contentRef = React.useRef<HTMLDivElement>(null);
  const warpRef = React.useRef<{ v: number }>({ v: 0 });
  const [starFieldActive, setStarFieldActive] = React.useState(true);
  const titleRef = React.useRef<HTMLSpanElement>(null);

  React.useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const tl = gsap.timeline({
      onComplete: () => setStarFieldActive(false),
    });
    gsap.set(content, { y: 24 });
    // Warp hits max IMMEDIATELY (streaks are the first thing you see);
    // the page reveals through the streaks, then the field settles and freezes.
    tl.to(warpRef.current, { v: 1, duration: 0.9, ease: 'power2.out' }, 0)
      .to(content, { opacity: 1, y: 0, duration: 0.9, ease: 'power2.out' }, 0.35)
      .to(warpRef.current, { v: 0.1, duration: 1.3, ease: 'power2.out' }, '+=0.2')
      .to(warpRef.current, { v: 0, duration: 0.8, ease: 'power2.inOut' }, '+=0.2');
    return () => { tl.kill(); };
  }, []);

  // Gentle float for the briefing heading.
  React.useEffect(() => {
    const tween = gsap.to(titleRef.current, {
      y: -7,
      duration: 2.8,
      ease: 'sine.inOut',
      yoyo: true,
      repeat: -1,
    });
    return () => { tween.kill(); };
  }, []);

  return (
    <div className="flex bg-p5-ink text-p5-text flex-1 min-w-0 min-h-0">
      <HyperspaceField warp={warpRef} active={starFieldActive} />

      <main className="relative z-10 flex-1 min-w-0 min-h-0 overflow-y-auto px-6 py-8 md:px-10 lg:px-10 lg:py-10">
        <div ref={contentRef} className="mx-auto max-w-[1128px]" style={{ opacity: 0 }}>
          {/* ─── Hero — dark briefing ─── */}
          <header className="relative min-h-[150px]">
            <div className="min-w-0 pt-1">
              <div className="p5-kicker text-p5-muted">DAILY BRIEFING</div>
              <h1 className="mt-3">
                <span
                  ref={titleRef}
                  className="relative inline-block font-p5-serif text-[clamp(44px,5.2vw,76px)] leading-[0.88] text-p5-text will-change-transform"
                >
                  TODAY'S MISSION
                  <span className="absolute -bottom-2.5 left-0 h-[6px] w-full bg-accent" />
                </span>
              </h1>
            </div>
            <span className="absolute right-0 top-2 border border-white/20 px-3 py-1.5 font-mono text-[10px] font-bold tracking-[0.16em] text-p5-muted">
              {dayStamp}
            </span>

            {/* Field report — the status line */}
            <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-1 border border-white/10 bg-white/[0.03] px-4 py-2.5 font-mono text-[10px] tracking-[0.14em] text-p5-muted">
              <span className="flex items-center gap-2 text-p5-text">
                <span className="h-2 w-2 animate-pulse rounded-full bg-accent" /> MISSION ACTIVE
              </span>
              <span>{listed.length} OBJECTIVE{listed.length === 1 ? '' : 'S'}</span>
              <span><span className="font-black text-p5-text">{completedCount}</span> CLEARED</span>
              {overdueTasks.length > 0 ? <span className="text-status-failed">{overdueTasks.length} OVERDUE</span> : null}
              <span className="ml-auto text-p5-muted/50">REPORT {dayStamp}</span>
            </div>
          </header>

          {/* ─── Board ─── */}
          <div className="mt-7 grid grid-cols-1 gap-7 lg:grid-cols-12">
            {/* Left: dial + operations */}
            <aside className="lg:col-span-5 space-y-7">
              <section className="relative overflow-hidden border border-white/10 bg-white/[0.03] p-6">
                <div className="flex items-center justify-between">
                  <div className="p5-kicker text-p5-muted">MISSION STATUS</div>
                  <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
                </div>
                <div className="mt-5">
                  <MissionDial rate={completionRate} completed={completedCount} total={totalCount} overdue={overdueTasks.length} />
                </div>
                <div className="mt-6 grid grid-cols-2 gap-2.5">
                  <div className="border border-white/10 bg-white/[0.03] p-3">
                    <div className="p5-kicker text-p5-muted">CLEARED</div>
                    <div className="mt-1 font-p5-serif text-[30px] leading-none text-p5-text tabular-nums">
                      {completedCount}<span className="text-[16px] text-p5-muted">/{totalCount}</span>
                    </div>
                  </div>
                  <div className="border border-white/10 bg-white/[0.03] p-3">
                    <div className="p5-kicker text-p5-muted">DEFERRED</div>
                    <div className="mt-1 font-p5-serif text-[30px] leading-none text-amber-400 tabular-nums">
                      {analytics?.deferredTomorrow ?? 0}
                    </div>
                  </div>
                  <div className="border border-white/10 bg-white/[0.03] p-3">
                    <div className="p5-kicker text-p5-muted">IN PROGRESS</div>
                    <div className="mt-1 font-p5-serif text-[30px] leading-none text-p5-text tabular-nums">
                      {analytics?.today.inProgress ?? 0}
                    </div>
                  </div>
                  <div className="border border-white/10 bg-white/[0.03] p-3">
                    <div className="p5-kicker text-p5-muted">OPEN</div>
                    <div className="mt-1 font-p5-serif text-[30px] leading-none text-p5-text tabular-nums">
                      {Math.max(0, totalCount - completedCount)}
                    </div>
                  </div>
                </div>
              </section>

              <section className="relative overflow-hidden border border-white/10 bg-white/[0.03] p-5">
                <div className="p5-kicker text-p5-muted">7-DAY TREND</div>
                {analytics && analytics.last7Days.length > 0 ? (
                  <div className="mt-4 flex h-[110px] items-end gap-2 border-b border-white/15">
                    {analytics.last7Days.map((d) => {
                      const max = Math.max(...analytics.last7Days.map((x) => Math.max(x.created, x.completed)), 1);
                      return (
                        <div key={d.date} className="group relative flex flex-1 flex-col justify-end">
                          <div className="flex items-end justify-center gap-0.5">
                            <div
                              className="w-[7px] bg-accent transition group-hover:opacity-80"
                              style={{ height: `${(d.completed / max) * 100}%` }}
                              title={`${d.date}: ${d.completed} completed`}
                            />
                            <div
                              className="w-[7px] bg-white/20 transition group-hover:bg-white/35"
                              style={{ height: `${(d.created / max) * 100}%` }}
                              title={`${d.date}: ${d.created} created`}
                            />
                          </div>
                          <span className="mt-1 text-center font-mono text-[9px] text-p5-muted">
                            {new Date(d.date).toLocaleDateString(undefined, { weekday: 'narrow' })}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="mt-4 border border-dashed border-white/15 p-4 text-center font-mono text-[10px] tracking-widest text-p5-muted">
                    NO TREND DATA YET
                  </div>
                )}
                <div className="mt-2 flex items-center gap-4 font-mono text-[9px] tracking-[0.1em] text-p5-muted">
                  <span className="flex items-center gap-1"><span className="h-2 w-[7px] bg-accent" /> COMPLETED</span>
                  <span className="flex items-center gap-1"><span className="h-2 w-[7px] bg-white/20" /> CREATED</span>
                </div>
              </section>
            </aside>

            {/* Right: the board — tickets + new objective */}
            <section className="lg:col-span-7">
              {/* New objective — cream console, the only bright strip */}
              <div className="relative overflow-hidden border-2 border-white/20 bg-p5-panel p-4">
                <div className="absolute inset-y-0 left-0 w-1 bg-accent" />
                <div className="relative flex flex-wrap items-center gap-3">
                  <div className="p5-kicker text-p5-dark shrink-0">NEW OBJECTIVE</div>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as TaskCategory)}
                    className="h-12 sm:h-8 border border-black/25 bg-white px-2 font-mono text-[12px] sm:text-[11px] text-p5-dark outline-none focus:border-accent"
                    aria-label="Category"
                  >
                    {(Object.keys(CATEGORY_LABEL) as TaskCategory[]).map((c) => (
                      <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
                    ))}
                  </select>
                  <form className="flex min-w-0 flex-1 items-center gap-3" onSubmit={submit}>
                    <input
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder="Add a task…"
                      enterKeyHint="done"
                      className="min-w-0 flex-1 border-0 border-b border-black/25 bg-transparent px-0 pb-1 h-12 sm:h-auto text-[16px] sm:text-[14px] text-p5-dark outline-none placeholder:text-p5-dark-muted focus:border-accent"
                    />
                    <button
                      type="submit"
                      disabled={!draft.trim() || createMut.isPending}
                      aria-label=""
                      className="flex h-12 w-12 sm:h-9 sm:w-9 shrink-0 items-center justify-center bg-accent text-white transition hover:bg-accent-hover disabled:opacity-40"
                    >
                      {createMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                    </button>
                  </form>
                </div>
              </div>

              {/* Log header */}
              <div className="mb-4 mt-6 flex items-end justify-between">
                <div>
                  <div className="p5-kicker text-p5-muted">OBJECTIVE LOG</div>
                  <div className="mt-1 text-[12px] text-p5-muted">
                    {listed.length} objective{listed.length === 1 ? '' : 's'} pinned on today's board.
                  </div>
                </div>
                {overdueTasks.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setShowOverdue((v) => !v)}
                    className={cn(
                      'border px-2.5 py-1 font-mono text-[10px] font-bold tracking-[0.12em] transition',
                      showOverdue ? 'border-accent bg-accent text-white' : 'border-accent/50 text-accent hover:bg-accent/10',
                    )}
                  >
                    SHOW OVERDUE ({overdueTasks.length})
                  </button>
                ) : null}
              </div>

              {listed.length === 0 ? (
                <div className="border-2 border-dashed border-white/15 p-12 text-center">
                  <p className="font-p5-serif text-[24px] text-p5-text">THE BOARD IS CLEAR.</p>
                  <p className="mt-1 font-mono text-[11px] tracking-[0.14em] text-p5-muted">
                    NOTHING ON THE MISSION — CAPTURE AN OBJECTIVE ABOVE.
                  </p>
                </div>
              ) : (
                <ul className="space-y-2.5">
                  {listed.map((t, i) => (
                    <ObjectiveTicket
                      key={t.id}
                      task={t}
                      index={i}
                      onToggle={(task) => updateMut.mutate({ id: task.id, status: task.status === 'done' ? 'todo' : 'done' })}
                      onDefer={(task) => deferMut.mutate(task.id)}
                      onArchive={(task) => archiveMut.mutate(task.id)}
                      onDelegate={openDelegate}
                      busy={updateMut.isPending || deferMut.isPending || archiveMut.isPending}
                    />
                  ))}
                </ul>
              )}
            </section>
          </div>

          <footer className="mt-12 text-center font-mono text-[10px] tracking-[0.25em] text-p5-muted">
            NIGHT OPS · EVERY OBJECTIVE CLEARED IS PROGRESS
          </footer>
        </div>
      </main>

      {/* ─── Delegate sheet ─── */}
      <Sheet
        open={!!delegating}
        onClose={() => setDelegating(null)}
        label="Delegate task to Hermes"
        footer={delegating ? (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setDelegating(null)}
              className="flex-1 sm:flex-none px-4 py-2 min-h-[48px] sm:min-h-0 text-[11px] font-black tracking-[0.12em] text-p5-dark-muted transition hover:text-p5-dark"
            >
              CANCEL
            </button>
            <button
              type="button"
              onClick={confirmDelegate}
              disabled={delegateMut.isPending}
              className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 bg-accent px-4 py-2 min-h-[48px] sm:min-h-0 text-[11px] font-black tracking-[0.12em] text-white transition hover:bg-accent-hover disabled:opacity-40"
            >
              {delegateMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Delegate
            </button>
          </div>
        ) : undefined}
      >
        {delegating ? (
          <div className="p-5 sm:p-6">
            <div className="absolute inset-y-0 left-0 w-1 bg-accent" />
            <div className="p5-kicker text-accent">DELEGATE</div>
            <h2 className="mt-2 font-p5-serif text-[22px] sm:text-[24px] leading-tight text-p5-dark">
              {delegating.title}
            </h2>
            <p className="mt-2 text-[12px] leading-relaxed text-p5-dark-muted">
              The task stays on your mission. Hermes gets the brief (with optional context) and reports back in its own thread.
            </p>
            <textarea
              value={delegateContext}
              onChange={(e) => setDelegateContext(e.target.value)}
              placeholder="Context (optional)"
              rows={3}
              className="mt-4 w-full resize-none border-2 border-black/20 bg-white px-3 py-2 h-24 sm:h-auto text-[16px] sm:text-[13px] text-p5-dark outline-none placeholder:text-p5-dark-muted focus:border-accent"
            />
          </div>
        ) : null}
      </Sheet>
    </div>
  );
}
