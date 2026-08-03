import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Target,
  CheckCircle2,
  Loader2,
  Plus,
  Trash2,
  ChevronRight,
  CalendarClock,
  TrendingUp,
  AlertCircle,
  ListTodo,
  Play,
} from 'lucide-react';
import { api, type Task, type TaskCategory, type TaskStatus, type TaskAnalytics } from '../api';
import { useServer } from '../server';
import { Sidebar } from '../components/Sidebar';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { cn } from '../lib/utils';

const CATEGORY_LABEL: Record<TaskCategory, string> = {
  work: 'Work',
  learning: 'Learning',
  research: 'Research',
  health: 'Health',
  admin: 'Admin',
  personal: 'Personal',
  other: 'Other',
};

const CATEGORY_COLOR: Record<TaskCategory, string> = {
  work: 'bg-sky-100 text-sky-700',
  learning: 'bg-emerald-100 text-emerald-700',
  research: 'bg-purple-100 text-purple-700',
  health: 'bg-rose-100 text-rose-700',
  admin: 'bg-amber-100 text-amber-700',
  personal: 'bg-pink-100 text-pink-700',
  other: 'bg-slate-100 text-slate-600',
};

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function isToday(iso: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  return startOfDay(d).getTime() === startOfDay(new Date()).getTime();
}

function ProgressRing({ value, size = 88 }: { value: number; size?: number }): React.JSX.Element {
  const r = (size - 10) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, value));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-border-strong, #e2e8f0)" strokeWidth="8" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="#22c55e"
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - pct)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text
        x="50%"
        y="50%"
        dominantBaseline="central"
        textAnchor="middle"
        fontSize="15"
        fontWeight="600"
        fill="currentColor"
      >
        {Math.round(pct * 100)}%
      </text>
    </svg>
  );
}

function StatChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone: 'green' | 'amber' | 'rose' | 'slate' | 'sky';
}): React.JSX.Element {
  const tones: Record<string, string> = {
    green: 'text-emerald-600',
    amber: 'text-amber-600',
    rose: 'text-rose-600',
    sky: 'text-sky-600',
    slate: 'text-text-secondary',
  };
  return (
    <div className="rounded-xl border border-border-default bg-surface-1 px-3 py-2.5">
      <div className={cn('text-[18px] font-bold leading-tight', tones[tone])}>{value}</div>
      <div className="text-[11px] text-text-tertiary mt-0.5">{label}</div>
    </div>
  );
}

