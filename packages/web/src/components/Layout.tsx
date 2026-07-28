import * as React from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth';
import { useServer } from '../server';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  ChevronDown,
  Search,
  Command as CommandIcon,
} from 'lucide-react';
import { api } from '../api';
import { useSse } from '../sse';
import { PwaBanner } from '../pwa';
import { CommandPalette, useCommandPalette } from './CommandPalette';
import { Sidebar } from './Sidebar';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Kbd } from './ui/kbd';
import { Separator } from './ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { cn } from '../lib/utils';

// ============================================================================
// Topbar
// ============================================================================

function Topbar() {
  const { data: unread } = useQuery({
    queryKey: ['unread'],
    queryFn: () => api.unreadCount(),
    refetchInterval: 30_000,
  });
  const { user } = useAuth();
  const palette = useCommandPalette();
  const [now, setNow] = React.useState(() => new Date());

  React.useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

  return (
    <header className="sticky top-0 z-30 h-[52px] bg-surface-1/95 backdrop-blur border-b border-border-default">
      <div className="h-full px-4 flex items-center gap-3">
        <button
          type="button"
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-text-secondary hover:bg-surface-2 transition"
        >
          <span className="text-[13px] font-medium">{user?.displayName ?? 'Personal'}</span>
          <ChevronDown className="w-3 h-3 text-text-quaternary" />
        </button>

        <Separator orientation="vertical" className="h-5 mx-1" />

        <div className="flex items-center gap-1.5 text-[12px] text-text-tertiary">
          <span>Workspace</span>
          <span className="text-text-quaternary">/</span>
          <span className="text-text-primary font-medium">{now.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</span>
        </div>

        <div className="flex-1" />

        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={palette.open}
                className="group hidden md:flex items-center gap-2.5 px-3 py-1.5 rounded-md w-[280px] bg-surface-2 border border-border-default text-text-tertiary transition-all hover:-translate-y-px hover:border-border-strong"
              >
                <Search className="w-3.5 h-3.5" />
                <span className="text-[12.5px]">Search, jump, command…</span>
                <span className="ml-auto flex items-center gap-0.5">
                  <Kbd>{isMac ? '⌘' : 'Ctrl'}</Kbd>
                  <Kbd>K</Kbd>
                </span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Open command palette</TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <div className="flex items-center gap-1.5">
          <TooltipProvider delayDuration={400}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
                  <Bell className="h-4 w-4" />
                  {(unread?.unread ?? 0) > 0 ? (
                    <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-1 rounded-full text-[9px] font-mono font-medium flex items-center justify-center bg-accent text-accent-fg">
                      {unread!.unread > 99 ? '99+' : unread!.unread}
                    </span>
                  ) : null}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Notifications</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <TooltipProvider delayDuration={400}>
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold ml-1 cursor-pointer ring-1 ring-border-default"
                  style={{
                    background: 'linear-gradient(135deg, #fcd34d, #f472b6 50%, #a78bfa)',
                    color: '#1a1033',
                  }}
                  aria-label={user?.displayName ?? 'User'}
                >
                  {user?.displayName ? user.displayName.slice(0, 2).toUpperCase() : 'JV'}
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom">{user?.email ?? 'Signed in'}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
    </header>
  );
}

// ============================================================================
// Layout
// ============================================================================

export function Layout() {
  const location = useLocation();
  const qc = useQueryClient();
  const { connected } = useServer();

  useSse({
    onFeed: () => {
      qc.invalidateQueries({ queryKey: ['feed'] });
      qc.invalidateQueries({ queryKey: ['unread'] });
    },
  });

  return (
    <div className="min-h-screen flex bg-page">
      <Sidebar activePath={location.pathname} />
      <div className="flex-1 min-w-0 flex flex-col">
        <Topbar />
        {connected ? (
          <>
            <PwaBanner />
            <main className="flex-1 min-w-0">
              <Outlet />
            </main>
          </>
        ) : null}
      </div>
      <CommandPalette />
    </div>
  );
}
