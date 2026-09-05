/**
 * Hermes Log — the system timeline rendered as a terminal mission log.
 *
 * Every event Hermes has produced for this user, in order, filterable
 * by kind. Log entries are pure: mono type, absolute timestamps, kind
 * tags, nothing decorative. The dark console panel is the page's one
 * object, like the operative file on Scouting.
 *
 * Feed events are produced by tools (create_object, create_task, etc.)
 * and by the scheduler. Each event has a kind and a payload that the
 * UI can render. Kinds are documented in @hermieos/db.
 */
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ChevronDown } from 'lucide-react';
import { api, type FeedEvent } from '../api';
import { useServer } from '../server';
import { cn } from '../lib/utils';

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

const KIND_TAG: Record<string, { label: string; cls: string }> = {
  opportunity_discovered: { label: 'Opportunity', cls: 'text-emerald-400 border-emerald-400/50' },
  research_completed: { label: 'Research', cls: 'text-violet-400 border-violet-400/50' },
  notification: { label: 'Notification', cls: 'text-amber-400 border-amber-400/50' },
  task_finished: { label: 'Task', cls: 'text-sky-400 border-sky-400/50' },
  priority_changed: { label: 'Priority', cls: 'text-rose-400 border-rose-400/50' },
  object_created: { label: 'Created', cls: 'text-p5-muted border-p5-line' },
  object_archived: { label: 'Archived', cls: 'text-p5-muted border-p5-line' },
  subscription_update: { label: 'Subscription', cls: 'text-indigo-400 border-indigo-400/50' },
  recommendation_changed: { label: 'Rec', cls: 'text-rose-400 border-rose-400/50' },
  project_updated: { label: 'Project', cls: 'text-sky-400 border-sky-400/50' },
  decision_requested: { label: 'Decision', cls: 'text-amber-400 border-amber-400/50' },
  decision_resolved: { label: 'Resolved', cls: 'text-emerald-400 border-emerald-400/50' },
};
const KIND_TAG_DEFAULT: { label: string; cls: string } = { label: 'Event', cls: 'text-p5-muted border-p5-line' };

function kindMeta(kind: string) {
  return KIND_TAG[kind] ?? KIND_TAG_DEFAULT;
}

