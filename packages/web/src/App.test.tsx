import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api');
  return actual;
});

vi.mock('./server', async () => {
  const actual = await vi.importActual<typeof import('./server')>('./server');
  return {
    ...actual,
    useServer: () => ({
      url: 'http://localhost:3001',
      connected: true,
      checking: false,
      error: null,
      connect: vi.fn(),
      disconnect: vi.fn(),
    }),
  };
});

import { App } from './App';
import { AuthProvider } from './auth';

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
}

function renderAt(path: string): ReturnType<typeof render> {
  const qc = makeQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('web smoke', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('redirects unauthenticated users from / to /login', async () => {
    // /me returns 401
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'unauthenticated' }), { status: 401 }),
    );
    renderAt('/');
    await waitFor(() => {
      expect(screen.getByText(/sign in to hermieos/i)).toBeInTheDocument();
    });
  });

  it('shows the signup form on /signup', async () => {
    renderAt('/signup');
    expect(screen.getByText(/create your hermieos account/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });

  it('navigates from /login to /signup', async () => {
    const user = userEvent.setup();
    renderAt('/login');
    await user.click(screen.getByRole('link', { name: /create an account/i }));
    await waitFor(() => {
      expect(screen.getByText(/create your hermieos account/i)).toBeInTheDocument();
    });
  });
});
