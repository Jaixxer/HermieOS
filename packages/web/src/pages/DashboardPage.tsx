import * as React from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Search,
  Bell,
  CheckCircle2,
  Circle,
  TrendingUp,
  Briefcase,
  FileText,
  Calendar,
  Sparkles,
  Network,
  Send,
  MessageCircle,
  Plus,
  Sun,
  Target,
  Lightbulb,
  Radar,
  CalendarDays,
} from 'lucide-react';
import { api } from '../api';
import type {
  DashboardData,
  Task,
  TaskStatus,
  TaskCategory,
  Upcoming,
  OpportunityCategory,
} from '../api';
import { useAuth } from '../auth';
import { useServer } from '../server';
import { Sidebar } from '../components/Sidebar';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Card, CardContent } from '../components/ui/card';
import { Input } from '../components/ui/input';

// ============================================================================
// Header
// ============================================================================

function Header({ userName }: { userName: string }): React.JSX.Element {
  const now = new Date();
  const hour = now.getHours();
  const greet = hour < 5 ? 'Working late' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const dateStr = now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return (
    <header className="flex flex-wrap items-center gap-4 mb-6">
      <div>
        <h1 className="text-[26px] font-semibold text-text-primary tracking-tight flex items-center gap-2">
          {greet}, {userName}. <Sun className="w-6 h-6 text-amber-500" />
        </h1>
        <p className="text-[13px] text-text-tertiary mt-0.5">{dateStr}</p>
      </div>
      <div className="ml-auto flex items-center gap-3 flex-wrap">
        <StatusPill label="Hermes Server" color="emerald" />
        <StatusPill label="LLM: GLM-5.2" color="purple" />
        <button className="w-9 h-9 rounded-lg border border-border-default flex items-center justify-center text-text-tertiary hover:bg-surface-2 transition" aria-label="Search">
          <Search className="w-4 h-4" />
        </button>
        <button className="w-9 h-9 rounded-lg border border-border-default flex items-center justify-center text-text-tertiary hover:bg-surface-2 transition relative" aria-label="Notifications">
          <Bell className="w-4 h-4" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-accent" />
        </button>
        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-amber-200 via-pink-300 to-purple-400 flex items-center justify-center text-[11px] font-semibold text-slate-900">
          JV
        </div>
      </div>
    </header>
  );
}

function StatusPill({ label, color }: { label: string; color: 'emerald' | 'purple' }) {
  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-border-default bg-surface-1 px-2.5 py-1.5 text-[12px] text-text-secondary">
      <span className={`w-2 h-2 rounded-full ${color === 'emerald' ? 'bg-status-active' : 'bg-purple-500'}`} />
      {label}
    </div>
  );
}

// ============================================================================
// Today's Mission
// ============================================================================

const CATEGORY_PILL_LABEL: Record<TaskCategory, string> = {
  work: 'Work',
  learning: 'Learning',
  research: 'Research',
  health: 'Health',
  admin: 'Admin',
  personal: 'Personal',
  other: 'Other',
};

const CATEGORY_PILL_COLORS: Record<TaskCategory, string> = {
  work: 'bg-sky-100 text-sky-700',
  learning: 'bg-emerald-100 text-emerald-700',
  research: 'bg-purple-100 text-purple-700',
  health: 'bg-rose-100 text-rose-700',
  admin: 'bg-amber-100 text-amber-700',
  personal: 'bg-pink-100 text-pink-700',
  other: 'bg-slate-100 text-slate-600',
};