function logTime(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '--/-- --:--';
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${mm}/${dd} ${hh}:${mi}`;
}

function LogEntry({ event, divider }: { event: FeedEvent; divider: boolean }) {
  const meta = kindMeta(event.kind);
  const objectId = event.objectId;
  return (
    <li className={cn('flex flex-col sm:flex-row gap-1.5 sm:gap-4 px-4 sm:px-5 py-3.5', divider && 'border-b border-white/[0.06]')}>
      <div className="flex shrink-0 items-center gap-2">
        <span className="sm:w-[88px] sm:pt-0.5 font-mono text-[11px] tabular-nums text-p5-muted">
          {logTime(event.createdAt)}
        </span>
        <span className={cn('shrink-0 self-start border px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.14em]', meta.cls)}>
          {meta.label}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-mono text-[14px] sm:text-[13px] leading-snug text-p5-text">
          {objectId ? (
            <a href={`#/objects/${objectId}`} className="transition hover:text-accent hover:underline">
              {event.title}
            </a>
          ) : (
            event.title
          )}
        </div>
        {event.body ? (
          <div className="mt-1 line-clamp-2 font-mono text-[11px] leading-relaxed text-p5-muted">{event.body}</div>
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

  const events = data?.events ?? [];
  const hasMore = data?.hasMore ?? false;
  const counts = (() => {
    const m = new Map<string, number>();
    for (const e of events) m.set(e.kind, (m.get(e.kind) ?? 0) + 1);
    return m;
  })();
  const kindsInView = counts.size;

  return (
    <div className="flex bg-p5-cream text-p5-dark flex-1 min-w-0 min-h-0">

      <main className="flex-1 min-w-0 min-h-0 overflow-y-auto px-6 py-8 md:px-10 lg:px-10 lg:py-10">
        <div className="mx-auto max-w-[1128px]">

          {/* ─── Hero ─── */}
          <header className="relative min-h-[148px]">
            <div className="min-w-0 pt-1">
              <div className="p5-kicker text-p5-dark">SYSTEM TIMELINE</div>
              <h1 className="mt-3">
                <span className="relative inline-block font-p5-serif text-[clamp(40px,11vw,80px)] leading-[0.88] text-p5-dark">
                  HERMES LOG
                  <span className="absolute -bottom-2.5 left-0 h-[6px] w-full bg-accent" />
                </span>
              </h1>
              <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-1 font-mono text-[11px] tracking-[0.14em] text-p5-dark-muted">
                <span><span className="font-black text-accent">{String(events.length).padStart(2, '0')}</span> ENTRIES</span>
                <span><span className="font-black text-p5-dark">{String(kindsInView).padStart(2, '0')}</span> KINDS</span>
                <span>RECORDED BY HERMES</span>
              </div>
            </div>
          </header>

          {/* ─── Filter chips ─── */}
          <div className="mt-7 mb-4 flex gap-1.5 overflow-x-auto sm:flex-wrap pb-1 -mx-1 px-1">
            {FEED_KINDS.map((k) => {
              const label = k === 'all' ? 'All' : (kindMeta(k).label);
              const count = k === 'all' ? events.length : (counts.get(k) ?? 0);
              const active = filter === k;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => setFilter(k)}
                  className={cn(
                    'px-3 py-1.5 min-h-[44px] sm:min-h-0 inline-flex shrink-0 items-center font-mono text-[10px] font-bold uppercase tracking-[0.12em] border transition',
                    active
                      ? 'border-accent bg-accent text-white'
                      : 'border-p5-dark-line text-p5-dark-muted hover:border-p5-dark hover:text-p5-dark',
                  )}
                >
                  <span>{label}</span>
                  <span className={cn('ml-1.5 tabular-nums', active ? 'text-white/70' : 'text-p5-dark-muted/70')}>{count}</span>
                </button>
              );
            })}
          </div>

          {/* ─── The log console ─── */}
          <div className="overflow-hidden border border-white/[0.08] bg-p5-ink-2 p5-anim-slide">
            <div className="flex items-center gap-3 border-b border-white/10 px-5 py-3">
              <span className="h-2.5 w-2.5 animate-pulse bg-accent" />
              <span className="font-mono text-[11px] font-bold tracking-[0.2em] text-p5-text">HERMES.LOG</span>
              <span className="hidden font-mono text-[10px] tracking-[0.12em] text-p5-muted sm:inline">
                {String(events.length).padStart(2, '0')} ENTRIES
              </span>
              <span className="ml-auto flex items-center gap-1.5 font-mono text-[10px] tracking-[0.14em] text-p5-muted">
                {filter === 'all' ? 'ALL KINDS' : kindMeta(filter).label.toUpperCase()}
                <ChevronDown className="h-3 w-3" />
              </span>
            </div>

            {!connected ? (
              <div className="px-6 py-16 text-center font-mono text-[12px] tracking-widest text-p5-muted">CONNECTING TO SERVER…</div>
            ) : isLoading ? (
              <div className="px-6 py-16 text-center font-mono text-[12px] tracking-widest text-p5-muted">READING THE LOG…</div>
            ) : error ? (
              <div className="px-6 py-16 text-center font-mono text-[12px] tracking-widest text-accent">
                FAILED TO READ THE LOG.
              </div>
            ) : events.length === 0 ? (
              <div className="px-6 py-16 text-center">
                <div className="font-mono text-[14px] font-bold tracking-[0.2em] text-p5-text">HERMES IS QUIET.</div>
                <div className="mt-2 font-mono text-[10px] tracking-[0.14em] text-p5-muted">
                  THE LOG IS EMPTY — NOTHING TO REPORT YET.
                </div>
              </div>
            ) : (
              <>
                <ul>
                  {events.map((e, i) => (
                    <LogEntry key={e.id} event={e} divider={i < events.length - 1} />
                  ))}
                </ul>
                <div className="border-t border-white/10 px-5 py-4 text-center">
                  {hasMore ? (
                    <button
                      type="button"
                      onClick={() => setLimit((l) => l + 50)}
                      disabled={isFetching}
                      className="inline-flex items-center justify-center gap-2 border border-white/25 px-4 py-2 min-h-[48px] w-full sm:w-auto font-mono text-[10px] font-bold tracking-[0.16em] text-p5-text transition hover:border-accent hover:text-accent disabled:opacity-40"
                    >
                      {isFetching ? 'READING…' : 'LOAD MORE ENTRIES'}
                      <ArrowRight className="h-3 w-3" />
                    </button>
                  ) : (
                    <span className="font-mono text-[10px] tracking-[0.16em] text-p5-muted">— END OF LOG —</span>
                  )}
                </div>
              </>
            )}
          </div>

          <footer className="mt-12 text-center font-mono text-[10px] tracking-[0.25em] text-p5-dark-muted">
            EVERY LINE IS A DECISION HERMES MADE FOR YOU
          </footer>
        </div>
      </main>
    </div>
  );
}
