import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { api, ApiError } from './api';
import type { User } from './api';
import { useServer } from './server';

interface AuthState {
  user: User | null;
  loading: boolean;
  mcpToken: string | null;
  signup: (email: string, password: string, displayName?: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  rotateToken: () => Promise<string>;
  setUser: (u: User) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [mcpToken, setMcpToken] = useState<string | null>(null);
  const { connected } = useServer();

  const refresh = useCallback(async () => {
    try {
      const { user: u } = await api.me();
      setUser(u);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setUser(null);
      } else {
        throw err;
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Refresh auth when server connection is established.
  // This covers: initial mount (connected may already be true from
  // localStorage auto-connect) AND manual connect from ConnectPage.
  useEffect(() => {
    if (connected) {
      refresh().catch(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [connected, refresh]);

  const signup = useCallback(
    async (email: string, password: string, displayName?: string) => {
      const res = await api.signup({ email, password, displayName });
      setUser(res.user);
      setMcpToken(res.mcpToken);
    },
    [],
  );

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.login({ email, password });
    setUser(res.user);
    setMcpToken(null);
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
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
