/**
 * The homepage/navigation frame from the reference composition.
 * The rail is intentionally editorial: quiet inactive rows, a large red
 * active banner that bleeds into the workspace, and a small utility footer.
 */
import * as React from 'react';
import { Link } from 'react-router-dom';
import { Activity, Crosshair, MessageSquare, Settings, Target } from 'lucide-react';
import { useAuth } from '../auth';
import { useServer } from '../server';
import { cn } from '../lib/utils';

const NAV_ITEMS = [
  { to: '/', num: '01', label: 'Home', subtitle: 'Workspace', icon: null },
  { to: '/scouting/findings', num: '02', label: 'Findings', subtitle: 'Research & intel', icon: Target },
  { to: '/scouting', num: '03', label: 'Scouts', subtitle: 'Opportunities', icon: Crosshair },
  { to: '/chat', num: '04', label: 'Command', subtitle: 'Talk with Hermes', icon: MessageSquare },
  { to: '/feed', num: '05', label: 'Feed', subtitle: 'Activity stream', icon: Activity },
  { to: '/settings', num: '06', label: 'Settings', subtitle: 'System & prefs', icon: Settings },
] as const;

function activeFor(path: string, to: string): boolean {
  return path === to || (to !== '/' && path.startsWith(to));
}

export function NavRail({ activePath }: { activePath: string }): React.JSX.Element {
  const { user } = useAuth();
  const { connected } = useServer();

  return (
    <aside className="sticky top-0 relative hidden h-screen max-h-screen w-[235px] shrink-0 self-start flex-col overflow-visible border-r border-white/[0.08] bg-[#111111] lg:flex">
      <div className="pointer-events-none absolute inset-0 z-0 opacity-20" style={{ backgroundImage: 'linear-gradient(135deg, rgba(255,255,255,0.03) 0%, transparent 42%), repeating-linear-gradient(135deg, rgba(255,255,255,0.014) 0 1px, transparent 1px 8px)' }} />
      <div className="relative px-8 pb-3 pt-6">
        <div className="flex items-center gap-2 text-[17px] font-mono font-bold tracking-[0.34em] text-[#f3eee5]">
          HERMIEOS <span className="text-[19px] text-accent">+</span>
        </div>
        <div className="mt-2 text-[9px] font-mono tracking-[0.3em] text-white/55">COLLABORATION OS</div>
      </div>

      <nav className="relative z-10 flex-1 py-2">
        <ul className="space-y-1">
          {NAV_ITEMS.map((item) => {
            const active = activeFor(activePath, item.to);
            const Icon = item.icon;
            return (
              <li key={item.to} className="relative">
                <Link to={item.to} className={cn('group relative flex items-center gap-3 px-8 py-2 transition', active ? 'min-h-[106px] text-white' : 'min-h-[52px] text-white/55 hover:text-white')}>
                  {active ? (
                    <>
                      <span className="absolute -inset-y-1 -left-5 right-[30px] bg-accent" style={{ clipPath: 'polygon(0 22%, 100% 0, 92% 100%, 7% 86%)' }} />
                      <span className="relative z-10 w-7 text-[13px] font-mono font-bold text-white/75">{item.num}</span>
                      {Icon ? <Icon className="relative z-10 h-5 w-5 text-white" /> : null}
                      <span className="relative z-10 font-p5-serif text-[27px] leading-none text-white">{item.label.toUpperCase()}</span>
                      <span className="relative z-10 ml-auto text-[46px] font-black leading-none text-white" style={{ textShadow: '3px 3px 0 #111' }}>›</span>
                    </>
                  ) : (
                    <>
                      <span className="w-7 text-[13px] font-mono font-bold text-white/35">{item.num}</span>
                      {Icon ? <Icon className={cn('h-6 w-6', item.num === '02' ? 'text-accent' : item.num === '03' ? 'text-yellow-400' : item.num === '04' ? 'text-violet-500' : item.num === '05' ? 'text-emerald-400' : 'text-white/75')} /> : null}
                      <span className="min-w-0">
                        <span className="block font-p5-serif text-[27px] leading-none text-white/95">{item.label.toUpperCase()}</span>
                        <span className="mt-1 block text-[12px] text-white/55">{item.subtitle}</span>
                      </span>
                    </>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="relative z-20 bg-[#111111] px-8 pb-6 pt-4">
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
            <div className="mt-1 text-[11px] text-white/55">Focus mode</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