function TodaysMissionCard({
  tasks,
  onAddTask,
  onStatusChange,
}: {
  tasks: Task[];
  onAddTask: (title: string, category: TaskCategory) => void;
  onStatusChange: (id: string, status: TaskStatus) => void;
}): React.JSX.Element {
  const [draft, setDraft] = React.useState('');
  const [category, setCategory] = React.useState<TaskCategory>('work');

  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    const title = draft.trim();
    if (!title) return;
    onAddTask(title, category);
    setDraft('');
  };

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-5">
        <div className="flex items-start gap-2 mb-4">
          <div className="w-8 h-8 rounded-lg bg-surface-2 flex items-center justify-center text-text-secondary">
            <Target className="w-4 h-4" />
          </div>
          <div className="flex-1">
            <h3 className="text-[15px] font-semibold text-text-primary">Today's Mission</h3>
            <p className="text-[12px] text-text-tertiary">Focus on what matters most.</p>
          </div>
        </div>

        <ul className="space-y-2">
          {tasks.length === 0 ? (
            <li className="text-[13px] text-text-tertiary py-2">No tasks queued. Add one below.</li>
          ) : null}
          {tasks.map((t) => (
            <li
              key={t.id}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border-default bg-surface-1 hover:border-border-strong transition"
            >
              <button
                type="button"
                onClick={() => onStatusChange(t.id, t.status === 'done' ? 'todo' : 'done')}
                className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition shrink-0 ${
                  t.status === 'done'
                    ? 'border-accent bg-accent text-accent-fg'
                    : t.status === 'in_progress'
                      ? 'border-amber-400'
                      : 'border-border-strong hover:border-text-muted'
                }`}
                aria-label={t.status === 'done' ? 'Mark as not done' : 'Mark as done'}
              >
                {t.status === 'done' ? <CheckCircle2 className="w-3.5 h-3.5" /> : null}
              </button>
              <div className="flex-1 min-w-0">
                <div className={`text-[13px] ${t.status === 'done' ? 'line-through text-text-tertiary' : 'text-text-primary'}`}>
                  {t.title}
                </div>
                {t.status === 'in_progress' ? <div className="text-[11px] text-amber-600 mt-0.5">In Progress</div> : null}
              </div>
              <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${CATEGORY_PILL_COLORS[t.category]}`}>
                {CATEGORY_PILL_LABEL[t.category]}
              </span>
            </li>
          ))}
        </ul>
        <form onSubmit={submit} className="mt-3 flex items-center gap-2">
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
            className="h-9 rounded-lg border border-border-default bg-surface-1 px-2 text-[12px] text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
            aria-label="Category"
          >
            {(Object.keys(CATEGORY_PILL_LABEL) as TaskCategory[]).map((c) => (
              <option key={c} value={c}>
                {CATEGORY_PILL_LABEL[c]}
              </option>
            ))}
          </select>
          <Button type="submit" size="icon" disabled={!draft.trim()}>
            <Plus className="w-4 h-4" />
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Hermes Feed
// ============================================================================

