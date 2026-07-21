import * as React from 'react';
import { NavLink, Outlet, Link } from 'react-router-dom';
import { useAuth } from '../auth';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { useSse } from '../sse';
import { PwaBanner } from '../pwa';

export function Layout(): React.JSX.Element {
  const { user, logout } = useAuth();
  const qc = useQueryClient();

  useSse({
    onFeed: () => {
      qc.invalidateQueries({ queryKey: ['feed'] });
      qc.invalidateQueries({ queryKey: ['unread'] });
    },
  });

  const { data: unread } = useQuery({
    queryKey: ['unread'],
    queryFn: () => api.unreadCount(),
    refetchInterval: 30_000,
  });

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center gap-6">
          <Link to="/" className="font-semibold tracking-tight">
            HermieOS
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            <NavTab to="/">Feed{(unread?.unread ?? 0) > 0 ? <span className="ml-1 badge">{unread!.unread}</span> : null}</NavTab>
            <NavTab to="/subscriptions">Subscriptions</NavTab>
            <NavTab to="/graph">Graph</NavTab>
            <NavTab to="/settings">Settings</NavTab>
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            {user ? (
              <>
                <span className="text-slate-400">{user.displayName}</span>
                <button
                  className="btn-ghost"
                  onClick={() => {
                    void logout();
                  }}
                >
                  Sign out
                </button>
              </>
            ) : null}
          </div>
        </div>
        {user && !user.schedulerEnabled ? (
          <div className="bg-amber-900/40 border-t border-amber-800/50 text-amber-200 text-sm">
            <div className="max-w-5xl mx-auto px-4 py-2">
              Hermes is paused. Background work will not run.{' '}
              <Link to="/settings" className="underline">
                Resume
              </Link>
            </div>
          </div>
        ) : null}
      </header>
      <PwaBanner />
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}

function NavTab({ to, children }: { to: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        `px-3 py-1.5 rounded-md transition ${isActive ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/50'}`
      }
    >
      {children}
    </NavLink>
  );
}
