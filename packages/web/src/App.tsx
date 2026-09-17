import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import * as React from 'react';
import type { ReactNode } from 'react';
import { useAuth } from './auth';
import { useServer } from './server';
import { initMobile } from './mobile';
import { AppShell } from './components/AppShell';
import { RouteFallback } from './components/Loading';

/**
 * Pages are loaded on demand.
 *
 * The whole app used to ship as ONE ~870 kB chunk, so a phone parsed and
 * evaluated every page — chat, calendar, graph, admin — before showing the
 * dashboard. Each route is now its own chunk, so the first paint only pays for
 * the shell plus the page it actually lands on (`vite.config.ts` splits the
 * shared vendors so they cache across deploys).
 */
const DashboardPage = React.lazy(() =>
  import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })),
);
const ObjectDetailPage = React.lazy(() =>
  import('./pages/ObjectDetailPage').then((m) => ({ default: m.ObjectDetailPage })),
);
const FindingChatPage = React.lazy(() =>
  import('./pages/FindingChatPage').then((m) => ({ default: m.FindingChatPage })),
);
const SubscriptionsPage = React.lazy(() =>
  import('./pages/SubscriptionsPage').then((m) => ({ default: m.SubscriptionsPage })),
);
const SettingsPage = React.lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const McpTokenPage = React.lazy(() => import('./pages/McpTokenPage').then((m) => ({ default: m.McpTokenPage })));
const GraphPage = React.lazy(() => import('./pages/GraphPage').then((m) => ({ default: m.GraphPage })));
const ScoutingInboxPage = React.lazy(() =>
  import('./pages/ScoutingInboxPage').then((m) => ({ default: m.ScoutingInboxPage })),
);
const FindingsListPage = React.lazy(() =>
  import('./pages/FindingsListPage').then((m) => ({ default: m.FindingsListPage })),
);
const CalendarPage = React.lazy(() => import('./pages/CalendarPage').then((m) => ({ default: m.CalendarPage })));
const FeedPage = React.lazy(() => import('./pages/FeedPage').then((m) => ({ default: m.FeedPage })));
const ChatPage = React.lazy(() => import('./pages/ChatPage').then((m) => ({ default: m.ChatPage })));
const MissionPage = React.lazy(() => import('./pages/MissionPage').then((m) => ({ default: m.MissionPage })));
const TasksPage = React.lazy(() => import('./pages/TasksPage').then((m) => ({ default: m.TasksPage })));
const KnowledgePage = React.lazy(() => import('./pages/KnowledgePage').then((m) => ({ default: m.KnowledgePage })));

// Auth screens stay eager: they are the first paint for a signed-out client and
// are small.
import { LoginPage } from './pages/LoginPage';
import { SignupPage } from './pages/SignupPage';
import { ConnectPage } from './pages/ConnectPage';

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
    <React.Suspense fallback={<RouteFallback />}>
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
    </React.Suspense>
  );
}
