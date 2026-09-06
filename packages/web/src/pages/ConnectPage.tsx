/**
 * Server connection page — two ways in:
 *
 *   1. Email + password (default) — sign in to an existing account or
 *      create one on the spot. The API returns the account's MCP token
 *      in the login/signup response, and this page finishes the full
 *      server connect with it (the token IS the desktop credential).
 *   2. MCP token — for users who already copied the token from
 *      Settings → MCP Token (or signed up in a browser).
 *
 * The health check validates both reachability AND token validity:
 *   GET {url}/me  with Authorization: Bearer {token}
 * A 200 means the server is up and the token is valid.
 */
import * as React from 'react';
import { useServer, type PingResult } from '../server';
import { useAuth } from '../auth';
import { setApiBase } from '../api';
import { Logo } from '../components/Logo';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Eye, EyeOff, KeyRound, Mail } from 'lucide-react';
import { cn } from '../lib/utils';

type Mode = 'email' | 'token';
type EmailAction = 'signin' | 'signup';

export function ConnectPage(): React.JSX.Element {
  const { connect, checking, error, ping, url: storedUrl } = useServer();
  const auth = useAuth();
  const [url, setUrl] = React.useState(storedUrl || 'http://localhost:3001');
  const [mode, setMode] = React.useState<Mode>('email');
  const [emailAction, setEmailAction] = React.useState<EmailAction>('signin');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [displayName, setDisplayName] = React.useState('');
  const [emailBusy, setEmailBusy] = React.useState(false);
  const [emailError, setEmailError] = React.useState<string | null>(null);
  const [token, setToken] = React.useState('');
  const [showToken, setShowToken] = React.useState(false);
  const [pinging, setPinging] = React.useState(false);
  const [pingRes, setPingRes] = React.useState<PingResult | null>(null);

  async function handleConnect(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    await connect(url, token);
  }

  async function handleEmail(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setEmailBusy(true);
    setEmailError(null);
    try {
      // Point the API client at the entered server BEFORE the auth
      // call so it doesn't hit a stale/dev base.
      setApiBase(url.replace(/\/+$/, ''));
      const mcpToken = emailAction === 'signin'
        ? await auth.login(email, password)
        : await auth.signup(email, password, displayName || undefined);
      if (mcpToken) {
        // Full connect: validates /me and persists URL + token.
        await connect(url, mcpToken);
      } else {
        // Server didn't return a token — fall back to manual token entry.
        setMode('token');
        setEmailError('Signed in, but the server did not return an MCP token — paste it below.');
      }
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : 'Sign in failed');
    } finally {
      setEmailBusy(false);
    }
  }

  async function handlePing(): Promise<void> {
    if (!url.trim() || pinging) return;
    setPinging(true);
    setPingRes(null);
    try {
      setPingRes(await ping(url));
    } finally {
      setPinging(false);
    }
  }

  function switchMode(next: Mode): void {
    setMode(next);
    setEmailError(null);
  }

  const busy = checking || emailBusy;

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-1 px-4">
      <Card className="w-full max-w-md shadow-sm">
        <CardContent className="p-6 sm:p-8 space-y-6">
          {/* Logo */}
          <div className="text-center space-y-3">
            <Logo size={56} className="mx-auto" />
            <h1 className="text-[22px] font-semibold text-text-primary tracking-tight">
              HermieOS
            </h1>
            <p className="text-[13px] text-text-tertiary max-w-xs mx-auto leading-relaxed">
              Connect to your HermieOS server — sign in with your account, or paste an MCP token.
            </p>
          </div>

          {/* Mode switch */}
          <div className="grid grid-cols-2 gap-2" role="tablist" aria-label="Sign-in method">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'email'}
              onClick={() => switchMode('email')}
              className={cn(
                'flex items-center justify-center gap-1.5 min-h-[44px] rounded-lg text-[13px] font-medium border transition-colors',
                mode === 'email'
                  ? 'bg-surface-3 border-border-strong text-text-primary'
                  : 'bg-surface-1 border-border-default text-text-tertiary hover:text-text-primary',
              )}
            >
              <Mail className="w-4 h-4" /> Email &amp; password
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'token'}
              onClick={() => switchMode('token')}
              className={cn(
                'flex items-center justify-center gap-1.5 min-h-[44px] rounded-lg text-[13px] font-medium border transition-colors',
                mode === 'token'
                  ? 'bg-surface-3 border-border-strong text-text-primary'
                  : 'bg-surface-1 border-border-default text-text-tertiary hover:text-text-primary',
              )}
            >
              <KeyRound className="w-4 h-4" /> MCP token
            </button>
          </div>

          {mode === 'email' ? (
            <form onSubmit={(e) => { handleEmail(e).catch(() => {}); }} className="space-y-4">
              {/* Server URL (shared) */}
              <ServerUrlField
                url={url}
                setUrl={setUrl}
                setPingRes={setPingRes}
                pinging={pinging}
                pingRes={pingRes}
                onPing={handlePing}
              />

              {/* Sign in / create account toggle */}
              <div className="flex gap-4 text-[12px]">
                <button
                  type="button"
                  onClick={() => { setEmailAction('signin'); setEmailError(null); }}
                  className={cn(
                    'pb-1 border-b-2 transition-colors',
                    emailAction === 'signin'
                      ? 'text-text-primary border-text-primary font-medium'
                      : 'text-text-tertiary border-transparent hover:text-text-secondary',
                  )}
                >
                  Sign in
                </button>
                <button
                  type="button"
                  onClick={() => { setEmailAction('signup'); setEmailError(null); }}
                  className={cn(
                    'pb-1 border-b-2 transition-colors',
                    emailAction === 'signup'
                      ? 'text-text-primary border-text-primary font-medium'
                      : 'text-text-tertiary border-transparent hover:text-text-secondary',
                  )}
                >
                  Create account
                </button>
              </div>

              {emailAction === 'signup' ? (
                <div>
                  <label className="block text-[12px] font-medium text-text-secondary mb-1">Display name</label>
                  <Input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="What should we call you?"
                    className="h-12 text-[16px]"
                    autoComplete="name"
                  />
                </div>
              ) : null}

              <div>
                <label className="block text-[12px] font-medium text-text-secondary mb-1">Email</label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="h-12 text-[16px]"
                  inputMode="email"
                  autoComplete="email"
                  required
                />
              </div>

              <div>
                <label className="block text-[12px] font-medium text-text-secondary mb-1">Password</label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={emailAction === 'signup' ? 'At least 8 characters' : '••••••••'}
                  className="h-12 text-[16px]"
                  autoComplete={emailAction === 'signup' ? 'new-password' : 'current-password'}
                  minLength={emailAction === 'signup' ? 8 : undefined}
                  required
                />
              </div>

              {/* Status */}
              {emailError ? (
                <div className="text-[12px] text-status-failed bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
                  {emailError}
                </div>
              ) : null}

              <Button
                type="submit"
                className="w-full min-h-[48px] text-[15px]"
                disabled={busy || !url.trim() || !email.trim() || !password.trim()}
              >
                {emailBusy
                  ? 'Signing in…'
                  : emailAction === 'signup'
                    ? 'Create account & connect'
                    : 'Sign in & connect'}
              </Button>

              <p className="text-[11px] text-text-tertiary text-center">
                {emailAction === 'signin' ? (
                  <>No account yet? Switch to <strong>Create account</strong> above.</>
                ) : (
                  <>The account is created on the server you entered above.</>
                )}
              </p>
            </form>
          ) : (
            <form onSubmit={(e) => { handleConnect(e).catch(() => {}); }} className="space-y-4">
              <ServerUrlField
                url={url}
                setUrl={setUrl}
                setPingRes={setPingRes}
                pinging={pinging}
                pingRes={pingRes}
                onPing={handlePing}
              />

              {/* MCP Token */}
              <div>
                <label className="block text-[12px] font-medium text-text-secondary mb-1">MCP Token</label>
                <div className="relative">
                  <Input
                    type={showToken ? 'text' : 'password'}
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="mcp_a1b2c3d4..."
                    className="pr-12 font-mono h-12 text-[16px]"
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowToken(!showToken)}
                    aria-label={showToken ? 'Hide token' : 'Show token'}
                    className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center justify-center min-w-[44px] min-h-[44px] text-text-tertiary hover:text-text-primary transition-colors"
                  >
                    {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Status */}
              {error ? (
                <div className="text-[12px] text-status-failed bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
                  {error}
                </div>
              ) : null}

              <Button
                type="submit"
                className="w-full min-h-[48px] text-[15px]"
                disabled={busy || !url.trim() || !token.trim()}
              >
                {checking ? 'Verifying…' : 'Connect'}
              </Button>
            </form>
          )}

          {/* Help */}
          <div className="space-y-2 pt-4 border-t border-border-default">
            <p className="text-[10px] font-medium text-text-quaternary uppercase tracking-wider">
              {mode === 'email' ? 'What happens next' : 'Where to find your MCP token'}
            </p>
            {mode === 'email' ? (
              <ul className="text-[11px] text-text-tertiary space-y-1">
                <li>• Your account lives on the HermieOS server above (hosted by you or your admin)</li>
                <li>• Signing in fetches your MCP token automatically and connects</li>
                <li>• Use <strong>MCP token</strong> mode only if you already copied one</li>
              </ul>
            ) : (
              <ul className="text-[11px] text-text-tertiary space-y-1">
                <li>• Or just use <strong>Email &amp; password</strong> mode — no copy/paste needed</li>
                <li>• After signup, your MCP token is shown once — copy it</li>
                <li>• Token format: <code className="px-1 rounded bg-surface-2 text-text-secondary">mcp_</code> followed by 64 hex characters</li>
                <li>• Rotate your token anytime in Settings → MCP Token</li>
              </ul>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/** Shared server-URL field with LAN presets + ping. */
function ServerUrlField({
  url,
  setUrl,
  setPingRes,
  pinging,
  pingRes,
  onPing,
}: {
  url: string;
  setUrl: (v: string) => void;
  setPingRes: (r: PingResult | null) => void;
  pinging: boolean;
  pingRes: PingResult | null;
  onPing: () => void;
}): React.JSX.Element {
  return (
    <div>
      <label className="block text-[12px] font-medium text-text-secondary mb-1">Server URL</label>
      <Input
        type="text"
        value={url}
        onChange={(e) => { setUrl(e.target.value); setPingRes(null); }}
        placeholder="http://192.168.1.50:3001"
        className="h-12 text-[16px]"
        inputMode="url"
        autoComplete="url"
      />
      <div className="flex flex-wrap gap-2 mt-2">
        {['http://localhost:3001', 'http://192.168.'].map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => { setUrl(preset); setPingRes(null); }}
            className="text-[11px] px-2 py-1 rounded-md bg-surface-2 text-text-tertiary hover:text-text-primary hover:bg-surface-3 transition-colors min-h-[32px]"
          >
            {preset.replace('http://', '')}
          </button>
        ))}
        <button
          type="button"
          onClick={onPing}
          disabled={pinging || !url.trim()}
          className="text-[11px] font-bold px-2 py-1 rounded-md border border-border-default text-text-secondary hover:text-text-primary transition-colors min-h-[32px] disabled:opacity-40"
        >
          {pinging ? 'Pinging…' : 'Ping server'}
        </button>
      </div>
      {pingRes ? (
        <div className={cn(
          'mt-2 text-[12px] border rounded-lg px-3 py-2',
          pingRes.status === 'ok' && 'text-emerald-700 bg-emerald-50 border-emerald-200',
          pingRes.status === 'unreachable' && 'text-status-failed bg-rose-50 border-rose-100',
          pingRes.status === 'wrong-server' && 'text-amber-700 bg-amber-50 border-amber-200',
        )}>
          {pingRes.detail}
        </div>
      ) : null}
    </div>
  );
}
