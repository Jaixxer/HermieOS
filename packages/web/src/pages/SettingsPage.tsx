import { useState } from 'react';
import { useAuth } from '../auth';
import { useServer } from '../server';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { usePwa } from '../pwa';
import { showSystemNotification } from '../systemNotification';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  User,
  BellRing,
  Cpu,
  KeyRound,
  Database,
  AlertTriangle,
  Download,
  Check,
  Send,
  Loader2,
  Server,
} from 'lucide-react';
import { cn } from '../lib/utils';
import type { PingResult } from '../server';

/**
 * Settings — the system desk. Editorial cream page with hard-edged
 * section cards, mono kickers, red primary actions. Same frame as
 * every other screen: nav rail on the left.
 */

function SectionHeader({ icon: Icon, title, subtitle }: { icon: React.ElementType; title: string; subtitle: string }): React.JSX.Element {
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center border border-black/15 text-p5-dark-muted">
        <Icon className="w-4 h-4" />
      </div>
      <div>
        <div className="p5-kicker text-p5-dark">{title}</div>
        <p className="mt-0.5 text-[12px] text-p5-dark-muted">{subtitle}</p>
      </div>
    </div>
  );
}

function SectionCard({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <section className="border-2 border-black/15 bg-p5-panel p-5 space-y-4">
      {children}
    </section>
  );
}

const fieldLabel = 'p5-kicker text-p5-dark-muted';
const inputCls =
  'flex-1 border border-p5-dark-line bg-white px-3 py-2 text-[13px] text-p5-dark outline-none placeholder:text-p5-dark-muted focus:border-accent transition';

function SolidBtn({
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>): React.JSX.Element {
  return (
    <button
      {...rest}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 bg-accent px-4 py-2 min-h-[44px] text-[11px] font-black tracking-[0.12em] text-white transition hover:bg-accent-hover disabled:opacity-40',
        rest.className,
      )}
    >
      {children}
    </button>
  );
}

function GhostBtn({
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>): React.JSX.Element {
  return (
    <button
      {...rest}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 border border-p5-dark-line px-4 py-2 min-h-[44px] text-[11px] font-black tracking-[0.12em] text-p5-dark transition hover:border-p5-dark hover:bg-p5-dark hover:text-p5-cream disabled:opacity-40',
        rest.className,
      )}
    >
      {children}
    </button>
  );
}

function StatusChip({ on, children }: { on: boolean; children: React.ReactNode }): React.JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 border px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.12em]',
        on ? 'border-emerald-600/50 text-emerald-700' : 'border-amber-500/50 text-amber-600',
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', on ? 'bg-emerald-500' : 'bg-amber-500')} />
      {children}
    </span>
  );
}

