import * as React from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Pause,
  Play,
  Archive,
  Search,
  Briefcase,
  TrendingUp,
  FileText,
  Lightbulb,
  Radar,
  Trophy,
  HelpCircle,
  CheckCircle2,
  XCircle,
  Clock,
  X,
  FolderKanban,
  GraduationCap,
  ArrowRight,
  Loader2,
} from 'lucide-react';
import { api } from '../api';
import type { Subscription, ObjectSummary, Category } from '../api';
import { useServer } from '../server';
import { scoutKeys, useScouts, useFindings } from '../hooks/data';
import { Sheet } from '../components/ui/sheet';
import { mediaMatches } from '../mobile';
import { cn, formatRelative } from '../lib/utils';

/**
 * Scouting — the operative roster.
 *
 * One page, one object: scouts. The roster is a single editorial table
 * (the deck), and selecting a scout opens their dossier — the one dark
 * panel on the page, deliberately weighted like Home's thinking panels.
 * Categories and findings browsing live on the Findings page; here we
 * only monitor, understand, and control the workers who produce them.
 */

// Well-known scouting categories surfaced as one-click suggestions in
// the New Scout modal. The user can also type any snake_case name to
// create a new category.
const SUGGESTED_CATEGORY_NAMES = [
  'job',
  'startup',
  'research_paper',
  'saas_idea',
  'iot',
  'grant',
  'competition',
  'other',
];

// ============================================================================
// Identity helpers
// ============================================================================

type Tone = 'emerald' | 'sky' | 'purple' | 'amber' | 'rose' | 'slate';

const TONE_ACCENT: Record<Tone, string> = {
  emerald: 'text-emerald-600',
  sky: 'text-sky-600',
  purple: 'text-purple-600',
  amber: 'text-amber-600',
  rose: 'text-rose-600',
  slate: 'text-p5-dark-muted',
};

/** Hard full-width band colors — same color-as-identity language as the findings deck. */
const TONE_BAND: Record<Tone, string> = {
  emerald: 'bg-emerald-600',
  sky: 'bg-cyan-600',
  purple: 'bg-violet-600',
  amber: 'bg-amber-500',
  rose: 'bg-rose-600',
  slate: 'bg-slate-600',
};

const CATEGORY_META: Record<string, { label: string; tone: Tone; icon: React.ElementType }> = {
  job: { label: 'Jobs', tone: 'emerald', icon: Briefcase },
  startup: { label: 'Startups', tone: 'purple', icon: TrendingUp },
  research_paper: { label: 'Research Papers', tone: 'sky', icon: FileText },
  saas_idea: { label: 'SaaS Ideas', tone: 'amber', icon: Lightbulb },
  iot: { label: 'IoT', tone: 'sky', icon: Radar },
  grant: { label: 'Grants', tone: 'rose', icon: Briefcase },
  competition: { label: 'Competitions', tone: 'purple', icon: Trophy },
  other: { label: 'Other', tone: 'slate', icon: HelpCircle },
};

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
const HASH_TONES: Tone[] = ['emerald', 'sky', 'purple', 'amber', 'rose', 'slate'];
const HASH_ICONS: React.ElementType[] = [Briefcase, TrendingUp, FileText, Lightbulb, Radar, Trophy, HelpCircle];
function dynamicCategoryMeta(rawKind: string | null | undefined): { label: string; tone: Tone; icon: React.ElementType } {
  const k = (rawKind ?? '').trim();
  if (!k) return { label: 'Other', tone: 'slate', icon: HelpCircle };
  if (CATEGORY_META[k]) return CATEGORY_META[k]!;
  const label = k
    .split('_')
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(' ') || k;
  const h = hashString(k);
  return { label, tone: HASH_TONES[h % HASH_TONES.length]!, icon: HASH_ICONS[h % HASH_ICONS.length]! };
}

const OBJECT_TYPE_META: Record<string, { label: string; tone: Tone; icon: React.ElementType }> = {
  opportunity: { label: 'Opportunity', tone: 'emerald', icon: TrendingUp },
  discovery: { label: 'Discovery', tone: 'sky', icon: FileText },
  research: { label: 'Research', tone: 'purple', icon: FileText },
  project: { label: 'Project', tone: 'amber', icon: FolderKanban },
  decision: { label: 'Decision', tone: 'rose', icon: CheckCircle2 },
  learning_path: { label: 'Learning Path', tone: 'slate', icon: GraduationCap },
};
export function objectTypeMeta(type: string): { label: string; tone: Tone; icon: React.ElementType } {
  return OBJECT_TYPE_META[type] ?? { label: type, tone: 'slate' as Tone, icon: FileText };
}

