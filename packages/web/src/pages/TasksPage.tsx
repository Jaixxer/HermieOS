import * as React from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  ArrowRight,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Clock,
  ExternalLink,
  Loader2,
  Plus,
  Send,
  Trash2,
} from 'lucide-react';
import {
  api,
  type Task,
  type TaskCategory,
  type TaskStatus,
  type TaskUpdate,
  type TaskUpdateKind,
} from '../api';
import { useServer } from '../server';
import { Sheet } from '../components/ui/sheet';
import { cn } from '../lib/utils';

/**
 * Tasks — the planner.
 *
 * One screen for the whole lifecycle: assign a task to a calendar day,
 * give it a deadline, write the standing brief Hermes gets when you hand
 * it over, and keep a progress log that both you and Hermes append to.
 * Delegated tasks relay your progress into the task's Hermes conversation,
 * and Hermes' entries land back in the same log.
 */

const CATEGORY_LABEL: Record<TaskCategory, string> = {
  work: 'Work',
  learning: 'Learning',
  research: 'Research',
  health: 'Health',
  admin: 'Admin',
  personal: 'Personal',
  other: 'Other',
};

const KIND_LABEL: Record<TaskUpdateKind, string> = {
  progress: 'Progress',
  blocker: 'Blocker',
  handoff: 'Handoff',
  note: 'Note',
  status: 'Status',
};

const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: 'Pending',
  in_progress: 'Active',
  blocked: 'Blocked',
  done: 'Cleared',
  cancelled: 'Cancelled',
};

// --- day helpers (all local-time, matching the API's day keys) -------------

