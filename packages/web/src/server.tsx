/**
 * Server connection state — persists the HermieOS server URL and
 * provides a health-check mechanism. Used by the desktop client
 * to connect to remote HermieOS instances.
 */
import * as React from 'react';
import { setApiBase } from './api';

const STORAGE_KEY = 'hermieos_server_url';

export interface ServerState {
  /** The configured server URL (e.g. http://192.168.1.50:3001) */
  url: string;
  /** Whether the configured server is reachable and healthy */
  connected: boolean;
  /** True while a health check is in progress */
  checking: boolean;
  /** Last health check error, if any */
  error: string | null;
  /** Connect to a new server URL */
  connect: (url: string) => Promise<void>;
  /** Disconnect and go back to server selection */
  disconnect: () => void;
}

function loadStoredUrl(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

function storeUrl(url: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, url);
  } catch { /* noop */ }
}

function clearStoredUrl(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch { /* noop */ }
}

const Ctx = React.createContext<ServerState | null>(null);

export function useServer(): ServerState {
  const s = React.useContext(Ctx);
  if (!s) throw new Error('useServer must be used within ServerProvider');
  return s;
}

export function ServerProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [url, setUrl] = React.useState(loadStoredUrl);
  const [connected, setConnected] = React.useState(false);
  const [checking, setChecking] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Auto-check on mount
  React.useEffect(() => {
    const stored = loadStoredUrl();
    if (stored) {
      check(stored).then((ok) => {
        setUrl(stored);
        setConnected(ok);
        if (!ok) setError('Server unreachable');
      }).catch(() => {});
    }
  }, []);

  async function check(server: string): Promise<boolean> {
    try {
      const res = await fetch(`${server}/healthz`, { signal: AbortSignal.timeout(5000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async function connect(server: string): Promise<void> {
    // Normalize URL — strip trailing slashes, ensure http(s) prefix
    let u = server.trim().replace(/\/+$/, '');
    if (!u.startsWith('http://') && !u.startsWith('https://')) {
      u = `http://${u}`;
    }

    setChecking(true);
    setError(null);
    try {
      const ok = await check(u);
      if (!ok) throw new Error('Server did not respond — check the URL');
      storeUrl(u);
      setUrl(u);
      setConnected(true);
      setApiBase(u);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Connection failed');
      setConnected(false);
      throw e;
    } finally {
      setChecking(false);
    }
  }

  function disconnect(): void {
    clearStoredUrl();
    setUrl('');
    setConnected(false);
    setError(null);
    setApiBase('');
  }

  return (
    <Ctx.Provider value={{ url, connected, checking, error, connect, disconnect }}>
      {children}
    </Ctx.Provider>
  );
}
