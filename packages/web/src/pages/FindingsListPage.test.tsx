import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FindingsListPage } from './FindingsListPage';
import { api } from '../api';

vi.mock('../auth', () => ({
  useAuth: () => ({
    user: { id: 'u-1', email: 'jaiveersk25@gmail.com', displayName: 'Jaiveer', schedulerEnabled: true },
    loading: false,
    mcpToken: null,
    login: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
    rotateToken: vi.fn(),
    signup: vi.fn(),
    setUser: vi.fn(),
  }),
}));

vi.mock('../server', () => ({
  useServer: () => ({
    url: 'http://localhost:3001',
    connected: true,
    setUrl: vi.fn(),
    setBaseUrl: vi.fn(),
    lastCheckAt: Date.now(),
    refresh: vi.fn(),
    error: null,
  }),
}));

function withQuery(node: React.JSX.Element): React.JSX.Element {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{node}</QueryClientProvider>;
}

function renderPage(): React.JSX.Element {
  return withQuery(
    <MemoryRouter initialEntries={['/scouting/findings']}>
      <Routes>
        <Route path="/scouting/findings" element={<FindingsListPage />} />
        <Route path="/objects/:id" element={<div>object page</div>} />
        <Route path="/objects/:id/discuss" element={<div>discuss page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

const sampleFindings = [
  {
    id: 'obj-1',
    type: 'research',
    status: 'open',
    title: 'A Paper About Agent Tool Use',
    summary: 'How agents pick their tools.',
    priority: 5,
    tags: ['agents', 'llm'],
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    body: { url: 'https://arxiv.org/abs/2412.12345', kind: 'research_paper', stars: 42 },
  },
  {
    id: 'obj-2',
    type: 'opportunity',
    status: 'open',
    title: 'AgentHub — No-code Builder',
    summary: 'A low-code platform for AI agents.',
    priority: 3,
    tags: ['saas'],
    archivedAt: null,
    createdAt: '2026-01-03T00:00:00.000Z',
    updatedAt: '2026-01-04T00:00:00.000Z',
    body: { url: 'https://agenthub.example.com', stars: 1200 },
  },
];

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'listObjects').mockImplementation(
    async (params) =>
      ({
        objects: sampleFindings.filter((f) => f.type === params?.type),
        nextCursor: null,
      }) as Awaited<ReturnType<typeof api.listObjects>>,
  );
});

/** Find the card (article) containing the given title text. */
async function cardWithTitle(title: string): Promise<HTMLElement> {
  const el = await screen.findByText(title);
  const card = el.closest('[role="article"]');
  if (!card) throw new Error(`no card for ${title}`);
  return card as HTMLElement;
}

describe('FindingsListPage (deck)', () => {
  it('renders each finding as a card with type identity and metadata', async () => {
    render(renderPage());
    expect(await screen.findByText('A Paper About Agent Tool Use')).toBeInTheDocument();
    expect(screen.getByText('AgentHub — No-code Builder')).toBeInTheDocument();
    expect(screen.getByText('Research')).toBeInTheDocument();
    expect(screen.getByText('Opportunity')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /arxiv.org\/abs\/2412.12345/ });
    expect(link).toHaveAttribute('href', 'https://arxiv.org/abs/2412.12345');
  });

  it('links every card to its discussion page', async () => {
    render(renderPage());
    const researchCard = await cardWithTitle('A Paper About Agent Tool Use');
    const oppCard = await cardWithTitle('AgentHub — No-code Builder');
    const rLink = within(researchCard).getByRole('link', { name: /Discuss/ });
    const oLink = within(oppCard).getByRole('link', { name: /Discuss/ });
    expect(rLink).toHaveAttribute('href', '/objects/obj-1/discuss');
    expect(oLink).toHaveAttribute('href', '/objects/obj-2/discuss');
  });

  it('filters by type pills', async () => {
    const user = userEvent.setup();
    render(renderPage());
    await screen.findByText('A Paper About Agent Tool Use');

    await user.click(screen.getByRole('button', { name: /^opportunity/i }));
    await waitFor(() => {
      expect(screen.queryByText('A Paper About Agent Tool Use')).not.toBeInTheDocument();
    });
    expect(screen.getByText('AgentHub — No-code Builder')).toBeInTheDocument();
  });

  it('search narrows the deck', async () => {
    const user = userEvent.setup();
    render(renderPage());
    await screen.findByText('A Paper About Agent Tool Use');

    await user.type(screen.getByPlaceholderText('Search findings…'), 'AgentHub');
    await waitFor(() => {
      expect(screen.queryByText('A Paper About Agent Tool Use')).not.toBeInTheDocument();
    });
    expect(screen.getByText('AgentHub — No-code Builder')).toBeInTheDocument();
  });

  it('archive feedback removes the card from the deck', async () => {
    const recordFeedback = vi.spyOn(api, 'recordFeedback').mockResolvedValue({ ok: true } as never);
    const user = userEvent.setup();
    render(renderPage());
    const card = await cardWithTitle('A Paper About Agent Tool Use');

    await user.click(within(card).getByRole('button', { name: 'Archive' }));

    await waitFor(() => {
      expect(recordFeedback).toHaveBeenCalledWith('obj-1', { kind: 'archive', note: undefined });
    });
    await waitFor(() => {
      expect(screen.queryByText('A Paper About Agent Tool Use')).not.toBeInTheDocument();
    });
  });

  it('suggest opens an inline note field and records the raw feedback', async () => {
    const recordFeedback = vi.spyOn(api, 'recordFeedback').mockResolvedValue({ ok: true } as never);
    const user = userEvent.setup();
    render(renderPage());
    const card = await cardWithTitle('A Paper About Agent Tool Use');

    await user.click(within(card).getByRole('button', { name: 'Suggest' }));
    await user.type(within(card).getByPlaceholderText('What would you rather see?'), 'More IoT papers please');
    await user.click(within(card).getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(recordFeedback).toHaveBeenCalledWith('obj-1', { kind: 'suggest', note: 'More IoT papers please' });
    });
  });

  it('keyboard j/k navigates and Enter opens the discussion', async () => {
    const user = userEvent.setup();
    render(renderPage());
    const deck = await screen.findByTestId('findings-deck');
    deck.focus();
    await user.keyboard('{j}');
    await user.keyboard('{Enter}');
    expect(await screen.findByText('discuss page')).toBeInTheDocument();
  });

  it('shows the empty state when there are no findings', async () => {
    vi.spyOn(api, 'listObjects').mockImplementation(
      async () => ({ objects: [], nextCursor: null }) as Awaited<ReturnType<typeof api.listObjects>>,
    );
    render(renderPage());
    expect(await screen.findByText('No findings yet')).toBeInTheDocument();
  });
});
