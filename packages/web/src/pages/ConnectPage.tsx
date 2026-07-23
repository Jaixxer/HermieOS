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
import { useServer } from '../server';

export function ConnectPage(): React.JSX.Element {
  const { connect, checking, error } = useServer();
  const [url, setUrl] = React.useState('http://localhost:3001');
  const [token, setToken] = React.useState('');
  const [showToken, setShowToken] = React.useState(false);

  async function handleConnect(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    await connect(url, token);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#050510] p-8">
      <div className="w-full max-w-md space-y-8">
        {/* Logo */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-sky-600 to-purple-700 shadow-[0_0_40px_rgba(59,130,246,0.15)]">
            <span className="text-2xl font-bold text-white">H</span>
          </div>
          <h1 className="text-2xl font-semibold text-slate-100 tracking-tight">
            HermieOS
          </h1>
          <p className="text-sm text-slate-500 max-w-xs mx-auto leading-relaxed">
            Connect to your HermieOS server using your MCP token. No password needed — the token IS your credential.
          </p>
        </div>

        <form onSubmit={(e) => { handleConnect(e).catch(() => {}); }} className="space-y-4">
          {/* Server URL */}
          <div>
            <label className="label mb-1.5 block">Server URL</label>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="http://192.168.1.50:3001"
              className="w-full bg-[#0a0a1a] border border-[#ffffff10] rounded-xl px-4 py-3 text-slate-200 text-sm placeholder:text-slate-700 outline-none focus:border-sky-700/50 transition-colors"
            />
            <div className="flex flex-wrap gap-2 mt-2">
              {['http://localhost:3001', 'http://192.168.'].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setUrl(preset)}
                  className="text-[10px] px-2 py-1 rounded-md bg-[#ffffff06] text-slate-600 hover:text-slate-400 hover:bg-[#ffffff0a] transition-colors"
                >
                  {preset.replace('http://', '')}
                </button>
              ))}
            </div>
          </div>

          {/* MCP Token */}
          <div>
            <label className="label mb-1.5 block">MCP Token</label>
            <div className="flex items-center gap-2 rounded-xl border border-[#ffffff10] bg-[#0a0a1a] focus-within:border-sky-700/50 transition-colors">
              <input
                type={showToken ? 'text' : 'password'}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="mcp_a1b2c3d4..."
                className="flex-1 bg-transparent border-none outline-none px-4 py-3 text-slate-200 text-sm placeholder:text-slate-700 font-mono"
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowToken(!showToken)}
                className="pr-3 text-slate-600 hover:text-slate-400 text-xs transition-colors"
              >
                {showToken ? 'hide' : 'show'}
              </button>
            </div>
          </div>

          {/* Status */}
          {error ? (
            <div className="text-xs text-red-400/80 bg-red-950/20 border border-red-900/30 rounded-lg px-3 py-2">
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={checking || !url.trim() || !token.trim()}
            className="w-full py-2.5 rounded-xl bg-gradient-to-r from-sky-600 to-sky-500 text-white text-sm font-medium
                       hover:from-sky-500 hover:to-sky-400 disabled:opacity-40 disabled:cursor-not-allowed
                       transition-all duration-200 shadow-[0_4px_20px_rgba(14,165,233,0.2)]"
          >
            {checking ? 'Verifying…' : 'Connect'}
          </button>
        </form>

        {/* Help */}
        <div className="space-y-2 pt-4 border-t border-[#ffffff06]">
          <p className="text-[10px] text-slate-700 font-mono uppercase tracking-wider">Where to find your MCP token</p>
          <ul className="text-[11px] text-slate-600 space-y-1">
            <li>• Sign up on your HermieOS server at <code className="px-1 rounded bg-[#ffffff06]">/signup</code></li>
            <li>• After signup, your MCP token is shown once — copy it</li>
            <li>• Token format: <code className="px-1 rounded bg-[#ffffff06]">mcp_</code> followed by 64 hex characters</li>
            <li>• Rotate your token anytime in Settings → MCP Token</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