function dayKeyOf(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayKey(): string {
  return dayKeyOf(new Date());
}

function shiftDay(key: string, days: number): string {
  const [y, m, d] = key.split('-').map((n) => parseInt(n, 10));
  const date = new Date(y!, (m ?? 1) - 1, d ?? 1);
  date.setDate(date.getDate() + days);
  return dayKeyOf(date);
}

/** Monday of the week containing `key`. */
function weekStartOf(key: string): string {
  const [y, m, d] = key.split('-').map((n) => parseInt(n, 10));
  const date = new Date(y!, (m ?? 1) - 1, d ?? 1);
  const dow = (date.getDay() + 6) % 7; // Mon = 0
  date.setDate(date.getDate() - dow);
  return dayKeyOf(date);
}

function parseDayKey(key: string): Date {
  const [y, m, d] = key.split('-').map((n) => parseInt(n, 10));
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
}

function fmtDayShort(key: string): string {
  return parseDayKey(key)
    .toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
    .toUpperCase();
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/** Deadline as a short label + urgency tone, evaluated against local today. */
function deadlineInfo(iso: string | null, done: boolean): { label: string; tone: string } | null {
  if (!iso) return null;
  const due = new Date(iso);
  const dueKey = dayKeyOf(due);
  const today = todayKey();
  const tomorrow = shiftDay(today, 1);
  const time = fmtTime(iso);
  const base = done ? 'text-p5-dark-muted' : 'text-p5-dark';
  if (dueKey === today) {
    return { label: `DEADLINE TODAY ${time}`, tone: done ? base : 'text-accent font-black' };
  }
  if (dueKey === tomorrow) return { label: `DEADLINE TOMORROW ${time}`, tone: done ? base : 'text-amber-600' };
  if (dueKey < today) return { label: `OVERDUE ${fmtDayShort(dueKey)} ${time}`, tone: done ? base : 'text-status-failed font-black' };
  return { label: `DUE ${fmtDayShort(dueKey)} ${time}`, tone: base };
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.round(ms / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** Local datetime-local value ("YYYY-MM-DDTHH:mm") for an ISO deadline. */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// --- small presentational pieces ------------------------------------------

function ProgressBar({ percent, compact }: { percent: number; compact?: boolean }): React.JSX.Element {
  const pct = Math.max(0, Math.min(100, percent));
  return (
    <div className={cn('flex items-center gap-2', compact ? 'w-full max-w-[220px]' : 'w-full')}>
      <div className="h-1.5 flex-1 bg-black/10">
        <div className="h-full bg-accent transition-[width] duration-300" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-9 shrink-0 text-right font-mono text-[10px] tabular-nums text-p5-dark-muted">{pct}%</span>
    </div>
  );
}

function ActorChip({ actor }: { actor: TaskUpdate['actor'] }): React.JSX.Element {
  const isHermes = actor === 'hermes';
  return (
    <span
      className={cn(
        'shrink-0 border px-1.5 py-0.5 font-mono text-[9px] font-black tracking-[0.12em]',
        isHermes ? 'border-accent bg-accent text-white' : 'border-black/30 text-p5-dark',
      )}
    >
      {isHermes ? 'HERMES' : actor === 'system' ? 'SYSTEM' : 'YOU'}
    </span>
  );
}

function UpdateRow({ update }: { update: TaskUpdate }): React.JSX.Element {
  const flagged = update.kind === 'blocker' || update.kind === 'handoff';
  return (
    <li className="border-l-2 border-black/10 py-1.5 pl-3">
      <div className="flex flex-wrap items-center gap-2">
        <ActorChip actor={update.actor} />
        <span className="font-mono text-[9px] tracking-[0.12em] text-p5-dark-muted">{KIND_LABEL[update.kind]}</span>
        {update.percent != null ? (
          <span className="font-mono text-[10px] font-bold tabular-nums text-accent">{update.percent}%</span>
        ) : null}
        <span className={cn('font-mono text-[9px] tracking-[0.1em]', flagged ? 'text-status-failed' : 'text-p5-dark-muted')}>
          {update.kind === 'blocker' ? 'NEEDS YOU · ' : ''}
          {update.kind === 'handoff' ? 'YOUR PART · ' : ''}
          {relativeTime(update.createdAt)}
        </span>
        {update.sharedWithHermesAt ? (
          <span className="font-mono text-[9px] tracking-[0.1em] text-accent">SENT TO HERMES</span>
        ) : null}
      </div>
      <p className="mt-1 whitespace-pre-wrap text-[13px] leading-snug text-p5-dark">{update.body}</p>
    </li>
  );
}

// --- page ------------------------------------------------------------------

type View = 'day' | 'delegated' | 'deadlines';

interface ProgressDraft {
  body: string;
  percent: string;
  kind: TaskUpdateKind;
}

const EMPTY_DRAFT: ProgressDraft = { body: '', percent: '', kind: 'progress' };

export function TasksPage(): React.JSX.Element {
  const { connected } = useServer();
  const qc = useQueryClient();

  const [view, setView] = React.useState<View>('day');
  const [day, setDay] = React.useState<string>(todayKey());
  const [expanded, setExpanded] = React.useState<string | null>(null);

  // composer
  const [title, setTitle] = React.useState('');
  const [category, setCategory] = React.useState<TaskCategory>('work');
  const [assignDay, setAssignDay] = React.useState<string>(todayKey());
  const [deadline, setDeadline] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [guidance, setGuidance] = React.useState('');
  const [showMore, setShowMore] = React.useState(false);

  // delegate sheet
  const [delegating, setDelegating] = React.useState<Task | null>(null);
  const [delegateNote, setDelegateNote] = React.useState('');
  const [delegateContext, setDelegateContext] = React.useState('');

  // progress drafts, keyed by task id
  const [drafts, setDrafts] = React.useState<Record<string, ProgressDraft>>({});

  const invalidate = (taskId?: string): void => {
    void qc.invalidateQueries({ queryKey: ['tasks'] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
    if (taskId) void qc.invalidateQueries({ queryKey: ['task-updates', taskId] });
  };

  const weekStart = weekStartOf(day);
  const weekDays = React.useMemo(() => Array.from({ length: 7 }, (_, i) => shiftDay(weekStart, i)), [weekStart]);

  const weekQ = useQuery({
    queryKey: ['tasks', 'range', weekStart],
    queryFn: () => api.listTasks({ from: weekStart, to: shiftDay(weekStart, 6), limit: 200 }),
    enabled: connected,
    refetchInterval: 120_000,
  });

  const dayQ = useQuery({
    queryKey: ['tasks', 'day', day],
    queryFn: () => api.listTasks({ day, limit: 100 }),
    enabled: connected && view === 'day',
    refetchInterval: 120_000,
  });

  const delegatedQ = useQuery({
    queryKey: ['tasks', 'delegated'],
    queryFn: () => api.listTasks({ delegated: true, limit: 100 }),
    enabled: connected && view === 'delegated',
    refetchInterval: 120_000,
  });

  const deadlinesQ = useQuery({
    queryKey: ['tasks', 'deadlines'],
    queryFn: () => api.listTasks({ from: todayKey(), to: shiftDay(todayKey(), 30), limit: 200 }),
    enabled: connected && view === 'deadlines',
    refetchInterval: 120_000,
  });

  const createMut = useMutation({
    mutationFn: (input: {
      title: string;
      category: TaskCategory;
      scheduledFor?: string;
      dueAt?: string;
      notes?: string;
      delegateNote?: string;
    }) => api.createTask(input),
    onSuccess: () => {
      setTitle('');
      setDeadline('');
      setNotes('');
      setGuidance('');
      invalidate();
    },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof api.updateTask>[1] }) =>
      api.updateTask(id, patch),
    onSuccess: (_data, vars) => invalidate(vars.id),
  });

  const archiveMut = useMutation({
    mutationFn: (id: string) => api.archiveTask(id),
    onSuccess: () => invalidate(),
  });

  const progressMut = useMutation({
    mutationFn: ({ id, draft }: { id: string; draft: ProgressDraft }) =>
      api.addTaskProgress(id, {
        body: draft.body,
        percent: draft.percent === '' ? undefined : Number(draft.percent),
        kind: draft.kind,
      }),
    onSuccess: (_data, vars) => {
      setDrafts((prev) => ({ ...prev, [vars.id]: EMPTY_DRAFT }));
      invalidate(vars.id);
    },
  });

  const delegateMut = useMutation({
    mutationFn: ({ id, note, context }: { id: string; note?: string; context?: string }) =>
      api.delegateTask(id, { note, context }),
    onSuccess: (_data, vars) => {
      setDelegating(null);
      setDelegateNote('');
      setDelegateContext('');
      invalidate(vars.id);
    },
  });

  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    createMut.mutate({
      title: t,
      category,
      scheduledFor: assignDay || undefined,
      dueAt: deadline ? new Date(deadline).toISOString() : undefined,
      notes: notes.trim() || undefined,
      delegateNote: guidance.trim() || undefined,
    });
  };

  const openDelegate = (task: Task): void => {
    setDelegateNote(task.delegateNote ?? '');
    setDelegateContext('');
    setDelegating(task);
  };

  const confirmDelegate = (): void => {
    if (!delegating) return;
    delegateMut.mutate({
      id: delegating.id,
      note: delegateNote.trim() || undefined,
      context: delegateContext.trim() || undefined,
    });
  };

  const list: Task[] = React.useMemo(() => {
    if (view === 'day') return dayQ.data?.tasks ?? [];
    if (view === 'delegated') {
      return [...(delegatedQ.data?.tasks ?? [])].sort((a, b) => {
        const av = a.dueAt ? new Date(a.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
        const bv = b.dueAt ? new Date(b.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
        return av - bv;
      });
    }
    return (deadlinesQ.data?.tasks ?? [])
      .filter((t) => t.status !== 'done' && t.status !== 'cancelled' && t.dueAt)
      .sort((a, b) => new Date(a.dueAt!).getTime() - new Date(b.dueAt!).getTime());
  }, [view, dayQ.data, delegatedQ.data, deadlinesQ.data]);

  const counts = weekQ.data?.counts ?? {};
  const loading =
    (view === 'day' && dayQ.isLoading) ||
    (view === 'delegated' && delegatedQ.isLoading) ||
    (view === 'deadlines' && deadlinesQ.isLoading);

  const today = todayKey();
  const todayCount = counts[today]?.open ?? 0;
  const overdueCount = (weekQ.data?.tasks ?? []).filter(
    (t) => t.dueAt && t.status !== 'done' && t.status !== 'cancelled' && dayKeyOf(new Date(t.dueAt)) < today,
  ).length;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 bg-p5-cream text-p5-dark">
      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6 sm:py-8 md:px-10">
        <div className="mx-auto max-w-[1128px]">
          {/* ─── Header ─── */}
          <header className="flex flex-wrap items-end justify-between gap-4 border-b-2 border-p5-dark pb-4">
            <div>
              <div className="p5-kicker text-p5-dark-muted">PLANNER</div>
              <h1 className="mt-2 font-p5-serif text-[clamp(38px,4.6vw,64px)] leading-[0.9] text-p5-dark">
                TASKS<span className="text-accent">.</span>
              </h1>
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1 font-mono text-[10px] tracking-[0.14em] text-p5-dark-muted">
              <span>
                <span className="font-black text-p5-dark">{todayCount}</span> OPEN TODAY
              </span>
              <span className={overdueCount > 0 ? 'text-status-failed' : ''}>
                <span className={cn('font-black', overdueCount > 0 ? 'text-status-failed' : 'text-p5-dark')}>
                  {overdueCount}
                </span>{' '}
                OVERDUE
              </span>
              <span>{fmtDayShort(today)}</span>
            </div>
          </header>

          {/* ─── Composer ─── */}
          <form onSubmit={submit} className="mt-6 border-2 border-p5-dark bg-white">
            <div className="flex flex-wrap items-center gap-3 border-b border-black/10 px-4 py-3">
              <span className="p5-kicker shrink-0 text-p5-dark-muted">NEW TASK</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="What needs doing?"
                className="min-w-[200px] flex-1 border-0 border-b border-black/25 bg-transparent px-0 pb-1 text-[15px] outline-none placeholder:text-p5-dark-muted focus:border-accent"
              />
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as TaskCategory)}
                aria-label="Category"
                className="h-11 border border-black/25 bg-white px-2 font-mono text-[11px] outline-none focus:border-accent sm:h-9"
              >
                {(Object.keys(CATEGORY_LABEL) as TaskCategory[]).map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABEL[c]}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col items-stretch gap-3 px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-5">
              <label className="flex items-center gap-2 font-mono text-[10px] tracking-[0.12em] text-p5-dark-muted">
                <CalendarDays className="h-3.5 w-3.5" />
                DAY
                <input
                  type="date"
                  value={assignDay}
                  onChange={(e) => setAssignDay(e.target.value)}
                  className="h-8 border border-black/25 bg-white px-2 font-mono text-[11px] text-p5-dark outline-none focus:border-accent"
                />
              </label>
              <label className="flex items-center gap-2 font-mono text-[10px] tracking-[0.12em] text-p5-dark-muted">
                <Clock className="h-3.5 w-3.5" />
                DEADLINE
                <input
                  type="datetime-local"
                  value={deadline}
                  onChange={(e) => setDeadline(e.target.value)}
                  className="h-8 border border-black/25 bg-white px-2 font-mono text-[11px] text-p5-dark outline-none focus:border-accent"
                />
              </label>
              {deadline ? (
                <button
                  type="button"
                  onClick={() => setDeadline('')}
                  className="font-mono text-[10px] tracking-[0.12em] text-p5-dark-muted underline hover:text-accent"
                >
                  CLEAR DEADLINE
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setShowMore((v) => !v)}
                aria-expanded={showMore}
                className="flex min-h-[44px] items-center gap-1 font-mono text-[10px] tracking-[0.12em] text-p5-dark-muted hover:text-accent sm:ml-auto sm:min-h-0"
              >
                {showMore ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                NOTES &amp; GUIDANCE FOR HERMES
              </button>
              <button
                type="submit"
                disabled={!title.trim() || createMut.isPending}
                className="flex h-11 w-full items-center justify-center gap-1.5 bg-accent px-4 font-mono text-[10px] font-black tracking-[0.14em] text-white transition hover:bg-accent-hover disabled:opacity-40 sm:h-9 sm:w-auto"
              >
                {createMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                ADD TASK
              </button>
            </div>

            {showMore ? (
              <div className="grid grid-cols-1 gap-3 border-t border-black/10 px-4 py-3 md:grid-cols-2">
                <label className="flex flex-col gap-1">
                  <span className="p5-kicker text-p5-dark-muted">NOTES</span>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={3}
                    placeholder="Details, links, constraints…"
                    className="w-full resize-none border border-black/20 bg-white px-2 py-1.5 text-[13px] outline-none focus:border-accent"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="p5-kicker text-accent">GUIDANCE FOR HERMES</span>
                  <textarea
                    value={guidance}
                    onChange={(e) => setGuidance(e.target.value)}
                    rows={3}
                    placeholder="How should Hermes go about this? e.g. draft in one page, cite sources, stop before anything irreversible…"
                    className="w-full resize-none border border-black/20 bg-white px-2 py-1.5 text-[13px] outline-none focus:border-accent"
                  />
                </label>
              </div>
            ) : null}
          </form>

          {/* ─── View switch ─── */}
          <div className="mt-7 flex items-center gap-2 overflow-x-auto pb-1 sm:flex-wrap">
            {(
              [
                { id: 'day', label: 'BY DAY' },
                { id: 'delegated', label: 'DELEGATED' },
                { id: 'deadlines', label: 'DEADLINES 30D' },
              ] as const
            ).map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => setView(v.id)}
                className={cn(
                  'min-h-[44px] shrink-0 border px-3 py-1.5 font-mono text-[10px] font-black tracking-[0.14em] transition sm:min-h-0',
                  view === v.id
                    ? 'border-accent bg-accent text-white'
                    : 'border-black/25 text-p5-dark-muted hover:border-accent hover:text-accent',
                )}
              >
                {v.label}
              </button>
            ))}
          </div>

          {/* ─── Week strip ─── */}
          {view === 'day' ? (
            <div className="-mx-1 mt-4 flex gap-2 overflow-x-auto px-1 pb-1 sm:mx-0 sm:grid sm:grid-cols-7 sm:overflow-visible sm:px-0">
              {weekDays.map((d) => {
                const c = counts[d];
                const isToday = d === today;
                const selected = d === day;
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDay(d)}
                    aria-pressed={selected}
                    className={cn(
                      'flex min-w-[84px] shrink-0 flex-col gap-1 border-2 px-2 py-2 text-left transition sm:min-w-0',
                      selected
                        ? 'border-accent bg-accent text-white'
                        : cn('border-black/15 bg-white hover:border-accent', isToday && 'border-p5-dark'),
                    )}
                  >
                    <span className={cn('font-mono text-[9px] tracking-[0.14em]', selected ? 'text-white/80' : 'text-p5-dark-muted')}>
                      {parseDayKey(d).toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase()}
                    </span>
                    <span className={cn('font-p5-serif text-[22px] leading-none', selected ? 'text-white' : 'text-p5-dark')}>
                      {parseDayKey(d).getDate()}
                    </span>
                    <span className={cn('font-mono text-[9px] tracking-[0.08em]', selected ? 'text-white/80' : 'text-p5-dark-muted')}>
                      {c ? `${c.assigned} TASK${c.assigned === 1 ? '' : 'S'}` : '—'}
                      {c && c.due > 0 ? ` · ${c.due} DUE` : ''}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}

          {/* ─── List header ─── */}
          <div className="mb-4 mt-6 flex items-end justify-between border-b border-black/10 pb-2">
            <div>
              <div className="p5-kicker text-p5-dark-muted">
                {view === 'day' ? `BOARD · ${fmtDayShort(day)}` : view === 'delegated' ? 'HANDED TO HERMES' : 'NEXT 30 DAYS'}
              </div>
              <div className="mt-1 text-[12px] text-p5-dark-muted">
                {view === 'day'
                  ? 'Assigned to this day, due this day, or already in progress.'
                  : view === 'delegated'
                    ? 'Hermes owns these. Your progress notes go straight into its conversation.'
                    : 'Everything with a deadline in the next 30 days, soonest first.'}
              </div>
            </div>
            <span className="font-mono text-[10px] tracking-[0.14em] text-p5-dark-muted">{list.length} SHOWN</span>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 border-2 border-dashed border-black/15 p-10 font-mono text-[11px] tracking-[0.14em] text-p5-dark-muted">
              <Loader2 className="h-4 w-4 animate-spin" /> LOADING TASKS…
            </div>
          ) : list.length === 0 ? (
            <div className="border-2 border-dashed border-black/15 p-10 text-center">
              <p className="font-p5-serif text-[22px] text-p5-dark">NOTHING HERE.</p>
              <p className="mt-1 font-mono text-[10px] tracking-[0.14em] text-p5-dark-muted">
                {view === 'day' ? 'ADD A TASK ABOVE, OR PICK ANOTHER DAY.' : 'NOTHING TO SHOW FOR THIS FILTER.'}
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {list.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  expanded={expanded === task.id}
                  onToggleExpand={() => setExpanded((cur) => (cur === task.id ? null : task.id))}
                  draft={drafts[task.id] ?? EMPTY_DRAFT}
                  onDraftChange={(patch) =>
                    setDrafts((prev) => ({ ...prev, [task.id]: { ...(prev[task.id] ?? EMPTY_DRAFT), ...patch } }))
                  }
                  onAddProgress={() => progressMut.mutate({ id: task.id, draft: drafts[task.id] ?? EMPTY_DRAFT })}
                  progressPending={progressMut.isPending}
                  sharedWithHermes={progressMut.data?.sharedWithHermes === true && progressMut.variables?.id === task.id}
                  onStatus={(status) => updateMut.mutate({ id: task.id, patch: { status } })}
                  onMoveToDay={(d) => updateMut.mutate({ id: task.id, patch: { scheduledFor: d } })}
                  onSetDeadline={(iso) => updateMut.mutate({ id: task.id, patch: { dueAt: iso } })}
                  onArchive={() => archiveMut.mutate(task.id)}
                  onDelegate={() => openDelegate(task)}
                  busy={updateMut.isPending || archiveMut.isPending}
                />
              ))}
            </ul>
          )}

          <footer className="mt-12 text-center font-mono text-[10px] tracking-[0.25em] text-p5-dark-muted">
            PLAN THE DAY · HAND OVER WHAT HERMES CAN DO · KEEP THE LOG HONEST
          </footer>
        </div>
      </main>

      {/* ─── Delegate sheet ─── */}
      <Sheet
        open={!!delegating}
        onClose={() => setDelegating(null)}
        label="Delegate task to Hermes"
        footer={
          delegating ? (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setDelegating(null)}
                className="min-h-[48px] flex-1 px-4 py-2 text-[11px] font-black tracking-[0.12em] text-p5-dark-muted transition hover:text-p5-dark sm:min-h-0 sm:flex-none"
              >
                CANCEL
              </button>
              <button
                type="button"
                onClick={confirmDelegate}
                disabled={delegateMut.isPending}
                className="inline-flex min-h-[48px] flex-1 items-center justify-center gap-1.5 bg-accent px-4 py-2 text-[11px] font-black tracking-[0.12em] text-white transition hover:bg-accent-hover disabled:opacity-40 sm:min-h-0 sm:flex-none"
              >
                {delegateMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                DELEGATE
              </button>
            </div>
          ) : undefined
        }
      >
        {delegating ? (
          <div className="p-5 sm:p-6">
            <div className="absolute inset-y-0 left-0 w-1 bg-accent" />
            <div className="p5-kicker text-accent">DELEGATE TO HERMES</div>
            <h2 className="mt-2 font-p5-serif text-[22px] leading-tight text-p5-dark sm:text-[24px]">
              {delegating.title}
            </h2>
            <p className="mt-2 text-[12px] leading-relaxed text-p5-dark-muted">
              The task stays on your board. Hermes gets this brief plus the progress log so far, and reports into
              it — your notes here are relayed to its conversation too.
            </p>

            <label className="mt-5 flex flex-col gap-1">
              <span className="p5-kicker text-accent">GUIDANCE FOR HERMES (SAVED ON THE TASK)</span>
              <textarea
                value={delegateNote}
                onChange={(e) => setDelegateNote(e.target.value)}
                rows={4}
                placeholder="How to go about it — sources to use, format, what to stop before…"
                className="w-full resize-none border-2 border-black/20 bg-white px-3 py-2 text-[13px] text-p5-dark outline-none placeholder:text-p5-dark-muted focus:border-accent"
              />
            </label>

            <label className="mt-3 flex flex-col gap-1">
              <span className="p5-kicker text-p5-dark-muted">ONE-OFF CONTEXT FOR THIS HAND-OFF</span>
              <textarea
                value={delegateContext}
                onChange={(e) => setDelegateContext(e.target.value)}
                rows={3}
                placeholder="Context (optional)"
                className="w-full resize-none border-2 border-black/20 bg-white px-3 py-2 text-[13px] text-p5-dark outline-none placeholder:text-p5-dark-muted focus:border-accent"
              />
            </label>

            {delegating.progressPercent > 0 ? (
              <p className="mt-3 font-mono text-[10px] tracking-[0.12em] text-p5-dark-muted">
                CURRENT PROGRESS {delegating.progressPercent}% — THE LOG GOES WITH THE BRIEF.
              </p>
            ) : null}
          </div>
        ) : null}
      </Sheet>
    </div>
  );
}

// --- one task card ---------------------------------------------------------

interface TaskCardProps {
  task: Task;
  expanded: boolean;
  onToggleExpand: () => void;
  draft: ProgressDraft;
  onDraftChange: (patch: Partial<ProgressDraft>) => void;
  onAddProgress: () => void;
  progressPending: boolean;
  sharedWithHermes: boolean;
  onStatus: (status: TaskStatus) => void;
  onMoveToDay: (day: string) => void;
  onSetDeadline: (iso: string | null) => void;
  onArchive: () => void;
  onDelegate: () => void;
  busy: boolean;
}

function TaskCard({
  task,
  expanded,
  onToggleExpand,
  draft,
  onDraftChange,
  onAddProgress,
  progressPending,
  sharedWithHermes,
  onStatus,
  onMoveToDay,
  onSetDeadline,
  onArchive,
  onDelegate,
  busy,
}: TaskCardProps): React.JSX.Element {
  const done = task.status === 'done';
  const deadline = deadlineInfo(task.dueAt, done);
  const updatesQ = useQuery({
    queryKey: ['task-updates', task.id],
    queryFn: () => api.listTaskUpdates(task.id, 50),
    enabled: expanded,
  });
  const updates = updatesQ.data?.updates ?? [];

  return (
    <li className={cn('border-2 bg-white transition', done ? 'border-black/10 opacity-60' : 'border-black/15')}>
      <div className="flex flex-wrap items-start gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => onStatus(done ? 'todo' : 'done')}
          disabled={busy}
          aria-label={done ? 'Mark as not done' : 'Mark as done'}
          className={cn(
            'mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center border-2 transition sm:h-6 sm:w-6',
            done ? 'border-accent bg-accent text-white' : 'border-black/30 hover:border-accent',
          )}
        >
          {done ? <span className="text-[15px] font-black leading-none sm:text-[12px]">✓</span> : null}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className={cn('font-p5-serif text-[19px] leading-tight', done && 'line-through')}>{task.title}</span>
            <span className="border border-black/20 px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-[0.12em] text-p5-dark-muted">
              {CATEGORY_LABEL[task.category]}
            </span>
            {task.delegatedAt ? (
              <span className="border border-accent/60 px-1.5 py-0.5 font-mono text-[9px] font-black tracking-[0.12em] text-accent">
                DELEGATED
              </span>
            ) : null}
            {task.status !== 'todo' && !done ? (
              <span className="font-mono text-[9px] font-black tracking-[0.12em] text-status-failed">
                {STATUS_LABEL[task.status].toUpperCase()}
              </span>
            ) : null}
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] tracking-[0.1em]">
            <span className="text-p5-dark-muted">
              {task.scheduledFor ? `ON ${fmtDayShort(task.scheduledFor)}` : 'UNSCHEDULED'}
            </span>
            {deadline ? <span className={deadline.tone}>{deadline.label}</span> : null}
            {task.latestUpdate ? (
              <span className="truncate text-p5-dark-muted">
                {task.latestUpdate.actor === 'hermes' ? 'HERMES' : 'YOU'}: {task.latestUpdate.body.slice(0, 70)}
                {task.latestUpdate.body.length > 70 ? '…' : ''}
              </span>
            ) : null}
          </div>

          <div className="mt-2 max-w-[320px]">
            <ProgressBar percent={task.progressPercent} compact />
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {task.delegatedAt ? (
            <Link
              to={`/chat/task-${task.id}`}
              title="Open the Hermes conversation"
              aria-label="Open Hermes conversation"
              className="flex h-11 w-11 items-center justify-center sm:h-8 sm:w-8 border border-accent/60 text-accent transition hover:bg-accent hover:text-white"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          ) : !done ? (
            <button
              type="button"
              onClick={onDelegate}
              title="Delegate to Hermes"
              aria-label="Delegate to Hermes"
              disabled={busy}
              className="flex h-11 w-11 items-center justify-center sm:h-8 sm:w-8 border border-black/20 text-p5-dark-muted transition hover:border-accent hover:bg-accent hover:text-white disabled:opacity-40"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={onToggleExpand}
            aria-expanded={expanded}
            aria-label={expanded ? 'Hide progress log' : 'Show progress log'}
            className="flex h-11 w-11 items-center justify-center sm:h-8 sm:w-8 border border-black/20 text-p5-dark-muted transition hover:border-p5-dark hover:text-p5-dark"
          >
            {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            onClick={onArchive}
            title="Archive"
            aria-label="Archive task"
            disabled={busy}
            className="flex h-11 w-11 items-center justify-center sm:h-8 sm:w-8 border border-black/20 text-p5-dark-muted transition hover:border-status-failed hover:text-status-failed disabled:opacity-40"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {expanded ? (
        <div className="border-t border-black/10 bg-p5-cream/60 px-4 py-4">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {/* Left: schedule + brief */}
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 font-mono text-[10px] tracking-[0.12em] text-p5-dark-muted">
                  DAY
                  <input
                    type="date"
                    value={task.scheduledFor ?? ''}
                    onChange={(e) => onMoveToDay(e.target.value)}
                    className="h-11 border border-black/25 bg-white px-2 font-mono text-[11px] outline-none focus:border-accent sm:h-8"
                  />
                </label>
                <label className="flex items-center gap-2 font-mono text-[10px] tracking-[0.12em] text-p5-dark-muted">
                  DEADLINE
                  <input
                    type="datetime-local"
                    value={toLocalInput(task.dueAt)}
                    onChange={(e) => onSetDeadline(e.target.value ? new Date(e.target.value).toISOString() : null)}
                    className="h-11 border border-black/25 bg-white px-2 font-mono text-[11px] outline-none focus:border-accent sm:h-8"
                  />
                </label>
              </div>

              {task.notes ? (
                <div>
                  <div className="p5-kicker text-p5-dark-muted">NOTES</div>
                  <p className="mt-1 whitespace-pre-wrap text-[13px] leading-snug text-p5-dark">{task.notes}</p>
                </div>
              ) : null}

              {task.delegateNote ? (
                <div className="border-l-2 border-accent pl-3">
                  <div className="p5-kicker text-accent">GUIDANCE FOR HERMES</div>
                  <p className="mt-1 whitespace-pre-wrap text-[13px] leading-snug text-p5-dark">{task.delegateNote}</p>
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => onStatus(task.status === 'in_progress' ? 'todo' : 'in_progress')}
                  className="min-h-[44px] border border-black/25 px-3 py-1 font-mono text-[10px] font-black tracking-[0.12em] text-p5-dark-muted transition hover:border-accent hover:text-accent sm:min-h-0"
                >
                  {task.status === 'in_progress' ? 'MARK PENDING' : 'MARK ACTIVE'}
                </button>
                <button
                  type="button"
                  onClick={() => onStatus('blocked')}
                  className="min-h-[44px] border border-black/25 px-3 py-1 font-mono text-[10px] font-black tracking-[0.12em] text-p5-dark-muted transition hover:border-status-failed hover:text-status-failed sm:min-h-0"
                >
                  BLOCKED
                </button>
              </div>
            </div>

            {/* Right: the shared progress log */}
            <div>
              <div className="flex items-center justify-between">
                <div className="p5-kicker text-p5-dark-muted">PROGRESS LOG</div>
                <span className="font-mono text-[9px] tracking-[0.12em] text-p5-dark-muted">
                  {task.updatesCount ?? updates.length} ENTRIES
                </span>
              </div>

              <div className="mt-2 max-h-[240px] overflow-y-auto pr-1">
                {updatesQ.isLoading ? (
                  <p className="font-mono text-[10px] tracking-[0.12em] text-p5-dark-muted">LOADING…</p>
                ) : updates.length === 0 ? (
                  <p className="font-mono text-[10px] tracking-[0.12em] text-p5-dark-muted">
                    NO UPDATES YET — ADD THE FIRST ONE BELOW.
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {updates.map((u) => (
                      <UpdateRow key={u.id} update={u} />
                    ))}
                  </ul>
                )}
              </div>

              <div className="mt-3 border-t border-black/10 pt-3">
                <textarea
                  value={draft.body}
                  onChange={(e) => onDraftChange({ body: e.target.value })}
                  rows={2}
                  placeholder="What moved? What's left?"
                  className="w-full resize-none border border-black/20 bg-white px-2 py-1.5 text-[13px] outline-none focus:border-accent"
                />
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <select
                    value={draft.kind}
                    onChange={(e) => onDraftChange({ kind: e.target.value as TaskUpdateKind })}
                    aria-label="Update kind"
                    className="h-11 border border-black/25 bg-white px-2 font-mono text-[10px] outline-none focus:border-accent sm:h-8"
                  >
                    {(Object.keys(KIND_LABEL) as TaskUpdateKind[]).map((k) => (
                      <option key={k} value={k}>
                        {KIND_LABEL[k]}
                      </option>
                    ))}
                  </select>
                  <label className="flex items-center gap-1.5 font-mono text-[10px] text-p5-dark-muted">
                    %
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={draft.percent}
                      onChange={(e) => onDraftChange({ percent: e.target.value })}
                      placeholder="—"
                      className="h-11 w-20 border border-black/25 bg-white px-2 font-mono text-[11px] tabular-nums outline-none focus:border-accent sm:h-8 sm:w-16"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={onAddProgress}
                    disabled={!draft.body.trim() || progressPending}
                    className="ml-auto flex h-11 items-center gap-1.5 bg-p5-dark px-3 font-mono text-[10px] font-black tracking-[0.12em] text-white transition hover:bg-accent disabled:opacity-40 sm:h-8"
                  >
                    {progressPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
                    LOG UPDATE
                  </button>
                </div>
                {task.delegatedAt ? (
                  <p className="mt-2 flex items-center gap-1.5 font-mono text-[9px] tracking-[0.1em] text-p5-dark-muted">
                    <AlertCircle className="h-3 w-3 text-accent" />
                    {sharedWithHermes ? 'SHARED WITH HERMES' : 'DELEGATED TASK — THIS ENTRY IS RELAYED TO HERMES'}
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </li>
  );
}
