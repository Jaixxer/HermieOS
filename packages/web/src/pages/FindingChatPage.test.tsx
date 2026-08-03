import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FindingChatPage } from './FindingChatPage';
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
    <MemoryRouter initialEntries={['/objects/obj-1/discuss']}>
      <Routes>
        <Route path="/objects/:id/discuss" element={<FindingChatPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const sampleObject = {
  object: {
    id: 'obj-1',
    type: 'research',
    status: 'open',
    title: 'A Paper About Agent Tool Use',
    summary: 'A very interesting paper about how agents pick their tools.',
    priority: 5,
    tags: ['agents', 'llm'],
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    body: {
      url: 'https://arxiv.org/abs/2412.12345',
      kind: 'research_paper',
      stars: 42,
      author: 'Smith et al.',
      subscriptionId: 'sub-1',
      source: 'arxiv:cs.AI',
    },
    related: [],
  },
};

const hermesInfo = { baseUrl: 'http://localhost:8642', token: 'mcp_token' };

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'object').mockResolvedValue(sampleObject as never);
  vi.spyOn(api, 'discussSession').mockResolvedValue({ sessionId: 'finding-obj-1', exists: true } as never);
  vi.spyOn(api, 'hermesInfo').mockResolvedValue(hermesInfo as never);
  vi.spyOn(api, 'hermesGetMessages').mockResolvedValue({
    object: 'list',
    session_id: 'finding-obj-1',
    data: [
      {
        id: 1,
        session_id: 'finding-obj-1',
        role: 'user',
        content: 'Make a beginner summary of this paper.',
        timestamp: Math.floor(Date.now() / 1000) - 60,
      },
      {
        id: 2,
        session_id: 'finding-obj-1',
        role: 'assistant',
        content: 'Here is a beginner-friendly summary.',
        timestamp: Math.floor(Date.now() / 1000) - 30,
      },
    ],
  } as never);
  vi.spyOn(api, 'subscriptions').mockResolvedValue({
    subscriptions: [{ id: 'sub-1', name: 'Paper Scout', target: 'arxiv:cs.AI', instruction: 'find papers', cadence: 'daily' }],
  } as never);
});

describe('FindingChatPage', () => {
  it('pins the finding as a hero card with its metadata', async () => {
    render(renderPage());
    expect(await screen.findByText('A Paper About Agent Tool Use')).toBeInTheDocument();
    expect(screen.getByText(/A very interesting paper/)).toBeInTheDocument();
    expect(screen.getByText('Research')).toBeInTheDocument();
    expect(screen.getByText('Paper Scout')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /arxiv.org\/abs\/2412.12345/ });
    expect(link).toHaveAttribute('href', 'https://arxiv.org/abs/2412.12345');
  });

  it('renders the conversation thread with user and assistant bubbles', async () => {
    render(renderPage());
    expect(await screen.findByText('Make a beginner summary of this paper.')).toBeInTheDocument();
    expect(screen.getByText('Here is a beginner-friendly summary.')).toBeInTheDocument();
  });

  it('shows the empty-state prompt when the session has no messages yet', async () => {
    vi.spyOn(api, 'hermesGetMessages').mockResolvedValue({
      object: 'list',
      session_id: 'finding-obj-1',
      data: [],
    } as never);
    vi.spyOn(api, 'discussSession').mockResolvedValue({ sessionId: 'finding-obj-1', exists: false } as never);
    render(renderPage());
    expect(await screen.findByText('Start the conversation')).toBeInTheDocument();
  });

  it('sends a follow-up and records the feedback path through the API', async () => {
    const followUp = vi.spyOn(api, 'followUp').mockResolvedValue({ sessionId: 'finding-obj-1', background: false } as never);
    const user = userEvent.setup();
    render(renderPage());
    await screen.findByText('A Paper About Agent Tool Use');

    const input = screen.getByPlaceholderText(/Raw feedback/);
    await user.type(input, 'I want to build a project around this.');
    await user.click(screen.getByRole('button', { name: 'Send follow-up' }));

    await waitFor(() => {
      expect(followUp).toHaveBeenCalledWith('obj-1', {
        message: 'I want to build a project around this.',
        runInBackground: false,
      });
    });
  });

  it('quick actions send a pre-filled follow-up immediately', async () => {
    const followUp = vi.spyOn(api, 'followUp').mockResolvedValue({ sessionId: 'finding-obj-1', background: false } as never);
    const user = userEvent.setup();
    render(renderPage());
    await screen.findByText('A Paper About Agent Tool Use');

    await user.click(screen.getByRole('button', { name: /Make a project/ }));

    await waitFor(() => {
      expect(followUp).toHaveBeenCalledWith('obj-1', {
        message: expect.stringContaining('I want to make a project around this.') as string,
        runInBackground: false,
      });
    });
  });

  it('the background toggle dispatches a tracked run', async () => {
    const followUp = vi.spyOn(api, 'followUp').mockResolvedValue({ sessionId: 'finding-obj-1', background: true } as never);
    const user = userEvent.setup();
    render(renderPage());
    await screen.findByText('A Paper About Agent Tool Use');

    await user.click(screen.getByRole('button', { name: /Background/ }));
    await user.type(screen.getByPlaceholderText(/Describe the deep work/), 'Research the whole field');
    await user.click(screen.getByRole('button', { name: 'Send follow-up' }));

    await waitFor(() => {
      expect(followUp).toHaveBeenCalledWith('obj-1', {
        message: 'Research the whole field',
        runInBackground: true,
      });
    });
    expect(await screen.findByText(/background research run/)).toBeInTheDocument();
  });
});
