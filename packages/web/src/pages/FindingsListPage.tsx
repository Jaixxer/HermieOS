import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ExternalLink,
  Star,
  Search,
  MessageSquare,
  Heart,
  Bookmark,
  Archive,
  EyeOff,
  Sparkles,
  Lightbulb,
  Radar,
  FileText,
  GitBranch,
  GraduationCap,
  Layers,
  FolderKanban,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { api, type ObjectSummary } from '../api';
import { useFindings } from '../hooks/data';
import { Sidebar } from '../components/Sidebar';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { cn, formatRelative } from '../lib/utils';
import { Loading } from '../components/Loading';

/**
 * Findings deck — the scouting feed.
 *
 * One finding per full-width card, vertically snap-scrolled like a
 * feed. Hard type-colored blocks and a diagonal corner cut give each
 * card a distinct, bold identity (restrained editorial energy).
 *
 * Navigation:
 *   j / ↓  next card      k / ↑  previous card
 *   Enter           open the discussion for the selected card
 *   Esc             clear the selection
 */

// ============================================================================
// Finding identity — per-type hard accents
// ============================================================================

interface TypeIdentity {
  label: string;
  icon: React.ElementType;
  /** Hard accent color (solid block). */
  band: string;
  /** Light wash + dark text for chips. */
  chip: string;
  /** Text accent on white. */
  text: string;
}