const COLOR_TO_TONE: Record<string, Tone> = {
  emerald: 'emerald',
  sky: 'sky',
  purple: 'purple',
  amber: 'amber',
  rose: 'rose',
  slate: 'slate',
  teal: 'sky',
  indigo: 'purple',
};
function categoryTone(color: string): Tone {
  return COLOR_TO_TONE[color] ?? 'slate';
}
const ICON_COMPONENT: Record<string, React.ElementType> = {
  briefcase: Briefcase,
  'trending-up': TrendingUp,
  'file-text': FileText,
  lightbulb: Lightbulb,
  radar: Radar,
  trophy: Trophy,
  'graduation-cap': FileText,
  'dollar-sign': Briefcase,
  cpu: Radar,
  layers: FileText,
  'help-circle': HelpCircle,
};
function categoryIcon(icon: string): React.ElementType {
  return ICON_COMPONENT[icon] ?? HelpCircle;
}

function cadenceLabel(c: string): string {
  switch (c) {
    case 'hourly': return 'Hourly';
    case 'every_6_hours': return 'Every 6h';
    case 'every_12_hours': return 'Every 12h';
    case 'daily': return 'Daily';
    case 'weekly': return 'Weekly';
    default: return c;
  }
}
function formatAbsolute(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '—';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const min = Math.floor(ms / 60_000);
  const sec = Math.round((ms % 60_000) / 1000);
  return `${min}m ${sec}s`;
}

type StatusTone = 'active' | 'paused' | 'failed' | 'archived';
function statusOf(s: Subscription): StatusTone {
  if (s.status === 'paused') return 'paused';
  if (s.status === 'archived') return 'archived';
  if (s.consecutiveFailures >= 3) return 'failed';
  return 'active';
}
const STATUS_LABEL: Record<StatusTone, string> = {
  active: 'Watching',
  paused: 'Paused',
  failed: 'Failing',
  archived: 'Retired',
};
const STATUS_DOT: Record<StatusTone, string> = {
  active: 'bg-accent',
  paused: 'bg-amber-500',
  failed: 'bg-status-failed',
  archived: 'bg-p5-muted',
};

// ============================================================================
// Hooks
// ============================================================================

interface ScoutMetrics {
  totalRuns: number;
  succeededRuns: number;
  failedRuns: number;
  cancelledRuns: number;
  last7DaysRuns: number;
  last7DaysSucceeded: number;
  avgRuntimeMs: number | null;
  opportunitiesCreated: number;
  topSources: Array<{ source: string; count: number }>;
  lastSuccessAt: string | null;
  lastRunAt: string | null;
}

function useScoutMetrics(scoutId: string | null) {
  return useQuery({
    queryKey: scoutId ? scoutKeys.metrics(scoutId) : ['scout-metrics'],
    queryFn: () => api.scoutMetrics(scoutId!),
    enabled: scoutId !== null,
    refetchInterval: 60_000,
    staleTime: 5_000,
  });
}
function useScoutRuns(scoutId: string | null) {
  return useQuery({
    queryKey: scoutId ? scoutKeys.runs(scoutId) : ['scout-runs'],
    queryFn: () => api.scoutRuns(scoutId!),
    enabled: scoutId !== null,
    refetchInterval: 10_000,
  });
}
function useScoutFindings(scoutId: string | null) {
  return useQuery({
    queryKey: scoutId ? scoutKeys.findings(scoutId) : ['scout-findings'],
    queryFn: () => api.scoutFindings(scoutId!),
    enabled: scoutId !== null,
    refetchInterval: 30_000,
  });
}

// ============================================================================
// Shared primitives
// ============================================================================

function ActionBtn({
  children,
  tone = 'outline',
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'solid' | 'outline' | 'ghost' }) {
  return (
    <button
      {...rest}
      className={cn(
        'inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[44px] sm:min-h-0 text-[11px] font-black tracking-[0.12em] transition disabled:opacity-40',
        tone === 'solid' && 'bg-accent text-white hover:bg-accent-hover',
        tone === 'outline' && 'border border-p5-dark-line text-p5-dark hover:border-p5-dark hover:bg-p5-dark hover:text-p5-cream',
        tone === 'ghost' && 'text-p5-dark-muted hover:text-p5-dark',
        className,
      )}
    >
      {children}
    </button>
  );
}

function LogField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="p5-kicker text-p5-muted mb-1.5">{label}</div>
      <div>{children}</div>
    </div>
  );
}

const inputCls =
  'w-full bg-p5-ink-3 border border-white/15 px-3 py-2 h-12 sm:h-auto text-[16px] sm:text-[13px] text-p5-text placeholder:text-p5-muted outline-none focus:border-accent transition';

// ============================================================================
// Page — hero → roster deck → operative dossier
// ============================================================================

