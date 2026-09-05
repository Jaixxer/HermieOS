import { useParams, Link, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  ExternalLink,
  Tag,
  Calendar,
  Rss,
  Layers,
  Lightbulb,
  History,
  Link2,
  Pencil,
  ChevronDown,
  ChevronRight,
  Star,
  DollarSign,
  Code,
  Hash,
  Code2,
  MessageSquare,
} from 'lucide-react';
import { api } from '../api';
import { useScouts, useCategories } from '../hooks/data';
import { formatRelative, cn } from '../lib/utils';
import { FeedbackButtons } from '../components/FeedbackButtons';

/**
 * Object desk — one finding, fully unpacked. Editorial frame with the
 * nav rail, serif title, red rule, hard-edged panels, mono metadata.
 * All behavior preserved: overview / timeline / revisions / related.
 */

type Tab = 'overview' | 'timeline' | 'revisions' | 'related';

// Hard-edged panel replacing the old rounded Card.
function Panel({ children, className }: { children: React.ReactNode; className?: string }): React.JSX.Element {
  return (
    <section className={cn('border-2 border-black/15 bg-p5-panel p-5', className)}>
      {children}
    </section>
  );
}

function PanelHead({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="p5-kicker text-p5-dark-muted mb-3">{children}</div>;
}

// Bordered mono chip replacing the old Badge.
function Chip({
  children,
  tone = 'slate',
}: {
  children: React.ReactNode;
  tone?: 'emerald' | 'sky' | 'amber' | 'purple' | 'rose' | 'slate';
}): React.JSX.Element {
  const cls: Record<string, string> = {
    emerald: 'border-emerald-600/50 text-emerald-700',
    sky: 'border-sky-600/50 text-sky-700',
    amber: 'border-amber-500/60 text-amber-600',
    purple: 'border-purple-600/50 text-purple-700',
    rose: 'border-rose-600/50 text-rose-700',
    slate: 'border-black/20 text-p5-dark-muted',
  };
  return (
    <span className={cn('inline-flex items-center border px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.14em]', cls[tone])}>
      {children}
    </span>
  );
}

export function ObjectDetailPage(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  const [tab, setTab] = useState<Tab>('overview');
  const qc = useQueryClient();
  const nav = useNavigate();

  if (!id) return <NotFound />;

  const { data, isLoading, error } = useQuery({
    queryKey: ['object', id],
    queryFn: () => api.object(id),
  });

  return (
    <div className="flex bg-p5-cream text-p5-dark flex-1 min-w-0 min-h-0">

      <main className="flex-1 min-w-0 min-h-0 overflow-y-auto px-6 py-8 md:px-10 lg:px-10 lg:py-10">
        <div className="mx-auto max-w-[1128px]">
          {isLoading ? (
            <div className="py-24 text-center font-mono text-[12px] tracking-widest text-p5-dark-muted">LOADING THE OBJECT…</div>
          ) : error || !data ? (
            <NotFound />
          ) : (
            <>
              <ObjectHeader obj={data.object} onBack={() => nav(-1)} />

              {/* Tabs */}
              <div className="mt-7 flex gap-1 border-b border-black/10 overflow-x-auto">
                {(['overview', 'timeline', 'revisions', 'related'] as Tab[]).map((t) => {
                  const meta: Record<Tab, { label: string; icon: React.ElementType; count?: number }> = {
                    overview: { label: 'Overview', icon: Lightbulb },
                    timeline: { label: 'Timeline', icon: History },
                    revisions: { label: 'Revisions', icon: Pencil },
                    related: { label: 'Related', icon: Link2, count: data.object.related.length },
                  };
                  const M = meta[t];
                  const Icon = M.icon;
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTab(t)}
                      className={cn(
                        'flex shrink-0 items-center gap-2 px-4 pb-2.5 pt-1 min-h-[44px] sm:min-h-0 text-[11px] font-black tracking-[0.14em] uppercase transition',
                        tab === t
                          ? 'border-b-2 border-accent text-p5-dark'
                          : 'border-b-2 border-transparent text-p5-dark-muted hover:text-p5-dark',
                      )}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {M.label}
                      {M.count !== undefined && M.count > 0 ? (
                        <span className="text-[10px] text-p5-dark-muted">({M.count})</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>

              <div className="py-6">
                {tab === 'overview' ? <OverviewTab obj={data.object} /> : null}
                {tab === 'timeline' ? <TimelineTab objectId={id} /> : null}
                {tab === 'revisions' ? <RevisionsTab objectId={id} qc={qc} /> : null}
                {tab === 'related' ? <RelatedTab items={data.object.related} /> : null}
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function NotFound(): React.JSX.Element {
  return (
    <div className="space-y-2">
      <p className="font-p5-serif text-[24px] text-p5-dark">OBJECT NOT FOUND.</p>
      <Link to="/" className="text-[12px] font-black tracking-[0.12em] text-accent hover:underline">
        GO HOME
      </Link>
    </div>
  );
}

function ObjectHeader({
  obj,
  onBack,
}: {
  obj: import('../api').ObjectDetail;
  onBack: () => void;
}): React.JSX.Element {
  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="mb-4 inline-flex items-center gap-1.5 font-mono text-[11px] tracking-[0.12em] text-p5-dark-muted transition hover:text-p5-dark"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> BACK
      </button>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <TypeBadge type={obj.type} />
            <StatusBadge status={obj.status} />
            {obj.archivedAt ? <Chip tone="rose">Archived</Chip> : null}
            {obj.priority >= 4 ? <Chip tone="amber">Priority {obj.priority}</Chip> : null}
          </div>
          <h1 className="relative inline-block font-p5-serif text-[clamp(28px,3.4vw,44px)] leading-[0.95] text-p5-dark">
            {obj.title}
            <span className="absolute -bottom-2 left-0 h-[5px] w-full bg-accent" />
          </h1>
          {obj.summary ? (
            <p className="mt-4 max-w-3xl text-[14px] leading-relaxed text-p5-dark-muted">{obj.summary}</p>
          ) : null}
          {obj.tags.length > 0 ? (
            <div className="mt-4 flex flex-wrap items-center gap-1.5">
              <Tag className="h-3.5 w-3.5 text-p5-dark-muted" />
              {obj.tags.map((t) => (
                <Chip key={t}>{t}</Chip>
              ))}
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-row sm:flex-col sm:items-end gap-2">
          <FeedbackButtons objectId={obj.id} />
          <Link
            to={`/objects/${obj.id}/discuss`}
            className="inline-flex items-center justify-center gap-1.5 bg-accent px-4 py-2 min-h-[44px] sm:min-h-0 flex-1 sm:flex-none text-[11px] font-black tracking-[0.12em] text-white transition hover:bg-accent-hover"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            DISCUSS
          </Link>
        </div>
      </div>
    </div>
  );
}

function TypeBadge({ type }: { type: string }): React.JSX.Element {
  const meta: Record<string, { label: string; tone: 'emerald' | 'sky' | 'amber' | 'purple' | 'rose' | 'slate' }> = {
    opportunity: { label: 'Opportunity', tone: 'emerald' },
    research: { label: 'Research', tone: 'sky' },
    discovery: { label: 'Discovery', tone: 'amber' },
    project: { label: 'Project', tone: 'purple' },
    task: { label: 'Task', tone: 'slate' },
  };
  const m = meta[type] ?? { label: type, tone: 'slate' as const };
  return <Chip tone={m.tone}>{m.label}</Chip>;
}

function StatusBadge({ status }: { status: string }): React.JSX.Element {
  const meta: Record<string, 'emerald' | 'amber' | 'slate' | 'rose'> = {
    open: 'emerald',
    active: 'emerald',
    completed: 'emerald',
    pending: 'amber',
    archived: 'slate',
    failed: 'rose',
  };
  return <Chip tone={meta[status] ?? 'slate'}>{status}</Chip>;
}

// ============================================================================
// Overview Tab
// ============================================================================

function OverviewTab({ obj }: { obj: import('../api').ObjectDetail }): React.JSX.Element {
  if (obj.type === 'opportunity') {
    return <OpportunityOverview obj={obj} />;
  }
  return <GenericOverview obj={obj} />;
}

function OpportunityOverview({ obj }: { obj: import('../api').ObjectDetail }): React.JSX.Element {
  const body = obj.body as {
    url?: string;
    source?: string;
    kind?: string;
    target?: string;
    summary?: string;
    subscriptionId?: string;
    category_id?: string;
    stars?: number;
    cost_estimate?: string;
    language?: string;
    topics?: string[];
    license?: string;
    author?: string;
    publishedDate?: string;
    [key: string]: unknown;
  };

  const url = body.url;
  const source = body.source;
  const kind = body.kind;
  const subId = body.subscriptionId;
  const stars = body.stars;
  const cost = body.cost_estimate;
  const language = body.language;
  const license = body.license;
  const author = body.author;
  const published = body.publishedDate;

  const knownKeys = new Set([
    'url', 'source', 'target', 'kind', 'summary', 'subscriptionId',
    'category_id', 'stars', 'cost_estimate', 'language', 'topics',
    'license', 'author', 'publishedDate',
  ]);
  const extraEntries = Object.entries(body).filter(([k]) => !knownKeys.has(k));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-5">
        {obj.summary ? (
          <Panel>
            <p className="text-[15px] leading-relaxed text-p5-dark">{obj.summary}</p>
          </Panel>
        ) : null}

        <Panel>
          <PanelHead>Details</PanelHead>
          <div className="space-y-3">
            {url ? (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 break-all text-[14px] font-bold text-accent hover:underline"
              >
                <ExternalLink className="h-4 w-4 shrink-0" />
                {url}
              </a>
            ) : null}
            <DetailRow icon={Rss} label="Source" value={source} mono />
            <DetailRow icon={Layers} label="Kind" value={kind} />
            {stars !== undefined && stars !== null ? (
              <DetailRow icon={Star} label="Stars" value={stars.toLocaleString()} />
            ) : null}
            {language ? <DetailRow icon={Code2} label="Language" value={language} /> : null}
            {license ? <DetailRow icon={Code} label="License" value={license} /> : null}
            {author ? <DetailRow icon={Hash} label="Author" value={author} /> : null}
            {cost ? <DetailRow icon={DollarSign} label="Cost" value={cost} /> : null}
            {published ? (
              <DetailRow icon={Calendar} label="Published" value={published} />
            ) : null}
            <DetailRow icon={Calendar} label="Discovered" value={formatRelative(obj.createdAt)} />
            {body.summary && obj.summary !== body.summary ? (
              <DetailRow icon={Lightbulb} label="Note" value={body.summary} />
            ) : null}
          </div>
        </Panel>

        {extraEntries.length > 0 ? (
          <RawBodyCard entries={extraEntries} />
        ) : null}

        {obj.tags.length > 0 ? (
          <Panel>
            <PanelHead>Tags</PanelHead>
            <div className="flex flex-wrap gap-1.5">
              {obj.tags.map((t) => (
                <Chip key={t}>{t}</Chip>
              ))}
            </div>
          </Panel>
        ) : null}
      </div>

      <div className="space-y-5">
        {subId ? <ProvenanceCard subscriptionId={subId} /> : null}
        <MetadataCard obj={obj} />
      </div>
    </div>
  );
}

function RawBodyCard({ entries }: { entries: Array<[string, unknown]> }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <Panel className="!p-0 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-5 py-3 text-[12px] font-black tracking-[0.1em] text-p5-dark-muted transition hover:bg-black/[0.03]"
      >
        <span className="flex items-center gap-2">
          {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          {open ? 'HIDE' : 'SHOW'} ALL FIELDS ({entries.length})
        </span>
        <span className="font-mono text-[10px] text-p5-dark-muted">raw json</span>
      </button>
      {open ? (
        <pre className="whitespace-pre-wrap break-words border-t border-black/10 bg-black/[0.03] p-4 font-mono text-[11px] text-p5-dark-muted overflow-x-auto">
          {JSON.stringify(Object.fromEntries(entries), null, 2)}
        </pre>
      ) : null}
    </Panel>
  );
}

function DetailRow({
  icon: Icon,
  label,
  value,
  mono,
}: {
  icon: React.ElementType;
  label: string;
  value: string | null | undefined;
  mono?: boolean;
}): React.JSX.Element | null {
  if (!value) return null;
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-p5-dark-muted" />
      <div className="min-w-0 flex-1">
        <div className="p5-kicker text-p5-dark-muted">{label}</div>
        <div className={cn('mt-0.5 break-words text-[13px] text-p5-dark', mono && 'font-mono')}>
          {value}
        </div>
      </div>
    </div>
  );
}

function ProvenanceCard({ subscriptionId }: { subscriptionId: string }): React.JSX.Element {
  const { data: scouts } = useScouts();
  const scout = scouts?.find((s: import('../api').Subscription) => s.id === subscriptionId);
  const { data: cats } = useCategories();
  const cat = scout?.categoryId ? cats?.find((c: import('../api').Category) => c.id === scout.categoryId) : null;

  return (
    <Panel>
      <PanelHead>Found by</PanelHead>
      {scout ? (
        <Link to="/scouting" className="block group">
          <div className="text-[14px] font-black tracking-tight text-p5-dark group-hover:text-accent transition">
            {scout.name}
          </div>
          <div className="mt-0.5 text-[12px] text-p5-dark-muted">
            <span className="font-mono">{scout.target}</span>
            {cat ? <> · <span>{cat.name}</span></> : null}
          </div>
        </Link>
      ) : (
        <div className="text-[13px] text-p5-dark-muted">
          Scout no longer exists (id <span className="font-mono text-[11px]">{subscriptionId.slice(0, 8)}</span>)
        </div>
      )}
    </Panel>
  );
}

function MetadataCard({ obj }: { obj: import('../api').ObjectDetail }): React.JSX.Element {
  return (
    <Panel>
      <PanelHead>Metadata</PanelHead>
      <div className="space-y-2.5">
        <Meta label="ID" value={obj.id} mono />
        <Meta label="Created" value={formatRelative(obj.createdAt)} />
        <Meta label="Updated" value={formatRelative(obj.updatedAt)} />
        {obj.archivedAt ? <Meta label="Archived" value={formatRelative(obj.archivedAt)} /> : null}
      </div>
    </Panel>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }): React.JSX.Element {
  return (
    <div>
      <div className="p5-kicker text-p5-dark-muted">{label}</div>
      <div className={cn('mt-0.5 text-[12px] text-p5-dark-muted', mono && 'font-mono break-all')}>
        {value}
      </div>
    </div>
  );
}

function GenericOverview({ obj }: { obj: import('../api').ObjectDetail }): React.JSX.Element {
  const body = obj.body;
  const skipKeys = new Set(['subscriptionId', 'category_id', 'kind']);
  const entries = Object.entries(body).filter(([k]) => !skipKeys.has(k));
  const knownEntries = entries.filter(([k]) =>
    ['url', 'source', 'target', 'summary', 'stars', 'language', 'topics',
     'license', 'author', 'publishedDate', 'cost_estimate'].includes(k),
  );
  const extraEntries = entries.filter(
    ([k]) => !['url', 'source', 'target', 'summary', 'stars', 'language', 'topics',
      'license', 'author', 'publishedDate', 'cost_estimate'].includes(k),
  );
  const url = (body as { url?: string }).url;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-5">
        {obj.summary ? (
          <Panel>
            <p className="text-[15px] leading-relaxed text-p5-dark">{obj.summary}</p>
          </Panel>
        ) : null}

        {url ? (
          <Panel>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 break-all text-[14px] font-bold text-accent hover:underline"
            >
              <ExternalLink className="h-4 w-4 shrink-0" />
              {url}
            </a>
          </Panel>
        ) : null}

        {knownEntries.length > 0 ? (
          <Panel>
            <PanelHead>Details</PanelHead>
            <div className="space-y-3">
              {knownEntries.map(([k, v]) => (
                <DetailRow
                  key={k}
                  icon={iconForKey(k)}
                  label={humanizeKey(k)}
                  value={formatValue(v)}
                  mono
                />
              ))}
            </div>
          </Panel>
        ) : null}

        {extraEntries.length > 0 ? (
          <RawBodyCard entries={extraEntries} />
        ) : null}
      </div>
      <div className="space-y-5">
        <MetadataCard obj={obj} />
      </div>
    </div>
  );
}

function iconForKey(key: string): React.ElementType {
  switch (key) {
    case 'url': return ExternalLink;
    case 'source': return Rss;
    case 'target': return Layers;
    case 'stars': return Star;
    case 'language': return Code2;
    case 'license': return Code;
    case 'author': return Hash;
    case 'publishedDate': return Calendar;
    case 'cost_estimate': return DollarSign;
    case 'topics': return Tag;
    default: return Hash;
  }
}

function humanizeKey(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase());
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map((x) => String(x)).join(', ');
  return JSON.stringify(v);
}

// ============================================================================
// Timeline Tab
// ============================================================================

function TimelineTab({ objectId }: { objectId: string }): React.JSX.Element {
  const { data, fetchNextPage, hasNextPage, isLoading } = useInfiniteQuery({
    queryKey: ['object', objectId, 'timeline'],
    queryFn: ({ pageParam }) =>
      api.objectTimeline(objectId, { limit: 25, cursor: pageParam as string | undefined }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  if (isLoading) {
    return <div className="py-16 text-center font-mono text-[11px] tracking-widest text-p5-dark-muted">LOADING TIMELINE…</div>;
  }

  const events = data?.pages.flatMap((p: { events: import('../api').ObjectEvent[] }) => p.events) ?? [];
  if (events.length === 0) {
    return (
      <Panel className="p-10 text-center">
        <p className="font-p5-serif text-[22px] text-p5-dark">NO EVENTS YET.</p>
        <p className="mt-1 text-[13px] text-p5-dark-muted">Object changes will appear here as they happen.</p>
      </Panel>
    );
  }

  return (
    <div className="space-y-3">
      {events.map((e) => {
        const meta: Record<string, 'emerald' | 'sky' | 'amber' | 'purple' | 'rose' | 'slate'> = {
          created: 'emerald',
          updated: 'sky',
          archived: 'slate',
          priority_changed: 'amber',
          reverted: 'purple',
          feedback_added: 'rose',
        };
        return (
          <div key={e.id} className="border-l-2 border-accent bg-p5-panel px-5 py-4">
            <div className="flex flex-wrap items-center gap-2 text-[12px]">
              <Chip tone={meta[e.kind] ?? 'slate'}>{e.kind.replace(/_/g, ' ')}</Chip>
              <span className="font-mono text-p5-dark-muted">
                {new Date(e.createdAt).toLocaleString()}
              </span>
              <span className="font-mono text-[11px] text-p5-dark-muted">by {e.actor}</span>
            </div>
            {Object.keys(e.payload).length > 0 ? (
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words bg-black/[0.03] p-3 font-mono text-[11px] text-p5-dark-muted">
                {JSON.stringify(e.payload, null, 2)}
              </pre>
            ) : null}
          </div>
        );
      })}
      {hasNextPage ? (
        <div className="text-center pt-2">
          <button
            type="button"
            onClick={() => fetchNextPage()}
            className="border border-p5-dark-line px-4 py-2 font-mono text-[10px] font-bold tracking-[0.16em] text-p5-dark transition hover:border-p5-dark hover:bg-p5-dark hover:text-p5-cream"
          >
            LOAD MORE
          </button>
        </div>
      ) : null}
    </div>
  );
}

// ============================================================================
// Revisions Tab
// ============================================================================

function RevisionsTab({
  objectId,
  qc,
}: {
  objectId: string;
  qc: ReturnType<typeof useQueryClient>;
}): React.JSX.Element {
  const { data, fetchNextPage, hasNextPage, isLoading } = useInfiniteQuery({
    queryKey: ['object', objectId, 'revisions'],
    queryFn: ({ pageParam }) =>
      api.objectRevisions(objectId, { limit: 25, cursor: pageParam as string | undefined }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const revert = useMutation({
    mutationFn: (revision: number) => api.revertObject(objectId, revision),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['object', objectId] });
      qc.invalidateQueries({ queryKey: ['object', objectId, 'revisions'] });
      qc.invalidateQueries({ queryKey: ['object', objectId, 'timeline'] });
    },
  });

  if (isLoading) {
    return <div className="py-16 text-center font-mono text-[11px] tracking-widest text-p5-dark-muted">LOADING REVISIONS…</div>;
  }

  const revisions = data?.pages.flatMap((p: { revisions: import('../api').ObjectRevision[] }) => p.revisions) ?? [];
  if (revisions.length === 0) {
    return (
      <Panel className="p-10 text-center">
        <p className="font-p5-serif text-[22px] text-p5-dark">NO REVISIONS YET.</p>
      </Panel>
    );
  }

  return (
    <div className="space-y-3">
      {revisions.map((r) => (
        <div key={r.id} className="border-2 border-black/15 bg-p5-panel p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[12px]">
              <Chip tone="sky">rev {r.revision}</Chip>
              <span className="font-mono text-p5-dark-muted">{new Date(r.createdAt).toLocaleString()}</span>
              <span className="font-mono text-[11px] text-p5-dark-muted">by {r.createdBy}</span>
            </div>
            <button
              type="button"
              onClick={() => {
                if (window.confirm(`Revert to revision ${r.revision}?`)) revert.mutate(r.revision);
              }}
              className="min-h-[44px] min-w-[44px] px-2 text-[10px] font-black tracking-[0.12em] text-p5-dark-muted transition hover:text-accent"
            >
              REVERT
            </button>
          </div>
          {r.reason ? <div className="text-[13px] text-p5-dark-muted">{r.reason}</div> : null}
          <div className="text-[14px] font-black tracking-tight text-p5-dark">{r.title}</div>
          {r.summary ? (
            <p className="text-[12px] text-p5-dark-muted">{r.summary}</p>
          ) : null}
        </div>
      ))}
      {hasNextPage ? (
        <div className="text-center pt-2">
          <button
            type="button"
            onClick={() => fetchNextPage()}
            className="border border-p5-dark-line px-4 py-2 font-mono text-[10px] font-bold tracking-[0.16em] text-p5-dark transition hover:border-p5-dark hover:bg-p5-dark hover:text-p5-cream"
          >
            LOAD MORE
          </button>
        </div>
      ) : null}
    </div>
  );
}

// ============================================================================
// Related Tab
// ============================================================================

function RelatedTab({
  items,
}: {
  items: Array<{ id: string; type: string; title: string; reason: string | null; confidence: number }>;
}): React.JSX.Element {
  if (items.length === 0) {
    return (
      <Panel className="p-10 text-center">
        <p className="font-p5-serif text-[22px] text-p5-dark">NO RELATED OBJECTS.</p>
        <p className="mt-1 text-[13px] text-p5-dark-muted">
          Objects get linked automatically when they share a target, source, or are linked explicitly.
        </p>
      </Panel>
    );
  }
  return (
    <div className="space-y-2">
      {items.map((r) => (
        <div key={r.id} className="flex items-center justify-between border-2 border-black/15 bg-p5-panel p-4">
          <Link to={`/objects/${r.id}`} className="group min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Chip>{r.type}</Chip>
              <span className="font-black tracking-tight text-p5-dark group-hover:text-accent transition">
                {r.title}
              </span>
            </div>
            {r.reason ? <div className="mt-1 text-[12px] text-p5-dark-muted">{r.reason}</div> : null}
          </Link>
          <div className="ml-4 shrink-0 font-mono text-[11px] text-p5-dark-muted">
            conf {r.confidence.toFixed(2)}
          </div>
        </div>
      ))}
    </div>
  );
}
