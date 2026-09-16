/**
 * The navigation rail — the frame every editorial screen shares.
 * Quiet inactive rows, a large red active banner that bleeds into the
 * workspace, and a small utility footer. No motion library — just CSS
 * hover micro-animations on the inactive rows.
 */
import * as React from 'react';
import { Link } from 'react-router-dom';
import { Activity, Calendar, Crosshair, ListChecks, MessageSquare, Settings, Target } from 'lucide-react';
import { useAuth } from '../auth';
import { useServer } from '../server';
import { cn } from '../lib/utils';

const NAV_ITEMS = [
  { to: '/', num: '01', label: 'Home', subtitle: 'Workspace', icon: null },
  { to: '/scouting/findings', num: '02', label: 'Findings', subtitle: 'Research & intel', icon: Target },
  { to: '/scouting', num: '03', label: 'Scouts', subtitle: 'Opportunities', icon: Crosshair },
  { to: '/chat', num: '04', label: 'Command', subtitle: 'Talk with Hermes', icon: MessageSquare },
  { to: '/feed', num: '05', label: 'Feed', subtitle: 'Activity stream', icon: Activity },
  { to: '/calendar', num: '06', label: 'Calendar', subtitle: 'Schedule & sync', icon: Calendar },
  { to: '/planner', num: '07', label: 'Tasks', subtitle: 'Plan & delegate', icon: ListChecks },
  { to: '/settings', num: '08', label: 'Settings', subtitle: 'System & prefs', icon: Settings },
] as const;

type NavItem = (typeof NAV_ITEMS)[number];

function activeFor(path: string, to: string): boolean {
  return path === to || (to !== '/' && path.startsWith(to + '/'));
}

/** Longest-prefix match so /scouting/findings highlights Findings,
 *  not the shorter /scouting (Scouts) entry. */
function activeItem(path: string): string | null {
  const matches = NAV_ITEMS.filter((i) => activeFor(path, i.to));
  if (matches.length === 0) return null;
  return [...matches].sort((a, b) => b.to.length - a.to.length)[0]!.to;
}

function iconTone(item: NavItem): string {
  switch (item.num) {
    case '02': return 'text-accent';
    case '03': return 'text-yellow-400';
    case '04': return 'text-violet-500';
    case '05': return 'text-emerald-400';
    default: return 'text-white/75';
  }
}

export function NavRail({ activePath }: { activePath: string }): React.JSX.Element {
  const { user } = useAuth();
  const { connected } = useServer();
  const activeTo = activeItem(activePath);

  return (
    <aside className="sticky top-0 relative hidden h-screen max-h-screen w-[200px] shrink-0 self-start flex-col overflow-visible border-r border-white/[0.08] bg-[#111111] lg:flex xl:w-[244px] z-20">
      <div className="pointer-events-none absolute inset-0 z-0 opacity-20" style={{ backgroundImage: 'linear-gradient(135deg, rgba(255,255,255,0.03) 0%, transparent 42%), repeating-linear-gradient(135deg, rgba(255,255,255,0.014) 0 1px, transparent 1px 8px)' }} />
      <div className="relative px-6 pb-3 pt-6 xl:px-9">
        <div className="flex items-center gap-2 font-mono text-[15px] font-bold tracking-[0.34em] text-[#f3eee5] xl:text-[17px]">
          HERMIEOS <span className="text-[17px] text-accent xl:text-[19px]">+</span>
        </div>
        <div className="mt-2 text-[8px] font-mono tracking-[0.3em] text-white/55 xl:text-[9px]">COLLABORATION OS</div>
      </div>

      <nav className="relative z-10 flex-1 min-h-0 overflow-y-auto py-2">
        <ul className="space-y-1 xl:space-y-1.5">
          {NAV_ITEMS.map((item) => {
            const active = item.to === activeTo;
            const Icon = item.icon;
            return (
              <li key={item.to} className="relative">
                <Link to={item.to} className={cn('group relative flex items-center gap-2 px-6 py-2 xl:gap-3 xl:px-9', active ? 'min-h-[96px] text-white xl:min-h-[108px]' : 'min-h-[46px] text-white/55 hover:text-white xl:min-h-[54px]')}>
                  {active ? (
                    <>
                      <span className="absolute -inset-y-1 -left-4 right-[20px] bg-accent xl:-left-5 xl:right-[24px]" style={{ clipPath: 'polygon(0 22%, 100% 0, 92% 100%, 7% 86%)' }} />
                      <span className="relative z-10 w-5 text-[11px] font-mono font-bold text-white/75 xl:w-7 xl:text-[13px]">{item.num}</span>
                      {Icon ? <Icon className="relative z-10 h-4 w-4 text-white xl:h-5 xl:w-5" /> : null}
                      <span className="relative z-10 font-p5-serif text-[23px] leading-none text-white xl:text-[28px]">{item.label.toUpperCase()}</span>
                      <span className="relative z-10 ml-auto text-[38px] font-black leading-none text-white xl:text-[46px]" style={{ textShadow: '3px 3px 0 #111' }}>›</span>
                    </>
                  ) : (
                    <>
                      <span className="pointer-events-none absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 bg-accent opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
                      <span className="w-5 text-[11px] font-mono font-bold text-white/35 transition-colors duration-200 group-hover:text-white/70 xl:w-7 xl:text-[13px]">{item.num}</span>
                      {Icon ? <Icon className={cn('h-5 w-5 transition-transform duration-200 group-hover:scale-110 xl:h-6 xl:w-6', iconTone(item))} /> : null}
                      <span className="min-w-0">
                        <span className="block font-p5-serif text-[21px] leading-none text-white/95 transition-transform duration-200 group-hover:translate-x-0.5 xl:text-[27px]">{item.label.toUpperCase()}</span>
                        <span className="mt-1 hidden text-[11px] text-white/55 transition-colors duration-200 group-hover:text-white/85 xl:block xl:text-[12px]">{item.subtitle}</span>
                      </span>
                    </>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="relative z-20 bg-[#111111] px-6 pb-6 pt-4 xl:px-9">
        <div className="mb-5 flex items-center gap-2 text-[10px] font-mono tracking-[0.2em] text-white/65">
          <span className={cn('h-2 w-2 rounded-full', connected ? 'bg-accent' : 'bg-white/35')} />
          HERMES IS {connected ? 'ONLINE' : 'OFFLINE'}
        </div>
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center bg-accent text-[16px] font-black text-white">
            {(user?.displayName ?? 'JV').slice(0, 2).toUpperCase()}
          </div>
          <div>
            <div className="text-[13px] font-bold uppercase tracking-[0.08em] text-[#f3eee5]">{user?.displayName ?? 'Jaiveer'}</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
