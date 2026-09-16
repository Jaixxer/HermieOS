import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import * as React from 'react';
import type { ReactNode } from 'react';
import { useAuth } from './auth';
import { useServer } from './server';
import { initMobile } from './mobile';
import { AppShell } from './components/AppShell';
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
import { TasksPage } from './pages/TasksPage';
import { KnowledgePage } from './pages/KnowledgePage';


function RequireAuth({ children }: { children: ReactNode }): React.JSX.Element {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="p-8 text-slate-400">Loading…</div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  return <>{children}</>;
}

export function App(): React.JSX.Element {
  const { connected } = useServer();
  const nav = useNavigate();
  const loc = useLocation();
  const pathRef = React.useRef(loc.pathname);
  pathRef.current = loc.pathname;

  // Native back button (Android): step SPA history, exit at root.
  React.useEffect(() => {
    initMobile(() => {
      if (pathRef.current === '/') return false;
      nav(-1);
      return true;
    });
  }, [nav]);

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
      <Route element={<RequireAuth><AppShell /></RequireAuth>}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/objects/:id" element={<ObjectDetailPage />} />
        <Route path="/objects/:id/discuss" element={<FindingChatPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/settings/mcp-token" element={<McpTokenPage />} />
        <Route path="/scouting" element={<ScoutingInboxPage />} />
        <Route path="/scouting/findings" element={<FindingsListPage />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/feed" element={<FeedPage />} />
        <Route path="/mission" element={<MissionPage />} />
        {/* NOTE: the page lives at /planner, not /tasks — the API owns
            GET /tasks (the JSON list), so a hard load of /tasks would return
            JSON instead of the app. Same reason /feed is a poor deep link. */}
        <Route path="/planner" element={<TasksPage />} />
        <Route path="/opportunities" element={<Navigate to="/scouting/findings" replace />} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/chat/:sessionId" element={<ChatPage />} />
        <Route path="/knowledge" element={<KnowledgePage />} />
        <Route path="/subscriptions" element={<SubscriptionsPage />} />
        <Route path="/graph" element={<GraphPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
