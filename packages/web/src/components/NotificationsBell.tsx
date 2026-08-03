import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Bell, BellRing, CheckCheck, Loader2, ExternalLink } from 'lucide-react';
import { api, type Notification } from '../api';
import { useServer } from '../server';
import { Button } from './ui/button';
import { cn } from '../lib/utils';

const PRIORITY_DOT: Record<Notification['priority'], string> = {
  high: 'bg-rose-500',
  normal: 'bg-accent',
  low: 'bg-slate-400',
};

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/**
 * Notification bell + dropdown panel.
 *
 * The bell shows the unread notification count and opens a panel listing
 * recent notifications (newest first). Clicking an unread notification
 * marks it read and navigates to its object. The panel is the in-app
 * notification surface — it works in the Electron shell and the browser
 * without relying on OS push permission.
 */
export function NotificationsBell(): React.JSX.Element {
  const { connected } = useServer();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);

  const unreadQ = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => api.notificationUnreadCount(),
    enabled: connected,
    refetchInterval: 30_000,
  });
  const listQ = useQuery({
    queryKey: ['notifications', 'list'],
    queryFn: () => api.notifications({ limit: 20 }),
    enabled: connected && open,
    refetchInterval: open ? 30_000 : undefined,
  });

  const markReadMut = useMutation({
    mutationFn: (id: string) => api.markNotificationRead(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
  const markAllMut = useMutation({
    mutationFn: () => api.markAllNotificationsRead(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  // Close on outside click / Escape.
  React.useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent): void {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const unread = unreadQ.data?.unread ?? 0;
  const notifications = listQ.data?.notifications ?? [];

  function openNotification(n: Notification): void {
    if (!n.readAt) markReadMut.mutate(n.id);
    setOpen(false);
    if (n.objectId) navigate(`/objects/${n.objectId}`);
  }

  return (
    <div ref={rootRef} className="relative">
      <Button
        variant="ghost"
        size="icon"
        className="relative"
        aria-label="Notifications"
        onClick={() => setOpen((v) => !v)}
      >
        {unread > 0 ? <BellRing className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
        {unread > 0 ? (
          <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-1 rounded-full text-[9px] font-mono font-medium flex items-center justify-center bg-accent text-accent-fg">
            {unread > 99 ? '99+' : unread}
          </span>
        ) : null}
      </Button>

      {open ? (
        <div className="absolute right-0 top-full mt-2 z-50 w-[340px] max-w-[calc(100vw-2rem)] rounded-xl border border-border-default bg-surface-0 shadow-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border-default">
            <span className="text-[13px] font-semibold text-text-primary">Notifications</span>
            {unread > 0 ? (
              <Button
                size="sm"
                variant="ghost"
                className="text-[11px] h-6 gap-1"
                disabled={markAllMut.isPending}
                onClick={() => markAllMut.mutate()}
              >
                {markAllMut.isPending ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <CheckCheck className="w-3 h-3" />
                )}
                Mark all read
              </Button>
            ) : null}
          </div>

          <div className="max-h-[380px] overflow-y-auto">
            {listQ.isLoading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-text-tertiary text-[12px]">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
              </div>
            ) : notifications.length === 0 ? (
              <div className="py-10 text-center">
                <Bell className="w-5 h-5 mx-auto text-text-quaternary" />
                <p className="mt-2 text-[12px] text-text-tertiary">No notifications yet.</p>
                <p className="mt-0.5 text-[11px] text-text-quaternary">
                  Hermes pings you here when something needs attention.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-border-default">
                {notifications.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => openNotification(n)}
                      className={cn(
                        'w-full text-left px-4 py-3 flex gap-3 transition hover:bg-surface-1',
                        !n.readAt && 'bg-accent/5',
                      )}
                    >
                      <span className={cn('w-2 h-2 rounded-full mt-1.5 shrink-0', PRIORITY_DOT[n.priority])} />
                      <span className="flex-1 min-w-0">
                        <span className="flex items-center gap-2">
                          <span className="text-[13px] font-medium text-text-primary truncate">{n.title}</span>
                          {!n.readAt ? (
                            <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-accent/15 text-accent-text shrink-0">
                              new
                            </span>
                          ) : null}
                        </span>
                        {n.message ? (
                          <span className="block text-[12px] text-text-tertiary mt-0.5 line-clamp-2">{n.message}</span>
                        ) : null}
                        <span className="flex items-center gap-1.5 mt-1 text-[10px] text-text-quaternary">
                          {timeAgo(n.createdAt)}
                          {n.objectId ? (
                            <span className="inline-flex items-center gap-0.5">
                              <ExternalLink className="w-2.5 h-2.5" /> open
                            </span>
                          ) : null}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