const TYPE_IDENTITY: Record<string, TypeIdentity> = {
  opportunity: { label: 'Opportunity', icon: Lightbulb, band: 'bg-emerald-600', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200', text: 'text-emerald-700' },
  discovery: { label: 'Discovery', icon: Radar, band: 'bg-cyan-600', chip: 'bg-cyan-50 text-cyan-700 border-cyan-200', text: 'text-cyan-700' },
  research: { label: 'Research', icon: FileText, band: 'bg-sky-600', chip: 'bg-sky-50 text-sky-700 border-sky-200', text: 'text-sky-700' },
  project: { label: 'Project', icon: FolderKanban, band: 'bg-amber-500', chip: 'bg-amber-50 text-amber-700 border-amber-200', text: 'text-amber-600' },
  decision: { label: 'Decision', icon: GitBranch, band: 'bg-rose-600', chip: 'bg-rose-50 text-rose-700 border-rose-200', text: 'text-rose-700' },
  learning_path: { label: 'Learning Path', icon: GraduationCap, band: 'bg-violet-600', chip: 'bg-violet-50 text-violet-700 border-violet-200', text: 'text-violet-700' },
  note: { label: 'Note', icon: Layers, band: 'bg-slate-600', chip: 'bg-slate-100 text-slate-700 border-slate-200', text: 'text-slate-700' },
  collection: { label: 'Collection', icon: Layers, band: 'bg-slate-600', chip: 'bg-slate-100 text-slate-700 border-slate-200', text: 'text-slate-700' },
};

function typeIdentity(type: string): TypeIdentity {
  return TYPE_IDENTITY[type] ?? { label: type, icon: Lightbulb, band: 'bg-slate-600', chip: 'bg-slate-100 text-slate-700 border-slate-200', text: 'text-slate-700' };
}

/** The list API returns full rows (with body) under the ObjectSummary type. */
interface DeckFinding extends ObjectSummary {
  body?: Record<string, unknown>;
}

const TYPE_FILTERS = ['all', 'opportunity', 'discovery', 'research', 'project', 'decision', 'learning_path'] as const;
type TypeFilter = (typeof TYPE_FILTERS)[number];

// ============================================================================
// Page
// ============================================================================

export function FindingsListPage(): React.JSX.Element {
  const { data: allFindings, isLoading } = useFindings();
  const navigate = useNavigate();
  const [typeFilter, setTypeFilter] = React.useState<TypeFilter>('all');
  const [search, setSearch] = React.useState('');
  const [sortBy, setSortBy] = React.useState<'updated' | 'type'>('updated');
  const [activeIndex, setActiveIndex] = React.useState<number | null>(0);
  const deckRef = React.useRef<HTMLDivElement>(null);
  const cardRefs = React.useRef<Array<HTMLDivElement | null>>([]);

  const filtered = React.useMemo(() => {
    let list = (allFindings ?? []) as DeckFinding[];
    if (typeFilter !== 'all') list = list.filter((o) => o.type === typeFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (o) =>
          o.title.toLowerCase().includes(q) ||
          (o.summary ?? '').toLowerCase().includes(q) ||
          (o.tags ?? []).some((t) => t.toLowerCase().includes(q)),
      );
    }
    if (sortBy === 'updated') {
      list = [...list].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    } else {
      list = [...list].sort((a, b) => a.type.localeCompare(b.type) || new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    }
    return list;
  }, [allFindings, typeFilter, search, sortBy]);

  const counts = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const o of allFindings ?? []) m.set(o.type, (m.get(o.type) ?? 0) + 1);
    return m;
  }, [allFindings]);

  // Keep the selection inside the filtered list.
  React.useEffect(() => {
    setActiveIndex((cur) => (cur === null || cur < filtered.length ? cur : Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  function scrollTo(index: number): void {
    const el = cardRefs.current[index];
    if (typeof el?.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function onKeyDown(e: React.KeyboardEvent): void {
    if (filtered.length === 0) return;
    let next = activeIndex ?? 0;
    if (e.key === 'j' || e.key === 'ArrowDown') {
      e.preventDefault();
      next = Math.min(next + 1, filtered.length - 1);
    } else if (e.key === 'k' || e.key === 'ArrowUp') {
      e.preventDefault();
      next = Math.max(next - 1, 0);
    } else if (e.key === 'Enter') {
      if (activeIndex !== null && filtered[activeIndex]) {
        e.preventDefault();
        navigate(`/objects/${filtered[activeIndex].id}/discuss`);
      }
      return;
    } else if (e.key === 'Escape') {
      setActiveIndex(null);
      return;
    } else {
      return;
    }
    setActiveIndex(next);
    scrollTo(next);
  }

  return (
    <div className="h-screen overflow-hidden flex bg-page text-text-primary">
      <Sidebar activePath="/scouting" className="hidden lg:flex" />
      <main className="flex-1 min-w-0 min-h-0 flex flex-col">
        {/* Header */}
        <div className="shrink-0 px-6 py-4 border-b border-border-default bg-surface-0/95 backdrop-blur">
          <div className="flex items-center gap-3">
            <Link to="/scouting" className="flex items-center gap-2 text-text-tertiary hover:text-text-primary transition">
              <ArrowLeft className="w-4 h-4" />
              <span className="text-[13px]">Scouting</span>
            </Link>
            <span className="text-[11px] text-text-quaternary">/</span>
            <h1 className="text-[15px] font-semibold tracking-tight">Findings</h1>
            <span className="text-[11px] text-text-quaternary">
              {filtered.length} of {allFindings?.length ?? 0}
            </span>
            <div className="ml-auto flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-quaternary" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search findings…"
                  className="pl-8 h-8 text-[12px] w-52"
                />
              </div>
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
          {/* Type filter pills with counts */}
          <div className="mt-3 flex flex-wrap gap-1.5">
            {TYPE_FILTERS.map((t) => {
              const active = typeFilter === t;
              const count = t === 'all' ? allFindings?.length ?? 0 : counts.get(t) ?? 0;
              return (
                <button
                  key={t}
                  onClick={() => setTypeFilter(t)}
                  className={cn(
                    'text-[11px] font-medium px-2.5 py-1 rounded-md border transition',
                    active
                      ? 'bg-text-primary text-page border-text-primary'
                      : 'bg-surface-0 text-text-secondary border-border-default hover:border-border-strong',
                  )}
                >
                  {t === 'all' ? 'All' : t.replace('_', ' ')}
                  <span className={cn('ml-1.5 text-[10px]', active ? 'text-page/70' : 'text-text-quaternary')}>{count}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Deck */}
        <div
          ref={deckRef}
          tabIndex={0}
          onKeyDown={onKeyDown}
          className="flex-1 min-h-0 overflow-y-auto outline-none [scroll-snap-type:y_proximity]"
          data-testid="findings-deck"
        >
          {isLoading ? (
            <Loading text="Loading findings…" className="py-24" />
          ) : filtered.length === 0 ? (
            <div className="max-w-2xl mx-auto mt-16 border border-dashed border-border-default rounded-xl p-12 text-center space-y-2">
              <Sparkles className="w-8 h-8 mx-auto text-text-quaternary" />
              <p className="text-[14px] font-medium text-text-primary">
                {allFindings?.length === 0 ? 'No findings yet' : 'Nothing matches'}
              </p>
              <p className="text-[12px] text-text-tertiary max-w-sm mx-auto">
                {allFindings?.length === 0
                  ? 'When a scout records something, it lands here — one card per finding, like a feed of the useful internet.'
                  : 'Try a different filter or search term.'}
              </p>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto px-6 py-6 space-y-5">
              {filtered.map((obj, i) => (
                <DeckCard
                  key={obj.id}
                  obj={obj}
                  ref={(el) => {
                    cardRefs.current[i] = el;
                  }}
                  selected={activeIndex === i}
                  onSelect={() => {
                    setActiveIndex(i);
                    scrollTo(i);
                  }}
                  onEnter={() => {
                    navigate(`/objects/${obj.id}/discuss`);
                  }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Keyboard hint bar */}
        <div className="shrink-0 px-6 py-1.5 border-t border-border-default bg-surface-0/95 text-[10px] text-text-quaternary flex items-center gap-4">
          <span><kbd className="font-mono">j</kbd>/<kbd className="font-mono">k</kbd> navigate</span>
          <span><kbd className="font-mono">⏎</kbd> discuss</span>
          <span><kbd className="font-mono">esc</kbd> clear</span>
          <span className="ml-auto">One card per finding · discuss to go deeper</span>
        </div>
      </main>
    </div>
  );
}

// ============================================================================
// Deck card — the feed unit
// ============================================================================

interface DeckCardProps {
  obj: DeckFinding;
  selected: boolean;
  onSelect: () => void;
  onEnter: () => void;
}

const DeckCard = React.forwardRef<HTMLDivElement, DeckCardProps>(function DeckCard(
  { obj, selected, onSelect, onEnter },
  ref,
) {
  const identity = typeIdentity(obj.type);
  const Icon = identity.icon;
  const body = obj.body ?? {};
  const url = typeof body['url'] === 'string' ? body['url'] : null;
  const stars = typeof body['stars'] === 'number' ? body['stars'] : null;
  const author = typeof body['author'] === 'string' ? body['author'] : null;
  const published = typeof body['publishedDate'] === 'string' ? body['publishedDate'] : null;
  const kind = typeof body['kind'] === 'string' ? body['kind'] : null;

  return (
    <div
      ref={ref}
      onClick={onSelect}
      onDoubleClick={onEnter}
      role="article"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onEnter();
        }
      }}
      className={cn(
        'relative overflow-hidden rounded-xl border bg-surface-0 shadow-sm transition [scroll-snap-align:start]',
        selected ? 'border-text-primary ring-2 ring-text-primary/10' : 'border-border-default hover:border-border-strong',
      )}
    >
      {/* Hard type band on the left edge */}
      <div className={cn('absolute inset-y-0 left-0 w-1.5', identity.band)} />
      {/* Diagonal corner cut (Persona-lite) */}
      <div
        className={cn('absolute -top-10 -right-10 w-28 h-28 rotate-12 opacity-[0.07]', identity.band)}
        style={{ clipPath: 'polygon(50% 0, 100% 0, 100% 50%, 0 100%, 0 50%)' }}
      />

      <div className="pl-6 pr-6 py-5">
        {/* Top row: identity + meta */}
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn('w-6 h-6 rounded-md flex items-center justify-center text-white', identity.band)}>
            <Icon className="w-3.5 h-3.5" />
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-widest text-text-secondary">{identity.label}</span>
          {kind ? <span className="text-[10px] font-mono text-text-quaternary">kind: {kind}</span> : null}
          <span className="ml-auto text-[11px] text-text-quaternary">{formatRelative(obj.updatedAt)}</span>
        </div>

        {/* Title */}
        <Link
          to={`/objects/${obj.id}`}
          onClick={(e) => e.stopPropagation()}
          className={cn('mt-3 block text-[21px] leading-snug font-bold tracking-tight hover:underline', identity.text)}
        >
          {obj.title}
        </Link>

        {/* Summary */}
        {obj.summary ? (
          <p className="mt-2 text-[13px] text-text-secondary leading-relaxed line-clamp-3">{obj.summary}</p>
        ) : null}

        {/* Meta row */}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-text-tertiary">
          {url ? (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 text-accent-text hover:underline max-w-[380px] truncate"
            >
              <ExternalLink className="w-3 h-3 shrink-0" />
              {url}
            </a>
          ) : null}
          {stars != null ? (
            <span className="inline-flex items-center gap-1"><Star className="w-3 h-3 text-amber-500" /> {stars.toLocaleString()}</span>
          ) : null}
          {author ? <span>{author}</span> : null}
          {published ? <span>{published}</span> : null}
        </div>

        {/* Tags */}
        {obj.tags.length > 0 ? (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {obj.tags.slice(0, 5).map((t) => (
              <span key={t} className="text-[10px] px-2 py-0.5 rounded-full bg-surface-2 text-text-tertiary">{t}</span>
            ))}
          </div>
        ) : null}

        {/* Actions rail */}
        <div className="mt-4 pt-3 border-t border-border-subtle flex items-center gap-2">
          <Link
            to={`/objects/${obj.id}/discuss`}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-lg bg-text-primary text-page hover:opacity-90 transition"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            Discuss
          </Link>
          <DeckFeedback objectId={obj.id} />
          <span className="ml-auto text-[10px] text-text-quaternary">open · double-click to discuss</span>
        </div>
      </div>
    </div>
  );
});

// ============================================================================
// Bespoke feedback rail for the deck (like / save / suggest / archive)
// ============================================================================

const FEEDBACK_META = [
  { kind: 'like', label: 'Like', Icon: Heart },
  { kind: 'save', label: 'Save', Icon: Bookmark },
  { kind: 'suggest', label: 'Suggest', Icon: Sparkles },
  { kind: 'ignore', label: 'Not for me', Icon: EyeOff },
  { kind: 'archive', label: 'Archive', Icon: Archive },
] as const;

function DeckFeedback({ objectId }: { objectId: string }): React.JSX.Element {
  const qc = useQueryClient();
  const [suggestOpen, setSuggestOpen] = React.useState(false);
  const [suggestText, setSuggestText] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  async function send(kind: (typeof FEEDBACK_META)[number]['kind'], note?: string): Promise<void> {
    setBusy(true);
    try {
      await api.recordFeedback(objectId, { kind, note });
      if (kind === 'archive') {
        qc.setQueryData<ObjectSummary[]>(['findings-for-buckets'], (old: ObjectSummary[] | undefined) =>
          old ? old.filter((o: ObjectSummary) => o.id !== objectId) : old,
        );
      }
    } finally {
      setBusy(false);
      setSuggestOpen(false);
      setSuggestText('');
    }
  }

  return (
    <>
      {FEEDBACK_META.map(({ kind, label, Icon }) => (
        <button
          key={kind}
          type="button"
          disabled={busy}
          title={label}
          aria-label={label}
          onClick={(e) => {
            e.stopPropagation();
            if (kind === 'suggest') {
              setSuggestOpen((v) => !v);
              return;
            }
            void send(kind);
          }}
          className="w-7 h-7 rounded-md flex items-center justify-center text-text-tertiary hover:bg-surface-2 hover:text-text-primary transition disabled:opacity-50"
        >
          <Icon className="w-3.5 h-3.5" />
        </button>
      ))}
      {suggestOpen ? (
        <form
          className="flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (suggestText.trim()) void send('suggest', suggestText.trim());
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <Input
            autoFocus
            value={suggestText}
            onChange={(e) => setSuggestText(e.target.value)}
            placeholder="What would you rather see?"
            className="h-7 text-[11px] w-56"
          />
          <Button type="submit" size="sm" disabled={!suggestText.trim() || busy} className="rounded-md">
            Send
          </Button>
        </form>
      ) : null}
    </>
  );
}
