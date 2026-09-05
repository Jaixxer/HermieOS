/**
 * AppShell — the persistent frame for every editorial (cream/dark) screen.
 *
 * The NavRail lives HERE, not inside the pages. That single mount is what
 * lets the active banner slide between tabs: the rail never remounts on
 * navigation, so its GSAP state survives a route change and the indicator
 * animates from the old row to the new one instead of teleporting.
 */
import * as React from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { NavRail } from './NavRail';
import { MobileHeader, MobileTabBar } from './MobileNav';
import { ToastProvider } from './Toasts';

export function AppShell(): React.JSX.Element {
  const location = useLocation();
  return (
    <ToastProvider>
      <div className="h-screen supports-[height:100dvh]:h-[100dvh] overflow-hidden flex flex-col lg:flex-row bg-p5-cream text-p5-dark">
        <NavRail activePath={location.pathname} />
        <MobileHeader />
        <Outlet />
        <MobileTabBar />
      </div>
    </ToastProvider>
  );
}