export function SettingsPage(): React.JSX.Element {
  const { user, setUser } = useAuth();
  const { url: serverUrl, connected, disconnect, connect, ping } = useServer();
  const { pushSupported, pushSubscribed, subscribeToPush, unsubscribeFromPush } = usePwa();
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const navigate = useNavigate();
  // Server switch form
  const [newUrl, setNewUrl] = useState('');
  const [newToken, setNewToken] = useState('');
  const [pinging, setPinging] = useState(false);
  const [pingRes, setPingRes] = useState<PingResult | null>(null);
  const [switching, setSwitching] = useState(false);

  const { data: unreadNotifs } = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => api.notificationUnreadCount(),
    enabled: connected,
    refetchInterval: 30_000,
  });

  const qc = useQueryClient();
  const testNotifMut = useMutation({
    mutationFn: () => api.sendTestNotification(),
    onSuccess: async (res) => {
      void qc.invalidateQueries({ queryKey: ['notifications'] });
      // The SSE path will also fire a system notification, but show one
      // immediately here so the button is a reliable manual test.
      await showSystemNotification({
        title: res.notification.title,
        body: res.notification.message,
        url: res.notification.objectId ? `/objects/${res.notification.objectId}` : undefined,
      });
      setMsg('Test notification sent — check your system notifications');
    },
  });

  if (!user) return <></>;

  async function saveProfile(): Promise<void> {
    setSaving(true);
    setMsg(null);
    try {
      const { user: u } = await api.updateMe({ displayName });
      setUser(u);
      setMsg('Saved');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function toggleScheduler(): Promise<void> {
    setSaving(true);
    setMsg(null);
    try {
      const { user: u } = await api.setScheduler(!user!.schedulerEnabled);
      setUser(u);
      setMsg(u.schedulerEnabled ? 'Hermes is running' : 'Hermes is paused');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Failed');
    } finally {
      setSaving(false);
    }
  }

  async function exportData(): Promise<void> {
    try {
      const res = await fetch('/api/me/export', { credentials: 'include' });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'hermieos-export.json';
      a.click();
      URL.revokeObjectURL(url);
      setMsg('Export downloaded');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Export failed');
    }
  }

  async function deleteAccount(): Promise<void> {
    if (!user) return;
    const confirmation = `${user.id}:${user.email}`;
    try {
      await api.deleteAccount({ confirmation });
      navigate('/login');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Delete failed');
    }
  }

  async function pingServer(): Promise<void> {
    const target = newUrl.trim() || serverUrl;
    if (!target || pinging) return;
    setPinging(true);
    setPingRes(null);
    try {
      setPingRes(await ping(target));
    } finally {
      setPinging(false);
    }
  }

  async function switchServer(): Promise<void> {
    if (!newUrl.trim() || !newToken.trim() || switching) return;
    setSwitching(true);
    setMsg(null);
    try {
      // connect() validates (GET /me), persists, and re-points the API.
      // SSE + gateway bind the base at mount, so reload to re-point
      // every live connection at the new server cleanly.
      await connect(newUrl, newToken);
      window.location.reload();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Server switch failed');
      setSwitching(false);
    }
  }

  return (
    <div className="flex bg-p5-cream text-p5-dark flex-1 min-w-0 min-h-0">

      <main className="flex-1 min-w-0 min-h-0 overflow-y-auto px-6 py-8 md:px-10 lg:px-10 lg:py-10">
        <div className="mx-auto max-w-[760px]">
          {/* Hero */}
          <header className="relative min-h-[128px]">
            <div className="min-w-0 pt-1">
              <div className="p5-kicker text-p5-dark">SYSTEM & PREFS</div>
              <h1 className="mt-3">
                <span className="relative inline-block font-p5-serif text-[clamp(44px,5vw,72px)] leading-[0.88] text-p5-dark">
                  SETTINGS
                  <span className="absolute -bottom-2.5 left-0 h-[6px] w-full bg-accent" />
                </span>
              </h1>
            </div>
          </header>

          {msg ? (
            <div className="mt-6 flex items-center gap-2 border border-emerald-600/40 bg-emerald-50 px-3 py-2 font-mono text-[12px] text-emerald-700">
              <Check className="w-3.5 h-3.5" /> {msg}
            </div>
          ) : null}

          <div className="mt-7 space-y-5">
            {/* Server */}
            <SectionCard>
              <SectionHeader icon={Server} title="Server" subtitle="Where this app talks to. Point it at your own HermieOS server." />
              <div className="flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 break-all border border-p5-dark-line bg-black/[0.03] px-2.5 py-2 font-mono text-[12px] text-p5-dark">
                  {serverUrl || 'not set'}
                </code>
                <StatusChip on={connected}>{connected ? 'connected' : 'offline'}</StatusChip>
              </div>
              <div>
                <label className={cn(fieldLabel, 'mb-1.5 block')}>New server URL</label>
                <input
                  value={newUrl}
                  onChange={(e) => { setNewUrl(e.target.value); setPingRes(null); }}
                  placeholder="http://192.168.1.50:3001"
                  inputMode="url"
                  autoComplete="url"
                  className={cn(inputCls, 'w-full h-12 !text-[16px]')}
                />
              </div>
              <div>
                <label className={cn(fieldLabel, 'mb-1.5 block')}>MCP token for that server</label>
                <input
                  type="password"
                  value={newToken}
                  onChange={(e) => setNewToken(e.target.value)}
                  placeholder="mcp_…"
                  autoComplete="current-password"
                  className={cn(inputCls, 'w-full h-12 !text-[16px] font-mono')}
                />
                <p className="mt-1 text-[11px] text-p5-dark-muted">Tokens belong to their server — paste the new server's token.</p>
              </div>
              {pingRes ? (
                <div className={cn(
                  'border px-3 py-2 font-mono text-[12px]',
                  pingRes.status === 'ok' && 'border-emerald-600/40 bg-emerald-50 text-emerald-700',
                  pingRes.status === 'unreachable' && 'border-status-failed/40 bg-red-50 text-status-failed',
                  pingRes.status === 'wrong-server' && 'border-amber-500/40 bg-amber-50 text-amber-700',
                )}>
                  {pingRes.detail}
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <GhostBtn onClick={() => void pingServer()} disabled={pinging || (!newUrl.trim() && !serverUrl)} className="min-h-[44px]">
                  {pinging ? 'Pinging…' : 'Ping server'}
                </GhostBtn>
                <SolidBtn onClick={() => void switchServer()} disabled={switching || !newUrl.trim() || !newToken.trim()} className="min-h-[44px]">
                  {switching ? 'Connecting…' : 'Save & reconnect'}
                </SolidBtn>
              </div>
            </SectionCard>

            {/* Profile */}
            <SectionCard>
              <SectionHeader icon={User} title="Profile" subtitle="Your display name and account email." />
              <div>
                <label className={cn(fieldLabel, 'mb-1.5 block')}>Email</label>
                <input value={user.email} disabled className={cn(inputCls, 'w-full bg-black/[0.03] text-p5-dark-muted')} />
              </div>
              <div>
                <label className={cn(fieldLabel, 'mb-1.5 block')}>Display name</label>
                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                  <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className={cn(inputCls, 'h-12 sm:h-auto !text-[16px] sm:!text-[13px]')} />
                  <SolidBtn onClick={() => void saveProfile()} disabled={saving}>
                    {saving ? 'Saving…' : 'Save'}
                  </SolidBtn>
                </div>
              </div>
            </SectionCard>

            {/* Background work */}
            <SectionCard>
              <SectionHeader icon={Cpu} title="Background work" subtitle="When Hermes is paused, subscriptions and feedback review stop." />
              <div className="flex items-center gap-3">
                <SolidBtn onClick={() => void toggleScheduler()} disabled={saving} className={user.schedulerEnabled ? '!bg-p5-dark !hover:bg-p5-ink-3' : ''}>
                  {user.schedulerEnabled ? 'Pause Hermes' : 'Resume Hermes'}
                </SolidBtn>
                <StatusChip on={user.schedulerEnabled}>
                  {user.schedulerEnabled ? 'running' : 'paused'}
                </StatusChip>
              </div>
            </SectionCard>

            {/* Notifications */}
            <SectionCard>
              <SectionHeader icon={BellRing} title="Notifications" subtitle="In-app notifications always appear in the bell. Browser push is optional." />
              {unreadNotifs && unreadNotifs.unread > 0 ? (
                <p className="text-[12px] text-p5-dark-muted">
                  You have <span className="font-bold text-accent">{unreadNotifs.unread} unread</span> notification{unreadNotifs.unread === 1 ? '' : 's'}.
                </p>
              ) : null}
              <div className="flex items-center gap-3 flex-wrap">
                <GhostBtn disabled={testNotifMut.isPending} onClick={() => testNotifMut.mutate()}>
                  {testNotifMut.isPending ? (
                    <Loader2 className="w-3 h-3 animate-spin mr-1" />
                  ) : (
                    <Send className="w-3 h-3 mr-1" />
                  )}
                  Send test notification
                </GhostBtn>
                <p className="text-[11px] font-mono text-p5-dark-muted">
                  Runs the real pipeline: feed + bell + toast.
                </p>
              </div>
              {pushSupported ? (
                <div className="flex items-center gap-3">
                  <GhostBtn
                    className={pushSubscribed ? '!bg-p5-dark !text-p5-cream' : ''}
                    onClick={() => {
                      if (pushSubscribed) void unsubscribeFromPush();
                      else void subscribeToPush();
                    }}
                  >
                    {pushSubscribed ? 'Disable browser push' : 'Enable browser push'}
                  </GhostBtn>
                  <StatusChip on={pushSubscribed}>{pushSubscribed ? 'on' : 'off'}</StatusChip>
                </div>
              ) : (
                <p className="text-[12px] text-p5-dark-muted">
                  Browser push isn't available in this environment (e.g. the desktop app). In-app notifications still work.
                </p>
              )}
            </SectionCard>

            {/* Connection */}
            <SectionCard>
              <SectionHeader icon={Database} title="Server connection" subtitle="Where this app talks to your HermieOS server." />
              <div className="flex items-center gap-2 font-mono text-[13px] text-p5-dark">
                <span className="truncate">{serverUrl || '—'}</span>
                <StatusChip on={connected}>{connected ? 'connected' : 'disconnected'}</StatusChip>
              </div>
              <div>
                <GhostBtn onClick={() => { disconnect(); navigate('/'); }}>
                  Disconnect
                </GhostBtn>
              </div>
            </SectionCard>

            {/* MCP token */}
            <SectionCard>
              <SectionHeader icon={KeyRound} title="MCP token" subtitle="Use this token to connect your local Hermes install to HermieOS." />
              <Link to="/settings/mcp-token" className="inline-block">
                <SolidBtn type="button">View / rotate token</SolidBtn>
              </Link>
            </SectionCard>

            {/* Export */}
            <SectionCard>
              <SectionHeader icon={Download} title="Export data" subtitle="Download all your objects, relationships, feedback, and history as JSON." />
              <GhostBtn onClick={() => { exportData().catch(() => {}); }}>
                <Download className="w-3.5 h-3.5" /> Download export
              </GhostBtn>
            </SectionCard>

            {/* Danger zone */}
            <section className="border-2 border-status-failed/40 bg-p5-panel p-5 space-y-4">
              <SectionHeader icon={AlertTriangle} title="Delete account" subtitle="This permanently deletes your account and all data." />
              <div className="flex items-center gap-2">
                <input
                  placeholder={user.email}
                  value={deleteConfirm}
                  onChange={(e) => setDeleteConfirm(e.target.value)}
                  className={inputCls}
                />
                <button
                  type="button"
                  disabled={deleteConfirm !== user.email}
                  onClick={() => { deleteAccount().catch(() => {}); }}
                  className="inline-flex shrink-0 items-center gap-1.5 border border-status-failed/60 px-4 py-2 text-[11px] font-black tracking-[0.12em] text-status-failed transition hover:bg-status-failed hover:text-white disabled:opacity-40"
                >
                  <AlertTriangle className="w-3.5 h-3.5" /> DELETE MY ACCOUNT
                </button>
              </div>
            </section>
          </div>

          <footer className="mt-12 text-center font-mono text-[10px] tracking-[0.25em] text-p5-dark-muted">
            SYSTEM · YOU OWN THE KNOBS
          </footer>
        </div>
      </main>
    </div>
  );
}
