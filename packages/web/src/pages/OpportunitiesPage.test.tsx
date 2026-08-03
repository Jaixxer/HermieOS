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

import { OpportunitiesPage } from './OpportunitiesPage';
import { api, type ObjectSummary } from '../api';
import { AuthProvider } from '../auth';

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
}

function makeOpportunity(overrides: Partial<ObjectSummary> & { body?: Record<string, unknown> } = {}): ObjectSummary {
  return {
    id: 'o-1',
    type: 'opportunity',
    status: 'open',
    title: 'ESP32 WiFi thermostat',
    summary: 'New repo with 250 stars',
    priority: 5,
    tags: ['esp32'],
    archivedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as ObjectSummary;
}

function renderPage(): ReturnType<typeof render> {
  const qc = makeQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/opportunities']}>
        <AuthProvider>
          <OpportunitiesPage />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('OpportunitiesPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(api, 'listObjects').mockResolvedValue({ objects: [], nextCursor: null });
    vi.spyOn(api, 'recordFeedback').mockResolvedValue({ ok: true });
  });

  it('renders the header with open count', async () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /opportunities/i, level: 1 })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(/0 open/i)).toBeInTheDocument();
    });
  });

  it('shows an empty state when there are no opportunities', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/no opportunities yet/i)).toBeInTheDocument();
    });
  });

  it('lists opportunities and shows a category pill', async () => {
    vi.spyOn(api, 'listObjects').mockResolvedValue({
      objects: [
        makeOpportunity({ title: 'ESP32 WiFi thermostat' }),
        makeOpportunity({ id: 'o-2', title: 'Open source grant', status: 'archived' }),
      ],
      nextCursor: null,
    });
    renderPage();
    expect(await screen.findByText('ESP32 WiFi thermostat')).toBeInTheDocument();
    expect(screen.getByText('Open source grant')).toBeInTheDocument();
    // "Other" appears as a category pill on each row (and in the filter row).
    expect(screen.getAllByText('Other').length).toBeGreaterThanOrEqual(2);
  });

  it('filters by kind', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'listObjects').mockResolvedValue({
      objects: [
        makeOpportunity({ title: 'A job posting', body: { kind: 'job' } }),
        makeOpportunity({ id: 'o-2', title: 'A research paper', body: { kind: 'research_paper' } }),
      ],
      nextCursor: null,
    });
    renderPage();
    await screen.findByText('A job posting');
    await user.click(screen.getByRole('button', { name: /Papers \(1\)/i }));
    await waitFor(() => {
      expect(screen.getByText('A research paper')).toBeInTheDocument();
    });
    expect(screen.queryByText('A job posting')).not.toBeInTheDocument();
  });

  it('marks an opportunity archived via feedback', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'listObjects').mockResolvedValue({ objects: [makeOpportunity()], nextCursor: null });
    const feedbackSpy = vi.spyOn(api, 'recordFeedback').mockResolvedValue({ ok: true });
    renderPage();
    await screen.findByText('ESP32 WiFi thermostat');
    const archiveBtn = screen.getByRole('button', { name: /archive/i });
    await user.click(archiveBtn);
    // Archive opens a confirm modal; click the confirm button (the last
    // "Archive" match — the row button is aria-labelled "Archive" too).
    const confirmBtn = (await screen.findAllByRole('button', { name: /^archive$/i })).at(-1)!;
    await user.click(confirmBtn);
    await waitFor(() => {
      expect(feedbackSpy).toHaveBeenCalledWith('o-1', { kind: 'archive' });
    });
  });

  it('links each row to the object detail page', async () => {
    vi.spyOn(api, 'listObjects').mockResolvedValue({ objects: [makeOpportunity()], nextCursor: null });
    renderPage();
    const link = await screen.findByRole('link', { name: /ESP32 WiFi thermostat/i });
    expect(link.getAttribute('href')).toBe('/objects/o-1');
  });
});
