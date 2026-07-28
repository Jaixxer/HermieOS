import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth';
import { ApiError } from '../api';
import { Logo } from '../components/Logo';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Input } from '../components/ui/input';

export function LoginPage(): React.JSX.Element {
  const { login, user, loading } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // If the user is already authenticated (e.g. they navigated here
  // by mistake while signed in, or a previous session is being
  // restored), bounce them to the original destination (or `/`).
  // Without this, `RequireAuth` redirects unauthenticated users
  // here, then after auth restores they stay on /login.
  useEffect(() => {
    if (loading) return;
    if (user) {
      const from = (loc.state as { from?: { pathname: string } } | null)?.from?.pathname ?? '/';
      nav(from, { replace: true });
    }
  }, [loading, user, loc.state, nav]);

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await login(email, password);
      const from = (loc.state as { from?: { pathname: string } } | null)?.from?.pathname ?? '/';
      nav(from, { replace: true });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-1 px-4">
      <Card className="w-full max-w-[380px] shadow-sm">
        <CardContent className="p-8">
          <div className="flex items-center gap-3 mb-6">
            <Logo size={44} />
            <div>
              <h1 className="text-[18px] font-semibold text-text-primary">Sign in to HermieOS</h1>
              <p className="text-[12px] text-text-tertiary">Personal OS · AI Agent</p>
            </div>
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-[12px] font-medium text-text-secondary mb-1">Email</label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-[12px] font-medium text-text-secondary mb-1">Password</label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>
            {err ? <div className="text-[13px] text-status-failed bg-rose-50 rounded-lg px-3 py-2 border border-rose-100">{err}</div> : null}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>

          <div className="mt-6 text-center text-[13px] text-text-tertiary">
            New here?{' '}
            <Link to="/signup" className="font-medium text-accent-text hover:underline">Create an account</Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
