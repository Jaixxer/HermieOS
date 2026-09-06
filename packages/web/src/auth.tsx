import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { api, ApiError, getApiBase, setApiToken } from './api';
import type { User } from './api';
import { useServer } from './server';

/**
 * When the user is in the Vite dev environment (running on
 * localhost:5173) the API lives at localhost:3001 — the Vite proxy
 * routes /api/* there. This helper infers that origin so a fresh
 * `pnpm dev` session works without going through the connect screen.
 */
function inferDevApiBase(): string {
  if (typeof window === 'undefined') return '';
  const { protocol, hostname, port } = window.location;
  // Only infer for the dev server. In production the SPA is loaded
  // from file:// and we have no way to know the API origin.
  if (hostname === 'localhost' && port === '5173') {
    return `${protocol}//${hostname}:3001`;
  }
  return '';
}

const SESSION_TOKEN_KEY = 'hermieos_session_token';
const API_BASE_KEY = 'hermieos_api_base';

function loadStr(key: string): string {
  try { return localStorage.getItem(key) ?? ''; } catch { return ''; }
}
function storeStr(key: string, val: string): void {
  try { localStorage.setItem(key, val); } catch { /* noop */ }
}

interface AuthState {
  user: User | null;
  loading: boolean;
  mcpToken: string | null;
  /** Resolves with the account's MCP token (or null when the server
   *  doesn't return one) so a connect screen can finish connecting. */
  signup: (email: string, password: string, displayName?: string) => Promise<string | null>;
  login: (email: string, password: string) => Promise<string | null>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  rotateToken: () => Promise<string>;
  setUser: (u: User) => void;
}

const AuthContext = createContext<AuthState | null>(null);

function loadSessionToken(): string {
  try { return localStorage.getItem(SESSION_TOKEN_KEY) ?? ''; } catch { return ''; }
}
function storeSessionToken(token: string): void {
  try { localStorage.setItem(SESSION_TOKEN_KEY, token); } catch { /* noop */ }
}
function clearSessionToken(): void {
  try { localStorage.removeItem(SESSION_TOKEN_KEY); } catch { /* noop */ }
}

export function AuthProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [mcpToken, setMcpToken] = useState<string | null>(null);
  const { connected, setBaseUrl } = useServer();

  const refresh = useCallback(async () => {
    try {
      const { user: u } = await api.me();
      setUser(u);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setUser(null);
        clearSessionToken();
      } else {
        throw err;
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Restore session when the app mounts. The session token (from
  // email/password login) is restored unconditionally on mount so
  // the auth state survives a hard refresh without going through the
  // MCP connect flow. The MCP token, if present, takes priority
  // (it's already set by ServerProvider once the connect screen
  // validates).
  //
  // The API accepts both session tokens and MCP tokens as bearer
  // credentials (see auth-middleware.ts in the API package), so we
  // use whichever is available. MCP-only users authenticate via
  // their long-lived token; email/password users get a per-login
  // session token that's stored alongside.
  //
  // We also need an API base before /me can be called. ServerProvider
  // sets it in the same useEffect chain (parent renders first), so by
  // the time AuthProvider's effect runs, getApiBase() returns either
  // the persisted hermieos_api_base (from a prior email login) or
  // whatever ServerProvider just restored.
  useEffect(() => {
    const sessionToken = loadSessionToken();
    const mcpToken = loadStr('hermieos_mcp_token');
    const bearer = sessionToken || mcpToken;
    if (bearer) {
      setApiToken(bearer);
    }
    // No session and no MCP token — nothing to restore, the user
    // will see the connect/login screens via RequireAuth.
    if (!bearer) {
      setLoading(false);
      return;
    }
    // We have a bearer token. Wait for the API base to be a real
    // server URL — not the Vite dev default `/api` and not empty.
    // ServerProvider sets it on mount synchronously in the same
    // render pass, so by the time this effect runs at mount, it
    // should already be set in production. We re-run this effect
    // when `connected` changes for the cases where validation
    // completes after the first render.
    const base = getApiBase();
    const baseLooksValid = base && base !== '/api';
    if (!baseLooksValid) {
      // Defer: leave `loading: true` until the next render when
      // ServerProvider has set a real base URL. RequireAuth uses
      // `loading` to decide whether to redirect, so this is what
      // keeps the user on `/` instead of getting bounced to
      // `/login` mid-restore.
      return;
    }
    refresh().catch(() => setLoading(false));
  }, [connected, refresh]);

  const signup = useCallback(
    async (email: string, password: string, displayName?: string): Promise<string | null> => {
      const res = await api.signup({ email, password, displayName });
      setUser(res.user);
      setMcpToken(res.mcpToken);
      if (res.token) {
        storeSessionToken(res.token);
        setApiToken(res.token);
        // Persist the API base from the response so a page refresh
        // can resume the session even if the user never went
        // through the MCP-connect flow. Store in BOTH keys:
        // - STORAGE_URL: picked up by ServerProvider's restore
        // - hermieos_api_base: separate channel for the auth-only flow
        const base = res.apiBase || getApiBase();
        setBaseUrl(base);
        storeStr('hermieos_api_base', base);
      }
      return res.mcpToken ?? null;
    },
    [setBaseUrl],
  );

  const login = useCallback(async (email: string, password: string): Promise<string | null> => {
    const res = await api.login({ email, password });
    setUser(res.user);
    setMcpToken(null);
    if (res.token) {
      storeSessionToken(res.token);
      setApiToken(res.token);
      const base = res.apiBase || getApiBase();
      setBaseUrl(base);
      storeStr('hermieos_api_base', base);
    }
    return res.mcpToken || null;
  }, [setBaseUrl]);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // Ignore network errors; still clear local state.
    }
    clearSessionToken();
    setUser(null);
    setMcpToken(null);
  }, []);

  const rotateToken = useCallback(async () => {
    const { mcpToken: t } = await api.rotateMcpToken();
    setMcpToken(t);
    return t;
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, mcpToken, signup, login, logout, refresh, rotateToken, setUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
