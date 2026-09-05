import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import {
  Lightbulb,
  Search,
  Loader2,
  Network,
  FolderKanban,
  FileText,
  GitBranch,
  Compass,
  GraduationCap,
  StickyNote,
  Boxes,
  BookOpen,
} from 'lucide-react';
import { api, type ObjectSummary } from '../api';
import { useServer } from '../server';
import { Card, CardContent } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { cn } from '../lib/utils';

type ObjectType = ObjectSummary['type'];

const TYPE_META: Record<ObjectType, { label: string; Icon: React.ElementType; tone: string }> = {
  project: { label: 'Projects', Icon: FolderKanban, tone: 'text-sky-600' },
  research: { label: 'Research', Icon: BookOpen, tone: 'text-purple-600' },
  discovery: { label: 'Discoveries', Icon: Lightbulb, tone: 'text-emerald-600' },
  decision: { label: 'Decisions', Icon: GitBranch, tone: 'text-amber-600' },
  opportunity: { label: 'Opportunities', Icon: Compass, tone: 'text-rose-600' },
  learning_path: { label: 'Learning paths', Icon: GraduationCap, tone: 'text-teal-600' },
  note: { label: 'Notes', Icon: StickyNote, tone: 'text-pink-600' },
  collection: { label: 'Collections', Icon: Boxes, tone: 'text-indigo-600' },
};

const TYPE_ORDER: ObjectType[] = ['project', 'research', 'discovery', 'decision', 'opportunity', 'learning_path', 'note', 'collection'];

