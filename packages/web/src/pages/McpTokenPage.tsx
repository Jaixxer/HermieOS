import { useEffect, useState } from 'react';
import { useAuth } from '../auth';
import { useLocation, useNavigate } from 'react-router-dom';

export function McpTokenPage(): React.JSX.Element {
  const { mcpToken, user, rotateToken } = useAuth();
  const [token, setToken] = useState<string | null>(mcpToken);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const loc = useLocation();
  const justSignedUp = Boolean((loc.state as { justSignedUp?: boolean } | null)?.justSignedUp);

  useEffect(() => {
    setToken(mcpToken);
  }, [mcpToken]);

  if (!user) return <></>;

  async function onRotate(): Promise<void> {
    if (!window.confirm('Rotate your MCP token? Your local Hermes config will need to be updated.')) {
      return;
    }
    setBusy(true);
    try {
      const t = await rotateToken();
      setToken(t);
      setCopied(false);
    } finally {
      setBusy(false);
    }
  }

  function copy(): void {
    if (!token) return;
    void navigator.clipboard.writeText(token).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="space-y-4 max-w-xl">
      <h1 className="text-2xl font-semibold">MCP token</h1>

      {justSignedUp ? (
        <div className="card border-amber-700/40 bg-amber-900/20 text-amber-100">
          <p className="font-medium">Save this token now.</p>
          <p className="text-sm mt-1">
            You will only see it once on this page. Copy it into your Hermes config. You can rotate it later.
          </p>
        </div>
      ) : null}

      <div className="card space-y-3">
        {token ? (
          <>
            <div>
              <label className="label">Your token</label>
              <div className="flex gap-2">
                <input className="input font-mono text-xs" readOnly value={token} />
                <button className="btn-secondary" onClick={copy}>
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
          </>
        ) : (
          <p className="text-sm text-slate-400">
            No token visible. Click rotate to generate a new one.
          </p>
        )}
        <div className="flex gap-2">
          <button className="btn-primary" onClick={() => void onRotate()} disabled={busy}>
            {busy ? 'Rotating…' : 'Rotate token'}
          </button>
          <button className="btn-ghost" onClick={() => nav('/')}>
            Done
          </button>
        </div>
        <details className="text-sm text-slate-400">
          <summary className="cursor-pointer">How to use this token</summary>
          <pre className="mt-2 p-3 bg-slate-950 rounded text-xs overflow-x-auto">
{`# Add to your Hermes profile (~/.hermes/profiles/default.yaml):
mcp_servers:
  hermieos:
    url: ${window.location.protocol}//${window.location.host}/api/mcp
    headers:
      Authorization: "Bearer ${token ?? '<your-token>'}"

# Then reload Hermes's MCP config:
hermes /reload-mcp`}
          </pre>
        </details>
      </div>
    </div>
  );
}
