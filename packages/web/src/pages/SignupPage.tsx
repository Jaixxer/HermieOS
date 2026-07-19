import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { ApiError } from '../api';

export function SignupPage(): React.JSX.Element {
  const { signup } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await signup(email, password, displayName || undefined);
      nav('/settings/mcp-token', { replace: true, state: { justSignedUp: true } });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Sign up failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <form onSubmit={onSubmit} className="card w-full max-w-sm space-y-4">
        <h1 className="text-xl font-semibold">Create your HermieOS account</h1>
        <div>
          <label className="label" htmlFor="dn">Display name</label>
          <input
            id="dn"
            className="input"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="What should we call you?"
          />
        </div>
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <p className="text-xs text-slate-500 mt-1">At least 8 characters.</p>
        </div>
        {err ? <div className="text-sm text-rose-400">{err}</div> : null}
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? 'Creating…' : 'Create account'}
        </button>
        <div className="text-sm text-slate-400 text-center">
          Already have one? <Link to="/login" className="text-sky-400 hover:underline">Sign in</Link>
        </div>
      </form>
    </div>
  );
}
