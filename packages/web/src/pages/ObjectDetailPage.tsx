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
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Card, CardContent } from '../components/ui/card';
import { useScouts, useCategories } from '../hooks/data';
import { formatRelative } from '../lib/utils';
import { FeedbackButtons } from '../components/FeedbackButtons';
import { Loading } from '../components/Loading';

type Tab = 'overview' | 'timeline' | 'revisions' | 'related';

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

  if (isLoading) {
    return <Loading text="Loading…" />;
  }
  if (error || !data) return <NotFound />;

  const obj = data.object;

  return (
    <>
      <ObjectHeader obj={obj} onBack={() => nav(-1)} />

      <div className="border-b border-border-default">
        <nav className="flex gap-1">
          {(['overview', 'timeline', 'revisions', 'related'] as Tab[]).map((t) => {
            const meta: Record<Tab, { label: string; icon: React.ElementType; count?: number }> = {
              overview: { label: 'Overview', icon: Lightbulb },
              timeline: { label: 'Timeline', icon: History },
              revisions: { label: 'Revisions', icon: Pencil },
              related: { label: 'Related', icon: Link2, count: obj.related.length },
            };
            const M = meta[t];
            const Icon = M.icon;
            return (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex items-center gap-2 px-4 py-2.5 text-[13px] font-medium border-b-2 -mb-px transition ${
                  tab === t
                    ? 'border-accent-text text-text-primary'
                    : 'border-transparent text-text-secondary hover:text-text-primary'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {M.label}
                {M.count !== undefined && M.count > 0 ? (
                  <span className="text-text-quaternary text-[11px]">({M.count})</span>
                ) : null}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="py-6 max-w-5xl">
        {tab === 'overview' ? <OverviewTab obj={obj} /> : null}
        {tab === 'timeline' ? <TimelineTab objectId={id} /> : null}
        {tab === 'revisions' ? <RevisionsTab objectId={id} qc={qc} /> : null}
        {tab === 'related' ? <RelatedTab items={obj.related} /> : null}
      </div>
    </>
  );
}

function NotFound(): React.JSX.Element {
  return (
    <div className="space-y-2">
      <p className="text-text-primary font-medium">Object not found</p>
      <Link to="/" className="text-accent-text text-sm hover:underline">
        Go home
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
    <div className="pt-6 pb-4 border-b border-border-default">
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-text-tertiary text-[12px] hover:text-text-primary transition mb-3"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Back
      </button>

      <div className="flex items-start gap-6">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <TypeBadge type={obj.type} />
            <StatusBadge status={obj.status} />
            {obj.archivedAt ? (
              <Badge tone="rose" variant="soft">
                Archived
              </Badge>
            ) : null}
            {obj.priority >= 4 ? (
              <Badge tone="amber" variant="soft">
                Priority {obj.priority}
              </Badge>
            ) : null}
          </div>
          <h1 className="text-[24px] font-semibold tracking-tight text-text-primary leading-tight">
            {obj.title}
          </h1>
          {obj.summary ? (
            <p className="mt-2 text-[14px] text-text-secondary leading-relaxed">{obj.summary}</p>
          ) : null}
          {obj.tags.length > 0 ? (
            <div className="mt-3 flex items-center gap-1.5 flex-wrap">
              <Tag className="w-3.5 h-3.5 text-text-quaternary" />
              {obj.tags.map((t) => (
                <Badge key={t} tone="slate" variant="outline">
                  {t}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-2 items-end shrink-0">
          <FeedbackButtons objectId={obj.id} />
          <Link
            to={`/objects/${obj.id}/discuss`}
            className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-lg bg-text-primary text-page hover:opacity-90 transition"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            Discuss
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
  return (
    <Badge tone={m.tone} variant="soft">
      {m.label}
    </Badge>
  );
}

function StatusBadge({ status }: { status: string }): React.JSX.Element {
  const meta: Record<string, { tone: 'emerald' | 'amber' | 'slate' | 'rose' }> = {
    open: { tone: 'emerald' },
    active: { tone: 'emerald' },
    completed: { tone: 'emerald' },
    pending: { tone: 'amber' },
    archived: { tone: 'slate' },
    failed: { tone: 'rose' },
  };
  const m = meta[status] ?? { tone: 'slate' as const };
  return (
    <Badge tone={m.tone} variant="outline">
      {status}
    </Badge>
  );
}

// ============================================================================
// Overview Tab — semantic layout per type
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

  // Known display fields we render as proper rows. Anything else in
  // body is shown under "Additional fields" so unknown metadata still
  // surfaces (e.g. cost_estimate, license, language) without dumping
  // the whole body as JSON.
  const knownKeys = new Set([
    'url', 'source', 'target', 'kind', 'summary', 'subscriptionId',
    'category_id', 'stars', 'cost_estimate', 'language', 'topics',
    'license', 'author', 'publishedDate',
  ]);
  const extraEntries = Object.entries(body).filter(([k]) => !knownKeys.has(k));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-6">
        {obj.summary ? (
          <Card>
            <CardContent className="p-6">
              <p className="text-[15px] text-text-primary leading-relaxed">{obj.summary}</p>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardContent className="p-6 space-y-4">
            <h2 className="text-[13px] font-semibold text-text-tertiary uppercase tracking-wider">
              Details
            </h2>
            <div className="space-y-3">
              {url ? (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-accent-text hover:underline text-[14px] break-all"
                >
                  <ExternalLink className="w-4 h-4 shrink-0" />
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
          </CardContent>
        </Card>

        {extraEntries.length > 0 ? (
          <RawBodyCard entries={extraEntries} />
        ) : null}

        {obj.tags.length > 0 ? (
          <Card>
            <CardContent className="p-6">
              <h2 className="text-[13px] font-semibold text-text-tertiary uppercase tracking-wider mb-3">
                Tags
              </h2>
              <div className="flex flex-wrap gap-1.5">
                {obj.tags.map((t) => (
                  <Badge key={t} tone="slate" variant="outline">
                    {t}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>

      <div className="space-y-6">
        {subId ? <ProvenanceCard subscriptionId={subId} /> : null}
        <MetadataCard obj={obj} />
      </div>
    </div>
  );
}

/**
 * Collapsible JSON dump for unknown body fields. Hermes's body
 * schema is open — scouts can attach arbitrary metadata (e.g.
 * `cost_estimate`, `license`, `topics`). Rather than dumping the
 * whole body as JSON on the page, we render the known fields
 * properly and tuck the rest behind a "Show all fields" toggle.
 */
function RawBodyCard({ entries }: { entries: Array<[string, unknown]> }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <CardContent className="p-0">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full px-6 py-3 flex items-center justify-between text-[12px] font-medium text-text-secondary hover:bg-surface-1 transition-colors rounded-xl"
        >
          <span className="flex items-center gap-2">
            {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            {open ? 'Hide' : 'Show'} all fields ({entries.length})
          </span>
          <span className="text-text-quaternary">raw JSON</span>
        </button>
        {open ? (
          <pre className="text-[11px] text-text-secondary bg-surface-1 rounded-b-xl p-4 overflow-x-auto font-mono whitespace-pre-wrap break-words border-t border-border-default">
            {JSON.stringify(Object.fromEntries(entries), null, 2)}
          </pre>
        ) : null}
      </CardContent>
    </Card>
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
      <Icon className="w-4 h-4 text-text-quaternary mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-[11px] uppercase tracking-wider text-text-quaternary">{label}</div>
        <div className={`text-[13px] text-text-primary mt-0.5 break-words ${mono ? 'font-mono' : ''}`}>
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
    <Card>
      <CardContent className="p-5 space-y-3">
        <h2 className="text-[13px] font-semibold text-text-tertiary uppercase tracking-wider">
          Found by
        </h2>
        {scout ? (
          <Link
            to="/scouting"
            className="block group"
          >
            <div className="text-[14px] font-medium text-text-primary group-hover:text-accent-text">
              {scout.name}
            </div>
            <div className="text-[12px] text-text-tertiary mt-0.5">
              <span className="font-mono">{scout.target}</span>
              {cat ? <> · <span>{cat.name}</span></> : null}
            </div>
          </Link>
        ) : (
          <div className="text-[13px] text-text-tertiary">
            Scout no longer exists (id <span className="font-mono text-[11px]">{subscriptionId.slice(0, 8)}</span>)
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MetadataCard({ obj }: { obj: import('../api').ObjectDetail }): React.JSX.Element {
  return (
    <Card>
      <CardContent className="p-5 space-y-2.5">
        <h2 className="text-[13px] font-semibold text-text-tertiary uppercase tracking-wider">
          Metadata
        </h2>
        <Meta label="ID" value={obj.id} mono />
        <Meta label="Created" value={formatRelative(obj.createdAt)} />
        <Meta label="Updated" value={formatRelative(obj.updatedAt)} />
        {obj.archivedAt ? <Meta label="Archived" value={formatRelative(obj.archivedAt)} /> : null}
      </CardContent>
    </Card>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }): React.JSX.Element {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-text-quaternary">{label}</div>
      <div className={`text-[12px] text-text-secondary mt-0.5 ${mono ? 'font-mono break-all' : ''}`}>
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
      <div className="lg:col-span-2 space-y-6">
        {obj.summary ? (
          <Card>
            <CardContent className="p-6">
              <p className="text-[15px] text-text-primary leading-relaxed">{obj.summary}</p>
            </CardContent>
          </Card>
        ) : null}

        {url ? (
          <Card>
            <CardContent className="p-6">
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-accent-text hover:underline text-[14px] break-all"
              >
                <ExternalLink className="w-4 h-4 shrink-0" />
                {url}
              </a>
            </CardContent>
          </Card>
        ) : null}

        {knownEntries.length > 0 ? (
          <Card>
            <CardContent className="p-6 space-y-4">
              <h2 className="text-[13px] font-semibold text-text-tertiary uppercase tracking-wider">
                Details
              </h2>
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
            </CardContent>
          </Card>
        ) : null}

        {extraEntries.length > 0 ? (
          <RawBodyCard entries={extraEntries} />
        ) : null}
      </div>
      <div className="space-y-6">
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

  if (isLoading) return <Loading text="Loading timeline…" />;

  const events = data?.pages.flatMap((p: { events: import('../api').ObjectEvent[] }) => p.events) ?? [];
  if (events.length === 0) {
    return (
      <Card>
        <CardContent className="p-10 text-center">
          <p className="text-text-primary font-medium">No events yet</p>
          <p className="text-text-tertiary text-[13px] mt-1">
            Object changes will appear here as they happen.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {events.map((e) => {
        const meta: Record<string, { tone: 'emerald' | 'sky' | 'amber' | 'purple' | 'rose' | 'slate' }> = {
          created: { tone: 'emerald' },
          updated: { tone: 'sky' },
          archived: { tone: 'slate' },
          priority_changed: { tone: 'amber' },
          reverted: { tone: 'purple' },
          feedback_added: { tone: 'rose' },
        };
        const m = meta[e.kind] ?? { tone: 'slate' as const };
        return (
          <Card key={e.id}>
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center gap-2 text-[12px]">
                <Badge tone={m.tone} variant="soft">
                  {e.kind.replace(/_/g, ' ')}
                </Badge>
                <span className="text-text-tertiary">
                  {new Date(e.createdAt).toLocaleString()}
                </span>
                <span className="text-text-quaternary">by {e.actor}</span>
              </div>
              {Object.keys(e.payload).length > 0 ? (
                <pre className="text-[11px] text-text-secondary bg-surface-1 rounded-md p-3 overflow-x-auto font-mono whitespace-pre-wrap break-words">
                  {JSON.stringify(e.payload, null, 2)}
                </pre>
              ) : null}
            </CardContent>
          </Card>
        );
      })}
      {hasNextPage ? (
        <Button variant="secondary" onClick={() => fetchNextPage()}>
          Load more
        </Button>
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

  if (isLoading) return <Loading text="Loading revisions…" />;

  const revisions = data?.pages.flatMap((p: { revisions: import('../api').ObjectRevision[] }) => p.revisions) ?? [];
  if (revisions.length === 0) {
    return (
      <Card>
        <CardContent className="p-10 text-center">
          <p className="text-text-primary font-medium">No revisions yet</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {revisions.map((r) => (
        <Card key={r.id}>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-[12px]">
                <Badge tone="sky" variant="soft">
                  rev {r.revision}
                </Badge>
                <span className="text-text-tertiary">{new Date(r.createdAt).toLocaleString()}</span>
                <span className="text-text-quaternary">by {r.createdBy}</span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (window.confirm(`Revert to revision ${r.revision}?`)) revert.mutate(r.revision);
                }}
              >
                Revert
              </Button>
            </div>
            {r.reason ? <div className="text-[13px] text-text-secondary">{r.reason}</div> : null}
            <div className="text-[14px] font-medium text-text-primary">{r.title}</div>
            {r.summary ? (
              <p className="text-[12px] text-text-tertiary">{r.summary}</p>
            ) : null}
          </CardContent>
        </Card>
      ))}
      {hasNextPage ? (
        <Button variant="secondary" onClick={() => fetchNextPage()}>
          Load more
        </Button>
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
      <Card>
        <CardContent className="p-10 text-center">
          <p className="text-text-primary font-medium">No related objects</p>
          <p className="text-text-tertiary text-[13px] mt-1">
            Objects get linked automatically when they share a target, source, or are linked explicitly.
          </p>
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-2">
      {items.map((r) => (
        <Card key={r.id}>
          <CardContent className="p-4 flex items-center justify-between">
            <Link to={`/objects/${r.id}`} className="min-w-0 flex-1 group">
              <div className="flex items-center gap-2">
                <Badge tone="slate" variant="outline">
                  {r.type}
                </Badge>
                <span className="font-medium text-text-primary group-hover:text-accent-text">
                  {r.title}
                </span>
              </div>
              {r.reason ? <div className="text-[12px] text-text-tertiary mt-1">{r.reason}</div> : null}
            </Link>
            <div className="text-[11px] text-text-quaternary ml-4 shrink-0">
              conf {r.confidence.toFixed(2)}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
