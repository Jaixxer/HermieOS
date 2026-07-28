import * as React from 'react';
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
  MoreHorizontal,
  CheckCircle2,
  XCircle,
  Clock,
  Calendar,
  GitBranch,
  Settings,
  PlayCircle,
  X,
  AlertCircle,
  ListTodo,
  FolderKanban,
  GraduationCap,
  ChevronDown,
  ChevronRight,
  Star,
  DollarSign,
  Code,
  Hash,
  Code2,
  Eye,
  Heart,
  Bookmark,
  BellOff,
  MessageSquare,
  ExternalLink,
  ArrowRight,
} from 'lucide-react';
import { api } from '../api';
import type { Subscription, ObjectSummary, Category } from '../api';
import { useServer } from '../server';
import { scoutKeys, categoryKeys, useScouts, useCategories, useFindings } from '../hooks/data';
import { Sidebar } from '../components/Sidebar';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Card, CardContent } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { FeedbackButtons } from '../components/FeedbackButtons';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../components/ui/dialog';
import { cn, formatRelative } from '../lib/utils';
import { Loading } from '../components/Loading';

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
// Category metadata
// ============================================================================

type Tone = 'emerald' | 'sky' | 'purple' | 'amber' | 'rose' | 'slate';

const TONE_BG: Record<Tone, string> = {
  emerald: 'bg-emerald-100',
  sky: 'bg-sky-100',
  purple: 'bg-purple-100',
  amber: 'bg-amber-100',
  rose: 'bg-rose-100',
  slate: 'bg-slate-100',
};

const TONE_TEXT: Record<Tone, string> = {
  emerald: 'text-emerald-600',
  sky: 'text-sky-600',
  purple: 'text-purple-600',
  amber: 'text-amber-600',
  rose: 'text-rose-600',
  slate: 'text-slate-600',
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

// Hash a string into a deterministic Tone + icon for unknown categories.
// Same input always -> same output, so the UI is stable across renders
// and across users (no per-session shimmer).
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
  return {
    label,
    tone: HASH_TONES[h % HASH_TONES.length]!,
    icon: HASH_ICONS[h % HASH_ICONS.length]!,
  };
}
function categoryMeta(cat: string | null | undefined) {
  if (!cat) return { label: 'Other', tone: 'slate' as Tone, icon: HelpCircle };
  return dynamicCategoryMeta(cat);
}

/**
 * Object type → display metadata for the Findings tab. A "Finding" is
 * any object a scout produced, but the row tells you what it is —
 * opportunity, discovery, research, etc.
 */
const OBJECT_TYPE_META: Record<
  string,
  { label: string; tone: Tone; icon: React.ElementType }
> = {
  opportunity: { label: 'Opportunity', tone: 'emerald', icon: TrendingUp },
  discovery: { label: 'Discovery', tone: 'sky', icon: FileText },
  research: { label: 'Research', tone: 'purple', icon: FileText },
  project: { label: 'Project', tone: 'amber', icon: FolderKanban },
  decision: { label: 'Decision', tone: 'rose', icon: CheckCircle2 },
  learning_path: { label: 'Learning Path', tone: 'slate', icon: GraduationCap },
};
export function objectTypeMeta(type: string): { label: string; tone: Tone; icon: React.ElementType } {
  return (
    OBJECT_TYPE_META[type] ?? { label: type, tone: 'slate' as Tone, icon: FileText }
  );
}

// Map a Category row from the API to {label, tone, icon}. The API
// stores color and icon as enum strings; we resolve them to lucide
// components and the Tone used by the badge system.
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

type StatusTone = 'active' | 'paused' | 'failed' | 'archived';
function statusOf(s: Subscription): StatusTone {
  if (s.status === 'paused') return 'paused';
  if (s.status === 'archived') return 'archived';
  if (s.consecutiveFailures >= 3) return 'failed';
  return 'active';
}
const STATUS_LABEL: Record<StatusTone, string> = {
  active: 'Active',
  paused: 'Paused',
  failed: 'Failing',
  archived: 'Archived',
};
const STATUS_DOT: Record<StatusTone, string> = {
  active: 'bg-status-active',
  paused: 'bg-status-paused',
  failed: 'bg-status-failed',
  archived: 'bg-status-archived',
};

// ============================================================================
// Query key factory
// ============================================================================

// ============================================================================
// Hooks (useScouts / useCategories are imported from ../hooks/data)
// ============================================================================

// ============================================================================
// Scout metrics (per-subscription aggregates from /subscriptions/:id/metrics)
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
    refetchInterval: 15_000,
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
// Page
// ============================================================================

interface CategoryCardData {
  id: string;
  name: string;
  color: Tone;
  icon: React.ElementType;
  total: number;
  open: number;
  /** When true, render the inline-edit affordance (rename + archive). */
  managed?: boolean;
  onRename?: () => void;
  onArchive?: () => void;
  /** When set, the card is clickable; pressing it calls this. */
  onSelect?: () => void;
  /** Show a checkmark when this card is the currently drilled-into one. */
  active?: boolean;
}