function MissionTaskRow({
  task,
  onToggle,
  onDefer,
  onArchive,
  busy,
}: {
  task: Task;
  onToggle: (t: Task) => void;
  onDefer: (t: Task) => void;
  onArchive: (t: Task) => void;
  busy: boolean;
}): React.JSX.Element {
  const done = task.status === 'done';
  return (
    <li className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border-default bg-surface-0 hover:border-border-strong transition group">
      <button
        type="button"
        onClick={() => onToggle(task)}
        disabled={busy}
        className={cn(
          'w-5 h-5 rounded-full border-2 flex items-center justify-center transition shrink-0',
          done ? 'border-accent bg-accent text-accent-fg' : 'border-border-strong hover:border-accent',
        )}
        aria-label={done ? 'Mark as not done' : 'Mark as done'}
      >
        {done ? <CheckCircle2 className="w-3.5 h-3.5" /> : null}
      </button>
      <div className="flex-1 min-w-0">
        <div className={cn('text-[13px] leading-snug', done && 'line-through text-text-tertiary')}>
          {task.title}
        </div>
        {task.dueAt && !isToday(task.dueAt) && task.status !== 'done' ? (
          <div className="text-[11px] text-amber-600 mt-0.5 flex items-center gap-1">
            <AlertCircle className="w-3 h-3" />
            Due {new Date(task.dueAt).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
          </div>
        ) : null}
        {task.status === 'in_progress' ? (
          <div className="text-[11px] text-amber-600 mt-0.5 flex items-center gap-1">
            <Play className="w-3 h-3" /> In progress
          </div>
        ) : null}
      </div>
      <span className={cn('text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0', CATEGORY_COLOR[task.category])}>
        {CATEGORY_LABEL[task.category]}
      </span>
      <div className="flex items-center gap-1 shrink-0">
        {!done ? (
          <Button
            size="icon"
            variant="ghost"
            title="Defer to tomorrow"
            aria-label="Defer to tomorrow"
            disabled={busy}
            onClick={() => onDefer(task)}
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </Button>
        ) : null}
        <Button size="icon" variant="ghost" title="Archive" aria-label="Archive task" disabled={busy} onClick={() => onArchive(task)}>
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
    </li>
  );
}

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
    queryFn: () => api.listTasks({ limit: 100 }),
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

  const all = tasksQ.data?.tasks ?? [];
  const todayTasks = all.filter((t) => !t.dueAt || startOfDay(new Date(t.dueAt)).getTime() <= startOfDay(new Date()).getTime());
  const overdueTasks = todayTasks.filter(
    (t) => t.dueAt && startOfDay(new Date(t.dueAt)).getTime() < startOfDay(new Date()).getTime() && t.status !== 'done',
  );
  const listed = showOverdue ? todayTasks : todayTasks.filter((t) => !overdueTasks.includes(t));

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
  const dayLabel = today.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <div className="min-h-screen flex bg-page text-text-primary">
      <Sidebar activePath="/mission" className="hidden lg:flex" />
      <main className="flex-1 p-6 lg:p-8 max-w-[1100px] mx-auto w-full">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-accent/15 text-accent-text flex items-center justify-center">
            <Target className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-[18px] font-semibold text-text-primary">Today's Mission</h1>
            <p className="text-[12px] text-text-tertiary">{dayLabel}</p>
          </div>
        </div>

        {/* Overview */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-6">
          <Card>
            <CardContent className="p-5 flex items-center gap-5">
              <ProgressRing value={completionRate} />
              <div>
                <div className="text-[15px] font-semibold text-text-primary">Today's progress</div>
                <div className="text-[12px] text-text-tertiary mt-1">
                  {completedCount} of {totalCount} tasks completed
                </div>
                {analytics ? (
                  <div className="text-[11px] text-text-tertiary mt-2">
                    <span className="text-emerald-600 font-medium">{analytics.today.overdue}</span> overdue ·{' '}
                    <span className="text-amber-600 font-medium">{analytics.today.inProgress}</span> in progress ·{' '}
                    <span className="text-sky-600 font-medium">{analytics.deferredTomorrow}</span> deferred to tomorrow
                  </div>
                ) : null}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <div className="text-[13px] font-semibold text-text-primary mb-3 flex items-center gap-1.5">
                <TrendingUp className="w-4 h-4 text-accent-text" />
                7-day trend
              </div>
              {analytics && analytics.last7Days.length > 0 ? (
                <div className="flex items-end gap-2 h-[70px]">
                  {analytics.last7Days.map((d) => {
                    const max = Math.max(...analytics.last7Days.map((x) => Math.max(x.created, x.completed)), 1);
                    return (
                      <div key={d.date} className="flex-1 flex flex-col items-center gap-1 group">
                        <div className="flex items-end gap-0.5 h-[52px] w-full justify-center">
                          <div
                            className="w-[6px] rounded-sm bg-emerald-400/80 group-hover:bg-emerald-500 transition"
                            style={{ height: `${(d.completed / max) * 100}%` }}
                            title={`${d.date}: ${d.completed} completed`}
                          />
                          <div
                            className="w-[6px] rounded-sm bg-slate-300 group-hover:bg-slate-400 transition"
                            style={{ height: `${(d.created / max) * 100}%` }}
                            title={`${d.date}: ${d.created} created`}
                          />
                        </div>
                        <span className="text-[9px] text-text-quaternary">
                          {new Date(d.date).toLocaleDateString(undefined, { weekday: 'narrow' })}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-[12px] text-text-tertiary py-6 text-center">No task activity yet.</div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Stats strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <StatChip label="Completed today" value={completedCount} tone="green" />
          <StatChip label="Pending today" value={Math.max(totalCount - completedCount, 0)} tone="amber" />
          <StatChip label="Overdue" value={analytics?.today.overdue ?? 0} tone="rose" />
          <StatChip label="Deferred to tomorrow" value={analytics?.deferredTomorrow ?? 0} tone="sky" />
        </div>

        {/* Task list */}
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[15px] font-semibold text-text-primary flex items-center gap-1.5">
                <ListTodo className="w-4 h-4 text-accent-text" />
                Tasks
              </h2>
              {overdueTasks.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setShowOverdue((v) => !v)}
                  className="text-[11px] text-amber-600 hover:underline"
                >
                  {showOverdue ? `Hide ${overdueTasks.length} overdue` : `Show ${overdueTasks.length} overdue`}
                </button>
              ) : null}
            </div>

            {tasksQ.isLoading ? (
              <div className="flex items-center justify-center py-8 text-text-tertiary">
                <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading tasks…
              </div>
            ) : listed.length === 0 ? (
              <div className="text-[13px] text-text-tertiary py-8 text-center">
                {showOverdue && overdueTasks.length === 0
                  ? 'Nothing overdue. Nice work!'
                  : 'No tasks yet. Add your first one below.'}
              </div>
            ) : (
              <ul className="space-y-2">
                {listed.map((t) => (
                  <MissionTaskRow
                    key={t.id}
                    task={t}
                    busy={updateMut.isPending || deferMut.isPending || archiveMut.isPending}
                    onToggle={(task) => updateMut.mutate({ id: task.id, status: task.status === 'done' ? 'todo' : 'done' })}
                    onDefer={(task) => deferMut.mutate(task.id)}
                    onArchive={(task) => archiveMut.mutate(task.id)}
                  />
                ))}
              </ul>
            )}

            <form onSubmit={submit} className="mt-4 flex items-center gap-2">
              <Input
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Add a task…"
                className="flex-1 text-[13px]"
              />
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as TaskCategory)}
                className="h-9 rounded-lg border border-border-default bg-surface-1 px-2 text-[12px] text-text-primary focus:border-accent focus:outline-none"
                aria-label="Category"
              >
                {(Object.keys(CATEGORY_LABEL) as TaskCategory[]).map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABEL[c]}
                  </option>
                ))}
              </select>
              <Button type="submit" size="icon" disabled={!draft.trim() || createMut.isPending}>
                <Plus className="w-4 h-4" />
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="mt-6 flex items-center gap-2 text-[11px] text-text-quaternary">
          <CalendarClock className="w-3.5 h-3.5" />
          Deferring a task moves it to tomorrow's mission. Hermes can read these tasks and analytics through MCP tools.
        </div>
      </main>
    </div>
  );
}
