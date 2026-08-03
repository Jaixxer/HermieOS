import { useState } from 'react';
import { useAuth } from '../auth';
import { useServer } from '../server';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { usePwa } from '../pwa';
import { showSystemNotification } from '../systemNotification';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
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
} from 'lucide-react';

function SectionTitle({ icon: Icon, title, subtitle }: { icon: React.ElementType; title: string; subtitle: string }): React.JSX.Element {
  return (
    <div className="flex items-start gap-3">
      <div className="w-9 h-9 rounded-lg bg-surface-2 flex items-center justify-center text-text-secondary shrink-0">
        <Icon className="w-4 h-4" />
      </div>
      <div>
        <h2 className="text-[15px] font-semibold text-text-primary">{title}</h2>
        <p className="text-[12px] text-text-tertiary mt-0.5">{subtitle}</p>
      </div>
    </div>
  );
}

export function SettingsPage(): React.JSX.Element {
  const { user, setUser } = useAuth();
  const { url: serverUrl, connected, disconnect } = useServer();
  const { pushSupported, pushSubscribed, subscribeToPush, unsubscribeFromPush } = usePwa();
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const navigate = useNavigate();

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

  return (
    <div className="space-y-5 max-w-2xl">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight text-text-primary">Settings</h1>
        <p className="text-[13px] text-text-tertiary mt-1">Your account, background work, and notifications.</p>
      </div>

      {msg ? (
        <div className="flex items-center gap-2 text-[12px] text-emerald-600 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
          <Check className="w-3.5 h-3.5" /> {msg}
        </div>
      ) : null}

      {/* Profile */}
      <Card>
        <CardContent className="p-5 space-y-4">
          <SectionTitle icon={User} title="Profile" subtitle="Your display name and account email." />
          <div>
            <label className="block text-[12px] font-medium text-text-secondary mb-1">Email</label>
            <Input value={user.email} disabled className="text-[13px]" />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-text-secondary mb-1">Display name</label>
            <div className="flex items-center gap-2">
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="flex-1 text-[13px]" />
              <Button onClick={() => void saveProfile()} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Background work */}
      <Card>
        <CardContent className="p-5 space-y-3">
          <SectionTitle icon={Cpu} title="Background work" subtitle="When Hermes is paused, subscriptions and feedback review stop." />
          <div className="flex items-center gap-3">
            <Button variant={user.schedulerEnabled ? 'secondary' : 'default'} onClick={() => void toggleScheduler()} disabled={saving}>
              {user.schedulerEnabled ? 'Pause Hermes' : 'Resume Hermes'}
            </Button>
            <Badge tone={user.schedulerEnabled ? 'emerald' : 'amber'} variant="soft">
              {user.schedulerEnabled ? 'running' : 'paused'}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Notifications */}
      <Card>
        <CardContent className="p-5 space-y-3">
          <SectionTitle icon={BellRing} title="Notifications" subtitle="In-app notifications always appear in the bell. Browser push is optional." />
          {unreadNotifs && unreadNotifs.unread > 0 ? (
            <p className="text-[12px] text-text-tertiary">
              You have <span className="text-accent-text font-medium">{unreadNotifs.unread} unread</span> notification{unreadNotifs.unread === 1 ? '' : 's'}.
            </p>
          ) : null}
          <div className="flex items-center gap-3 flex-wrap">
            <Button variant="outline" size="sm" disabled={testNotifMut.isPending} onClick={() => testNotifMut.mutate()}>
              {testNotifMut.isPending ? (
                <Loader2 className="w-3 h-3 animate-spin mr-1" />
              ) : (
                <Send className="w-3 h-3 mr-1" />
              )}
              Send test notification
            </Button>
            <p className="text-[11px] text-text-quaternary">
              Creates a notification through the real pipeline (feed + bell + toast).
            </p>
          </div>
          {pushSupported ? (
            <div className="flex items-center gap-3">
              <Button
                variant={pushSubscribed ? 'secondary' : 'default'}
                onClick={() => {
                  if (pushSubscribed) void unsubscribeFromPush();
                  else void subscribeToPush();
                }}
              >
                {pushSubscribed ? 'Disable browser push' : 'Enable browser push'}
              </Button>
              <Badge tone={pushSubscribed ? 'emerald' : 'slate'} variant="soft">
                {pushSubscribed ? 'on' : 'off'}
              </Badge>
            </div>
          ) : (
            <p className="text-[12px] text-text-tertiary">
              Browser push isn't available in this environment (e.g. the desktop app). In-app notifications still work.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Connection */}
      <Card>
        <CardContent className="p-5 space-y-3">
          <SectionTitle icon={Database} title="Server connection" subtitle="Where this app talks to your HermieOS server." />
          <div className="flex items-center gap-2 text-[13px] text-text-primary font-mono">
            <span className="truncate">{serverUrl || '—'}</span>
            <Badge tone={connected ? 'emerald' : 'rose'} variant="soft">{connected ? 'connected' : 'disconnected'}</Badge>
          </div>
          <div>
            <Button variant="ghost" size="sm" onClick={() => { disconnect(); navigate('/'); }}>
              Disconnect
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* MCP token */}
      <Card>
        <CardContent className="p-5 space-y-3">
          <SectionTitle icon={KeyRound} title="MCP token" subtitle="Use this token to connect your local Hermes install to HermieOS." />
          <Link to="/settings/mcp-token">
            <Button variant="secondary">View / rotate token</Button>
          </Link>
        </CardContent>
      </Card>

      {/* Export */}
      <Card>
        <CardContent className="p-5 space-y-3">
          <SectionTitle icon={Download} title="Export data" subtitle="Download all your objects, relationships, feedback, and history as JSON." />
          <Button variant="secondary" onClick={() => { exportData().catch(() => {}); }}>
            Download export
          </Button>
        </CardContent>
      </Card>

      {/* Danger zone */}
      <Card className="border-rose-900/40">
        <CardContent className="p-5 space-y-3">
          <SectionTitle icon={AlertTriangle} title="Delete account" subtitle="This permanently deletes your account and all data." />
          <div className="flex items-center gap-2">
            <Input
              placeholder={user.email}
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              className="flex-1 text-[13px]"
            />
            <Button
              variant="destructive"
              disabled={deleteConfirm !== user.email}
              onClick={() => { deleteAccount().catch(() => {}); }}
            >
              Delete my account
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
