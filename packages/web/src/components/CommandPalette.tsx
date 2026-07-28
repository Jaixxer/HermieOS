import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from './ui/command';
import { Kbd } from './ui/kbd';
import { api } from '../api';
import { cn } from '../lib/utils';

// ============================================================================
// CommandPalette — Raycast-style global launcher
// Cmd+K (or Ctrl+K) opens a centered dialog. Type to filter across
//   - Navigate: pages, settings sections
//   - Scouts: jump to a specific scout
//   - Actions: pause scheduler, sign out, etc
//   - Quick capture: create task, add upcoming, queue opportunity
//   - Recent: previously visited (from localStorage)
// Keyboard: ↑/↓ move, enter executes, esc closes.
// ============================================================================

type PaletteGroup = 'Navigate' | 'Scouts' | 'Actions' | 'Capture' | 'Recent';

type Tone = 'emerald' | 'sky' | 'purple' | 'amber' | 'rose' | 'slate';

const TONE_BG: Record<Tone, string> = {
  emerald: 'bg-pill-emerald-bg text-pill-emerald-text',
  sky: 'bg-pill-sky-bg text-pill-sky-text',
  purple: 'bg-pill-purple-bg text-pill-purple-text',
  amber: 'bg-pill-amber-bg text-pill-amber-text',
  rose: 'bg-pill-rose-bg text-pill-rose-text',
  slate: 'bg-pill-slate-bg text-pill-slate-text',
};

const GLYPHS: Record<Tone, string> = {
  emerald: '◆',
  sky: '◇',
  purple: '◈',
  amber: '◉',
  rose: '◐',
  slate: '○',
};

interface PaletteEntry {
  id: string;
  title: string;
  subtitle?: string;
  group: PaletteGroup;
  tone: Tone;
  shortcut?: string[];
  keywords?: string[];
  perform: () => void;
}

// Singleton state — Cmd+K toggles globally
type Listener = (open: boolean) => void;
const listeners = new Set<Listener>();
let isOpen = false;

export function useCommandPalette() {
  return {
    open: () => {
      isOpen = true;
      listeners.forEach((l) => l(true));
    },
    close: () => {
      isOpen = false;
      listeners.forEach((l) => l(false));
    },
    toggle: () => {
      isOpen = !isOpen;
      listeners.forEach((l) => l(isOpen));
    },
  };
}

const RECENT_KEY = 'hermieos_palette_recent';
const RECENT_MAX = 8;

function getRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}
function pushRecent(id: string) {
  try {
    const list = getRecent();
    const next = [id, ...list.filter((x) => x !== id)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

export function CommandPalette() {
  const navigate = useNavigate();
  const [open, setOpen] = React.useState(isOpen);
  const [query, setQuery] = React.useState('');

  // Global Cmd+K
  React.useEffect(() => {
    const l: Listener = (v) => setOpen(v);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        isOpen = !isOpen;
        listeners.forEach((l) => l(isOpen));
        return;
      }
      // g+letter vim navigation
      if (e.key === 'g' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const handler = (e2: KeyboardEvent) => {
          document.removeEventListener('keydown', handler, true);
          const map: Record<string, string> = {
            h: '/',
            s: '/scouting',
            t: '/subscriptions',
            g: '/graph',
          };
          const target = map[e2.key];
          if (target) {
            e2.preventDefault();
            navigate(target);
          }
        };
        document.addEventListener('keydown', handler, true);
        window.setTimeout(() => document.removeEventListener('keydown', handler, true), 1000);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [navigate]);

  // Reset on open
  React.useEffect(() => {
    if (open) setQuery('');
  }, [open]);

  // Pull scouts for the palette
  const { data: scoutsResp } = useQuery({
    queryKey: ['subscriptions'],
    queryFn: () => api.subscriptions(),
    enabled: open,
  });

  const navigateTo = React.useCallback(
    (to: string) => () => navigate(to),
    [navigate],
  );

  // Build entries
  const entries: PaletteEntry[] = React.useMemo(() => {
    const list: PaletteEntry[] = [
      { id: 'nav-home', title: 'Home', subtitle: 'Dashboard', group: 'Navigate', tone: 'emerald', shortcut: ['G', 'H'], keywords: ['dashboard', 'feed'], perform: navigateTo('/') },
      { id: 'nav-scouting', title: 'Scouting Inbox', subtitle: 'Recurring research jobs', group: 'Navigate', tone: 'sky', shortcut: ['G', 'S'], keywords: ['scout', 'research', 'inbox'], perform: navigateTo('/scouting') },
      { id: 'nav-subs', title: 'Tasks & Subscriptions', group: 'Navigate', tone: 'amber', keywords: ['task', 'subscription', 'workflow'], perform: navigateTo('/subscriptions') },
      { id: 'nav-graph', title: 'Knowledge Graph', group: 'Navigate', tone: 'purple', shortcut: ['G', 'G'], keywords: ['graph', 'knowledge', 'relations'], perform: navigateTo('/graph') },
      { id: 'nav-settings', title: 'Settings', group: 'Navigate', tone: 'slate', keywords: ['settings', 'preferences', 'account'], perform: navigateTo('/settings') },
    ];

    for (const s of scoutsResp?.subscriptions ?? []) {
      list.push({
        id: `scout-${s.id}`,
        title: s.name,
        subtitle: s.target,
        group: 'Scouts',
        tone: 'sky',
        keywords: [s.category ?? '', s.target, s.instruction].filter(Boolean),
        perform: navigateTo('/scouting'),
      });
    }

    list.push(
      { id: 'cap-task', title: 'New task', subtitle: 'Add to Today\'s Mission', group: 'Capture', tone: 'emerald', keywords: ['create', 'add', 'todo'], perform: navigateTo('/') },
      { id: 'cap-upcoming', title: 'New upcoming', subtitle: 'Add a date-anchored item', group: 'Capture', tone: 'amber', keywords: ['create', 'add', 'event', 'calendar', 'appointment'], perform: navigateTo('/') },
      { id: 'cap-scout', title: 'Open a new scout', subtitle: 'Recurring research brief for Hermes', group: 'Capture', tone: 'sky', keywords: ['new', 'create', 'subscription', 'recurring'], perform: navigateTo('/scouting') },
    );

    list.push(
      { id: 'act-scheduler', title: 'Toggle scheduler', subtitle: 'Pause / resume background work', group: 'Actions', tone: 'amber', keywords: ['pause', 'resume', 'hermes', 'scheduler'], perform: navigateTo('/settings') },
    );

    // Recent
    const recentIds = getRecent();
    const byId = new Map(list.map((e) => [e.id, e]));
    for (const id of recentIds) {
      const e = byId.get(id);
      if (e) list.push({ ...e, id: `recent-${id}`, group: 'Recent', title: e.title, subtitle: 'recent' });
    }

    return list;
  }, [navigateTo, scoutsResp]);

  // Group the entries in order
  const grouped: Array<{ group: PaletteGroup; entries: PaletteEntry[] }> = React.useMemo(() => {
    const groups: PaletteGroup[] = ['Navigate', 'Recent', 'Scouts', 'Capture', 'Actions'];
    return groups
      .map((g) => ({ group: g, entries: entries.filter((e) => e.group === g) }))
      .filter((g) => g.entries.length > 0);
  }, [entries]);

  const handleSelect = (entry: PaletteEntry) => {
    pushRecent(entry.id.startsWith('recent-') ? entry.id.slice(7) : entry.id);
    entry.perform();
    isOpen = false;
    listeners.forEach((l) => l(false));
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput
        placeholder="Type a command or search…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>
          <div className="text-text-tertiary">
            No results for{' '}
            <span className="font-mono text-text-primary">{query}</span>
          </div>
          <div className="mt-1 text-[11px] text-text-quaternary">
            Try a page name, a scout, or an action
          </div>
        </CommandEmpty>
        {grouped.map(({ group, entries }) => (
          <CommandGroup key={group} heading={group}>
            {entries.map((e) => (
              <CommandItem
                key={e.id}
                value={`${e.title} ${e.subtitle ?? ''} ${(e.keywords ?? []).join(' ')}`}
                onSelect={() => handleSelect(e)}
              >
                <span
                  className={cn(
                    'w-7 h-7 rounded-md flex items-center justify-center font-mono text-sm shrink-0',
                    TONE_BG[e.tone],
                  )}
                >
                  {GLYPHS[e.tone]}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-[13.5px] truncate font-medium text-text-primary">
                    {e.title}
                  </div>
                  {e.subtitle ? (
                    <div className="text-[11.5px] truncate text-text-tertiary">
                      {e.subtitle}
                    </div>
                  ) : null}
                </div>
                {e.shortcut && e.shortcut.length > 0 ? (
                  <CommandShortcut className="flex items-center gap-0.5">
                    {e.shortcut.map((k, i) => (
                      <Kbd key={i}>{k}</Kbd>
                    ))}
                  </CommandShortcut>
                ) : null}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
      <PaletteFooter />
    </CommandDialog>
  );
}

function PaletteFooter() {
  return (
    <div
      className="flex items-center justify-between px-4 h-9 border-t border-border-divider text-[10.5px] font-mono text-text-quaternary"
    >
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd>
          <span className="ml-1">move</span>
        </span>
        <span className="flex items-center gap-1">
          <Kbd>↵</Kbd>
          <span className="ml-1">open</span>
        </span>
        <span className="flex items-center gap-1">
          <Kbd>esc</Kbd>
          <span className="ml-1">close</span>
        </span>
      </div>
      <span>HermieOS</span>
    </div>
  );
}