const FEED_ICON: Record<string, { icon: React.ElementType; color: string }> = {
  opportunity_discovered: { icon: Briefcase, color: 'text-emerald-600 bg-emerald-100' },
  research_completed: { icon: FileText, color: 'text-purple-600 bg-purple-100' },
  notification: { icon: Calendar, color: 'text-amber-600 bg-amber-100' },
  task_finished: { icon: CheckCircle2, color: 'text-sky-600 bg-sky-100' },
  priority_changed: { icon: TrendingUp, color: 'text-rose-600 bg-rose-100' },
  object_created: { icon: Sparkles, color: 'text-slate-600 bg-slate-100' },
};
const FEED_ICON_DEFAULT: { icon: React.ElementType; color: string } = { icon: Sparkles, color: 'text-slate-600 bg-slate-100' };

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function HermesFeedCard({ events }: { events: DashboardData['hermesFeed']['events'] }): React.JSX.Element {
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-5">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-start gap-2">
            <div className="w-8 h-8 rounded-lg bg-surface-2 flex items-center justify-center text-text-secondary">
              <TrendingUp className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-[15px] font-semibold text-text-primary">Hermes Feed</h3>
              <p className="text-[12px] text-text-tertiary">What I've been up to while you were away.</p>
            </div>
          </div>
          <Link to="/feed" className="text-[12px] font-medium text-accent-text hover:underline flex items-center gap-0.5">
            View all <span>→</span>
          </Link>
        </div>

        <ul className="space-y-2.5">
          {events.length === 0 ? (
            <li className="text-[13px] text-text-tertiary py-2">Hermes is quiet. For now.</li>
          ) : null}
          {events.slice(0, 3).map((e) => {
            const meta = FEED_ICON[e.kind] ?? FEED_ICON_DEFAULT;
            const Icon = meta.icon;
            return (
              <li key={e.id} className="flex items-start gap-3">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${meta.color}`}>
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] text-text-primary leading-snug">{e.title}</div>
                  {e.body ? <div className="text-[12px] text-text-tertiary mt-0.5 line-clamp-1">{e.body}</div> : null}
                </div>
                <div className="text-[11px] text-text-quaternary shrink-0 mt-0.5">{timeAgo(e.createdAt)}</div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Knowledge Graph mini
// ============================================================================

const NODE_COLORS: Record<string, string> = {
  project: '#38bdf8',
  research: '#a78bfa',
  discovery: '#fb923c',
  decision: '#facc15',
  opportunity: '#34d399',
  learning_path: '#f472b6',
  note: '#94a3b8',
  collection: '#22d3ee',
};

function MiniGraph({ nodes, links }: { nodes: DashboardData['graph']['nodes']; links: DashboardData['graph']['links'] }): React.JSX.Element {
  const W = 320;
  const H = 180;
  const cx = W / 2;
  const cy = H / 2;
  const placed = React.useMemo(() => {
    const n = Math.max(nodes.length, 1);
    return nodes.map((node, i) => {
      const angle = (i / n) * Math.PI * 2;
      const r = Math.min(W, H) * 0.34;
      return { ...node, x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
    });
  }, [nodes]);
  const idMap = React.useMemo(() => new Map(placed.map((n) => [n.id, n])), [placed]);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
      {links.map((l, i) => {
        const a = idMap.get(l.source);
        const b = idMap.get(l.target);
        if (!a || !b) return null;
        return (
          <line
            key={i}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke="#d1d5db"
            strokeWidth={Math.max(0.5, l.confidence * 1.5)}
          />
        );
      })}
      {placed.map((n) => (
        <g key={n.id}>
          <circle cx={n.x} cy={n.y} r="9" fill={NODE_COLORS[n.type] ?? '#94a3b8'} />
          <text x={n.x} y={n.y - 14} textAnchor="middle" className="fill-text-secondary" style={{ fontSize: 9, fontFamily: 'var(--font-sans)' }}>
            {n.title.length > 14 ? `${n.title.slice(0, 12)}…` : n.title}
          </text>
        </g>
      ))}
    </svg>
  );
}

function KnowledgeGraphCard({ data }: { data: DashboardData['graph'] }): React.JSX.Element {
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-5">
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-start gap-2">
            <div className="w-8 h-8 rounded-lg bg-surface-2 flex items-center justify-center text-text-secondary">
              <Network className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-[15px] font-semibold text-text-primary">Knowledge Graph</h3>
              <p className="text-[12px] text-text-tertiary">Your ideas, projects & connections.</p>
            </div>
          </div>
          <Link to="/graph" className="text-[12px] font-medium text-accent-text hover:underline">
            View graph
          </Link>
        </div>
        {data.nodes.length === 0 ? (
          <div className="text-[13px] text-text-tertiary py-8 text-center">No graph data yet.</div>
        ) : (
          <MiniGraph nodes={data.nodes} links={data.links} />
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Scouting Inbox card
// ============================================================================

const OPP_LABEL: Record<OpportunityCategory, string> = {
  job: 'Job Opportunities',
  startup: 'Startups to Watch',
  research_paper: 'Research Papers',
  saas_idea: 'SaaS Ideas',
  iot: 'IoT Opportunities',
  grant: 'Grants',
  competition: 'Competitions',
  other: 'Other',
};

const OPP_ICON: Record<OpportunityCategory, { icon: React.ElementType; color: string }> = {
  job: { icon: Briefcase, color: 'text-emerald-600 bg-emerald-100' },
  startup: { icon: TrendingUp, color: 'text-purple-600 bg-purple-100' },
  research_paper: { icon: FileText, color: 'text-sky-600 bg-sky-100' },
  saas_idea: { icon: Lightbulb, color: 'text-amber-600 bg-amber-100' },
  iot: { icon: Radar, color: 'text-sky-600 bg-sky-100' },
  grant: { icon: Briefcase, color: 'text-rose-600 bg-rose-100' },
  competition: { icon: Target, color: 'text-pink-600 bg-pink-100' },
  other: { icon: Circle, color: 'text-slate-600 bg-slate-100' },
};

function ScoutingInboxCard({ buckets }: { buckets: DashboardData['opportunities']['categories'] }): React.JSX.Element {
  const visibleCategories: OpportunityCategory[] = ['job', 'startup', 'research_paper', 'saas_idea', 'iot'];
  const visible = visibleCategories.map((c) => ({
    category: c,
    total: buckets.find((b) => b.category === c)?.total ?? 0,
    unread: buckets.find((b) => b.category === c)?.unread ?? 0,
  }));

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-5">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-start gap-2">
            <div className="w-8 h-8 rounded-lg bg-surface-2 flex items-center justify-center text-text-secondary">
              <Radar className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-[15px] font-semibold text-text-primary">Scouting Inbox</h3>
              <p className="text-[12px] text-text-tertiary">Opportunities, research & leads.</p>
            </div>
          </div>
          <Link to="/scouting" className="text-[12px] font-medium text-accent-text hover:underline flex items-center gap-0.5">
            View all <span>→</span>
          </Link>
        </div>

        <ul className="space-y-1.5">
          {visible.map((b) => {
            const meta = OPP_ICON[b.category];
            const Icon = meta.icon;
            return (
              <li
                key={b.category}
                className="flex items-center gap-3 px-3 py-2 rounded-lg border border-border-default bg-surface-1 hover:border-border-strong transition cursor-pointer"
              >
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${meta.color}`}>
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0 text-[13px] text-text-primary">{OPP_LABEL[b.category]}</div>
                {b.unread > 0 ? (
                  <Badge tone="emerald" variant="soft">{b.unread} new</Badge>
                ) : (
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-surface-2 text-text-quaternary">none</span>
                )}
              </li>
            );
          })}
        </ul>
        <Link to="/scouting" className="mt-4 inline-flex items-center gap-1 text-[12px] font-medium text-accent-text hover:underline">
          Go to inbox <span>→</span>
        </Link>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Upcoming
