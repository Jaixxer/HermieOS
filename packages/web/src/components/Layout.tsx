import * as React from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { useServer } from '../server';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Search } from 'lucide-react';
import { useSse } from '../sse';
import { PwaBanner } from '../pwa';
import { NotificationsBell } from './NotificationsBell';
import { ToastProvider, useToasts } from './Toasts';
import { onSystemNotificationNavigate, showSystemNotification } from '../systemNotification';
import { CommandPalette, useCommandPalette } from './CommandPalette';
import { Sidebar } from './Sidebar';
import { Kbd } from './ui/kbd';
import { Separator } from './ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';

// ============================================================================
// Topbar
// ============================================================================

function Topbar() {
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
                <NotificationsBell />
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

function LayoutInner() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { push: pushToast } = useToasts();

  // System notification click → navigate to the linked object.
  React.useEffect(() => {
    return onSystemNotificationNavigate((url) => {
      if (url.startsWith('/')) navigate(url);
      else window.location.href = url;
    });
  }, [navigate]);

  const showNotification = (n: { title: string; body?: string; objectId?: string | null }): void => {
    qc.invalidateQueries({ queryKey: ['notifications'] });
    pushToast({ title: n.title, body: n.body ?? undefined, objectId: n.objectId ?? undefined });
    void showSystemNotification({
      title: n.title,
      body: n.body ?? '',
      url: n.objectId ? `/objects/${n.objectId}` : undefined,
    });
  };

  useSse({
    onFeed: () => {
      qc.invalidateQueries({ queryKey: ['feed'] });
      qc.invalidateQueries({ queryKey: ['unread'] });
      // Notifications arrive on the dedicated `notification` SSE event
      // below. We deliberately do NOT also fire toasts for feed events
      // with kind='notification' — notifyUser writes BOTH a feed event
      // and a notification row, so handling both paths double-fires
      // every notification.
    },
    onNotification: (n) => {
      showNotification({ title: n.title, body: n.body, objectId: n.objectId });
    },
  });

  return null;
}

export function Layout() {
  const location = useLocation();
  const { connected } = useServer();

  return (
    <ToastProvider>
      <LayoutInner />
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
    </ToastProvider>
  );
}
