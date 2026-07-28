/**
 * Hermes Feed — full chronological system timeline.
 *
 * The dashboard shows a 3-event preview. This page is the "View all"
 * destination: every event Hermes has produced for this user,
 * filterable by kind, with pagination.
 *
 * Feed events are produced by tools (create_object, create_task, etc.)
 * and by the scheduler. Each event has a kind (opportunity_discovered,
 * research_completed, notification, ...) and a payload that the UI
 * can render. The kinds are documented in @hermieos/db.
 */
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Briefcase,
  FileText,
  Calendar,
  CheckCircle2,
  TrendingUp,
  Sparkles,
  Archive,
  ArrowRight,
  ArrowDown,
  Inbox,
  ArchiveRestore,
  ListTodo,
} from 'lucide-react';
import { api, type FeedEvent } from '../api';
import { useServer } from '../server';
import { Sidebar } from '../components/Sidebar';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Loading, PageLoader } from '../components/Loading';
import { cn, formatRelative } from '../lib/utils';

type IconComponent = React.ComponentType<{ className?: string }>;

const FEED_KINDS = [
  'all',
  'opportunity_discovered',
  'research_completed',
  'task_finished',
  'notification',
  'object_created',
  'object_archived',
  'priority_changed',
  'subscription_update',
] as const;
type FeedKindFilter = (typeof FEED_KINDS)[number];

const FEED_ICON: Record<string, { icon: IconComponent; color: string; label: string }> = {
  opportunity_discovered: { icon: Briefcase, color: 'text-emerald-600 bg-emerald-100', label: 'Opportunity' },
  research_completed: { icon: FileText, color: 'text-purple-600 bg-purple-100', label: 'Research' },
  notification: { icon: Calendar, color: 'text-amber-600 bg-amber-100', label: 'Notification' },
  task_finished: { icon: CheckCircle2, color: 'text-sky-600 bg-sky-100', label: 'Task' },
  priority_changed: { icon: TrendingUp, color: 'text-rose-600 bg-rose-100', label: 'Priority' },
  object_created: { icon: Sparkles, color: 'text-slate-600 bg-slate-100', label: 'Created' },
  object_archived: { icon: Archive, color: 'text-slate-500 bg-slate-100', label: 'Archived' },
  subscription_update: { icon: ListTodo, color: 'text-indigo-600 bg-indigo-100', label: 'Subscription' },
  recommendation_changed: { icon: ArrowRight, color: 'text-rose-600 bg-rose-100', label: 'Rec' },
  project_updated: { icon: ArrowDown, color: 'text-sky-600 bg-sky-100', label: 'Project' },
  decision_requested: { icon: Inbox, color: 'text-amber-600 bg-amber-100', label: 'Decision' },
  decision_resolved: { icon: ArchiveRestore, color: 'text-emerald-600 bg-emerald-100', label: 'Resolved' },
};
const FEED_ICON_DEFAULT = { icon: Sparkles, color: 'text-slate-600 bg-slate-100', label: 'Event' };

function eventMeta(kind: string) {
  return FEED_ICON[kind] ?? FEED_ICON_DEFAULT;
}

function timeAgo(iso: string): string {
  return formatRelative(iso);
}

function FeedEventItem({ event, divider }: { event: FeedEvent; divider: boolean }) {
  const meta = eventMeta(event.kind);
  const Icon = meta.icon;
  const objectId = event.objectId;
  return (
    <li
      className={cn(
        'relative flex items-start gap-4 px-2 py-3',
        divider && 'border-b border-border-default',
      )}
    >
      <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center shrink-0', meta.color)}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge tone="slate" variant="outline" className="uppercase tracking-wide text-[10px]">
            {meta.label}
          </Badge>
          <span className="text-[11px] text-text-quaternary">{timeAgo(event.createdAt)}</span>
        </div>
        <div className="text-[14px] text-text-primary mt-1 leading-snug">
          {objectId ? (
            <a
              href={`#/objects/${objectId}`}
              className="hover:underline hover:text-accent-text"
            >
              {event.title}
            </a>
          ) : (
            event.title
          )}
        </div>
        {event.body ? (
          <div className="text-[12px] text-text-tertiary mt-1 line-clamp-2">{event.body}</div>
        ) : null}
      </div>
    </li>
  );
}

export function FeedPage(): React.JSX.Element {
  const { connected } = useServer();
  const [filter, setFilter] = React.useState<FeedKindFilter>('all');
  const [limit, setLimit] = React.useState(50);
  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: ['feed', filter, limit],
    queryFn: () =>
      api.feed({
        limit,
        kinds: filter === 'all' ? undefined : filter,
      }),
    enabled: connected,
  });

  if (!connected) {
    return <PageLoader text="Connecting to server…" />;
  }
  if (isLoading) {
    return <PageLoader text="Loading feed…" />;
  }
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-page text-status-failed">
        Failed to load feed: {error instanceof Error ? error.message : 'Unknown error'}
      </div>
    );
  }

  const events = data?.events ?? [];
  const hasMore = data?.hasMore ?? false;
  const counts = (() => {
    const m = new Map<string, number>();
    for (const e of events) m.set(e.kind, (m.get(e.kind) ?? 0) + 1);
    return m;
  })();

  return (
    <div className="min-h-screen flex bg-page text-text-primary">
      <Sidebar activePath="/feed" className="hidden lg:flex" />
      <div className="flex-1 min-w-0 max-w-3xl mx-auto p-6 lg:p-10">
        <header className="mb-6">
          <h1 className="text-[26px] font-semibold tracking-tight">Hermes Feed</h1>
          <p className="text-[13px] text-text-tertiary mt-1">
            Everything Hermes has done across your Personal OS.
          </p>
        </header>

        {/* Filter chips */}
        <div className="mb-5 flex items-center gap-2 flex-wrap">
          {FEED_KINDS.map((k) => {
            const label = k === 'all' ? 'All' : (FEED_ICON[k]?.label ?? k);
            const count = k === 'all' ? events.length : (counts.get(k) ?? 0);
            const active = filter === k;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setFilter(k)}
                className={cn(
                  'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[12px] font-medium border transition',
                  active
                    ? 'bg-accent-soft border-accent text-accent-text'
                    : 'bg-surface-0 border-border-default text-text-secondary hover:border-border-strong',
                )}
              >
                <span>{label}</span>
                {count > 0 ? (
                  <span className={cn('text-[10px] tabular-nums', active ? 'text-accent-text/70' : 'text-text-quaternary')}>{count}</span>
                ) : null}
              </button>
            );
          })}
        </div>

        <Card>
          <CardContent className="p-2">
            {events.length === 0 ? (
              <div className="px-4 py-16 text-center">
                <Loading text="Hermes is quiet. For now." />
              </div>
            ) : (
              <ul>
                {events.map((e, i) => (
                  <FeedEventItem key={e.id} event={e} divider={i < events.length - 1} />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <div className="mt-4 flex items-center justify-center">
          {hasMore ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setLimit((l) => l + 50)}
              disabled={isFetching}
            >
              {isFetching ? 'Loading…' : 'Load more'}
            </Button>
          ) : events.length > 0 ? (
            <p className="text-[12px] text-text-quaternary">End of feed.</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
