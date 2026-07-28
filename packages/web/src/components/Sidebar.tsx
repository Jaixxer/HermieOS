import * as React from 'react';
import { NavLink, Link, useLocation } from 'react-router-dom';
import {
  Home,
  Target,
  FolderKanban,
  Lightbulb,
  Compass,
  Radar,
  CalendarDays,
  BookOpen,
  BarChart3,
  Settings,
  LogOut,
  MessageSquare,
} from 'lucide-react';
import { useAuth } from '../auth';
import { Logo, Wordmark } from './Logo';
import { OrbitGlyph } from './OrbitGlyph';
import { Button } from './ui/button';
import { cn } from '../lib/utils';

// ============================================================================
// Navigation
// ============================================================================

const NAV_ITEMS = [
  { to: '/', label: 'Home', icon: Home },
  { to: '/mission', label: 'Mission', icon: Target },
  { to: '/projects', label: 'Projects', icon: FolderKanban },
  { to: '/knowledge', label: 'Knowledge', icon: Lightbulb },
  { to: '/opportunities', label: 'Opportunities', icon: Compass },
  { to: '/scouting', label: 'Scouting', icon: Radar },
  { to: '/chat', label: 'Chat', icon: MessageSquare },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays },
  { to: '/resources', label: 'Resources', icon: BookOpen },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/settings', label: 'Settings', icon: Settings },
] as const;

export interface SidebarProps {
  activePath?: string;
  className?: string;
  hideHeader?: boolean;
}

export function Sidebar({ activePath: activePathProp, className, hideHeader }: SidebarProps): React.JSX.Element {
  const { user, logout } = useAuth();
  const location = useLocation();
  const activePath = activePathProp ?? location.pathname;

  return (
    <aside
      className={cn(
        'flex w-[244px] shrink-0 flex-col border-r border-border-default bg-sidebar',
        className,
      )}
    >
      {!hideHeader ? (
        <Link
          to="/"
          className="flex items-center gap-3 px-4 py-4 hover:opacity-90 transition"
        >
          <Logo size={40} />
          <Wordmark />
        </Link>
      ) : null}

      <nav className="flex-1 px-3 overflow-y-auto">
        <ul className="space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive =
              activePath === item.to ||
              (item.to === '/' && activePath === '/') ||
              (item.to !== '/' && activePath.startsWith(item.to));
            return (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.to === '/'}
                  className={cn(
                    'group flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium transition',
                    isActive
                      ? 'bg-accent-soft text-accent-text'
                      : 'text-text-secondary hover:bg-surface-2 hover:text-text-primary',
                  )}
                >
                  <Icon className="w-[18px] h-[18px] shrink-0" strokeWidth={1.75} />
                  <span className="flex-1 truncate">{item.label}</span>
                </NavLink>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Hermes agent card */}
      <div className="p-3 border-t border-border-default">
        <div className="rounded-xl p-3 bg-surface-0 border border-border-default shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[#0a0a0a] flex items-center justify-center text-[#bfa15f]">
              <OrbitGlyph size={24} animate />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold text-text-primary">Hermes</div>
              <div className="flex items-center gap-1.5 text-[11px] text-accent-text font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-status-active" />
                Online
              </div>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-text-tertiary leading-relaxed">
            Your AI agent. Scouting, researching, keeping you ahead.
          </p>
        </div>

        {user ? (
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start mt-2 text-[12px] text-text-tertiary hover:text-text-primary"
            onClick={() => void logout()}
          >
            <LogOut className="w-4 h-4 mr-2" />
            Sign out
            <span className="ml-auto text-[11px] font-mono text-text-quaternary truncate max-w-[90px]">
              {user.displayName}
            </span>
          </Button>
        ) : null}
      </div>
    </aside>
  );
}
