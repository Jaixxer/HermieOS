import { useState } from 'react';
import { useAuth } from '../auth';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';

export function SettingsPage(): React.JSX.Element {
  const { user, setUser } = useAuth();
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const navigate = useNavigate();

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

      <section className="card space-y-3">
        <h2 className="font-medium">Export data</h2>
        <p className="text-sm text-slate-400">
          Download all your objects, relationships, feedback, and history as JSON.
        </p>
        <button className="btn-secondary" onClick={() => { exportData().catch(() => {}); }}>
          Download export
        </button>
      </section>

      <section className="card space-y-3 border-red-900/40">
        <h2 className="font-medium text-red-400">Delete account</h2>
        <p className="text-sm text-slate-400">
          This permanently deletes your account and all data. Type your email to confirm.
        </p>
        <input
          className="input"
          placeholder={user.email}
          value={deleteConfirm}
          onChange={(e) => setDeleteConfirm(e.target.value)}
        />
        <button
          className="px-3 py-1.5 rounded-md bg-red-800 text-red-100 text-sm font-medium hover:bg-red-700 disabled:opacity-50 transition"
          disabled={deleteConfirm !== user.email}
          onClick={() => { deleteAccount().catch(() => {}); }}
        >
          Delete my account
        </button>
      </section>
    </div>
  );
}