export function ScoutingInboxPage() {
  const { data: scouts, isLoading, error } = useScouts();
  const { data: findings } = useFindings();
  const { connected } = useServer();
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [showNewModal, setShowNewModal] = React.useState(false);
  const [filter, setFilter] = React.useState<'all' | 'active' | 'paused' | 'archived'>('active');
  const [search, setSearch] = React.useState('');

  const { data: categoriesData } = useQuery({
    queryKey: ['categories', 'active'],
    queryFn: () => api.categories(),
    enabled: connected,
    refetchInterval: 60_000,
  });
  const categories = categoriesData?.categories ?? [];

  const filteredScouts = React.useMemo(() => {
    if (!scouts) return [];
    let list = scouts.filter((s) => s.categoryId !== null);
    if (filter !== 'all') list = list.filter((s) => s.status === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.target.toLowerCase().includes(q) ||
          (s.category ?? '').toLowerCase().includes(q) ||
          s.instruction.toLowerCase().includes(q),
      );
    }
    return list;
  }, [scouts, filter, search]);

  const categoryById = React.useMemo(() => {
    const m = new Map<string, Category>();
    for (const c of categories) m.set(c.id, c);
    return m;
  }, [categories]);
  function categoryForScout(s: Subscription): Category | null {
    if (s.categoryId && categoryById.has(s.categoryId)) return categoryById.get(s.categoryId) ?? null;
    if (s.category) {
      const match = categories.find((c) => c.name === s.category);
      if (match) return match;
    }
    return null;
  }

  const pauseMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'active' | 'paused' }) =>
      api.updateSubscription(id, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: scoutKeys.all }),
  });
  const archiveMut = useMutation({
    mutationFn: (id: string) => api.archiveSubscription(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: scoutKeys.all });
      setSelectedId(null);
    },
  });
  const runNowMut = useMutation({
    mutationFn: (id: string) => api.runScoutNow(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: scoutKeys.all });
      if (selectedId) {
        qc.invalidateQueries({ queryKey: scoutKeys.runs(selectedId) });
        qc.invalidateQueries({ queryKey: scoutKeys.metrics(selectedId) });
      }
    },
  });

  const watchingCount = (scouts ?? []).filter((s) => s.status === 'active').length;
  const deliveredCount = (findings ?? []).filter((o) => o.status === 'open' || o.status === 'active').length;

  return (
    <div className="flex bg-p5-cream text-p5-dark flex-1 min-w-0 min-h-0">

      <main className="flex-1 min-w-0 min-h-0 overflow-y-auto px-6 py-8 md:px-10 lg:px-10 lg:py-10">
        <div className="mx-auto max-w-[1128px]">

          {/* ─── Hero ─── */}
          <header className="relative min-h-[158px]">
            <div className="min-w-0 pt-1">
              <div className="p5-kicker text-p5-dark">AUTONOMOUS RESEARCH OPERATIVES</div>
              <h1 className="mt-3">
                <span className="relative inline-block font-p5-serif text-[clamp(40px,11vw,86px)] leading-[0.88] text-p5-dark">
                  SCOUTING
                  <span className="absolute -bottom-2.5 left-0 h-[6px] w-full bg-accent" />
                </span>
              </h1>
              <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-1 font-mono text-[11px] tracking-[0.14em] text-p5-dark-muted">
                <span><span className="font-black text-accent">{watchingCount}</span> SCOUTS WATCHING</span>
                <span><span className="font-black text-p5-dark">{deliveredCount}</span> FINDINGS DELIVERED</span>
                <span><span className="font-black text-p5-dark">{(scouts ?? []).length}</span> ON THE ROSTER</span>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2 sm:absolute sm:right-0 sm:top-0 sm:mt-0 sm:gap-3">
              <Link
                to="/feed"
                className="inline-flex items-center gap-1.5 min-h-[44px] sm:min-h-0 text-[11px] font-black tracking-[0.12em] text-p5-dark-muted hover:text-p5-dark transition"
              >
                HERMES FEED <ArrowRight className="w-3.5 h-3.5" />
              </Link>
              <ActionBtn tone="solid" onClick={() => setShowNewModal(true)}>
                <Plus className="w-3.5 h-3.5" /> NEW SCOUT
              </ActionBtn>
            </div>
          </header>

          {/* ─── Deck toolbar ─── */}
          <div className="mt-7 mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="p5-kicker text-p5-dark-muted">THE ROSTER</div>
              <div className="mt-1 text-[12px] text-p5-dark-muted">Select an operative to open its dossier.</div>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-p5-dark-muted" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search scouts…"
                  className="h-9 w-52 border border-p5-dark-line bg-white pl-8 pr-2 text-[12px] text-p5-dark outline-none placeholder:text-p5-dark-muted focus:border-accent transition"
                />
              </div>
              <div className="flex border border-p5-dark-line">
                {(['all', 'active', 'paused', 'archived'] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFilter(f)}
                    className={cn(
                      'px-3 py-2 text-[10px] font-black tracking-[0.12em] uppercase transition',
                      filter === f ? 'bg-accent text-white' : 'text-p5-dark-muted hover:text-p5-dark',
                    )}
                  >
                    {f === 'active' ? 'Watching' : f}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* ─── The roster deck — one card per operative, findings-style ─── */}
          {isLoading ? (
            <div className="px-6 py-16 text-center font-mono text-[12px] tracking-widest text-p5-dark-muted">LOADING THE ROSTER…</div>
          ) : error ? (
            <div className="px-6 py-16 text-center font-mono text-[12px] tracking-widest text-accent">FAILED TO LOAD SCOUTS.</div>
          ) : filteredScouts.length === 0 ? (
            <div className="border-2 border-dashed border-p5-dark-line px-6 py-16 text-center">
              <div className="font-p5-serif text-[28px] text-p5-dark">NO SCOUTS YET.</div>
              <div className="mt-2 font-mono text-[11px] tracking-[0.14em] text-p5-dark-muted">
                DEPLOY ONE WITH NEW SCOUT — HERMES RUNS THE BRIEF.
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              {filteredScouts.map((s, i) => (
                <ScoutCard
                  key={s.id}
                  scout={s}
                  category={categoryForScout(s)}
                  index={i}
                  selected={selectedId === s.id}
                  onSelect={() => setSelectedId((cur) => (cur === s.id ? null : s.id))}
                  onPause={() =>
                    pauseMut.mutate({ id: s.id, status: s.status === 'paused' ? 'active' : 'paused' })
                  }
                  onArchive={() => {
                    if (window.confirm(`Archive "${s.name}"? This stops future runs.`)) {
                      archiveMut.mutate(s.id);
                    }
                  }}
                  onRunNow={() => runNowMut.mutate(s.id)}
                  pausing={pauseMut.isPending}
                  archiving={archiveMut.isPending}
                  runningNow={runNowMut.isPending}
                />
              ))}
            </div>
          )}

          <footer className="mt-12 text-center text-[10px] font-mono tracking-[0.25em] text-p5-dark-muted">
            SCOUTING · AUTONOMOUS RESEARCH, RAN BY HERMES
          </footer>
        </div>
      </main>

      <NewScoutModal open={showNewModal} onOpenChange={setShowNewModal} />
    </div>
  );
}

