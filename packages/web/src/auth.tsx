import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { api, ApiError } from './api';
import type { User } from './api';

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

  useEffect(() => {
    refresh().catch(() => setLoading(false));
  }, [refresh]);

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
