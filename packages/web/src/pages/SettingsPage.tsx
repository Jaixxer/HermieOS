import { useState } from 'react';
import { useAuth } from '../auth';
import { Link } from 'react-router-dom';
import { api } from '../api';

export function SettingsPage(): React.JSX.Element {
  const { user, setUser } = useAuth();
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

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

  return (
    <div className="space-y-6 max-w-xl">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <section className="card space-y-3">
        <h2 className="font-medium">Profile</h2>
        <div>
          <label className="label">Email</label>
          <input className="input" value={user.email} disabled />
        </div>
        <div>
          <label className="label">Display name</label>
          <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </div>
        <div className="flex items-center gap-3">
          <button className="btn-primary" onClick={() => void saveProfile()} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          {msg ? <span className="text-sm text-slate-400">{msg}</span> : null}
        </div>
      </section>

      <section className="card space-y-3">
        <h2 className="font-medium">Background work</h2>
        <p className="text-sm text-slate-400">
          When Hermes is paused, your subscriptions and feedback review will not run.
        </p>
        <div className="flex items-center gap-3">
          <button className="btn-secondary" onClick={() => void toggleScheduler()} disabled={saving}>
            {user.schedulerEnabled ? 'Pause Hermes' : 'Resume Hermes'}
          </button>
          <span className="text-sm text-slate-400">
            currently: {user.schedulerEnabled ? 'running' : 'paused'}
          </span>
        </div>
      </section>

      <section className="card space-y-3">
        <h2 className="font-medium">MCP token</h2>
        <p className="text-sm text-slate-400">
          Use this token to connect your local Hermes install to HermieOS.
        </p>
        <Link to="/settings/mcp-token" className="btn-secondary inline-block">
          View / rotate token
        </Link>
      </section>
    </div>
  );
}
