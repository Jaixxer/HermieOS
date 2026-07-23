/**
 * Server connection page — shown when no server is configured.
 * User enters their HermieOS server URL (IP:port or domain).
 * A health check verifies the endpoint before connecting.
 */
import * as React from 'react';
import { useServer } from '../server';

export function ConnectPage(): React.JSX.Element {
  const { connect, checking, error } = useServer();
  const [url, setUrl] = React.useState('http://localhost:3001');
  const [status, setStatus] = React.useState<'idle' | 'checking' | 'connected' | 'failed'>('idle');

  async function handleConnect(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setStatus('checking');
    try {
      await connect(url);
      setStatus('connected');
    } catch {
      setStatus('failed');
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#050510] p-8">
      <div className="w-full max-w-md space-y-8">
        {/* Logo / Header */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-sky-600 to-purple-700 shadow-[0_0_40px_rgba(59,130,246,0.15)]">
            <span className="text-2xl font-bold text-white">H</span>
          </div>
          <h1 className="text-2xl font-semibold text-slate-100 tracking-tight">
            HermieOS
          </h1>
          <p className="text-sm text-slate-500 max-w-xs mx-auto leading-relaxed">
            Connect to your HermieOS server to access your objects, subscriptions, and knowledge graph.
          </p>
        </div>

        {/* Connection form */}
        <form onSubmit={(e) => { handleConnect(e).catch(() => {}); }} className="space-y-4">
          <div>
            <label className="label mb-1.5 block">Server URL</label>
            <div
              className={`flex items-center gap-2 rounded-xl border transition-all duration-200 ${
                status === 'failed'
                  ? 'border-red-700/50 bg-red-950/20'
                  : status === 'connected'
                    ? 'border-emerald-700/50 bg-emerald-950/20'
                    : 'border-[#ffffff10] bg-[#0a0a1a]'
              }`}
            >
              <input
                type="text"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setStatus('idle');
                }}
                onFocus={() => setStatus('idle')}
                placeholder="http://192.168.1.50:3001"
                className="flex-1 bg-transparent border-none outline-none px-4 py-3 text-slate-200 text-sm placeholder:text-slate-700"
                autoFocus
              />
              {status === 'connected' ? (
                <span className="pr-3 text-emerald-400 text-sm">✓ Connected</span>
              ) : null}
            </div>

            {/* Status indicators */}
            <div className="mt-2 space-y-1">
              {status === 'failed' ? (
                <p className="text-xs text-red-400/80">{error ?? 'Connection failed'}</p>
              ) : null}

              {/* Quick presets */}
              <div className="flex flex-wrap gap-2 mt-2">
                {['http://localhost:3001', 'http://192.168.'].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => { setUrl(preset); setStatus('idle'); }}
                    className="text-[10px] px-2 py-1 rounded-md bg-[#ffffff06] text-slate-600 hover:text-slate-400 hover:bg-[#ffffff0a] transition-colors"
                  >
                    {preset.replace('http://', '')}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={checking || !url.trim()}
            className="w-full py-2.5 rounded-xl bg-gradient-to-r from-sky-600 to-sky-500 text-white text-sm font-medium
                       hover:from-sky-500 hover:to-sky-400 disabled:opacity-40 disabled:cursor-not-allowed
                       transition-all duration-200 shadow-[0_4px_20px_rgba(14,165,233,0.2)]"
          >
            {checking ? 'Checking connection…' : status === 'connected' ? 'Reconnect' : 'Connect'}
          </button>

          <p className="text-[11px] text-slate-700 text-center leading-relaxed">
            Enter the address of your HermieOS server.
            The default Docker Compose port is <code className="px-1 rounded bg-[#ffffff06]">3001</code>.
          </p>
        </form>

        {/* Tips */}
        <div className="space-y-2 pt-4 border-t border-[#ffffff06]">
          <p className="text-[10px] text-slate-700 font-mono uppercase tracking-wider">Connection Tips</p>
          <ul className="text-[11px] text-slate-600 space-y-1">
            <li>• Docker Compose: <code className="px-1 rounded bg-[#ffffff06]">http://localhost:3001</code></li>
            <li>• Remote server: <code className="px-1 rounded bg-[#ffffff06]">http://your-server-ip:3001</code></li>
            <li>• The port must match your <code className="px-1 rounded bg-[#ffffff06]">API_PORT</code> setting</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
