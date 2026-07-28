import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../server', async () => {
  const actual = await vi.importActual<typeof import('../server')>('../server');
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

import { FeedPage } from './FeedPage';
import { api, type FeedEvent } from '../api';
import { AuthProvider } from '../auth';

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
}

function makeEvent(overrides: Partial<FeedEvent> = {}): FeedEvent {
  return {
    id: 'e-1',
    userId: 'u-1',
    kind: 'opportunity_discovered',
    objectId: 'o-1',
    title: 'Found 4 new internship opportunities',
    body: '2 match your skills perfectly',
    payload: {},
    readAt: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function renderPage(): ReturnType<typeof render> {
  const qc = makeQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/feed']}>
        <AuthProvider>
          <FeedPage />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('FeedPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows a "no events" empty state when the feed is empty', async () => {
    vi.spyOn(api, 'feed').mockResolvedValue({ events: [], hasMore: false });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/hermes is quiet/i)).toBeInTheDocument();
    });
  });

  it('renders event titles and bodies', async () => {
    const e = makeEvent();
    vi.spyOn(api, 'feed').mockResolvedValue({ events: [e], hasMore: false });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/found 4 new internship opportunities/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/2 match your skills perfectly/i)).toBeInTheDocument();
  });

  it('shows filter chips with counts', async () => {
    const events: FeedEvent[] = [
      makeEvent({ id: '1', kind: 'opportunity_discovered' }),
      makeEvent({ id: '2', kind: 'opportunity_discovered' }),
      makeEvent({ id: '3', kind: 'research_completed' }),
    ];
    vi.spyOn(api, 'feed').mockResolvedValue({ events, hasMore: false });
    renderPage();
    await waitFor(() => {
      // chip labels exist
      expect(screen.getByText(/^All$/i)).toBeInTheDocument();
    });
    // counts
    expect(screen.getByText('3')).toBeInTheDocument(); // All chip count
  });

  it('clicking a filter chip passes the kind to api.feed', async () => {
    const feed = vi.spyOn(api, 'feed').mockResolvedValue({ events: [], hasMore: false });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/hermes is quiet/i);

    // Click the "Opportunity" chip
    const chip = screen.getByRole('button', { name: /opportunity/i });
    await user.click(chip);

    await waitFor(() => {
      const lastCall = feed.mock.calls[feed.mock.calls.length - 1]?.[0] ?? {};
      expect(lastCall).toMatchObject({ kinds: 'opportunity_discovered' });
    });
  });
});
