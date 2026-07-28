import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { ApiError } from '../api';
import { Logo } from '../components/Logo';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Input } from '../components/ui/input';

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
    <div className="min-h-screen flex items-center justify-center bg-surface-1 px-4">
      <Card className="w-full max-w-[380px] shadow-sm">
        <CardContent className="p-8">
          <div className="flex items-center gap-3 mb-6">
            <Logo size={44} />
            <div>
              <h1 className="text-[18px] font-semibold text-text-primary">Create your HermieOS account</h1>
              <p className="text-[12px] text-text-tertiary">HermieOS · Personal OS</p>
            </div>
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label htmlFor="dn" className="block text-[12px] font-medium text-text-secondary mb-1">Display name</label>
              <Input
                id="dn"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="What should we call you?"
              />
            </div>
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
                autoComplete="new-password"
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
              <p className="text-[11px] text-text-tertiary mt-1">At least 8 characters.</p>
            </div>
            {err ? <div className="text-[13px] text-status-failed bg-rose-50 rounded-lg px-3 py-2 border border-rose-100">{err}</div> : null}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? 'Creating…' : 'Create account'}
            </Button>
          </form>

          <div className="mt-6 text-center text-[13px] text-text-tertiary">
            Already have one?{' '}
            <Link to="/login" className="font-medium text-accent-text hover:underline">Sign in</Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
