import * as React from 'react';
import { setApiBase, setApiToken } from './api';

const STORAGE_URL = 'hermieos_server_url';
const STORAGE_TOKEN = 'hermieos_mcp_token';

export interface ServerState {
  url: string;
  connected: boolean;
  checking: boolean;
  error: string | null;
  /** Connect with a server URL + MCP bearer token */
  connect: (url: string, token: string) => Promise<void>;
  disconnect: () => void;
}

function loadStr(key: string): string {
  try { return localStorage.getItem(key) ?? ''; } catch { return ''; }
}
function storeStr(key: string, val: string): void {
  try { localStorage.setItem(key, val); } catch { /* noop */ }
}
function clearStr(key: string): void {
  try { localStorage.removeItem(key); } catch { /* noop */ }
}

const Ctx = React.createContext<ServerState | null>(null);

export function useServer(): ServerState {
  const s = React.useContext(Ctx);
  if (!s) throw new Error('useServer must be used within ServerProvider');
  return s;
}

/**
 * Validates a connection by calling GET /me with the bearer token.
 * A 200 means the server is reachable, the token is valid, and the
 * user account is active.
 */
async function validateToken(server: string, token: string): Promise<boolean> {
  try {
    const res = await fetch(`${server}/me`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function normalizeUrl(raw: string): string {
  let u = raw.trim().replace(/\/+$/, '');
  if (!u.startsWith('http://') && !u.startsWith('https://')) {
    u = `http://${u}`;
  }
  return u;
}

export function ServerProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [url, setUrl] = React.useState(() => loadStr(STORAGE_URL));
  const [token, setTokenState] = React.useState(() => loadStr(STORAGE_TOKEN));
  const [connected, setConnected] = React.useState(false);
  const [checking, setChecking] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Auto-connect on mount if credentials are stored
  React.useEffect(() => {
    const storedUrl = loadStr(STORAGE_URL);
    const storedToken = loadStr(STORAGE_TOKEN);
    if (storedUrl && storedToken) {
      setChecking(true);
      validateToken(storedUrl, storedToken).then((ok) => {
        if (ok) {
          setApiBase(storedUrl);
          setApiToken(storedToken);
          setConnected(true);
        }
        setChecking(false);
      }).catch(() => setChecking(false));
    }
  }, []);

  async function connect(server: string, tok: string): Promise<void> {
    const u = normalizeUrl(server);
    setChecking(true);
    setError(null);
    try {
      const ok = await validateToken(u, tok);
      if (!ok) throw new Error('Connection failed — check the URL and token');
      storeStr(STORAGE_URL, u);
      storeStr(STORAGE_TOKEN, tok);
      setApiBase(u);
      setApiToken(tok);
      setUrl(u);
      setTokenState(tok);
      setConnected(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Connection failed');
      throw e;
    } finally {
      setChecking(false);
    }
  }

  function disconnect(): void {
    clearStr(STORAGE_URL);
    clearStr(STORAGE_TOKEN);
    setApiBase('');
    setApiToken('');
    setUrl('');
    setTokenState('');
    setConnected(false);
    setError(null);
  }

  return (
    <Ctx.Provider value={{ url, connected, checking, error, connect, disconnect }}>
      {children}
    </Ctx.Provider>
  );
}
