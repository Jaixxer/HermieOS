import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from './auth';
import { useServer } from './server';
import { Layout } from './components/Layout';
import { DesktopShell } from './DesktopShell';
import { LoginPage } from './pages/LoginPage';
import { SignupPage } from './pages/SignupPage';
import { ConnectPage } from './pages/ConnectPage';
import { DashboardPage } from './pages/DashboardPage';
import { ObjectDetailPage } from './pages/ObjectDetailPage';
import { FindingChatPage } from './pages/FindingChatPage';
import { SubscriptionsPage } from './pages/SubscriptionsPage';
import { SettingsPage } from './pages/SettingsPage';
import { McpTokenPage } from './pages/McpTokenPage';
import { GraphPage } from './pages/GraphPage';
import { ScoutingInboxPage } from './pages/ScoutingInboxPage';
import { FindingsListPage } from './pages/FindingsListPage';
import { CalendarPage } from './pages/CalendarPage';
import { FeedPage } from './pages/FeedPage';
import { ChatPage } from './pages/ChatPage';
import { MissionPage } from './pages/MissionPage';
import { OpportunitiesPage } from './pages/OpportunitiesPage';
import { KnowledgePage } from './pages/KnowledgePage';
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
  const { connected } = useServer();

  // The connect page is only shown when there's no session at all
  // (no MCP token + no email session). An email/password user who
  // has a session token in localStorage should land on their normal
  // routes — RequireAuth handles redirecting them to /login if the
  // session has actually expired (the server returns 401 on /me).
  const hasSession = (() => {
    try {
      return !!localStorage.getItem('hermieos_session_token');
    } catch {
      return false;
    }
  })();

  if (!connected && !hasSession) {
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
            <DashboardPage />
          </RequireAuth>
        }
      />
      <Route
        path="/objects/:id"
        element={
          <RequireAuth>
            <Shell />
          </RequireAuth>
        }
      >
        <Route index element={<ObjectDetailPage />} />
      </Route>
      <Route
        path="/objects/:id/discuss"
        element={
          <RequireAuth>
            <FindingChatPage />
          </RequireAuth>
        }
      />
      <Route
        path="/subscriptions"
        element={
          <RequireAuth>
            <Shell />
          </RequireAuth>
        }
      >
        <Route index element={<SubscriptionsPage />} />
      </Route>
      <Route
        path="/settings"
        element={
          <RequireAuth>
            <Shell />
          </RequireAuth>
        }
      >
        <Route index element={<SettingsPage />} />
      </Route>
      <Route
        path="/settings/mcp-token"
        element={
          <RequireAuth>
            <Shell />
          </RequireAuth>
        }
      >
        <Route index element={<McpTokenPage />} />
      </Route>
      <Route
        path="/graph"
        element={
          <RequireAuth>
            <Shell />
          </RequireAuth>
        }
      >
        <Route index element={<GraphPage />} />
      </Route>
      <Route
        path="/scouting"
        element={
          <RequireAuth>
            <ScoutingInboxPage />
          </RequireAuth>
        }
      />
      <Route
        path="/scouting/findings"
        element={
          <RequireAuth>
            <FindingsListPage />
          </RequireAuth>
        }
      />
      <Route
        path="/calendar"
        element={
          <RequireAuth>
            <CalendarPage />
          </RequireAuth>
        }
      />
      <Route
        path="/feed"
        element={
          <RequireAuth>
            <FeedPage />
          </RequireAuth>
        }
      />
      <Route
        path="/mission"
        element={
          <RequireAuth>
            <MissionPage />
          </RequireAuth>
        }
      />
      <Route
        path="/opportunities"
        element={
          <RequireAuth>
            <OpportunitiesPage />
          </RequireAuth>
        }
      />
      <Route
        path="/knowledge"
        element={
          <RequireAuth>
            <KnowledgePage />
          </RequireAuth>
        }
      />
      <Route
        path="/chat"
        element={
          <RequireAuth>
            <ChatPage />
          </RequireAuth>
        }
      />
      <Route
        path="/chat/:sessionId"
        element={
          <RequireAuth>
            <ChatPage />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
