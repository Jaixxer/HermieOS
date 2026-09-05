import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
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
import { cn, formatRelative } from '../lib/utils';

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
    <div className="h-screen overflow-hidden flex bg-p5-cream text-p5-dark flex-1 min-w-0">
      <main className="flex-1 min-w-0 min-h-0 flex flex-col">
        {/* Header */}
        <div className="shrink-0 px-6 md:px-10 py-5 border-b border-p5-dark-line bg-p5-cream/95">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
            <div className="flex items-center gap-4">
              <h1 className="text-[clamp(28px,4vw,44px)] font-black tracking-tight text-p5-dark leading-none">
                FINDINGS
              </h1>
              <span className="text-[12px] font-mono text-p5-dark-muted">
                {filtered.length} / {allFindings?.length ?? 0}
              </span>
            </div>
            <div className="flex items-center gap-2 sm:ml-auto">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-p5-muted" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search findings…"
                  className="pl-9 h-12 sm:h-9 w-full sm:w-52 text-[16px] sm:text-[12px] bg-white border border-p5-dark-line text-p5-dark placeholder:text-p5-dark-muted outline-none focus:border-accent transition"
                />
              </div>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as 'updated' | 'type')}
                className="text-[12px] h-12 sm:h-9 px-2 bg-white border border-p5-dark-line text-p5-dark outline-none focus:border-accent"
              >
                <option value="updated">Newest first</option>
                <option value="type">By type</option>
              </select>
            </div>
          </div>
          {/* Type filter pills with counts */}
          <div className="mt-4 flex flex-wrap gap-1.5">
            {TYPE_FILTERS.map((t) => {
              const active = typeFilter === t;
              const count = t === 'all' ? allFindings?.length ?? 0 : counts.get(t) ?? 0;
              return (
                <button
                  key={t}
                  onClick={() => setTypeFilter(t)}
                  className={cn(
                    'text-[11px] font-black uppercase tracking-wider px-3 py-1.5 min-h-[44px] sm:min-h-0 inline-flex items-center border transition',
                    active
                      ? 'bg-accent text-white border-accent'
                      : 'border-p5-dark-line text-p5-dark-muted hover:text-p5-dark hover:border-p5-dark/60',
                  )}
                >
                  {t === 'all' ? 'All' : t.replace('_', ' ')}
                  <span className={cn('ml-1.5 text-[10px]', active ? 'text-white/70' : 'text-p5-muted/60')}>{count}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Deck */}
        {/* Deck */}
        <div
          ref={deckRef}
          tabIndex={0}
          onKeyDown={onKeyDown}
          className="flex-1 min-h-0 overflow-y-auto outline-none [scroll-snap-type:y_proximity]"
          data-testid="findings-deck"
        >
          {isLoading ? (
            <div className="py-24 text-center font-mono text-[12px] tracking-widest text-p5-dark-muted">LOADING FINDINGS…</div>
          ) : filtered.length === 0 ? (
            <div className="max-w-2xl mx-auto mt-16 border-2 border-dashed border-p5-dark-line p-12 text-center space-y-3">
              <Sparkles className="w-8 h-8 mx-auto text-p5-dark-muted" />
              <p className="text-[16px] font-black uppercase tracking-wide text-p5-dark">
                {allFindings?.length === 0 ? 'No findings yet' : 'Nothing matches'}
              </p>
              <p className="text-[12px] text-p5-dark-muted max-w-sm mx-auto">
                {allFindings?.length === 0
                  ? 'When a scout records something, it lands here — one card per finding, like a feed of the useful internet.'
                  : 'Try a different filter or search term.'}
              </p>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto px-6 py-8 space-y-7">
              {filtered.map((obj, i) => (
                <DeckCard
                  key={obj.id}
                  obj={obj}
                  index={i}
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
        <div className="shrink-0 px-6 py-2 border-t border-p5-dark-line bg-p5-cream text-[10px] font-mono text-p5-dark-muted hidden sm:flex items-center gap-4">
          <span><kbd className="text-p5-dark">j</kbd>/<kbd className="text-p5-dark">k</kbd> navigate</span>
          <span><kbd className="text-p5-dark">⏎</kbd> discuss</span>
          <span><kbd className="text-p5-dark">esc</kbd> clear</span>
          <span className="ml-auto">ONE CARD PER FINDING · DISCUSS TO GO DEEPER</span>
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
  index: number;
  selected: boolean;
  onSelect: () => void;
  onEnter: () => void;
}

const DeckCard = React.forwardRef<HTMLDivElement, DeckCardProps>(function DeckCard(
  { obj, index, selected, onSelect, onEnter },
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
  const num = String(index + 1).padStart(2, '0');

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
        'relative bg-white text-black border-2 transition [scroll-snap-align:start] p5-anim-slide',
        'group/panel',
        selected
          ? 'border-black [filter:drop-shadow(6px_6px_0_rgba(213,0,28,0.55))]'
          : 'border-black/15 hover:border-black [filter:drop-shadow(4px_4px_0_rgba(213,0,28,0.22))]',
      )}
    >
      {/* Hard type header band — full-width color block */}
      <div className={cn('relative h-10 flex items-center gap-2.5 px-4', identity.band)}>
        <span className="w-6 h-6 bg-page/15 flex items-center justify-center text-white border-2 border-white/60">
          <Icon className="w-3.5 h-3.5" />
        </span>
        <span className="text-[11px] font-black uppercase tracking-[0.2em] text-white">
          // {identity.label}
        </span>
        <span className="hidden sm:inline text-[10px] font-mono tracking-widest text-white/70">
          {kind ? `KIND ${kind.toUpperCase()}` : ''}
        </span>
        <span className="ml-auto relative text-white text-[18px] font-black tracking-tight tabular-nums leading-none">{num}</span>
      </div>

      <div className="px-5 py-4">
        {/* Title — big and black */}
        <Link
          to={`/objects/${obj.id}`}
          onClick={(e) => e.stopPropagation()}
          className={cn('block text-[23px] leading-tight font-black tracking-tight hover:underline', identity.text)}
        >
          {obj.title}
        </Link>

        {/* Summary */}
        {obj.summary ? (
          <p className="mt-2 text-[13px] text-text-secondary leading-relaxed line-clamp-3">{obj.summary}</p>
        ) : null}

        {/* Meta row — cut-corner chips */}
        <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
          {url ? (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1.5 text-[11px] font-mono text-text-secondary bg-surface-1 border border-border-default px-2 py-1 max-w-full truncate hover:bg-surface-2 transition"
            >
              <ExternalLink className="w-3 h-3 shrink-0 text-text-quaternary" />
              {url}
            </a>
          ) : null}
          {stars != null ? (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-amber-700 bg-amber-100 px-2 py-1">
              <Star className="w-3 h-3 fill-amber-500 text-amber-500" /> {stars.toLocaleString()}
            </span>
          ) : null}
          {author ? (
            <span className="text-[11px] text-text-tertiary bg-surface-1 border border-border-default px-2 py-1">
              {author}
            </span>
          ) : null}
          {published ? (
            <span className="text-[11px] font-mono text-text-tertiary bg-surface-1 border border-border-default px-2 py-1">
              {published}
            </span>
          ) : null}
          <span className="ml-auto text-[11px] font-mono text-text-quaternary">{formatRelative(obj.updatedAt)}</span>
        </div>

        {/* Tags */}
        {obj.tags.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {obj.tags.slice(0, 5).map((t) => (
              <span
                key={t}
                className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary bg-surface-1 border border-border-default px-2 py-0.5"
              >
                {t}
              </span>
            ))}
          </div>
        ) : null}

        {/* Actions rail */}
        <div className="mt-4 pt-3 border-t-2 border-black/10 flex flex-wrap items-center gap-2">
          <Link
            to={`/objects/${obj.id}/discuss`}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1.5 text-[12px] font-black uppercase tracking-wider px-3.5 py-1.5 min-h-[44px] sm:min-h-0 bg-accent text-white hover:bg-accent-hover transition"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            Discuss
          </Link>
          <DeckFeedback objectId={obj.id} />
          <span className="ml-auto text-[10px] font-mono text-black/40 hidden sm:inline">ENTER TO DISCUSS</span>
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
          className="w-11 h-11 sm:w-7 sm:h-7 flex items-center justify-center text-black/50 border border-black/15 bg-black/[0.03] hover:bg-black hover:text-white hover:border-black transition disabled:opacity-50"

        >
          <Icon className="w-3.5 h-3.5" />
        </button>
      ))}
      {suggestOpen ? (
        <form
          className="flex flex-wrap sm:flex-nowrap items-center gap-1.5 basis-full sm:basis-auto mt-1 sm:mt-0"
          onSubmit={(e) => {
            e.preventDefault();
            if (suggestText.trim()) void send('suggest', suggestText.trim());
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <input
            value={suggestText}
            onChange={(e) => setSuggestText(e.target.value)}
            placeholder="What would you rather see?"
            className="h-12 sm:h-7 text-[16px] sm:text-[11px] flex-1 min-w-0 sm:w-56 sm:flex-none px-2 bg-black/[0.03] border border-black/15 text-black placeholder:text-black/40 outline-none focus:border-accent"
          />
          <button
            type="submit"
            disabled={!suggestText.trim() || busy}
            className="text-[11px] font-black uppercase tracking-wider px-2.5 h-12 sm:h-7 min-w-[64px] bg-black text-white hover:opacity-85 transition disabled:opacity-40"
          >
            Send
          </button>
        </form>
      ) : null}
    </>
  );
}
