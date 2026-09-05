import { useEffect, useState } from 'react';
import { useAuth } from '../auth';
import { useLocation, useNavigate } from 'react-router-dom';
import { Copy, RefreshCw, ArrowLeft } from 'lucide-react';

/**
 * MCP token — the key Hermes uses to reach HermieOS. Same editorial
 * frame as Settings; the token renders as a mono console line.
 */

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
    <div className="flex bg-p5-cream text-p5-dark flex-1 min-w-0 min-h-0">
      <main className="flex-1 min-w-0 min-h-0 overflow-y-auto px-6 py-8 md:px-10 lg:px-10 lg:py-10">
        <div className="mx-auto max-w-[760px]">
          <header className="relative min-h-[128px]">
            <div className="min-w-0 pt-1">
              <div className="p5-kicker text-p5-dark">SYSTEM & PREFS / MCP TOKEN</div>
              <h1 className="mt-3">
                <span className="relative inline-block font-p5-serif text-[clamp(44px,5vw,72px)] leading-[0.88] text-p5-dark">
                  MCP TOKEN
                  <span className="absolute -bottom-2.5 left-0 h-[6px] w-full bg-accent" />
                </span>
              </h1>
            </div>
          </header>

          <div className="mt-7 space-y-5">
            {justSignedUp ? (
              <div className="border-2 border-amber-500/50 bg-amber-50 p-4">
                <p className="text-[13px] font-black tracking-tight text-amber-800">SAVE THIS TOKEN NOW.</p>
                <p className="mt-1 text-[12px] text-amber-900/80">
                  You will only see it once on this page. Copy it into your Hermes config. You can rotate it later.
                </p>
              </div>
            ) : null}

            <section className="border-2 border-black/15 bg-p5-panel p-5 space-y-4">
              {token ? (
                <div>
                  <div className="p5-kicker text-p5-dark-muted mb-1.5">Your token</div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <code className="flex-1 truncate border border-black/15 bg-black/[0.03] px-3 py-2 font-mono text-[12px] text-p5-dark">
                      {token}
                    </code>
                    <button
                      type="button"
                      onClick={copy}
                      className="inline-flex items-center justify-center gap-1.5 border border-p5-dark-line px-3.5 py-2 min-h-[48px] sm:min-h-0 text-[11px] font-black tracking-[0.12em] text-p5-dark transition hover:border-p5-dark hover:bg-p5-dark hover:text-p5-cream"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-[13px] text-p5-dark-muted">
                  No token visible. Click rotate to generate a new one.
                </p>
              )}
              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  type="button"
                  onClick={() => void onRotate()}
                  disabled={busy}
                  className="inline-flex items-center justify-center gap-1.5 bg-accent px-4 py-2 min-h-[48px] sm:min-h-0 text-[11px] font-black tracking-[0.12em] text-white transition hover:bg-accent-hover disabled:opacity-40"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  {busy ? 'Rotating…' : 'Rotate token'}
                </button>
                <button
                  type="button"
                  onClick={() => nav('/settings')}
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2 min-h-[48px] sm:min-h-0 text-[11px] font-black tracking-[0.12em] text-p5-dark-muted transition hover:text-p5-dark"
                >
                  <ArrowLeft className="w-3.5 h-3.5" /> Back to settings
                </button>
              </div>
              <details className="text-[12px] text-p5-dark-muted">
                <summary className="cursor-pointer font-bold tracking-[0.1em]">HOW TO USE THIS TOKEN</summary>
                <pre className="mt-2 overflow-x-auto border border-black/15 bg-p5-ink p-3 text-[11px] text-p5-text">
{`# Add to your Hermes profile (~/.hermes/profiles/default.yaml):
mcp_servers:
  hermieos:
    url: ${window.location.protocol}//${window.location.host}/api/mcp
    headers:
      Authorization: "Bearer ${token ?? '<your-token>'}"
    enabled: true

# Then reload Hermes's MCP config:
hermes /reload-mcp`}
                </pre>
              </details>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
