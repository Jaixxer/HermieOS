/**
 * Command Palette — Cmd+K global search and action menu.
 *
 * Inspired by Spotlight / Raycast / Linear. Opens on Cmd+K (or Ctrl+K).
 * Fuzzy-filters objects, subscriptions, and actions as the user types.
 * Arrow keys navigate; Enter executes. Escape dismisses.
 */
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Home, Network, ListTodo, Settings, RefreshCw, Box, FileText, Sparkles, GitBranch, Target, ArrowUpRight, StickyNote, LayoutGrid, Circle } from 'lucide-react';
import { api, type ObjectSummary } from './api';

interface CommandItem {
  id: string;
  label: string;
  subtitle: string;
  icon: React.ElementType;
  action: () => void;
}

export function CommandPalette(): React.JSX.Element | null {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [selected, setSelected] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: objects } = useQuery({
    queryKey: ['objects-list'],
    queryFn: () => api.listObjects({ limit: 100 }),
    enabled: open,
  });

  // Keyboard shortcut
  React.useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
        setQuery('');
        setSelected(0);
      }
      if (e.key === 'Escape') {
        setOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Focus input on open
  React.useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (!open) return null;

  // Build command list
  const items: CommandItem[] = [];

  // Navigation
  items.push(
    { id: 'nav-feed', label: 'Go to Feed', subtitle: '/', icon: Home, action: () => navigate('/') },
    { id: 'nav-graph', label: 'Go to Graph', subtitle: '/graph', icon: Network, action: () => navigate('/graph') },
    { id: 'nav-subs', label: 'Go to Subscriptions', subtitle: '/subscriptions', icon: ListTodo, action: () => navigate('/subscriptions') },
    { id: 'nav-settings', label: 'Go to Settings', subtitle: '/settings', icon: Settings, action: () => navigate('/settings') },
  );

  // Search objects
  if (objects?.objects) {
    for (const o of objects.objects) {
      items.push({
        id: o.id,
        label: o.title,
        subtitle: `${o.type} · priority ${o.priority}`,
        icon: TypeIcon(o.type),
        action: () => navigate(`/objects/${o.id}`),
      });
    }
  }

  // Actions
  items.push(
    { id: 'action-refresh', label: 'Refresh data', subtitle: 'Invalidate all caches', icon: RefreshCw, action: () => { qc.invalidateQueries(); setOpen(false); } },
  );

  // Fuzzy filter
  const filtered = query
    ? items.filter((i) => {
        const q = query.toLowerCase();
        return i.label.toLowerCase().includes(q) || i.subtitle.toLowerCase().includes(q);
      })
    : items;

  // Clamp selected
  const sel = Math.min(Math.max(selected, 0), Math.max(filtered.length - 1, 0));

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      onClick={() => setOpen(false)}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-xl bg-[#111122]/95 border border-[#ffffff10] rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        style={{ backdropFilter: 'blur(24px)' }}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[#ffffff08]">
          <span className="text-slate-500 text-lg">⌘</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelected(0); }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setSelected((s) => Math.min(s + 1, filtered.length - 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setSelected((s) => Math.max(s - 1, 0)); }
              if (e.key === 'Enter' && filtered[sel]) { filtered[sel].action(); setOpen(false); }
            }}
            placeholder="Search objects, navigate, execute..."
            className="flex-1 bg-transparent border-none outline-none text-slate-200 placeholder:text-slate-600 text-sm"
          />
          <kbd className="text-[10px] text-slate-600 font-mono px-1.5 py-0.5 rounded bg-[#ffffff08] border border-[#ffffff10]">esc</kbd>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto">
          {filtered.slice(0, 30).map((item, i) => (
            <div
              key={item.id}
              className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors ${
                i === sel ? 'bg-[#1a1a3e]' : 'hover:bg-[#ffffff05]'
              }`}
              onClick={() => { item.action(); setOpen(false); }}
              onMouseEnter={() => setSelected(i)}
            >
              <span className="text-base w-5 text-center flex items-center justify-center text-text-tertiary"><item.icon className="w-4 h-4" /></span>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-slate-200 truncate">{item.label}</div>
                <div className="text-[11px] text-slate-500 truncate">{item.subtitle}</div>
              </div>
              {i === sel ? <span className="text-[10px] text-sky-400">↵</span> : null}
            </div>
          ))}
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-slate-600">No results</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function TypeIcon(type: string): React.ElementType {
  const icons: Record<string, React.ElementType> = {
    project: Box,
    research: FileText,
    discovery: Sparkles,
    decision: GitBranch,
    opportunity: Target,
    learning_path: ArrowUpRight,
    note: StickyNote,
    collection: LayoutGrid,
  };
  return icons[type] ?? Circle;
}