export function KnowledgePage(): React.JSX.Element {
  const { connected } = useServer();
  const navigate = useNavigate();
  const [query, setQuery] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  const [activeType, setActiveType] = React.useState<ObjectType | 'all'>('all');

  React.useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query.trim()), 300);
    return () => window.clearTimeout(t);
  }, [query]);

  const searchQ = useQuery({
    queryKey: ['knowledge-search', debounced],
    queryFn: () => api.search(debounced, { limit: 30 }),
    enabled: connected && debounced.length > 0,
  });

  const browseQ = useQuery({
    queryKey: ['knowledge-browse', activeType],
    queryFn: () =>
      activeType === 'all'
        ? api.listObjects({ limit: 100 })
        : api.listObjects({ type: activeType, limit: 100 }),
    enabled: connected && debounced.length === 0,
  });

  const graphQ = useQuery({
    queryKey: ['knowledge-graph'],
    queryFn: () => api.graph(),
    enabled: connected,
    refetchInterval: 60_000,
  });

  const searching = debounced.length > 0;
  const hits = searchQ.data?.hits ?? [];
  const objects = browseQ.data?.objects ?? [];

  return (
    <div className="flex bg-page text-text-primary flex-1 min-w-0 min-h-0">
      <main className="flex-1 min-w-0 min-h-0 overflow-y-auto p-6 lg:p-8 max-w-[1100px] mx-auto w-full">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-amber-500/15 text-amber-600 flex items-center justify-center">
            <Lightbulb className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-[18px] font-semibold text-text-primary">Knowledge</h1>
            <p className="text-[12px] text-text-tertiary">Search everything, browse by type, explore the graph.</p>
          </div>
        </div>

        {/* Search */}
        <div className="relative mt-4 mb-5 max-w-xl">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-quaternary" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search projects, research, decisions, opportunities…"
            className="pl-10 h-11 text-[14px]"
          />
        </div>

        {/* Search results */}
        {searching ? (
          <div className="mb-6">
            <h2 className="text-[13px] font-semibold text-text-primary mb-2">
              {searchQ.isLoading ? 'Searching…' : `${hits.length} result${hits.length === 1 ? '' : 's'}`}
            </h2>
            {searchQ.isLoading ? (
              <div className="flex items-center gap-2 text-text-tertiary py-6">
                <Loader2 className="w-4 h-4 animate-spin" /> Searching…
              </div>
            ) : hits.length === 0 ? (
              <div className="text-[13px] text-text-tertiary py-6">No matches for “{debounced}”.</div>
            ) : (
              <div className="space-y-1.5">
                {hits.map((h) => (
                  <Link
                    key={h.id}
                    to={`/objects/${h.id}`}
                    className="block px-4 py-2.5 rounded-lg border border-border-default bg-surface-0 hover:border-border-strong transition"
                  >
                    <div className="flex items-center gap-2">
                      {(() => {
                        const M = TYPE_META[h.type as ObjectType];
                        const Icon = M?.Icon ?? FileText;
                        return <Icon className={cn('w-3.5 h-3.5', M?.tone ?? 'text-text-tertiary')} />;
                      })()}
                      <span className="text-[13px] font-medium text-text-primary">{h.title}</span>
                    </div>                    {h.snippet ? (
                      <div
                        className="text-[12px] text-text-tertiary mt-1"
                        dangerouslySetInnerHTML={{ __html: h.snippet }}
                      />
                    ) : null}
                  </Link>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Browse by type */}
            <div className="flex gap-2 mb-5 overflow-x-auto sm:flex-wrap pb-1 -mx-1 px-1">
              <TypePill active={activeType === 'all'} label="All" onClick={() => setActiveType('all')} />
              {TYPE_ORDER.map((t) => {
                const M = TYPE_META[t]!;
                const count = activeType === t ? objects.length : undefined;
                return (
                  <TypePill
                    key={t}
                    active={activeType === t}
                    label={M.label}
                    count={count}
                    Icon={M.Icon}
                    onClick={() => setActiveType(t)}
                  />
                );
              })}
            </div>

            {browseQ.isLoading ? (
              <div className="flex items-center gap-2 text-text-tertiary py-8">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading…
              </div>
            ) : objects.length === 0 ? (
              <div className="text-[13px] text-text-tertiary py-10 text-center">
                Nothing here yet. {activeType === 'all' ? 'Add objects or let Hermes research.' : `No ${TYPE_META[activeType as ObjectType]?.label.toLowerCase() ?? 'objects'} yet.`}
              </div>
            ) : (
              <div className="space-y-1.5 mb-8">
                {objects.map((o) => {
                  const M = TYPE_META[o.type];
                  const Icon = M?.Icon ?? FileText;
                  return (
                    <Link
                      key={o.id}
                      to={`/objects/${o.id}`}
                      className="flex items-center gap-3 px-4 py-3 sm:py-2.5 min-h-[48px] sm:min-h-0 rounded-lg border border-border-default bg-surface-0 hover:border-border-strong transition"
                    >
                      <Icon className={cn('w-4 h-4 shrink-0', M?.tone)} />
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-medium text-text-primary truncate">{o.title}</div>
                        {o.summary ? (
                          <div className="text-[12px] text-text-tertiary truncate">{o.summary}</div>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {o.status === 'archived' ? (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">archived</span>
                        ) : null}
                        <span className="text-[11px] text-text-quaternary">
                          {new Date(o.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                        </span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* Graph */}
        <Card className="mb-6">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-surface-2 flex items-center justify-center text-text-secondary">
                  <Network className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-[15px] font-semibold text-text-primary">Knowledge Graph</h2>
                  <p className="text-[12px] text-text-tertiary">Relationships between everything you know.</p>
                </div>
              </div>
              <Link to="/graph" className="text-[12px] font-medium text-accent-text hover:underline">
                Open full graph →
              </Link>
            </div>
            {graphQ.isLoading ? (
              <div className="text-[12px] text-text-tertiary py-6 text-center">Loading graph…</div>
            ) : (graphQ.data?.nodes.length ?? 0) === 0 ? (
              <div className="text-[13px] text-text-tertiary py-8 text-center">
                No relationships yet. Hermes links related objects as it works.
              </div>
            ) : (
              <>
                <div className="hidden sm:block">
                  <GraphPreview
                    nodes={graphQ.data?.nodes ?? []}
                    links={graphQ.data?.links ?? []}
                    onSelect={(id) => navigate(`/objects/${id}`)}
                  />
                </div>
                <Link
                  to="/graph"
                  className="flex min-h-[48px] items-center justify-between border border-border-default bg-surface-0 px-4 py-3 sm:hidden"
                >
                  <span className="text-[13px] font-medium text-text-primary">
                    {graphQ.data?.nodes.length ?? 0} relationships — open the interactive graph
                  </span>
                  <span className="text-accent-text">→</span>
                </Link>
              </>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

function TypePill({
  label,
  active,
  count,
  Icon,
  onClick,
}: {
  label: string;
  active: boolean;
  count?: number;
  Icon?: React.ElementType;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex shrink-0 items-center gap-1.5 px-3 py-1.5 min-h-[44px] sm:min-h-0 rounded-full text-[12px] font-medium border transition',
        active
          ? 'bg-accent text-accent-fg border-accent'
          : 'bg-surface-0 text-text-secondary border-border-default hover:border-border-strong hover:text-text-primary',
      )}
    >
      {Icon ? <Icon className="w-3.5 h-3.5" /> : null}
      {label}
      {count !== undefined ? <span className="opacity-70">({count})</span> : null}
    </button>
  );
}

function GraphPreview({
  nodes,
  links,
  onSelect,
}: {
  nodes: Array<{ id: string; title: string; type: string; priority: number }>;
  links: Array<{ source: string; target: string; kind: string; confidence: number }>;
  onSelect: (id: string) => void;
}): React.JSX.Element {
  const W = 640;
  const H = 220;
  const cx = W / 2;
  const cy = H / 2;
  const placed = React.useMemo(() => {
    const n = Math.max(nodes.length, 1);
    const visible = nodes.slice(0, 60);
    return visible.map((node, i) => {
      const angle = (i / n) * Math.PI * 2;
      const r = Math.min(W, H) * 0.36;
      return { ...node, x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
    });
  }, [nodes]);
  const idMap = React.useMemo(() => new Map(placed.map((n) => [n.id, n])), [placed]);
  const TYPE_COLORS: Record<string, string> = {
    project: '#0284c7',
    research: '#7c3aed',
    discovery: '#059669',
    decision: '#d97706',
    opportunity: '#10b981',
    learning_path: '#0d9488',
    note: '#db2777',
    collection: '#4f46e5',
  };

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
            stroke="#94a3b8"
            strokeOpacity="0.4"
            strokeWidth={Math.max(0.5, l.confidence * 2)}
          />
        );
      })}
      {placed.map((n) => (
        <g
          key={n.id}
          className="cursor-pointer"
          onClick={() => onSelect(n.id)}
          role="link"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSelect(n.id);
          }}
        >
          <circle cx={n.x} cy={n.y} r="10" fill={TYPE_COLORS[n.type] ?? '#94a3b8'} />
          <text
            x={n.x}
            y={n.y - 15}
            textAnchor="middle"
            className="fill-text-secondary"
            style={{ fontSize: 10, fontFamily: 'var(--font-sans)' }}
          >
            {n.title.length > 18 ? `${n.title.slice(0, 16)}…` : n.title}
          </text>
        </g>
      ))}
    </svg>
  );
}
