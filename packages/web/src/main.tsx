import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { AuthProvider } from './auth';
import { ServerProvider } from './server';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

// In the packaged Electron app the SPA is served from file://, so path-based
// routes (e.g. /scouting) don't resolve to the index.html shell on refresh and
// Chromium logs ERR_FILE_NOT_FOUND. Hash routes always reload the same HTML
// file and are the standard fix for Electron + SPA.
const isFileProtocol =
  typeof window !== 'undefined' && window.location.protocol === 'file:';
const Router = isFileProtocol ? HashRouter : BrowserRouter;

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');
ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <Router>
        <ServerProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ServerProvider>
      </Router>
    </QueryClientProvider>
  </React.StrictMode>,
);
