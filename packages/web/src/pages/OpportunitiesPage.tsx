import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Compass, Loader2, Search, X } from 'lucide-react';
import { api, type ObjectSummary, type OpportunityCategory } from '../api';
import { useServer } from '../server';
import { Sidebar } from '../components/Sidebar';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { FeedbackButtons } from '../components/FeedbackButtons';
import { cn } from '../lib/utils';

const OPP_LABEL: Record<OpportunityCategory, string> = {
  job: 'Jobs',
  startup: 'Startups',
  research_paper: 'Papers',
  saas_idea: 'SaaS ideas',
  iot: 'IoT',
  grant: 'Grants',
  competition: 'Competitions',
  other: 'Other',
};

const OPP_TONE: Record<string, string> = {
  job: 'bg-sky-100 text-sky-700',
  startup: 'bg-emerald-100 text-emerald-700',
  research_paper: 'bg-purple-100 text-purple-700',
  saas_idea: 'bg-amber-100 text-amber-700',
  iot: 'bg-rose-100 text-rose-700',
  grant: 'bg-teal-100 text-teal-700',
  competition: 'bg-indigo-100 text-indigo-700',
  other: 'bg-slate-100 text-slate-600',
};

const STATUS_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'archived', label: 'Archived' },
] as const;

function oppKind(o: ObjectSummary): string {
  const kind = (o as ObjectSummary & { body?: Record<string, unknown> }).body?.kind;
  return typeof kind === 'string' ? kind : 'other';
}

export function OpportunitiesPage(): React.JSX.Element {
  const { connected } = useServer();
  const qc = useQueryClient();
  const [kindFilter, setKindFilter] = React.useState<string>('all');
  const [statusFilter, setStatusFilter] = React.useState<(typeof STATUS_FILTERS)[number]['value']>('all');
  const [query, setQuery] = React.useState('');

  const oppsQ = useQuery({
    queryKey: ['opportunities', 'all'],
    queryFn: async () => {
      // Fetch all opportunity objects, walking the cursor. Cap at 1000
      // so a pathological dataset can't hammer the API.
      const out: ObjectSummary[] = [];
      let cursor: string | undefined;
      for (let i = 0; i < 20; i++) {
        const res = await api.listObjects({ type: 'opportunity', limit: 50, cursor });
        out.push(...res.objects);
        if (!res.nextCursor) break;
        cursor = res.nextCursor;
      }
      // Newest first — the cursor walk returns priority-sorted pages.
      out.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      return out;
    },
    enabled: connected,
    refetchInterval: 60_000,
  });

  const kinds = React.useMemo(() => {
    const set = new Set<string>();
    for (const o of oppsQ.data ?? []) set.add(oppKind(o));
    return Array.from(set).sort();
  }, [oppsQ.data]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return (oppsQ.data ?? []).filter((o) => {
      if (kindFilter !== 'all' && oppKind(o) !== kindFilter) return false;
      if (statusFilter === 'open' && o.status !== 'open') return false;
      if (statusFilter === 'archived' && o.status !== 'archived') return false;
      if (q) {
        const title = o.title.toLowerCase();
        const summary = (o.summary ?? '').toLowerCase();
        if (!title.includes(q) && !summary.includes(q)) return false;
      }
      return true;
    });
  }, [oppsQ.data, kindFilter, statusFilter, query]);

  const openCount = React.useMemo(
    () => (oppsQ.data ?? []).filter((o) => o.status === 'open').length,
    [oppsQ.data],
  );

  const invalidate = (): void => {
    void qc.invalidateQueries({ queryKey: ['opportunities'] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
    void qc.invalidateQueries({ queryKey: ['findings-for-buckets'] });
  };

  return (
    <div className="min-h-screen flex bg-page text-text-primary">
      <Sidebar activePath="/opportunities" className="hidden lg:flex" />
      <main className="flex-1 p-6 lg:p-8 max-w-[1100px] mx-auto w-full">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/15 text-emerald-600 flex items-center justify-center">
            <Compass className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-[18px] font-semibold text-text-primary">Opportunities</h1>
            <p className="text-[12px] text-text-tertiary">
              Everything Hermes has surfaced for you. {openCount} open.
            </p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2 mt-4 mb-4">
          <div className="flex items-center gap-1 flex-wrap">
            <FilterPill active={kindFilter === 'all'} onClick={() => setKindFilter('all')} label={`All (${oppsQ.data?.length ?? 0})`} />
            {kinds.map((k) => {
              const count = (oppsQ.data ?? []).filter((o) => oppKind(o) === k).length;
              return <FilterPill key={k} active={kindFilter === k} onClick={() => setKindFilter(k)} label={`${OPP_LABEL[k as OpportunityCategory] ?? k} (${count})`} />;
            })}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-text-quaternary" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search…"
                className="w-44 h-8 pl-8 text-[12px]"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as (typeof STATUS_FILTERS)[number]['value'])}
              className="h-8 px-2 rounded-md border border-border-default bg-surface-0 text-[12px] text-text-primary"
              aria-label="Status filter"
            >
              {STATUS_FILTERS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* List */}
        {oppsQ.isLoading ? (
          <div className="flex items-center justify-center py-16 text-text-tertiary">
            <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading opportunities…
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-[13px] text-text-tertiary py-16 text-center">
            {query || kindFilter !== 'all' || statusFilter !== 'all'
              ? 'No opportunities match these filters.'
              : 'No opportunities yet. Hermes will surface them here as scouts run.'}
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((o) => (
              <div
                key={o.id}
                className={cn(
                  'flex items-center gap-3 px-4 py-3 rounded-xl border bg-surface-0 transition',
                  o.status === 'archived' ? 'border-border-default opacity-60' : 'border-border-default hover:border-border-strong',
                )}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link
                      to={`/objects/${o.id}`}
                      className="text-[13px] font-medium text-text-primary hover:text-accent-text truncate"
                    >
                      {o.title}
                    </Link>
                    <span className={cn('text-[10px] font-medium px-2 py-0.5 rounded-full', OPP_TONE[oppKind(o)] ?? OPP_TONE.other ?? '')}>
                      {OPP_LABEL[oppKind(o) as OpportunityCategory] ?? oppKind(o)}
                    </span>
                    {o.status === 'open' ? (
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">new</span>
                    ) : (
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">archived</span>
                    )}
                  </div>
                  {o.summary ? (
                    <p className="text-[12px] text-text-tertiary mt-1 line-clamp-2">{o.summary}</p>
                  ) : null}
                  <div className="text-[11px] text-text-quaternary mt-1">
                    {new Date(o.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · priority {o.priority}
                  </div>
                </div>
                <FeedbackButtons
                  objectId={o.id}
                  compact
                  kinds={['like', 'save', 'ignore', 'archive']}
                  onAction={() => invalidate()}
                />
              </div>
            ))}
          </div>
        )}

        {query || kindFilter !== 'all' || statusFilter !== 'all' ? (
          <div className="flex justify-end mt-4">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setQuery('');
                setKindFilter('all');
                setStatusFilter('all');
              }}
            >
              <X className="w-3 h-3 mr-1" /> Clear filters
            </Button>
          </div>
        ) : null}
      </main>
    </div>
  );
}

function FilterPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'px-2.5 py-1 rounded-full text-[11px] font-medium border transition',
        active
          ? 'bg-accent text-accent-fg border-accent'
          : 'bg-surface-0 text-text-secondary border-border-default hover:border-border-strong hover:text-text-primary',
      )}
    >
      {label}
    </button>
  );
}