const CategoryCard = React.memo(function CategoryCard({ card }: { card: CategoryCardData }) {
  const Icon = card.icon;
  return (
    <Card
      className={`transition cursor-pointer group relative ${card.active ? 'border-accent ring-1 ring-accent/30' : 'hover:border-border-strong'}`}
      onClick={card.onSelect}
      role="button"
      tabIndex={card.onSelect ? 0 : undefined}
      onKeyDown={(e) => {
        if (!card.onSelect) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          card.onSelect();
        }
      }}
    >
      <CardContent className="p-3">
        <div className={`w-8 h-8 rounded-lg ${TONE_BG[card.color]} ${TONE_TEXT[card.color]} flex items-center justify-center mb-3`}>
          <Icon className="w-4 h-4" />
        </div>
        <div className="text-[12px] text-text-tertiary flex items-center gap-1.5">
          {card.name}
          {card.active ? <span className="w-1.5 h-1.5 rounded-full bg-accent-text" /> : null}
        </div>
        <div className="flex items-baseline gap-2 mt-1">
          <span className="text-[20px] font-semibold text-text-primary">{card.total}</span>
          {card.open > 0 ? <Badge tone={card.color} variant="soft" className="text-[10px]">{card.open} new</Badge> : null}
        </div>
        {card.managed ? (
          <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition flex items-center gap-1">
            <button
              type="button"
              aria-label="Rename category"
              onClick={(e) => { e.stopPropagation(); card.onRename?.(); }}
              className="w-6 h-6 rounded hover:bg-surface-2 flex items-center justify-center text-text-quaternary hover:text-text-primary"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
              </svg>
            </button>
            <button
              type="button"
              aria-label="Archive category"
              onClick={(e) => { e.stopPropagation(); card.onArchive?.(); }}
              className="w-6 h-6 rounded hover:bg-rose-50 flex items-center justify-center text-text-quaternary hover:text-status-failed"
            >
              <Archive className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
});

export function ScoutingInboxPage() {
  const { data: scouts, isLoading, error } = useScouts();
  const { data: findings, isLoading: findingsLoading } = useFindings();
  const { connected } = useServer();
  const qc = useQueryClient();
const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [showNewModal, setShowNewModal] = React.useState(false);
  const [filter, setFilter] = React.useState<'all' | 'active' | 'paused' | 'archived'>('active');
  const [search, setSearch] = React.useState('');
  // null = "All findings"; otherwise the id of the clicked category
  // card. Clicking a category card on the inbox drills down to the
  // Findings tab filtered to that category.
  const [drillCategoryId, setDrillCategoryId] = React.useState<string | null>(null);

  // Fetch the user's scouting categories. Drives the New Scout
  // dropdown and the category card appearance.
  const { data: categoriesData } = useQuery({
    queryKey: ['categories', 'active'],
    queryFn: () => api.categories(),
    enabled: connected,
    refetchInterval: 60_000,
  });
  const categories = categoriesData?.categories ?? [];

  // Only show scouts (have a category). Group findings by
  // body->>'category_id' (preferred) or body->>'kind' (legacy).
  // When neither is set, fall back to the producing scout's
  // categoryId via body->>'subscriptionId' (Hermes may not yet
  // set category_id on every object). The actual category metadata
  // (name, color, icon) comes from the categories query so we
  // render whatever categories the user has created.
  const counts = React.useMemo(() => {
    const map = new Map<string, { total: number; open: number }>();
    const scoutById = new Map<string, Subscription>();
    for (const s of scouts ?? []) scoutById.set(s.id, s);
    for (const o of findings ?? []) {
      const body = (o as { body?: { category_id?: string; kind?: string; subscriptionId?: string } }).body ?? {};
      // Resolve the category. Order of preference:
      //   1. body.category_id (explicit)
      //   2. body.kind (legacy; matched by name in render)
      //   3. The producing scout's categoryId (most common path for
      //      objects Hermes tagged with subscriptionId but not category_id)
      //   4. The producing scout's legacy `category` text
      //   5. 'other' (uncategorized)
      let key: string | null = body.category_id ?? null;
      if (!key && body.kind) {
        const byName = categories.find((c) => c.name === body.kind);
        if (byName) key = byName.id;
      }
      if (!key && body.subscriptionId) {
        const scout = scoutById.get(body.subscriptionId);
        if (scout?.categoryId) key = scout.categoryId;
        else if (scout?.category) {
          const byName = categories.find((c) => c.name === scout.category);
          if (byName) key = byName.id;
        }
      }
      if (!key) key = categories.find((c) => c.name === 'other')?.id ?? 'other';
      const cur = map.get(key) ?? { total: 0, open: 0 };
      cur.total += 1;
      if (o.status === 'open' || o.status === 'active' || o.status === 'in_progress') cur.open += 1;
      map.set(key, cur);
    }
    return map;
  }, [findings, scouts, categories]);

  // Category management state
  const [managingCategory, setManagingCategory] = React.useState<Category | null>(null);
  const [showNewCategoryModal, setShowNewCategoryModal] = React.useState(false);

  const createCategoryMut = useMutation({
    mutationFn: (body: { name: string; color?: string; icon?: string }) => api.createCategory(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories', 'active'] });
      setShowNewCategoryModal(false);
    },
  });
  const updateCategoryMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { name?: string; color?: string; icon?: string; sortOrder?: number } }) =>
      api.updateCategory(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories', 'active'] });
      setManagingCategory(null);
    },
  });
  const archiveCategoryMut = useMutation({
    mutationFn: (id: string) => api.archiveCategory(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories', 'active'] });
      qc.invalidateQueries({ queryKey: scoutKeys.all });
      setManagingCategory(null);
    },
  });

  const categoryCards = React.useMemo(() => {
    const known = new Set(categories.map((c) => c.id));
    const suggested = SUGGESTED_CATEGORY_NAMES;
    const suggestedWithData = suggested
      .map((name) => {
        const cat = categories.find((c) => c.name === name);
        if (!cat) return null;
        const c = counts.get(cat.id) ?? { total: 0, open: 0 };
        return { id: cat.id, name: cat.name, color: categoryTone(cat.color), icon: categoryIcon(cat.icon), total: c.total, open: c.open } as CategoryCardData;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null && x.total > 0);
    const dynamicEntries = [...counts.entries()]
      .filter(([key]) => !known.has(key) && !suggested.some((n) => categories.find((c) => c.name === n)?.id === key))
      .map(([key, c]) => {
        const meta = dynamicCategoryMeta(key);
        return { id: key, name: meta.label, color: meta.tone, icon: meta.icon, total: c.total, open: c.open } as CategoryCardData;
      });
    const userCategories = categories
      .filter((c) => !suggested.includes(c.name))
      .map((c) => {
        const stat = counts.get(c.id) ?? { total: 0, open: 0 };
        return { id: c.id, name: c.name, color: categoryTone(c.color), icon: categoryIcon(c.icon), total: stat.total, open: stat.open } as CategoryCardData;
      })
      .filter((c) => c.total > 0)
      .sort((a, b) => b.open - a.open || b.total - a.total);
    const ordered = [
      ...suggestedWithData,
      ...userCategories,
      ...dynamicEntries.sort((a, b) => b.open - a.open || b.total - a.total),
    ];
    return ordered;
  }, [counts, categories]);

  // All categories (incl. those with zero opportunities) for the
  // management section. Driven by the same categories query.
  const allCategoriesWithManaged = React.useMemo(() => {
    return categories.map((c) => ({
      id: c.id,
      name: c.name,
      color: categoryTone(c.color),
      icon: categoryIcon(c.icon),
      total: 0,
      open: 0,
      managed: true,
    } as CategoryCardData));
  }, [categories]);

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

  // Lookup helper: given a subscription's categoryId, return the
  // category row (from the categories list), or a synthetic fallback
  // for legacy subscriptions whose categoryId is null but category text
  // is set.
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

  React.useEffect(() => {
    if (selectedId === null && filteredScouts.length > 0) setSelectedId(filteredScouts[0]!.id);
  }, [filteredScouts, selectedId]);

  const selected = scouts?.find((s) => s.id === selectedId) ?? null;

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

  return (
    <div className="min-h-screen flex bg-page text-text-primary">
      <Sidebar activePath="/scouting" className="hidden lg:flex" />

      <main className="flex-1 min-w-0 flex flex-col">
        {/* Top header */}
        <div className="px-8 pt-6 pb-4 border-b border-border-default">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-[24px] font-semibold tracking-tight text-text-primary">Scouting</h1>
              <p className="text-[13px] text-text-tertiary mt-1">
                Workspace for managing and inspecting your autonomous research agents.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Link
                to="/feed"
                className="text-[12px] font-medium text-text-secondary hover:text-accent-text transition flex items-center gap-1.5"
              >
                <ListTodo className="w-3.5 h-3.5" />
                Hermes Feed →
              </Link>
              <Button onClick={() => setShowNewModal(true)} className="gap-2 rounded-lg">
                <Plus className="w-4 h-4" /> New Scout
              </Button>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-8">
          {/* Category cards — filter/drill + management in one unified section */}
          <section>
            <div className="flex items-end justify-between mb-3">
              <div>
                <h2 className="text-[15px] font-semibold text-text-primary">Categories</h2>
                <p className="text-[12px] text-text-tertiary">
                  Click a category to filter its findings. Hover to rename or archive.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 rounded-lg"
                onClick={() => setShowNewCategoryModal(true)}
              >
                <Plus className="w-3.5 h-3.5" />
                New Category
              </Button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
              {(allCategoriesWithManaged.length > 0 ? allCategoriesWithManaged : categoryCards).map((c) => (
                <CategoryCard
                  key={c.id}
                  card={{
                    ...c,
                    onSelect: () => setDrillCategoryId((cur) => (cur === c.id ? null : c.id)),
                    active: drillCategoryId === c.id,
                    onRename: () => setManagingCategory(c as unknown as Category),
                    onArchive: () => {
                      if (window.confirm(`Archive category "${c.name}"?`)) {
                        archiveCategoryMut.mutate(c.id);
                      }
                    },
                  }}
                />
              ))}
            </div>
          </section>

          {/* Feedback — user-feedback loop dashboard: stats,
              recent rows with inline re-rating, and suggest notes
              so the user can see what Hermes is tracking. */}
          <FeedbackSection />

          {/* Findings — every object a scout produced. Filtered by the
              selected category card when one is clicked; otherwise
              shows everything. Inline feedback actions on each row. */}
          <FindingsSection
            findings={findings ?? []}
            loading={findingsLoading}
            drillCategoryId={drillCategoryId}
            onClearDrill={() => setDrillCategoryId(null)}
            categories={categories}
          />

          {/* Middle: Scouts table */}
          <section className="mt-6">
            <Card className="overflow-hidden">
              <CardContent className="p-5">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                  <div>
                    <h2 className="text-[15px] font-semibold text-text-primary">Your Scouts</h2>
                    <p className="text-[12px] text-text-tertiary">Active automated research scouts.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {(['all', 'active', 'paused', 'archived'] as const).map((f) => (
                      <Button
                        key={f}
                        variant={filter === f ? 'secondary' : 'ghost'}
                        size="sm"
                        onClick={() => setFilter(f)}
                        className="text-[12px] capitalize rounded-lg"
                      >
                        {f}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="relative mb-3">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-quaternary" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search scouts..."
                    className="pl-9"
                  />
                </div>

                {isLoading ? (
                  <div className="text-center text-text-tertiary py-12">Loading scouts…</div>
                ) : error ? (
                  <div className="text-center text-status-failed py-12">Failed to load scouts.</div>
                ) : filteredScouts.length === 0 ? (
                  <div className="text-center text-text-tertiary py-12">No scouts yet. Click "New Scout" to create one.</div>
                ) : (
                  <div className="border border-border-default rounded-lg overflow-hidden">
                    <table className="w-full text-[13px]">
                      <thead className="bg-surface-1 border-b border-border-default">
                        <tr>
                          <th className="text-left px-4 py-2.5 font-medium text-text-tertiary">Scout</th>
                          <th className="text-left px-4 py-2.5 font-medium text-text-tertiary">Category</th>
                          <th className="text-left px-4 py-2.5 font-medium text-text-tertiary">Cadence</th>
                          <th className="text-left px-4 py-2.5 font-medium text-text-tertiary">Next Run</th>
                          <th className="text-left px-4 py-2.5 font-medium text-text-tertiary">Status</th>
                          <th className="px-4 py-2.5" />
                        </tr>
                      </thead>
                      <tbody>
                        {filteredScouts.map((s) => {
                          const cat = categoryForScout(s);
                          const meta = cat
                            ? { label: cat.name, tone: (categoryTone(cat.color) ?? 'slate') as Tone, icon: categoryIcon(cat.icon) }
                            : { label: s.category ?? 'Other', tone: 'slate' as Tone, icon: HelpCircle };
                          const status = statusOf(s);
                          const Icon = meta.icon;
                          return (
                            <tr
                              key={s.id}
                              onClick={() => setSelectedId(s.id)}
                              className={cn(
                                'border-b border-border-default last:border-0 cursor-pointer transition',
                                selectedId === s.id ? 'bg-accent-soft' : 'hover:bg-surface-1',
                              )}
                            >
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-3">
                                  <div className={`w-8 h-8 rounded-lg ${TONE_BG[meta.tone]} ${TONE_TEXT[meta.tone]} flex items-center justify-center`}>
                                    <Icon className="w-4 h-4" />
                                  </div>
                                  <div>
                                    <div className="font-medium text-text-primary">{s.name}</div>
                                    <div className="text-[11px] text-text-tertiary truncate max-w-[280px]">
                                      {s.target} · {formatRelative(s.nextRunAt)}
                                    </div>
                                  </div>
                                </div>
                              </td>
                              <td className="px-4 py-3"><Badge tone={meta.tone} variant="soft">{meta.label}</Badge></td>
                              <td className="px-4 py-3 text-text-secondary">{cadenceLabel(s.cadence)}</td>
                              <td className="px-4 py-3 text-text-secondary">{formatRelative(s.nextRunAt)}</td>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-1.5">
                                  <span className={cn('w-1.5 h-1.5 rounded-full', STATUS_DOT[status])} />
                                  <span className="text-[12px] text-text-secondary">{STATUS_LABEL[status]}</span>
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <button
                                  className="w-7 h-7 rounded hover:bg-surface-2 flex items-center justify-center text-text-tertiary"
                                  onClick={(e) => e.stopPropagation()}
                                  aria-label="More"
                                >
                                  <MoreHorizontal className="w-4 h-4" />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </section>

          {/* Scout detail panel */}
          {selected ? (
            <section className="mt-6">
              <ScoutDetailPanel
                scout={selected}
                category={categoryForScout(selected)}
                onPause={() =>
                  pauseMut.mutate({ id: selected.id, status: selected.status === 'paused' ? 'active' : 'paused' })
                }
                onArchive={() => {
                  if (window.confirm(`Archive "${selected.name}"? This stops future runs.`)) {
                    archiveMut.mutate(selected.id);
                  }
                }}
                onRunNow={() => runNowMut.mutate(selected.id)}
                pausing={pauseMut.isPending}
                archiving={archiveMut.isPending}
                runningNow={runNowMut.isPending}
              />
            </section>
          ) : null}
        </div>
      </main>

      <NewScoutModal open={showNewModal} onOpenChange={setShowNewModal} />
      <NewCategoryDialog
        open={showNewCategoryModal}
        onOpenChange={setShowNewCategoryModal}
        createMut={createCategoryMut}
      />
      <EditCategoryDialog
        category={managingCategory}
        onClose={() => setManagingCategory(null)}
        updateMut={updateCategoryMut}
        archiveMut={archiveCategoryMut}
      />
    </div>
  );
}

// ============================================================================
// Scout detail panel (Overview / Findings / Run History / Settings tabs)
// ============================================================================

type ScoutTab = 'overview' | 'findings' | 'runs' | 'settings';

function ScoutDetailPanel({
  scout,
  category,
  onPause,
  onArchive,
  onRunNow,
  pausing,
  archiving,
  runningNow,
}: {
  scout: Subscription;
  category: Category | null;
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

  const [tab, setTab] = React.useState<ScoutTab>('overview');
  // Reset to overview when scout changes
  React.useEffect(() => { setTab('overview'); }, [scout.id]);

  const { data: metrics, isLoading: metricsLoading } = useScoutMetrics(scout.id);
  const { data: runs, isLoading: runsLoading } = useScoutRuns(scout.id);
  const { data: findings, isLoading: findingsLoading } = useScoutFindings(scout.id);

  const tabs: Array<{ key: ScoutTab; label: string }> = [
    { key: 'overview', label: 'Overview' },
    { key: 'findings', label: 'Findings' },
    { key: 'runs', label: 'Run History' },
    { key: 'settings', label: 'Settings' },
  ];

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-5">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4 mb-5 pb-5 border-b border-border-default">
          <div className="flex items-start gap-3">
            <div className={`w-11 h-11 rounded-xl ${TONE_BG[meta.tone]} ${TONE_TEXT[meta.tone]} flex items-center justify-center`}>
              <Icon className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <Badge tone={status === 'active' ? 'emerald' : status === 'paused' ? 'amber' : status === 'failed' ? 'rose' : 'slate'} variant="soft">
                  {STATUS_LABEL[status]}
                </Badge>
                <Badge tone={meta.tone} variant="soft">{meta.label}</Badge>
                {isPaused ? null : (
                  <Button
                    variant="default"
                    size="sm"
                    onClick={onRunNow}
                    disabled={runningNow || isArchived}
                    className="gap-1.5 rounded-lg"
                  >
                    {runningNow ? <Clock className="w-3.5 h-3.5 animate-spin" /> : <PlayCircle className="w-3.5 h-3.5" />}
                    {runningNow ? 'Queued' : 'Run Now'}
                  </Button>
                )}
              </div>
              <h2 className="text-[20px] font-semibold text-text-primary">{scout.name}</h2>
              <div className="mt-1 flex items-center gap-1.5 font-mono text-[12px]">
                <span className="text-text-quaternary">target</span>
                <span className="text-text-secondary truncate max-w-[420px]">{scout.target}</span>
              </div>
              {scout.instruction ? (
                <p className="mt-2 text-[13px] text-text-tertiary max-w-2xl leading-relaxed">{scout.instruction}</p>
              ) : null}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!isArchived ? (
              <Button
                variant="outline"
                size="sm"
                onClick={onPause}
                disabled={pausing}
                className="gap-1.5 rounded-lg"
              >
                {isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                {isPaused ? 'Resume' : 'Pause'}
              </Button>
            ) : null}
            {!isArchived ? (
              <Button
                variant="outline"
                size="sm"
                onClick={onArchive}
                disabled={archiving}
                className="gap-1.5 rounded-lg"
              >
                <Archive className="w-3.5 h-3.5" /> Archive
              </Button>
            ) : null}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 border-b border-border-default mb-5 -mx-5 px-5">
          {tabs.map((t) => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  'px-3 py-2 text-[13px] font-medium border-b-2 transition',
                  active
                    ? 'text-accent-text border-accent'
                    : 'text-text-tertiary border-transparent hover:text-text-primary',
                )}
              >
                {t.label}
                {t.key === 'findings' && findings?.objects ? (
                  <span className="ml-1.5 text-[10px] text-text-quaternary">({findings.objects.length})</span>
                ) : null}
                {t.key === 'runs' && runs?.runs ? (
                  <span className="ml-1.5 text-[10px] text-text-quaternary">({runs.runs.length})</span>
                ) : null}
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        {tab === 'overview' ? (
          <OverviewTab
            scout={scout}
            metrics={metrics ?? null}
            metricsLoading={metricsLoading}
          />
        ) : null}
        {tab === 'findings' ? (
          <FindingsTab findings={findings?.objects ?? null} loading={findingsLoading} />
        ) : null}
        {tab === 'runs' ? (
          <RunsTab runs={runs?.runs ?? null} loading={runsLoading} />
        ) : null}
        {tab === 'settings' ? (
          <SettingsTab scout={scout} />
        ) : null}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Overview tab
// ============================================================================

function OverviewTab({
  scout,
  metrics,
  metricsLoading,
}: {
  scout: Subscription;
  metrics: ScoutMetrics | null;
  metricsLoading: boolean;
}) {
  const { data: findings } = useScoutFindings(scout.id);
  const recent = findings?.objects.slice(0, 5) ?? [];

  const successRate =
    metrics && metrics.totalRuns > 0
      ? Math.round((metrics.succeededRuns / metrics.totalRuns) * 100)
      : null;

  const avgMs = metrics?.avgRuntimeMs ?? null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <div className="lg:col-span-2 space-y-5">
        {/* Metric grid */}
        <div>
          <h3 className="text-[14px] font-semibold text-text-primary mb-3">
            Scout Performance
            {metrics && metrics.last7DaysRuns > 0 ? (
              <span className="ml-2 text-[11px] font-normal text-text-tertiary">last 7 days: {metrics.last7DaysRuns} runs</span>
            ) : null}
          </h3>
          {metricsLoading && !metrics ? (
            <Loading text="Loading metrics…" className="py-6" />
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
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
              <MetricBox label="Findings" value={String(metrics?.opportunitiesCreated ?? 0)} />
            </div>
          )}
        </div>

        {/* Recent findings */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[14px] font-semibold text-text-primary">Recent Findings</h3>
            {findings && findings.objects.length > 5 ? (
              <span className="text-[12px] text-text-tertiary">Showing 5 of {findings.objects.length}</span>
            ) : null}
          </div>
          {recent.length === 0 ? (
            <div className="border border-dashed border-border-default rounded-lg p-6 text-center text-[13px] text-text-tertiary">
              No findings yet. Hermes will record opportunities here as the scout runs.
            </div>
          ) : (
            <ul className="border border-border-default rounded-lg overflow-hidden divide-y divide-border-default">
              {recent.map((o) => (
                <li key={o.id}>
                  <Link
                    to={`/objects/${o.id}`}
                    className="flex items-center gap-3 px-3 py-2.5 hover:bg-surface-1 transition"
                  >
                    <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
                      <Briefcase className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] text-text-primary truncate">{o.title}</div>
                      {o.summary ? <div className="text-[11px] text-text-tertiary truncate">{o.summary}</div> : null}
                    </div>
                    <span className="text-[11px] text-text-quaternary shrink-0">{formatRelative(o.updatedAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Right: source breakdown + timing */}
      <div className="space-y-5">
        <div>
          <h3 className="text-[14px] font-semibold text-text-primary mb-3">Top Sources</h3>
          {metrics && metrics.topSources.length > 0 ? (
            <Card>
              <CardContent className="p-3 space-y-2">
                {metrics.topSources.map((s) => (
                  <div key={s.source} className="flex items-center justify-between text-[13px]">
                    <span className="text-text-secondary truncate mr-2">{s.source}</span>
                    <span className="font-medium text-text-primary tabular-nums">{s.count}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-4 text-center text-[12px] text-text-tertiary">
                No source breakdown yet.
              </CardContent>
            </Card>
          )}
        </div>

        <div>
          <h3 className="text-[14px] font-semibold text-text-primary mb-3">Timing</h3>
          <Card>
            <CardContent className="p-3 space-y-2 text-[13px]">
              <div className="flex items-center justify-between">
                <span className="text-text-secondary">Cadence</span>
                <span className="font-medium text-text-primary">{cadenceLabel(scout.cadence)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-text-secondary">Next run</span>
                <span className="font-medium text-text-primary">{formatRelative(scout.nextRunAt)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-text-secondary">Last run</span>
                <span className="font-medium text-text-primary">{scout.lastRunAt ? formatRelative(scout.lastRunAt) : '—'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-text-secondary">Last success</span>
                <span className="font-medium text-text-primary">{metrics?.lastSuccessAt ? formatRelative(metrics.lastSuccessAt) : '—'}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function MetricBox({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'emerald' | 'amber' | 'rose' }) {
  return (
    <div className="border border-border-default rounded-lg p-3 bg-surface-0">
      <div className="text-[11px] text-text-tertiary mb-1">{label}</div>
      <div className={cn(
        'text-[20px] font-semibold tabular-nums',
        tone === 'emerald' && 'text-accent-text',
        tone === 'amber' && 'text-amber-600',
        tone === 'rose' && 'text-status-failed',
        !tone && 'text-text-primary',
      )}>
        {value}
        {sub ? <span className="ml-1.5 text-[11px] text-text-tertiary font-normal">{sub}</span> : null}
      </div>
    </div>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const min = Math.floor(ms / 60_000);
  const sec = Math.round((ms % 60_000) / 1000);
  return `${min}m ${sec}s`;
}

// ============================================================================
// Findings tab
// ============================================================================

function FindingsTab({ findings, loading }: { findings: ObjectSummary[] | null; loading: boolean }) {
  const qc = useQueryClient();
  if (loading) return <Loading text="Loading findings…" className="py-6" />;
  if (!findings || findings.length === 0) {
    return (
      <div className="border border-dashed border-border-default rounded-lg p-10 text-center space-y-2">
        <p className="text-[14px] text-text-primary font-medium">No findings yet</p>
        <p className="text-[12px] text-text-tertiary max-w-md mx-auto">
          When this scout runs, anything Hermes records (opportunities,
          discoveries, research, …) shows up here. An empty tab means
          Hermes had nothing to record on the last run — that's expected
          if the source hasn't changed.
        </p>
        <p className="text-[11px] text-text-quaternary pt-1">
          Tip: check the Run History tab to see what the last run did.
        </p>
      </div>
    );
  }

  function archiveLocal(id: string): void {
    qc.setQueryData<{ objects: ObjectSummary[] } | undefined>(
      ['scout', 'findings'],
      (old) =>
        old
          ? { objects: old.objects.filter((o) => o.id !== id) }
          : old,
    );
    qc.invalidateQueries({ queryKey: ['object', id] });
  }

  return (
    <div className="border border-border-default rounded-lg overflow-hidden">
      <table className="w-full text-[13px]">
        <thead className="bg-surface-1 border-b border-border-default">
          <tr>
            <th className="text-left px-4 py-2.5 font-medium text-text-tertiary">Title</th>
            <th className="text-left px-4 py-2.5 font-medium text-text-tertiary">Type</th>
            <th className="text-left px-4 py-2.5 font-medium text-text-tertiary">Category</th>
            <th className="text-left px-4 py-2.5 font-medium text-text-tertiary">Status</th>
            <th className="text-left px-4 py-2.5 font-medium text-text-tertiary">Updated</th>
            <th className="text-right px-4 py-2.5 font-medium text-text-tertiary">Actions</th>
          </tr>
        </thead>
        <tbody>
          {findings.map((o) => {
            const body = (o as { body?: { kind?: string; category_id?: string } }).body ?? {};
            const typeMeta = objectTypeMeta(o.type);
            const kindLabel = body.kind ?? null;
            return (
              <tr key={o.id} className="border-b border-border-default last:border-0 hover:bg-surface-1 transition">
                <td className="px-4 py-2.5">
                  <Link to={`/objects/${o.id}`} className="text-text-primary hover:text-accent-text hover:underline">
                    {o.title}
                  </Link>
                  {o.summary ? <div className="text-[11px] text-text-tertiary mt-0.5 line-clamp-2">{o.summary}</div> : null}
                </td>
                <td className="px-4 py-2.5">
                  <Badge tone={typeMeta.tone} variant="soft">
                    {typeMeta.label}
                  </Badge>
                </td>
                <td className="px-4 py-2.5">
                  {kindLabel ? (
                    <Badge tone="slate" variant="outline">
                      {kindLabel}
                    </Badge>
                  ) : (
                    <span className="text-text-quaternary text-[12px]">—</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-text-secondary">{o.status}</td>
                <td className="px-4 py-2.5 text-text-secondary">{formatRelative(o.updatedAt)}</td>
                <td className="px-4 py-2.5">
                  <div className="flex justify-end">
                    <FeedbackButtons
                      objectId={o.id}
                      compact
                      kinds={['like', 'save', 'ignore', 'archive']}
                      onAction={(k) => {
                        if (k === 'archive') archiveLocal(o.id);
                      }}
                    />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================================
// Findings Section (under the Inbox category cards)
// ============================================================================

interface FindingsSectionProps {
  findings: ObjectSummary[];
  loading: boolean;
  drillCategoryId: string | null;
  onClearDrill: () => void;
  categories: Category[];
  limit?: number;
}

function FindingsSection({
  findings,
  loading,
  drillCategoryId,
  onClearDrill,
  categories,
  limit = 5,
}: FindingsSectionProps): React.JSX.Element {
  const qc = useQueryClient();
  const [sortBy, setSortBy] = React.useState<'updated' | 'type'>('updated');
  const [typeFilter, setTypeFilter] = React.useState<'all' | ObjectSummary['type']>('all');

  // Resolve the producing category for each finding. The body may
  // carry it directly (body.category_id), or we can fall back to the
  // scout that produced it via body.subscriptionId. Without this
  // resolve the drill-down would miss anything Hermes created before
  // we added the category_id field.
  const { data: scouts } = useScouts();
  const scoutCatId = React.useMemo(() => {
    const m = new Map<string, string | null>();
    for (const s of scouts ?? []) m.set(s.id, s.categoryId);
    return m;
  }, [scouts]);

  function categoryKeyOf(o: ObjectSummary): string | null {
    const body = (o as { body?: { category_id?: string; kind?: string; subscriptionId?: string } }).body ?? {};
    if (body.category_id) return body.category_id;
    if (body.kind) {
      const byName = categories.find((c) => c.name === body.kind);
      if (byName) return byName.id;
    }
    if (body.subscriptionId) {
      const cid = scoutCatId.get(body.subscriptionId);
      if (cid) return cid;
    }
    return null;
  }

  const filtered = React.useMemo(() => {
    let list = findings;
    if (drillCategoryId) {
      list = list.filter((o) => categoryKeyOf(o) === drillCategoryId);
    }
    if (typeFilter !== 'all') {
      list = list.filter((o) => o.type === typeFilter);
    }
    if (sortBy === 'type') {
      list = [...list].sort((a, b) => a.type.localeCompare(b.type));
    }
    return list;
  }, [findings, drillCategoryId, typeFilter, sortBy, scoutCatId, categories]);

  const drillCat = drillCategoryId
    ? categories.find((c) => c.id === drillCategoryId)
    : null;

  function archiveLocal(id: string): void {
    qc.setQueryData<{ objects: ObjectSummary[] } | undefined>(
      ['findings-for-buckets'],
      (old) => (old ? { objects: old.objects.filter((o) => o.id !== id) } : old),
    );
  }

  const typeOptions: Array<{ value: 'all' | ObjectSummary['type']; label: string }> = [
    { value: 'all', label: 'All types' },
    { value: 'opportunity', label: 'Opportunities' },
    { value: 'discovery', label: 'Discoveries' },
    { value: 'research', label: 'Research' },
    { value: 'project', label: 'Projects' },
    { value: 'decision', label: 'Decisions' },
  ];

  return (
    <section className="mt-8">
      <div className="flex items-end justify-between gap-3 mb-3 flex-wrap">
        <div>
          <h2 className="text-[15px] font-semibold text-text-primary">Findings</h2>
          <p className="text-[12px] text-text-tertiary">
            Every object a scout produced. Click a category card above to drill in.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as 'all' | ObjectSummary['type'])}
            className="text-[12px] h-8 px-2 rounded-md border border-border-default bg-surface-0 text-text-primary"
          >
            {typeOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'updated' | 'type')}
            className="text-[12px] h-8 px-2 rounded-md border border-border-default bg-surface-0 text-text-primary"
          >
            <option value="updated">Newest first</option>
            <option value="type">By type</option>
          </select>
        </div>
      </div>

      {drillCat ? (
        <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-lg bg-accent/10 border border-accent/30 text-[12px] text-text-primary">
          <span>
            Showing findings in <span className="font-medium">{drillCat.name}</span>
          </span>
          <button
            type="button"
            onClick={onClearDrill}
            className="ml-auto text-accent-text hover:underline"
          >
            Clear filter
          </button>
        </div>
      ) : null}

      {loading ? (
        <Loading text="Loading findings…" className="py-6" />
      ) : filtered.length === 0 ? (
        <div className="border border-dashed border-border-default rounded-lg p-10 text-center">
          <p className="text-[13px] text-text-tertiary">
            {findings.length === 0
              ? 'No findings yet. Hermes will record them here as scouts run.'
              : 'No findings match the current filter.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.slice(0, limit).map((o) => (
            <FindingRow key={o.id} obj={o} onArchive={() => archiveLocal(o.id)} />
          ))}
          {filtered.length > limit ? (
            <div className="text-center pt-2">
              <Link
                to="/scouting/findings"
                className="inline-flex items-center gap-1.5 text-[12px] text-accent-text hover:underline"
              >
                View all {filtered.length} findings
                <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

function FindingRow({
  obj,
  onArchive,
}: {
  obj: ObjectSummary;
  onArchive: () => void;
}): React.JSX.Element {
  const body = (obj as { body?: { url?: string; kind?: string; category_id?: string; stars?: number; cost_estimate?: string } }).body ?? {};
  const typeMeta = objectTypeMeta(obj.type);
  const Icon = typeMeta.icon;
  const url = body.url;
  const stars = body.stars;
  const cost = body.cost_estimate;
  return (
    <Card className="hover:border-border-strong transition">
      <CardContent className="p-4">
        <div className="flex items-start gap-4">
          <div className={`w-9 h-9 rounded-lg ${TONE_BG[typeMeta.tone]} ${TONE_TEXT[typeMeta.tone]} flex items-center justify-center shrink-0`}>
            <Icon className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Link
                to={`/objects/${obj.id}`}
                className="text-[14px] font-medium text-text-primary hover:text-accent-text hover:underline"
              >
                {obj.title}
              </Link>
              <Badge tone={typeMeta.tone} variant="soft">
                {typeMeta.label}
              </Badge>
              {body.kind ? (
                <Badge tone="slate" variant="outline">
                  {body.kind}
                </Badge>
              ) : null}
              {obj.status !== 'open' ? (
                <Badge tone="slate" variant="outline">
                  {obj.status}
                </Badge>
              ) : null}
              <span className="text-[11px] text-text-quaternary ml-auto">
                {formatRelative(obj.updatedAt)}
              </span>
            </div>
            {obj.summary ? (
              <p className="text-[13px] text-text-tertiary mt-1 line-clamp-2">{obj.summary}</p>
            ) : null}
            <div className="flex items-center gap-3 mt-2 text-[11px] text-text-quaternary flex-wrap">
              {url ? (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-accent-text hover:underline"
                >
                  <ExternalLink className="w-3 h-3" />
                  Open
                </a>
              ) : null}
              {stars !== undefined && stars !== null ? (
                <span className="inline-flex items-center gap-1">
                  <Star className="w-3 h-3" /> {stars.toLocaleString()}
                </span>
              ) : null}
              {cost ? <span>{cost}</span> : null}
            </div>
          </div>
          <div className="shrink-0">
            <FeedbackButtons
              objectId={obj.id}
              compact
              kinds={['like', 'save', 'ignore', 'archive']}
              onAction={(k) => {
                if (k === 'archive') onArchive();
              }}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Feedback Section (dashboard tab for the user-feedback loop)
// ============================================================================

function useFeedbackSummary(days = 7, limit = 50) {
  return useQuery({
    queryKey: ['feedback-summary', days, limit],
    queryFn: () => api.feedbackSummary({ days, limit }),
    refetchInterval: 60_000,
  });
}

function FeedbackSection(): React.JSX.Element | null {
  const { data: summary, isLoading } = useFeedbackSummary();

  const stats = summary?.stats;
  const rows = summary?.rows ?? [];

  if (isLoading && !stats) {
    return null;
  }

  if (!stats || stats.total === 0) {
    return (
      <section className="mt-8">
        <div className="flex items-end justify-between mb-3">
          <div>
            <h2 className="text-[15px] font-semibold text-text-primary">Feedback</h2>
            <p className="text-[12px] text-text-tertiary">
              No feedback yet. Rate scout findings to shape what Hermes prioritises next.
            </p>
          </div>
        </div>
      </section>
    );
  }

  const kindLabels: Record<string, string> = { like: 'Liked', save: 'Saved', ignore: 'Ignored', archive: 'Archived', suggest: 'Suggests' };

  return (
    <section className="mt-8">
      <div className="flex items-end justify-between mb-3">
        <div>
          <h2 className="text-[15px] font-semibold text-text-primary">Feedback</h2>
          <p className="text-[12px] text-text-tertiary">
            Last {summary.days} days — {stats.total} actions. What the next scout will see is shaped by these signals.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        {(Object.entries(stats.byKind) as Array<[string, number]>).map(([kind, count]) => (
          <div key={kind} className="border border-border-default rounded-lg p-3 bg-surface-0">
            <div className="text-[11px] text-text-tertiary uppercase tracking-wider">{kindLabels[kind] ?? kind}</div>
            <div className="text-[20px] font-semibold text-text-primary mt-1">{count}</div>
          </div>
        ))}
      </div>

      {Object.keys(stats.likedOrSavedByType).length > 0 ? (
        <Card className="mb-4">
          <CardContent className="p-4">
            <h3 className="text-[13px] font-semibold text-text-primary mb-2">Liked &amp; Saved by type</h3>
            <div className="flex flex-wrap gap-2">
              {Object.entries(stats.likedOrSavedByType).map(([type, count]) => (
                <Badge key={type} tone="emerald" variant="soft">
                  {type}: {count}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {stats.suggestNotes.length > 0 ? (
        <Card className="mb-4 border-accent/30">
          <CardContent className="p-4">
            <h3 className="text-[13px] font-semibold text-text-primary mb-2 flex items-center gap-2">
              <Lightbulb className="w-4 h-4 text-accent-text" /> Suggest notes from you
            </h3>
            <ul className="space-y-2">
              {stats.suggestNotes.map((n) => (
                <li key={n.objectId} className="flex items-start gap-2 text-[13px]">
                  <ArrowRight className="w-3.5 h-3.5 text-text-quaternary mt-0.5 shrink-0" />
                  <span className="text-text-primary font-medium">{n.objectTitle}</span>
                  <span className="text-text-tertiary">— {n.note}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="p-4">
          <h3 className="text-[13px] font-semibold text-text-primary mb-3">Recent activity</h3>
          <ul className="space-y-2">
            {rows.slice(0, 10).map((r) => (
              <li key={r.id} className="flex items-center gap-3 py-2 border-b border-border-default last:border-0">
                <span className="text-[12px] font-medium text-text-secondary shrink-0 w-20">
                  {kindLabels[r.kind] ?? r.kind}
                </span>
                <span className="text-[13px] text-text-primary flex-1 truncate">{r.object.title}</span>
                <span className="text-[11px] text-text-quaternary shrink-0">{r.object.type}</span>
                <FeedbackButtons
                  objectId={r.object.id}
                  compact
                  kinds={['like', 'save', 'ignore', 'archive', 'suggest']}
                />
              </li>
            ))}
          </ul>
          {rows.length > 10 ? (
            <p className="text-[11px] text-text-quaternary mt-2 text-center">Showing 10 of {rows.length} recent actions</p>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}

// ============================================================================
// Run History tab
// ============================================================================

const RUN_STATUS_META: Record<string, { label: string; icon: React.ElementType; tone: 'emerald' | 'amber' | 'rose' | 'sky' | 'slate' }> = {
  succeeded: { label: 'Succeeded', icon: CheckCircle2, tone: 'emerald' },
  failed: { label: 'Failed', icon: XCircle, tone: 'rose' },
  cancelled: { label: 'Cancelled', icon: X, tone: 'slate' },
  running: { label: 'Running', icon: Clock, tone: 'sky' },
  dispatched: { label: 'Dispatched', icon: Clock, tone: 'amber' },
};
const RUN_STATUS_DEFAULT: { label: string; icon: React.ElementType; tone: 'emerald' | 'amber' | 'rose' | 'sky' | 'slate' } = RUN_STATUS_META.dispatched!;

function RunsTab({ runs, loading }: { runs: Array<{
  id: string;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  createdAt: string;
  attempt: number;
  hermesRunId: string | null;
}> | null; loading: boolean }) {
  if (loading) return <Loading text="Loading runs…" className="py-6" />;
  if (!runs || runs.length === 0) {
    return (
      <div className="border border-dashed border-border-default rounded-lg p-10 text-center">
        <p className="text-[14px] text-text-primary font-medium">No runs yet</p>
        <p className="text-[12px] text-text-tertiary mt-1">Click "Run Now" to dispatch immediately.</p>
      </div>
    );
  }
  return (
    <div className="border border-border-default rounded-lg overflow-hidden">
      <table className="w-full text-[13px]">
        <thead className="bg-surface-1 border-b border-border-default">
          <tr>
            <th className="text-left px-4 py-2.5 font-medium text-text-tertiary">Status</th>
            <th className="text-left px-4 py-2.5 font-medium text-text-tertiary">Started</th>
            <th className="text-left px-4 py-2.5 font-medium text-text-tertiary">Finished</th>
            <th className="text-left px-4 py-2.5 font-medium text-text-tertiary">Duration</th>
            <th className="text-left px-4 py-2.5 font-medium text-text-tertiary">Error</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => {
            const meta = RUN_STATUS_META[r.status] ?? RUN_STATUS_DEFAULT;
            const Icon = meta.icon;
            const dur = r.startedAt && r.finishedAt
              ? new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime()
              : null;
            return (
              <tr key={r.id} className="border-b border-border-default last:border-0">
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-1.5">
                    <Icon className={cn(
                      'w-3.5 h-3.5',
                      meta.tone === 'emerald' && 'text-accent-text',
                      meta.tone === 'rose' && 'text-status-failed',
                      meta.tone === 'amber' && 'text-amber-600',
                      meta.tone === 'sky' && 'text-sky-600',
                      meta.tone === 'slate' && 'text-text-quaternary',
                    )} />
                    <span className="text-text-primary">{meta.label}</span>
                    {r.attempt > 1 ? <span className="text-[10px] text-text-quaternary">×{r.attempt}</span> : null}
                  </div>
                </td>
                <td className="px-4 py-2.5 text-text-secondary">{r.startedAt ? formatAbsolute(r.startedAt) : '—'}</td>
                <td className="px-4 py-2.5 text-text-secondary">{r.finishedAt ? formatAbsolute(r.finishedAt) : '—'}</td>
                <td className="px-4 py-2.5 text-text-secondary tabular-nums">{dur !== null ? formatDuration(dur) : '—'}</td>
                <td className="px-4 py-2.5 text-status-failed truncate max-w-[280px]">{r.error ?? '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================================
// Settings tab
// ============================================================================

function SettingsTab({ scout }: { scout: Subscription }) {
  const [copied, setCopied] = React.useState(false);
  function copy(): void {
    void navigator.clipboard.writeText(scout.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <div className="space-y-4">
      <Field label="Scout ID">
        <div className="flex items-center gap-2">
          <code className="text-[12px] font-mono px-2 py-1 rounded bg-surface-1 border border-border-default text-text-secondary">
            {scout.id}
          </code>
          <Button variant="ghost" size="sm" onClick={copy}>
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
      </Field>
      <Field label="Name">
        <span className="text-[14px] text-text-primary">{scout.name}</span>
      </Field>
      <Field label="Target">
        <code className="text-[12px] font-mono text-text-secondary break-all">{scout.target}</code>
      </Field>
      <Field label="Instruction">
        <p className="text-[13px] text-text-primary leading-relaxed max-w-3xl">{scout.instruction}</p>
      </Field>
      <Field label="Cadence">
        <span className="text-[14px] text-text-primary">{cadenceLabel(scout.cadence)}</span>
      </Field>
      <Field label="Created">
        <span className="text-[14px] text-text-primary">{new Date(scout.createdAt).toLocaleString()}</span>
      </Field>
      <div className="mt-2 p-3 rounded-lg border border-amber-200 bg-amber-50 text-amber-900 text-[12px] flex items-start gap-2">
        <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
        <div>
          Inline edit is coming soon. For now, archive and re-create to rename a scout or change its
          target.
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-mono uppercase tracking-[0.08em] text-text-quaternary mb-1.5">
        {label}
      </div>
      <div>{children}</div>
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

  // Default to the first user category once loaded.
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New Scout</DialogTitle>
          <DialogDescription>Hermes will run this brief on a schedule and surface what it finds.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); if (ready) createMut.mutate(); }} className="space-y-4">
          <div>
            <label className="text-[12px] font-medium text-text-secondary">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="ESPHome new projects" autoFocus />
          </div>
          <div>
            <label className="text-[12px] font-medium text-text-secondary">Target</label>
            <Input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="github:esphome/esphome" />
            <p className="text-[11px] text-text-tertiary mt-1">
              e.g. <code className="text-[10px]">github:user/repo</code>, <code className="text-[10px]">rss:https://…</code>,{' '}
              <code className="text-[10px]">arxiv:cs.AI</code>, <code className="text-[10px]">hackernews:front</code>
            </p>
          </div>
          <div>
            <label className="text-[12px] font-medium text-text-secondary">Instruction to Hermes</label>
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="Find new ESPHome projects with >100 GitHub stars in the last 30 days. Summarize each with a 2-sentence pitch."
              rows={4}
              className="mt-1 flex min-h-[80px] w-full rounded-lg border border-border-default bg-surface-0 px-3 py-2 text-[13px] text-text-primary placeholder:text-text-quaternary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30 resize-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[12px] font-medium text-text-secondary">Cadence</label>
              <select
                value={cadence}
                onChange={(e) => setCadence(e.target.value as typeof cadence)}
                className="mt-1 h-9 w-full rounded-lg border border-border-default bg-surface-0 px-3 text-[13px] text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
              >
                <option value="hourly">Hourly</option>
                <option value="every_6_hours">Every 6 hours</option>
                <option value="every_12_hours">Every 12 hours</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
              </select>
            </div>
            <div>
              <label className="text-[12px] font-medium text-text-secondary">Inbox category</label>
              {categoryMode === 'pick' ? (
                <select
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  className="mt-1 h-9 w-full rounded-lg border border-border-default bg-surface-0 px-3 text-[13px] text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
                >
                  {categories.length === 0 ? (
                    <option value="">No categories yet</option>
                  ) : null}
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value.toLowerCase().replace(/\s+/g, '_'))}
                  placeholder="ai_security"
                />
              )}
              <button
                type="button"
                className="text-[11px] text-accent-text hover:underline mt-1"
                onClick={() => setCategoryMode((m) => (m === 'pick' ? 'new' : 'pick'))}
              >
                {categoryMode === 'pick' ? '+ New category' : '← Pick existing'}
              </button>
            </div>
          </div>
          {categoryMode === 'new' ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[12px] font-medium text-text-secondary">Color</label>
                <select
                  value={newCategoryColor}
                  onChange={(e) => setNewCategoryColor(e.target.value)}
                  className="mt-1 h-9 w-full rounded-lg border border-border-default bg-surface-0 px-3 text-[13px] text-text-primary"
                >
                  {['emerald', 'sky', 'purple', 'amber', 'rose', 'slate', 'teal', 'indigo'].map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[12px] font-medium text-text-secondary">Icon</label>
                <select
                  value={newCategoryIcon}
                  onChange={(e) => setNewCategoryIcon(e.target.value)}
                  className="mt-1 h-9 w-full rounded-lg border border-border-default bg-surface-0 px-3 text-[13px] text-text-primary"
                >
                  {['briefcase', 'trending-up', 'file-text', 'lightbulb', 'radar', 'trophy', 'graduation-cap', 'dollar-sign', 'cpu', 'layers', 'help-circle'].map((i) => (
                    <option key={i} value={i}>{i}</option>
                  ))}
                </select>
              </div>
            </div>
          ) : null}
          {createMut.error ? (
            <div className="text-[12px] p-2 rounded bg-rose-50 text-rose-700 border border-rose-200">
              {createMut.error instanceof Error ? createMut.error.message : 'Failed to create scout'}
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={!ready || createMut.isPending}>
              {createMut.isPending ? 'Creating…' : 'Create Scout'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// New Category dialog
// ============================================================================

function NewCategoryDialog({
  open,
  onOpenChange,
  createMut,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  createMut: { mutate: (body: { name: string; color?: string; icon?: string }) => void; isPending: boolean; error: unknown };
}) {
  const [name, setName] = React.useState('');
  const [color, setColor] = React.useState('slate');
  const [icon, setIcon] = React.useState('help-circle');
  const ready = name.trim().length > 0;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>New Category</DialogTitle>
          <DialogDescription>
            Categories are stable buckets for the Scouting Inbox. Hermes never invents new ones.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => { e.preventDefault(); if (ready) createMut.mutate({ name, color, icon }); }}
          className="space-y-3"
        >
          <div>
            <label className="text-[12px] font-medium text-text-secondary">Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value.toLowerCase().replace(/\s+/g, '_'))}
              placeholder="ai_security"
              autoFocus
            />
            <p className="text-[11px] text-text-tertiary mt-1">lowercase snake_case</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[12px] font-medium text-text-secondary">Color</label>
              <select value={color} onChange={(e) => setColor(e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-border-default bg-surface-0 px-3 text-[13px] text-text-primary">
                {['emerald', 'sky', 'purple', 'amber', 'rose', 'slate', 'teal', 'indigo'].map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[12px] font-medium text-text-secondary">Icon</label>
              <select value={icon} onChange={(e) => setIcon(e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-border-default bg-surface-0 px-3 text-[13px] text-text-primary">
                {['briefcase', 'trending-up', 'file-text', 'lightbulb', 'radar', 'trophy', 'graduation-cap', 'dollar-sign', 'cpu', 'layers', 'help-circle'].map((i) => (
                  <option key={i} value={i}>{i}</option>
                ))}
              </select>
            </div>
          </div>
          {createMut.error ? (
            <div className="text-[12px] p-2 rounded bg-rose-50 text-rose-700 border border-rose-200">
              {createMut.error instanceof Error ? createMut.error.message : 'Failed to create category'}
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={!ready || createMut.isPending}>
              {createMut.isPending ? 'Creating…' : 'Create Category'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Edit Category dialog
// ============================================================================

function EditCategoryDialog({
  category,
  onClose,
  updateMut,
  archiveMut,
}: {
  category: Category | null;
  onClose: () => void;
  updateMut: { mutate: (args: { id: string; body: Record<string, unknown> }) => void; isPending: boolean; error: unknown };
  archiveMut: { mutate: (id: string) => void; isPending: boolean };
}) {
  const [name, setName] = React.useState('');
  const [color, setColor] = React.useState('slate');
  const [icon, setIcon] = React.useState('help-circle');
  React.useEffect(() => {
    if (category) {
      setName(category.name);
      setColor(category.color);
      setIcon(category.icon);
    }
  }, [category]);
  if (!category) return null;
  const ready = name.trim().length > 0;
  return (
    <Dialog open={!!category} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit Category</DialogTitle>
          <DialogDescription>Renaming keeps the same id; subscriptions and findings follow automatically.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (ready) updateMut.mutate({ id: category.id, body: { name, color, icon } });
          }}
          className="space-y-3"
        >
          <div>
            <label className="text-[12px] font-medium text-text-secondary">Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value.toLowerCase().replace(/\s+/g, '_'))}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[12px] font-medium text-text-secondary">Color</label>
              <select value={color} onChange={(e) => setColor(e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-border-default bg-surface-0 px-3 text-[13px] text-text-primary">
                {['emerald', 'sky', 'purple', 'amber', 'rose', 'slate', 'teal', 'indigo'].map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[12px] font-medium text-text-secondary">Icon</label>
              <select value={icon} onChange={(e) => setIcon(e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-border-default bg-surface-0 px-3 text-[13px] text-text-primary">
                {['briefcase', 'trending-up', 'file-text', 'lightbulb', 'radar', 'trophy', 'graduation-cap', 'dollar-sign', 'cpu', 'layers', 'help-circle'].map((i) => (
                  <option key={i} value={i}>{i}</option>
                ))}
              </select>
            </div>
          </div>
          {updateMut.error ? (
            <div className="text-[12px] p-2 rounded bg-rose-50 text-rose-700 border border-rose-200">
              {updateMut.error instanceof Error ? updateMut.error.message : 'Failed to update category'}
            </div>
          ) : null}
          <DialogFooter className="justify-between">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                if (window.confirm(`Archive category "${category.name}"? Subscriptions in it will become non-scout.`)) {
                  archiveMut.mutate(category.id);
                }
              }}
              disabled={archiveMut.isPending}
              className="text-status-failed"
            >
              <Archive className="w-3.5 h-3.5 mr-1" /> Archive
            </Button>
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={!ready || updateMut.isPending}>
                {updateMut.isPending ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