// ============================================================================
// Scout card — the roster unit, drawn in the findings-deck language:
// band header, big black title, brief, chips, actions rail. The selected
// card expands in place to open the operative file (dossier).
// ============================================================================

function MetricBox({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'emerald' | 'amber' | 'rose' }) {
  return (
    <div className="border border-black/15 bg-black/[0.02] p-3.5">
      <div className="p5-kicker text-p5-dark-muted">{label}</div>
      <div className={cn(
        'mt-1 font-p5-serif text-[28px] leading-none tabular-nums',
        tone === 'emerald' && 'text-emerald-600',
        tone === 'amber' && 'text-amber-500',
        tone === 'rose' && 'text-rose-600',
        !tone && 'text-p5-dark',
      )}>
        {value}
        {sub ? <span className="ml-1.5 text-[11px] font-normal text-p5-dark-muted">{sub}</span> : null}
      </div>
    </div>
  );
}

function ScoutCard({
  scout,
  category,
  index,
  selected,
  onSelect,
  onPause,
  onArchive,
  onRunNow,
  pausing,
  archiving,
  runningNow,
}: {
  scout: Subscription;
  category: Category | null;
  index: number;
  selected: boolean;
  onSelect: () => void;
  onPause: () => void;
  onArchive: () => void;
  onRunNow: () => void;
  pausing: boolean;
  archiving: boolean;
  runningNow: boolean;
}) {
  const meta = category
    ? { label: category.name, tone: categoryTone(category.color) as Tone, icon: categoryIcon(category.icon) }
    : dynamicCategoryMeta(scout.category);
  const status = statusOf(scout);
  const isPaused = scout.status === 'paused';
  const isArchived = scout.status === 'archived';
  const Icon = meta.icon;
  const num = String(index + 1).padStart(2, '0');

  return (
    <article
      role="article"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        'bg-white text-p5-dark border-2 transition p5-anim-slide',
        selected
          ? 'border-black [filter:drop-shadow(6px_6px_0_rgba(213,0,28,0.55))]'
          : 'border-black/15 hover:border-black [filter:drop-shadow(4px_4px_0_rgba(213,0,28,0.22))]',
      )}
      style={{ animationDelay: `${index * 60}ms` }}
    >
      {/* Hard band header — intel category color, like the findings deck */}
      <div className={cn('relative flex h-10 items-center gap-2.5 px-4', TONE_BAND[meta.tone])}>
        <span className="flex h-6 w-6 items-center justify-center border-2 border-white/60 bg-page/15 text-white">
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="text-[11px] font-black uppercase tracking-[0.2em] text-white">// {meta.label}</span>
        <span className="hidden text-[10px] font-mono tracking-widest text-white/70 sm:inline">
          CADENCE {cadenceLabel(scout.cadence).toUpperCase()}
        </span>
        <span className="relative ml-auto text-[18px] font-black leading-none tracking-tight text-white tabular-nums">{num}</span>
      </div>

      <div className="px-5 py-4">
        {/* Title + status chip */}
        <div className="flex items-start justify-between gap-4">
          <h2 className="min-w-0 flex-1 text-[23px] leading-tight font-black tracking-tight text-p5-dark break-words">{scout.name}</h2>
          <span
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 border px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.1em]',
              status === 'active' ? 'border-accent/40 text-accent' : 'border-black/20 text-p5-dark-muted',
            )}
          >
            <span className={cn('h-1.5 w-1.5 rounded-full', STATUS_DOT[status])} />
            {STATUS_LABEL[status]}
          </span>
        </div>

        {/* Brief */}
        <p className="mt-2 text-[13px] leading-relaxed text-p5-dark-muted line-clamp-2">{scout.instruction}</p>

        {/* Meta chips */}
        <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
          <span className="inline-flex max-w-full items-center gap-1.5 truncate border border-black/15 bg-black/[0.03] px-2 py-1 font-mono text-[11px] text-p5-dark-muted">
            {scout.target}
          </span>
          <span className="border border-black/15 bg-black/[0.03] px-2 py-1 font-mono text-[11px] text-p5-dark-muted">
            {cadenceLabel(scout.cadence)}
          </span>
          <span className="border border-black/15 bg-black/[0.03] px-2 py-1 font-mono text-[11px] text-p5-dark-muted">
            NEXT {formatRelative(scout.nextRunAt)}
          </span>
          {scout.lastRunAt ? (
            <span className="border border-black/15 bg-black/[0.03] px-2 py-1 font-mono text-[11px] text-p5-dark-muted">
              LAST {formatRelative(scout.lastRunAt)}
            </span>
          ) : null}
        </div>

        {/* Actions rail */}
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t-2 border-black/10 pt-3">
          {!isPaused ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onRunNow(); }}
              disabled={runningNow || isArchived}
              className="inline-flex items-center gap-1.5 bg-accent px-3.5 py-1.5 text-[12px] font-black uppercase tracking-wider text-white transition hover:bg-accent-hover disabled:opacity-40"
            >
              {runningNow ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              {runningNow ? 'Queued' : 'Run Now'}
            </button>
          ) : null}
          {!isArchived ? (
            <>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onPause(); }}
                disabled={pausing}
                className="inline-flex items-center gap-1.5 border border-black/15 px-3 py-1.5 text-[11px] font-black uppercase tracking-wider text-black/60 transition hover:bg-black hover:text-white hover:border-black disabled:opacity-40"
              >
                {isPaused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                {isPaused ? 'Resume' : 'Pause'}
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onArchive(); }}
                disabled={archiving}
                className="inline-flex items-center gap-1.5 border border-black/15 px-3 py-1.5 text-[11px] font-black uppercase tracking-wider text-black/40 transition hover:border-status-failed hover:text-status-failed disabled:opacity-40"
              >
                <Archive className="h-3.5 w-3.5" /> Archive
              </button>
            </>
          ) : null}
          <span className="ml-auto text-[10px] font-mono text-black/40 hidden sm:inline">
            {selected ? 'CLICK TO CLOSE THE FILE' : 'CLICK TO OPEN THE FILE'}
          </span>
        </div>
      </div>

      {/* Operative file — full-screen takeover on phones (ported out of the
          filtered card so `fixed` reaches the viewport), inline on sm+ */}
      {selected && mediaMatches('(max-width: 639px)')
        ? createPortal(
            <div className="fixed inset-0 z-40 overflow-y-auto bg-p5-cream p-4">
              <div className="mb-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onSelect(); }}
                  className="flex min-h-[44px] items-center gap-2 font-mono text-[11px] font-bold tracking-[0.14em] text-p5-dark"
                  aria-label="Close operative file"
                >
                  ← BACK TO ROSTER
                </button>
              </div>
              <ScoutDossier scout={scout} onRunNow={onRunNow} />
            </div>,
            document.body,
          )
        : null}
      <div className="hidden sm:block">
        {selected && !mediaMatches('(max-width: 639px)') ? <ScoutDossier scout={scout} onRunNow={onRunNow} /> : null}
      </div>
    </article>
  );
}