// ============================================================================

function fmtMonthDay(iso: string): { month: string; day: string } {
  const d = new Date(iso);
  return {
    month: d.toLocaleString(undefined, { month: 'short' }).toUpperCase(),
    day: String(d.getDate()),
  };
}

function daysUntil(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60_000)));
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}

function UpcomingCard({ items }: { items: Upcoming[] }): React.JSX.Element {
  const visible = items.slice(0, 5);
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-5">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-start gap-2">
            <div className="w-8 h-8 rounded-lg bg-surface-2 flex items-center justify-center text-text-secondary">
              <CalendarDays className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-[15px] font-semibold text-text-primary">Upcoming</h3>
              <p className="text-[12px] text-text-tertiary">Your important dates & deadlines.</p>
            </div>
          </div>
          <Link to="/calendar" className="text-[12px] font-medium text-accent-text hover:underline flex items-center gap-0.5">
            View calendar <span>→</span>
          </Link>
        </div>

        <ul className="space-y-2">
          {visible.length === 0 ? (
            <li className="text-[13px] text-text-tertiary py-2">Nothing on the horizon.</li>
          ) : null}
          {visible.map((u) => {
            const { month, day } = fmtMonthDay(u.occursAt);
            const days = daysUntil(u.occursAt);
            return (
              <li key={u.id} className="flex items-center gap-3 px-3 py-2 rounded-lg border border-border-default bg-surface-1 hover:border-border-strong transition">
                <div className="w-11 h-11 rounded-lg bg-sky-50 border border-sky-100 flex flex-col items-center justify-center shrink-0">
                  <div className="text-[9px] uppercase tracking-wider text-sky-600 font-semibold leading-none">{month}</div>
                  <div className="text-[15px] font-bold text-sky-700 leading-none mt-0.5">{day}</div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] text-text-primary">{u.title}</div>
                  <div className="text-[11px] text-text-tertiary mt-0.5">
                    {u.subtitle ?? fmtDate(u.occursAt)}
                  </div>
                </div>
                <Badge tone={days <= 30 ? 'emerald' : 'amber'} variant="soft">
                  In {days} days
                </Badge>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Quick Capture
// ============================================================================

function QuickCaptureBar({
  onAddTask,
  onAddUpcoming,
  onAddOpportunity,
}: {
  onAddTask: (title: string, category: TaskCategory) => void;
  onAddUpcoming: (title: string, occursAt: string) => void;
  onAddOpportunity: (title: string, category: OpportunityCategory) => void;
}): React.JSX.Element {
  const [text, setText] = React.useState('');
  const [kind, setKind] = React.useState<'task' | 'upcoming' | 'opportunity'>('task');
  const [oppCat, setOppCat] = React.useState<OpportunityCategory>('job');
  const [date, setDate] = React.useState('');

  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    if (kind === 'task') onAddTask(t, 'other');
    else if (kind === 'upcoming' && date) onAddUpcoming(t, new Date(date).toISOString());
    else if (kind === 'opportunity') onAddOpportunity(t, oppCat);
    setText('');
    setDate('');
  };

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-5">
        <div className="flex items-start gap-2 mb-3">
          <div className="w-8 h-8 rounded-lg bg-surface-2 flex items-center justify-center text-text-secondary">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-[15px] font-semibold text-text-primary">Quick Capture</h3>
            <p className="text-[12px] text-text-tertiary">Capture ideas, tasks or anything…</p>
          </div>
        </div>
        <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
          <Input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Write a note or task…"
            className="flex-1 min-w-[180px] text-[13px]"
          />
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as 'task' | 'upcoming' | 'opportunity')}
            className="h-9 rounded-lg border border-border-default bg-surface-1 px-2 text-[12px] text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
          >
            <option value="task">Task</option>
            <option value="upcoming">Upcoming</option>
            <option value="opportunity">Opportunity</option>
          </select>
          {kind === 'upcoming' ? (
            <input
              type="datetime-local"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="h-9 rounded-lg border border-border-default bg-surface-1 px-2 text-[12px] text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
            />
          ) : null}
          {kind === 'opportunity' ? (
            <select
              value={oppCat}
              onChange={(e) => setOppCat(e.target.value as OpportunityCategory)}
              className="h-9 rounded-lg border border-border-default bg-surface-1 px-2 text-[12px] text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
            >
              {(Object.keys(OPP_LABEL) as OpportunityCategory[]).map((c) => (
                <option key={c} value={c}>
                  {OPP_LABEL[c]}
                </option>
              ))}
            </select>
          ) : null}
          <Button type="submit" size="icon" disabled={!text.trim() || (kind === 'upcoming' && !date)}>
            <Plus className="w-4 h-4" />
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Chat with Hermes card
// ============================================================================

function ChatWithHermesCard(): React.JSX.Element {
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-5 flex items-center justify-between gap-4">
        <div>
          <h3 className="text-[15px] font-semibold text-text-primary">Chat with Hermes</h3>
          <p className="text-[12px] text-text-tertiary">Ask anything. Get answers.</p>
        </div>
        <Button variant="outline" size="sm" className="gap-2">
          <MessageCircle className="w-4 h-4" />
          Start chat
        </Button>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Send-to-Hermes action bar
// ============================================================================

function SendToHermesBar({ unsentCount, onSend, sending }: { unsentCount: number; onSend: () => void; sending: boolean }): React.JSX.Element | null {
  if (unsentCount === 0) return null;
  return (
    <Card className="border-amber-200 bg-amber-50 overflow-hidden">
      <CardContent className="p-4 flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-amber-100 text-amber-600 flex items-center justify-center shrink-0">
          <Send className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-text-primary">
            {unsentCount} {unsentCount === 1 ? 'task' : 'tasks'} ready to send to Hermes
          </div>
          <div className="text-[12px] text-text-tertiary">
            Hermes will be notified of your new tasks in a single dispatch.
          </div>
        </div>
        <Button onClick={onSend} disabled={sending} size="sm">
          {sending ? 'Sending…' : 'Send to Hermes'}
        </Button>
      </CardContent>
    </Card>
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

  const createTaskMut = useMutation({
    mutationFn: (input: { title: string; category: TaskCategory }) => api.createTask(input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['dashboard'] }),
  });
  const updateTaskMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: TaskStatus }) => api.updateTask(id, { status }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['dashboard'] }),
  });
  const sendBatchMut = useMutation({
    mutationFn: (taskIds: string[]) => api.sendTasksToHermes(taskIds),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['dashboard'] }),
  });
  const createUpcomingMut = useMutation({
    mutationFn: (input: { title: string; occursAt: string }) => api.createUpcoming({ title: input.title, occursAt: input.occursAt }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['dashboard'] }),
  });
  const createOppMut = useMutation({
    mutationFn: (input: { title: string; category: OpportunityCategory }) =>
      api.createObject({ type: 'opportunity', title: input.title, status: 'open', body: { kind: input.category } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['dashboard'] }),
  });

  const unsentTaskIds = (data?.tasks.today ?? []).filter((t) => t.sentToHermesAt === null).map((t) => t.id);
  const handleSendToHermes = (): void => { if (unsentTaskIds.length === 0) return; sendBatchMut.mutate(unsentTaskIds); };
  const handleAddTask = (title: string, category: TaskCategory): void => createTaskMut.mutate({ title, category });
  const handleAddUpcoming = (title: string, occursAt: string): void => createUpcomingMut.mutate({ title, occursAt });
  const handleAddOpportunity = (title: string, category: OpportunityCategory): void => createOppMut.mutate({ title, category });
  const handleStatusChange = (id: string, status: TaskStatus): void => updateTaskMut.mutate({ id, status });

  const userName = user?.displayName ?? 'there';
  void serverUrl;

  const tasks = data?.tasks.today ?? [];
  const upcoming = [
    ...(data?.upcoming.next7Days ?? []),
    ...(data?.upcoming.next30Days ?? []),
    ...(data?.upcoming.next90Days ?? []),
  ];

  return (
    <div className="min-h-screen flex bg-page text-text-primary">
      <Sidebar activePath="/" className="hidden lg:flex" />
      <main className="flex-1 p-6 lg:p-8 max-w-[1280px] mx-auto w-full">
        <Header userName={userName} />

        {isLoading ? (
          <div className="text-center text-text-tertiary py-12">Loading dashboard…</div>
        ) : error ? (
          <div className="text-center text-status-failed py-12">
            Failed to load dashboard. {error instanceof Error ? error.message : 'Unknown error'}
          </div>
        ) : data ? (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
            <div className="xl:col-span-2 space-y-5">
              <TodaysMissionCard tasks={tasks} onAddTask={handleAddTask} onStatusChange={handleStatusChange} />
              <SendToHermesBar unsentCount={unsentTaskIds.length} onSend={handleSendToHermes} sending={sendBatchMut.isPending} />
              <HermesFeedCard events={data.hermesFeed.events} />
              <KnowledgeGraphCard data={data.graph} />
            </div>
            <div className="space-y-5">
              <UpcomingCard items={upcoming} />
              <ScoutingInboxCard buckets={data.opportunities.categories} />
              <QuickCaptureBar onAddTask={handleAddTask} onAddUpcoming={handleAddUpcoming} onAddOpportunity={handleAddOpportunity} />
              <ChatWithHermesCard />
            </div>
          </div>
        ) : null}

        <footer className="mt-10 text-center text-[11px] text-text-quaternary">
          HermieOS · {new Date().getFullYear()} · Dashboard v3
        </footer>
      </main>
    </div>
  );
}
