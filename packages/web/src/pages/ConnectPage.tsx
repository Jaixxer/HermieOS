/**
 * Server connection page — enter HermieOS server URL and MCP token.
 *
 * The desktop app authenticates using the same bearer token as the
 * MCP server (users.mcpToken). No session cookies needed — the token
 * is the credential. On signup, the user copies their MCP token and
 * pastes it here to connect from any device.
 *
 * The health check validates both reachability AND token validity:
 *   GET {url}/me  with Authorization: Bearer {token}
 * A 200 means the server is up and the token is valid.
 */
import * as React from 'react';
import { useServer, type PingResult } from '../server';
import { Logo } from '../components/Logo';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '../lib/utils';

export function ConnectPage(): React.JSX.Element {
  const { connect, checking, error, ping, url: storedUrl } = useServer();
  const [url, setUrl] = React.useState(storedUrl || 'http://localhost:3001');
  const [token, setToken] = React.useState('');
  const [showToken, setShowToken] = React.useState(false);
  const [pinging, setPinging] = React.useState(false);
  const [pingRes, setPingRes] = React.useState<PingResult | null>(null);

  async function handleConnect(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    await connect(url, token);
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
              Connect to your HermieOS server using your MCP token. The token IS your credential.
            </p>
          </div>

          <form onSubmit={(e) => { handleConnect(e).catch(() => {}); }} className="space-y-4">
            {/* Server URL */}
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
                  onClick={() => void handlePing()}
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
              disabled={checking || !url.trim() || !token.trim()}
            >
              {checking ? 'Verifying…' : 'Connect'}
            </Button>
          </form>

          {/* Help */}
          <div className="space-y-2 pt-4 border-t border-border-default">
            <p className="text-[10px] font-medium text-text-quaternary uppercase tracking-wider">Where to find your MCP token</p>
            <ul className="text-[11px] text-text-tertiary space-y-1">
              <li>• Sign up on your HermieOS server at <code className="px-1 rounded bg-surface-2 text-text-secondary">/signup</code></li>
              <li>• After signup, your MCP token is shown once — copy it</li>
              <li>• Token format: <code className="px-1 rounded bg-surface-2 text-text-secondary">mcp_</code> followed by 64 hex characters</li>
              <li>• Rotate your token anytime in Settings → MCP Token</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
