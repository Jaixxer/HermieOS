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
  /** URL-only mode: remember the API origin without an MCP token.
   *  Used after email login so page refreshes know where to call. */
  setBaseUrl: (url: string) => void;
  /** Ping a server URL without credentials. Classifies it as a
   *  HermieOS server, unreachable, or something else entirely. */
  ping: (url: string) => Promise<PingResult>;
  disconnect: () => void;
}

export type PingStatus = 'ok' | 'unreachable' | 'wrong-server';

export interface PingResult {
  status: PingStatus;
  latencyMs: number;
  detail: string;
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

/**
 * Ping a server URL without credentials. GET /me with no token must
 * answer 401/403 on a real HermieOS API — that proves reachability AND
 * identity in one cheap call:
 *   - network error / timeout → unreachable
 *   - 401/403 (or 200) → a HermieOS server
 *   - anything else → reachable, but not HermieOS
 */
async function pingServer(raw: string): Promise<PingResult> {
  const u = normalizeUrl(raw);
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  try {
    const res = await fetch(`${u}/me`, { signal: AbortSignal.timeout(5000) });
    const latencyMs = Math.round(performance.now() - t0);
    if (res.status === 401 || res.status === 403) {
      return { status: 'ok', latencyMs, detail: `HermieOS server — reachable in ${latencyMs}ms (auth required)` };
    }
    if (res.ok) {
      return { status: 'ok', latencyMs, detail: `HermieOS server — reachable in ${latencyMs}ms` };
    }
    return { status: 'wrong-server', latencyMs, detail: `Answered HTTP ${res.status} — this doesn't look like a HermieOS server` };
  } catch {
    return { status: 'unreachable', latencyMs: 0, detail: 'No response — check the URL and that the server is running' };
  }
}

/**
 * When the user is in the Vite dev environment (running on
 * localhost:5173) the API lives at localhost:3001. This is the
 * default when nothing is stored and no other origin is supplied.
 */
function inferDevApiBase(): string {
  if (typeof window === 'undefined') return '';
  const { protocol, hostname, port } = window.location;
  if (hostname === 'localhost' && port === '5173') {
    return `${protocol}//${hostname}:3001`;
  }
  return '';
}

export function ServerProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [url, setUrl] = React.useState(() => loadStr(STORAGE_URL));
  const [token, setTokenState] = React.useState(() => loadStr(STORAGE_TOKEN));
  const [connected, setConnected] = React.useState(false);
  const [checking, setChecking] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Auto-connect on mount if credentials are stored. We support three
  // modes:
  //   1. MCP token + URL — full server connect. The token is the
  //      bearer for /me and all other requests.
  //   2. URL only — used after a successful email login, where the
  //      session token (set by AuthProvider) is the bearer. Without
  //      this fallback an email login would still need a fresh MCP
  //      token on every page refresh.
  //   3. hermieos_api_base (set by the login response) — Electron
  //      users who only logged in via email/password don't have
  //      STORAGE_URL set, but we do persist the API base alongside
  //      the session token. This restores the URL on refresh so the
  //      session survives.
  React.useEffect(() => {
    const storedUrl = loadStr(STORAGE_URL);
    const storedApiBase = loadStr('hermieos_api_base');
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
    } else if (storedUrl) {
      // URL-only mode: just remember where the API lives. The session
      // token (set by AuthProvider) provides auth on requests.
      setApiBase(storedUrl);
      setUrl(storedUrl);
    } else if (storedApiBase) {
      // Email-only mode: the API base is stored alongside the
      // session token. No MCP token, but we know where to call.
      setApiBase(storedApiBase);
      setUrl(storedApiBase);
    } else {
      // Last-resort: in Vite dev, infer localhost:3001. In
      // Electron with file://, the user must configure.
      const inferred = inferDevApiBase();
      if (inferred) {
        setApiBase(inferred);
        setUrl(inferred);
      }
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

  /**
   * URL-only mode: remember where the API lives so the email-login
   * session token can be used without going through the full MCP
   * connect flow on every page refresh. Called by AuthProvider on
   * successful login/signup.
   */
  function setBaseUrl(server: string): void {
    const u = normalizeUrl(server);
    storeStr(STORAGE_URL, u);
    setApiBase(u);
    setUrl(u);
    // A session token alone isn't enough to declare connected; the
    // /me check below decides that. But it IS enough to know where
    // to send the /me check.
    if (loadStr(STORAGE_TOKEN)) setConnected(true);
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

  async function ping(raw: string): Promise<PingResult> {
    return pingServer(raw);
  }

  return (
    <Ctx.Provider value={{ url, connected, checking, error, connect, setBaseUrl, ping, disconnect }}>
      {children}
    </Ctx.Provider>
  );
}
