import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from './auth';
import { useServer } from './server';
import { Layout } from './components/Layout';
import { DesktopShell } from './DesktopShell';
import { LoginPage } from './pages/LoginPage';
import { SignupPage } from './pages/SignupPage';
import { ConnectPage } from './pages/ConnectPage';
import { FeedPage } from './pages/FeedPage';
import { ObjectDetailPage } from './pages/ObjectDetailPage';
import { SubscriptionsPage } from './pages/SubscriptionsPage';
import { SettingsPage } from './pages/SettingsPage';
import { McpTokenPage } from './pages/McpTokenPage';
import { GraphPage } from './pages/GraphPage';
import { isTauri } from './tauri';

const Shell = isTauri() ? DesktopShell : Layout;

function RequireAuth({ children }: { children: ReactNode }): React.JSX.Element {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="p-8 text-slate-400">Loading…</div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  return <>{children}</>;
}

export function App(): React.JSX.Element {
  const { connected, url } = useServer();

  // Connection gate — show connect page if no server configured
  if (!connected && !url) {
    return <ConnectPage />;
  }

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Shell />
          </RequireAuth>
        }
      >
        <Route index element={<FeedPage />} />
        <Route path="objects/:id" element={<ObjectDetailPage />} />
        <Route path="subscriptions" element={<SubscriptionsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="settings/mcp-token" element={<McpTokenPage />} />
        <Route path="graph" element={<GraphPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
