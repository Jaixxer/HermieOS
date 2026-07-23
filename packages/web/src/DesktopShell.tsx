/**
 * Desktop Shell — the native desktop replacement for the web Layout.
 *
 * Three-panel layout optimized for desktop use:
 *   Left sidebar   — navigation + status + tray controls
 *   Center content — Feed, Graph, Subscriptions, etc.
 *   Right inspector — context-aware (object detail, run status, etc.)
 *
 * Integrated titlebar with traffic-light-style window controls.
 * All panels are independently resizable.
 */
import * as React from 'react';
import { NavLink, Outlet, Link, useLocation } from 'react-router-dom';
import { useAuth } from './auth';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { useSse } from './sse';
import { CommandPalette } from './CommandPalette';
import { useServer } from './server';

const NAV_ITEMS = [
  { to: '/', icon: '◉', label: 'Feed', shortcut: '1' },
  { to: '/graph', icon: '◈', label: 'Graph', shortcut: '2' },
  { to: '/subscriptions', icon: '⚡', label: 'Subs', shortcut: '3' },
  { to: '/settings', icon: '⚙', label: 'Settings', shortcut: '4' },
] as const;

export function DesktopShell(): React.JSX.Element {
  const { user, logout } = useAuth();
  const qc = useQueryClient();
  const loc = useLocation();
  const [sidebarW, setSidebarW] = React.useState(220);
  const [rightW, setRightW] = React.useState(320);
  const [rightOpen, setRightOpen] = React.useState(true);
  const dragging = React.useRef<'sidebar' | 'right' | null>(null);

  useSse({
    onFeed: () => {
      qc.invalidateQueries({ queryKey: ['feed'] });
      qc.invalidateQueries({ queryKey: ['unread'] });
    },
  });

  const { data: unread } = useQuery({
    queryKey: ['unread'],
    queryFn: () => api.unreadCount(),
    refetchInterval: 60_000,
  });

  // Resize handlers
  React.useEffect(() => {
    function onMove(e: MouseEvent): void {
      if (dragging.current === 'sidebar') setSidebarW(Math.max(180, Math.min(350, e.clientX)));
      if (dragging.current === 'right') setRightW(Math.max(240, Math.min(500, window.innerWidth - e.clientX)));
    }
    function onUp(): void { dragging.current = null; }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

  return (
    <div className="h-screen flex flex-col bg-[#050510] text-slate-200 overflow-hidden select-none">
      {/* Titlebar */}
      <Titlebar />

      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar */}
        <aside
          className="flex flex-col border-r border-[#ffffff08] bg-[#08081a]/80"
          style={{ width: sidebarW, minWidth: sidebarW, backdropFilter: 'blur(20px)' }}
        >
          <SidebarNav unread={unread?.unread ?? 0} />
          <div className="mt-auto p-3 border-t border-[#ffffff06]">
            <SidebarFooter user={user} onLogout={() => { void logout(); }} />
          </div>
        </aside>

        {/* Sidebar resize handle */}
        <div
          className="w-1 cursor-col-resize hover:bg-sky-500/50 transition-colors relative group"
          onMouseDown={() => { dragging.current = 'sidebar'; }}
        >
          <div className="absolute inset-y-0 left-1/2 w-px bg-[#ffffff06] group-hover:bg-sky-500/30" />
        </div>

        {/* Center content */}
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>

        {/* Right resize handle */}
        {rightOpen ? (
          <div
            className="w-1 cursor-col-resize hover:bg-sky-500/50 transition-colors relative group"
            onMouseDown={() => { dragging.current = 'right'; }}
          >
            <div className="absolute inset-y-0 left-1/2 w-px bg-[#ffffff06] group-hover:bg-sky-500/30" />
          </div>
        ) : null}

        {/* Right inspector */}
        {rightOpen ? (
          <aside
            className="overflow-y-auto border-l border-[#ffffff08] bg-[#08081a]/80"
            style={{ width: rightW, minWidth: rightW, backdropFilter: 'blur(20px)' }}
          >
            <InspectorPanel path={loc.pathname} onClose={() => setRightOpen(false)} />
          </aside>
        ) : (
          <button
            className="w-8 border-l border-[#ffffff08] bg-[#08081a]/80 flex items-center justify-center text-slate-600 hover:text-slate-400 transition-colors text-xs"
            onClick={() => setRightOpen(true)}
          >▶</button>
        )}
      </div>

      {/* Command palette overlay */}
      <CommandPalette />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Titlebar
// ---------------------------------------------------------------------------

function Titlebar(): React.JSX.Element {
  const { url, connected, disconnect } = useServer();
  const [showMenu, setShowMenu] = React.useState(false);

  return (
    <div
      className="h-9 flex items-center justify-between px-3 border-b border-[#ffffff06] bg-[#060618]/90"
      style={{ backdropFilter: 'blur(16px)' }}
      data-tauri-drag-region
    >
      <div className="flex items-center gap-2 select-none">
        <span
          className={`w-2 h-2 rounded-full shadow-[0_0_6px_currentColor] ${connected ? 'bg-emerald-500 text-emerald-500' : 'bg-amber-500 text-amber-500'}`}
        />
        <span className="text-[11px] font-mono tracking-widest text-slate-500">
          HERMIEOS
          <span className="ml-2 text-[10px] text-slate-700 font-normal tracking-normal">
            v0.1
          </span>
        </span>
      </div>

      <div className="flex items-center gap-3">
        {/* Server indicator */}
        <div className="relative">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className={`text-[10px] font-mono px-2 py-0.5 rounded border transition-colors ${
              connected
                ? 'border-emerald-800/50 text-emerald-600 hover:text-emerald-400'
                : 'border-amber-800/50 text-amber-600'
            }`}
          >
            {connected ? '● Connected' : '○ Disconnected'}
          </button>
          {showMenu ? (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
              <div className="absolute right-0 top-full mt-1 z-20 w-56 bg-[#0a0a1a] border border-[#ffffff10] rounded-lg shadow-xl overflow-hidden">
                <div className="px-3 py-2 border-b border-[#ffffff06]">
                  <div className="text-[10px] text-slate-600 font-mono uppercase tracking-wider">Server</div>
                  <div className="text-[11px] text-slate-400 mt-0.5 truncate font-mono">{url || 'Not configured'}</div>
                </div>
                <button
                  onClick={() => { disconnect(); setShowMenu(false); }}
                  className="w-full text-left px-3 py-2 text-[11px] text-red-400 hover:bg-red-950/30 transition-colors"
                >
                  Disconnect
                </button>
              </div>
            </>
          ) : null}
        </div>

        <div className="text-[10px] text-slate-600 font-mono">
          <kbd className="px-1.5 py-0.5 rounded bg-[#ffffff08] border border-[#ffffff0a]">⌘</kbd>
          <kbd className="ml-1 px-1.5 py-0.5 rounded bg-[#ffffff08] border border-[#ffffff0a]">K</kbd>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sidebar Navigation
// ---------------------------------------------------------------------------

function SidebarNav({ unread }: { unread: number }): React.JSX.Element {
  return (
    <nav className="flex flex-col gap-0.5 p-2 mt-1">
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === '/'}
          className={({ isActive }) =>
            `group flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all duration-150 ${
              isActive
                ? 'bg-[#1a1a3e] text-sky-300 shadow-[inset_0_0_0_1px_rgba(59,130,246,0.15)]'
                : 'text-slate-500 hover:text-slate-300 hover:bg-[#ffffff04]'
            }`
          }
        >
          <span className="text-base w-5 text-center">{item.icon}</span>
          <span className="flex-1 font-medium tracking-tight">{item.label}</span>
          {item.to === '/' && unread > 0 ? (
            <span className="text-[10px] bg-sky-600 text-white px-1.5 py-0 rounded-full font-mono">
              {unread > 99 ? '99+' : unread}
            </span>
          ) : null}
          <kbd className="text-[10px] font-mono text-slate-700 opacity-0 group-hover:opacity-100 transition-opacity">
            ⌘{item.shortcut}
          </kbd>
        </NavLink>
      ))}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Sidebar Footer
// ---------------------------------------------------------------------------

function SidebarFooter({
  user,
  onLogout,
}: {
  user: { displayName: string; schedulerEnabled: boolean } | null;
  onLogout: () => void;
}): React.JSX.Element {
  return (
    <div className="space-y-2">
      {/* Scheduler status */}
      <div className="flex items-center gap-2 px-1 text-[11px]">
        <span
          className={`w-1.5 h-1.5 rounded-full ${user?.schedulerEnabled ? 'bg-emerald-500 shadow-[0_0_4px_#10b981]' : 'bg-amber-500'}`}
        />
        <span className="text-slate-500">
          {user?.schedulerEnabled ? 'Hermes active' : 'Hermes paused'}
        </span>
      </div>

      {/* User */}
      {user ? (
        <div className="flex items-center gap-2 text-xs">
          <div className="w-6 h-6 rounded-md bg-gradient-to-br from-sky-600 to-purple-600 flex items-center justify-center text-[10px] font-bold text-white">
            {(user.displayName[0] ?? '?').toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-slate-300 truncate">{user.displayName}</div>
          </div>
          <button
            onClick={onLogout}
            className="text-slate-600 hover:text-slate-400 transition-colors text-[10px] px-1"
            title="Sign out"
          >⇥</button>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inspector Panel (right sidebar)
// ---------------------------------------------------------------------------

function InspectorPanel({ path, onClose }: { path: string; onClose: () => void }): React.JSX.Element {
  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-mono uppercase tracking-widest text-slate-600">Inspector</h2>
        <button
          onClick={onClose}
          className="text-slate-600 hover:text-slate-400 transition-colors text-sm"
        >✕</button>
      </div>
      <div className="text-xs text-slate-500 font-mono space-y-1">
        <div>path: {path}</div>
      </div>
      <div className="pt-4 border-t border-[#ffffff06]">
        <p className="text-xs text-slate-600 leading-relaxed">
          Select an object to see its details, relationships, and timeline here.
          Press <kbd className="px-1 rounded bg-[#ffffff08] text-[10px]">⌘K</kbd> to search.
        </p>
      </div>
    </div>
  );
}