// ============================================================================
// Operative file — the dossier, light, inside the selected card
// ============================================================================

function ScoutDossier({
  scout,
  onRunNow,
}: {
  scout: Subscription;
  onRunNow: () => void;
}) {
  const status = statusOf(scout);

  const { data: metrics, isLoading: metricsLoading } = useScoutMetrics(scout.id);
  const { data: runs, isLoading: runsLoading } = useScoutRuns(scout.id);
  const { data: findings, isLoading: findingsLoading } = useScoutFindings(scout.id);

  const successRate =
    metrics && metrics.totalRuns > 0
      ? Math.round((metrics.succeededRuns / metrics.totalRuns) * 100)
      : null;
  const avgMs = metrics?.avgRuntimeMs ?? null;
  const recent = findings?.objects.slice(0, 5) ?? [];
  const recentRuns = runs?.runs.slice(0, 8) ?? [];

  return (
    <div className="border-t-2 border-black/10 px-5 pb-5 pt-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <span className="p5-kicker text-p5-dark-muted">
          OPERATIVE FILE — {STATUS_LABEL[status].toUpperCase()}
        </span>
        <span className="font-mono text-[10px] tracking-[0.12em] text-p5-dark-muted">
          {cadenceLabel(scout.cadence).toUpperCase()} · NEXT {formatRelative(scout.nextRunAt)}
        </span>
      </div>

      {/* Operations */}
      <div className="mb-5">
        <div className="mb-2.5 flex items-baseline gap-3">
          <span className="p5-kicker text-p5-dark">OPERATIONS</span>
          {metrics && metrics.last7DaysRuns > 0 ? (
            <span className="font-mono text-[10px] tracking-[0.12em] text-p5-dark-muted">
              LAST 7 DAYS: {metrics.last7DaysRuns} RUNS
            </span>
          ) : null}
        </div>
        {metricsLoading && !metrics ? (
          <div className="border border-dashed border-p5-dark-line py-8 text-center font-mono text-[11px] tracking-widest text-p5-dark-muted">
            LOADING OPERATIONS…
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
            <MetricBox label="Total runs" value={String(metrics?.totalRuns ?? 0)} />
            <MetricBox
              label="Success rate"
              value={successRate !== null ? `${successRate}%` : '—'}
              sub={metrics ? `${metrics.succeededRuns}/${metrics.totalRuns}` : undefined}
              tone={successRate === null ? undefined : successRate >= 80 ? 'emerald' : successRate >= 50 ? 'amber' : 'rose'}
            />
            <MetricBox
              label="Avg duration"
              value={avgMs !== null ? formatDuration(avgMs) : '—'}
              sub={avgMs !== null ? 'successful' : undefined}
            />
            <MetricBox label="Succeeded" value={String(metrics?.succeededRuns ?? 0)} tone="emerald" />
            <MetricBox label="Failed" value={String(metrics?.failedRuns ?? 0)} tone={metrics && metrics.failedRuns > 0 ? 'rose' : undefined} />
            <MetricBox label="Delivered" value={String(metrics?.opportunitiesCreated ?? 0)} />
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Delivered findings */}
        <div>
          <div className="mb-2.5 flex items-center justify-between">
            <span className="p5-kicker text-p5-dark">DELIVERED FINDINGS</span>
            <Link
              to="/scouting/findings"
              className="text-[10px] font-black tracking-[0.12em] text-accent hover:underline"
            >
              VIEW IN FINDINGS <ArrowRight className="ml-0.5 inline h-3 w-3" />
            </Link>
          </div>
          {findingsLoading && !findings ? (
            <div className="border border-dashed border-p5-dark-line py-8 text-center font-mono text-[10px] tracking-widest text-p5-dark-muted">LOADING…</div>
          ) : recent.length === 0 ? (
            <div className="border border-dashed border-p5-dark-line p-6 text-center font-mono text-[11px] tracking-widest text-p5-dark-muted">
              NOTHING DELIVERED YET — THE SCOUT IS STILL LISTENING.
            </div>
          ) : (
            <ul className="divide-y divide-black/[0.06] border border-black/15">
              {recent.map((o) => (
                <li key={o.id}>
                  <Link
                    to={`/objects/${o.id}`}
                    className="group flex items-center gap-4 px-4 py-3 transition hover:bg-black/[0.03]"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center border border-black/15 text-accent">
                      <Briefcase className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[16px] font-black leading-none tracking-tight text-p5-dark group-hover:text-accent transition">{o.title}</div>
                      {o.summary ? <div className="mt-1 truncate text-[11px] text-p5-dark-muted">{o.summary}</div> : null}
                    </div>
                    <span className="shrink-0 font-mono text-[10px] text-p5-dark-muted">{formatRelative(o.updatedAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Run history */}
        <div>
          <div className="mb-2.5 p5-kicker text-p5-dark">RUN HISTORY</div>
          {runsLoading && !runs ? (
            <div className="border border-dashed border-p5-dark-line py-8 text-center font-mono text-[10px] tracking-widest text-p5-dark-muted">LOADING…</div>
          ) : recentRuns.length === 0 ? (
            <div className="border border-dashed border-p5-dark-line p-6 text-center font-mono text-[11px] tracking-widest text-p5-dark-muted">
              NO RUNS YET — RUN NOW TO DISPATCH.
            </div>
          ) : (
            <ul className="divide-y divide-black/[0.06] border border-black/15">
              {recentRuns.map((r) => {
                const RUN_META: Record<string, { label: string; icon: React.ElementType; cls: string }> = {
                  succeeded: { label: 'Succeeded', icon: CheckCircle2, cls: 'text-emerald-600' },
                  failed: { label: 'Failed', icon: XCircle, cls: 'text-rose-600' },
                  cancelled: { label: 'Cancelled', icon: X, cls: 'text-p5-dark-muted' },
                  running: { label: 'Running', icon: Clock, cls: 'text-sky-600' },
                  dispatched: { label: 'Dispatched', icon: Clock, cls: 'text-amber-500' },
                };
                const meta = RUN_META[r.status] ?? RUN_META['dispatched']!;
                const Icon = meta.icon;
                const dur = r.startedAt && r.finishedAt
                  ? new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime()
                  : null;
                return (
                  <li key={r.id} className="flex items-center gap-4 px-4 py-2.5">
                    <Icon className={cn('h-3.5 w-3.5 shrink-0', meta.cls)} />
                    <span className="w-24 shrink-0 font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-p5-dark">
                      {meta.label}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-p5-dark-muted">
                      {r.startedAt ? formatAbsolute(r.startedAt) : '—'}
                    </span>
                    <span className="shrink-0 font-mono text-[11px] text-p5-dark-muted tabular-nums">
                      {dur !== null ? formatDuration(dur) : '—'}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        {([
          ['Cadence', cadenceLabel(scout.cadence)],
          ['Next run', scout.nextRunAt ? formatRelative(scout.nextRunAt) : '—'],
          ['Last run', scout.lastRunAt ? formatRelative(scout.lastRunAt) : '—'],
          ['Last success', metrics?.lastSuccessAt ? formatRelative(metrics.lastSuccessAt) : '—'],
        ] as Array<[string, string]>).map(([k, v]) => (
          <div key={k} className="border border-black/15 px-4 py-3">
            <div className="p5-kicker text-p5-dark-muted">{k}</div>
            <div className="mt-1.5 font-mono text-[13px] text-p5-dark">{v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// New Scout modal
// ============================================================================

function NewScoutModal({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const { data: categoriesData } = useQuery({
    queryKey: ['categories', 'active'],
    queryFn: () => api.categories(),
    enabled: open,
  });
  const categories = categoriesData?.categories ?? [];
  const [name, setName] = React.useState('');
  const [target, setTarget] = React.useState('');
  const [instruction, setInstruction] = React.useState('');
  const [cadence, setCadence] = React.useState<'every_6_hours' | 'hourly' | 'every_12_hours' | 'daily' | 'weekly'>('every_6_hours');
  const [categoryMode, setCategoryMode] = React.useState<'pick' | 'new'>('pick');
  const [categoryId, setCategoryId] = React.useState<string>('');
  const [newCategoryName, setNewCategoryName] = React.useState('');
  const [newCategoryColor, setNewCategoryColor] = React.useState<string>('slate');
  const [newCategoryIcon, setNewCategoryIcon] = React.useState<string>('help-circle');

  React.useEffect(() => {
    if (!categoryId && categories.length > 0) setCategoryId(categories[0]!.id);
  }, [categories, categoryId]);

  const createMut = useMutation({
    mutationFn: async () =>
      api.createSubscription({
        name,
        target,
        instruction,
        cadence,
        categoryId: categoryMode === 'pick' ? categoryId : undefined,
        categoryName: categoryMode === 'new' ? newCategoryName : undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['subscriptions'] });
      qc.invalidateQueries({ queryKey: ['categories', 'active'] });
      onOpenChange(false);
      setName('');
      setTarget('');
      setInstruction('');
    },
  });

  const ready =
    name.trim() && target.trim() && instruction.trim() &&
    (categoryMode === 'pick' ? !!categoryId : newCategoryName.trim().length > 0);

  return (
    <Sheet
      open={open}
      onClose={() => onOpenChange(false)}
      label="New scout"
      className="border-white/15 bg-[#1b1b1b] text-p5-text sm:max-w-lg"
      footerClassName="border-white/15 bg-[#1b1b1b]"
      footer={
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="flex-1 sm:flex-none px-3.5 py-2 min-h-[48px] sm:min-h-0 text-[11px] font-black tracking-[0.12em] text-p5-muted hover:text-p5-text transition"
          >
            CANCEL
          </button>
          <button
            type="submit"
            form="new-scout-form"
            disabled={!ready || createMut.isPending}
            className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 bg-accent px-4 py-2 min-h-[48px] sm:min-h-0 text-[11px] font-black tracking-[0.12em] text-white transition hover:bg-accent-hover disabled:opacity-40"
          >
            {createMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            CREATE SCOUT
          </button>
        </div>
      }
    >
      <div className="p-5 sm:p-6">
        <div className="font-p5-serif text-[26px] sm:text-[28px] leading-none text-p5-text tracking-normal">NEW SCOUT</div>
        <p className="mt-1.5 text-[12px] text-p5-muted">
          Hermes will run this brief on a schedule and surface what it finds.
        </p>
        <form id="new-scout-form" onSubmit={(e) => { e.preventDefault(); if (ready) createMut.mutate(); }} className="mt-4 space-y-4">
          <div>
            <label className="p5-kicker text-p5-muted">Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="ESPHome new projects" autoFocus={mediaMatches('(hover: hover)')} className={cn(inputCls, 'mt-1.5')} />
          </div>
          <div>
            <label className="p5-kicker text-p5-muted">Target</label>
            <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="github:esphome/esphome" className={cn(inputCls, 'mt-1.5')} />
            <p className="mt-1.5 text-[11px] text-p5-muted">
              e.g. <code className="text-[10px] text-p5-text">github:user/repo</code>, <code className="text-[10px] text-p5-text">rss:https://…</code>,{' '}
              <code className="text-[10px] text-p5-text">arxiv:cs.AI</code>, <code className="text-[10px] text-p5-text">hackernews:front</code>
            </p>
          </div>
          <div>
            <label className="p5-kicker text-p5-muted">Instruction to Hermes</label>
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="Find new ESPHome projects with >100 GitHub stars in the last 30 days. Summarize each with a 2-sentence pitch."
              rows={4}
              className={cn(inputCls, 'mt-1.5 min-h-[80px] resize-none')}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="p5-kicker text-p5-muted">Cadence</label>
              <select
                value={cadence}
                onChange={(e) => setCadence(e.target.value as typeof cadence)}
                className={cn(inputCls, 'mt-1.5')}
              >
                <option value="hourly">Hourly</option>
                <option value="every_6_hours">Every 6 hours</option>
                <option value="every_12_hours">Every 12 hours</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
              </select>
            </div>
            <div>
              <label className="p5-kicker text-p5-muted">Inbox category</label>
              {categoryMode === 'pick' ? (
                <select
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  className={cn(inputCls, 'mt-1.5')}
                >
                  {categories.length === 0 ? (
                    <option value="">No categories yet</option>
                  ) : null}
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              ) : (
                <input
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value.toLowerCase().replace(/\s+/g, '_'))}
                  placeholder="ai_security"
                  className={cn(inputCls, 'mt-1.5')}
                />
              )}
              <button
                type="button"
                className="mt-1.5 text-[11px] font-bold tracking-[0.1em] text-accent hover:underline"
                onClick={() => setCategoryMode((m) => (m === 'pick' ? 'new' : 'pick'))}
              >
                {categoryMode === 'pick' ? '+ NEW CATEGORY' : '← PICK EXISTING'}
              </button>
            </div>
          </div>
          {categoryMode === 'new' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="p5-kicker text-p5-muted">Color</label>
                <select value={newCategoryColor} onChange={(e) => setNewCategoryColor(e.target.value)} className={cn(inputCls, 'mt-1.5')}>
                  {['emerald', 'sky', 'purple', 'amber', 'rose', 'slate', 'teal', 'indigo'].map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="p5-kicker text-p5-muted">Icon</label>
                <select value={newCategoryIcon} onChange={(e) => setNewCategoryIcon(e.target.value)} className={cn(inputCls, 'mt-1.5')}>
                  {['briefcase', 'trending-up', 'file-text', 'lightbulb', 'radar', 'trophy', 'graduation-cap', 'dollar-sign', 'cpu', 'layers', 'help-circle'].map((i) => (
                    <option key={i} value={i}>{i}</option>
                  ))}
                </select>
              </div>
            </div>
          ) : null}
          {createMut.error ? (
            <div className="border border-status-failed/50 bg-status-failed/10 p-2.5 text-[12px] text-rose-300">
              {createMut.error instanceof Error ? createMut.error.message : 'Failed to create scout'}
            </div>
          ) : null}
        </form>
      </div>
    </Sheet>
  );
}
