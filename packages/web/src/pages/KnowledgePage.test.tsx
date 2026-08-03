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

import { KnowledgePage } from './KnowledgePage';
import { api, type ObjectSummary, type SearchHit } from '../api';
import { AuthProvider } from '../auth';

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
}

function makeObject(overrides: Partial<ObjectSummary> = {}): ObjectSummary {
  return {
    id: 'obj-1',
    type: 'project',
    status: 'active',
    title: 'AI Hardware Lab',
    summary: 'Long-running hardware project',
    priority: 5,
    tags: [],
    archivedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function renderPage(): ReturnType<typeof render> {
  const qc = makeQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/knowledge']}>
        <AuthProvider>
          <KnowledgePage />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('KnowledgePage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(api, 'listObjects').mockResolvedValue({ objects: [], nextCursor: null });
    vi.spyOn(api, 'search').mockResolvedValue({ hits: [] });
    vi.spyOn(api, 'graph').mockResolvedValue({ nodes: [], links: [] });
  });

  it('renders the header and search box', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /knowledge/i, level: 1 })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/search projects/i)).toBeInTheDocument();
  });

  it('browses objects by type', async () => {
    vi.spyOn(api, 'listObjects').mockResolvedValue({
      objects: [makeObject({ title: 'AI Hardware Lab' })],
      nextCursor: null,
    });
    renderPage();
    expect(await screen.findByText('AI Hardware Lab')).toBeInTheDocument();
  });

  it('searches with debounce and shows results', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'listObjects').mockResolvedValue({ objects: [], nextCursor: null });
    vi.spyOn(api, 'search').mockResolvedValue({
      hits: [{ id: 'obj-9', type: 'research', title: 'ROS2 notes', summary: 'Findings', rank: 1, snippet: '<mark>ROS2</mark> notes' } as SearchHit],
    });
    renderPage();
    const input = screen.getByPlaceholderText(/search projects/i);
    await user.type(input, 'ROS2');
    expect(await screen.findByText('ROS2 notes')).toBeInTheDocument();
  });

  it('links browse results to the object detail page', async () => {
    vi.spyOn(api, 'listObjects').mockResolvedValue({
      objects: [makeObject({ title: 'AI Hardware Lab' })],
      nextCursor: null,
    });
    renderPage();
    const link = await screen.findByRole('link', { name: /AI Hardware Lab/i });
    expect(link.getAttribute('href')).toBe('/objects/obj-1');
  });

  it('shows a graph preview when there are nodes', async () => {
    vi.spyOn(api, 'graph').mockResolvedValue({
      nodes: [{ id: 'n1', title: 'Node one', type: 'project', priority: 5 }],
      links: [],
    });
    renderPage();
    expect(await screen.findByText('Node one')).toBeInTheDocument();
  });

  it('shows an empty graph state', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/no relationships yet/i)).toBeInTheDocument();
    });
  });
});
