/**
 * Mobile navigation — bottom tab bar + slim header, phones only (`lg:hidden`).
 *
 * Five destinations (per product decision): Home, Scouts, Command (center
 * FAB), Feed, Tasks. Findings/Calendar/Settings stay reachable through Home
 * cards and hubs. The bar hides while the software keyboard is open
 * (see mobile.ts `hermieos:keyboard` events) and respects the iOS/Android
 * bottom safe area. Tab presses fire a light haptic on native builds.
 */
import * as React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Activity, Crosshair, Home, ListChecks, MessageSquare } from 'lucide-react';
import { useServer } from '../server';
import { hapticTap, keyboardEventName } from '../mobile';
import { cn } from '../lib/utils';

interface Tab {
  to: string;
  label: string;
  icon: React.ElementType;
  fab?: boolean;
  match: (path: string) => boolean;
}

const TABS: Tab[] = [
  { to: '/', label: 'HOME', icon: Home, match: (p) => p === '/' },
  {
    to: '/scouting',
    label: 'SCOUTS',
    icon: Crosshair,
    match: (p) => p === '/scouting' || p.startsWith('/scouting/') || p.startsWith('/objects/'),
  },
  { to: '/chat', label: 'COMMAND', icon: MessageSquare, fab: true, match: (p) => p.startsWith('/chat') },
  { to: '/feed', label: 'FEED', icon: Activity, match: (p) => p.startsWith('/feed') },
  { to: '/mission', label: 'TASKS', icon: ListChecks, match: (p) => p.startsWith('/mission') },
];

export function MobileHeader(): React.JSX.Element {
  const { connected } = useServer();
  return (
    <header
      className="shrink-0 flex h-[52px] items-center gap-2 border-b border-black/10 bg-p5-cream px-4 lg:hidden"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <span className="font-mono text-[13px] font-bold tracking-[0.3em] text-p5-dark">
        HERMIEOS <span className="text-accent">+</span>
      </span>
      <span className="ml-auto flex items-center gap-1.5 font-mono text-[9px] tracking-[0.2em] text-p5-dark-muted">
        <span className={cn('h-1.5 w-1.5 rounded-full', connected ? 'bg-accent' : 'bg-black/25')} />
        {connected ? 'ONLINE' : 'OFFLINE'}
      </span>
    </header>
  );
}

export function MobileTabBar(): React.JSX.Element {
  const location = useLocation();
  const [kbOpen, setKbOpen] = React.useState(false);

  React.useEffect(() => {
    const onKb = (e: Event): void => {
      setKbOpen((e as CustomEvent<{ visible?: boolean }>).detail?.visible === true);
    };
    window.addEventListener(keyboardEventName(), onKb);
    return () => window.removeEventListener(keyboardEventName(), onKb);
  }, []);

  if (kbOpen) return <></>;

  return (
    <nav
      aria-label="Primary"
      className="shrink-0 border-t border-white/10 bg-[#111111] lg:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="grid h-[60px] grid-cols-5 items-stretch">
        {TABS.map((tab) => {
          const active = tab.match(location.pathname);
          const Icon = tab.icon;
          if (tab.fab) {
            return (
              <div key={tab.to} className="relative flex items-start justify-center">
                <Link
                  to={tab.to}
                  aria-label={tab.label}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => void hapticTap()}
                  className={cn(
                    '-mt-5 flex h-14 w-14 items-center justify-center rounded-full border-2 border-[#111111] text-white transition active:scale-95',
                    active ? 'bg-accent' : 'bg-accent/85',
                  )}
                >
                  <Icon className="h-6 w-6" />
                </Link>
              </div>
            );
          }
          return (
            <Link
              key={tab.to}
              to={tab.to}
              aria-current={active ? 'page' : undefined}
              onClick={() => void hapticTap()}
              className="relative flex min-h-[60px] flex-col items-center justify-center gap-1 transition active:scale-95"
            >
              <span className={cn('h-[3px] w-8 rounded-full', active ? 'bg-accent' : 'bg-transparent')} />
              <Icon className={cn('h-5 w-5', active ? 'text-white' : 'text-white/45')} />
              <span className={cn('font-mono text-[8px] font-bold tracking-[0.18em]', active ? 'text-white' : 'text-white/45')}>
                {tab.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
