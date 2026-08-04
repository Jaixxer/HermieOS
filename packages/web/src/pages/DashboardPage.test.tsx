import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DashboardPage } from './DashboardPage';
import { api } from '../api';

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));

class EventSourceStub {
  onerror: ((e: unknown) => void) | null = null;
  constructor(_url: string, _opts?: EventSourceInit) {}
  addEventListener() {}
  removeEventListener() {}
  close() {}
}
vi.stubGlobal('EventSource', EventSourceStub);

vi.mock('../auth', () => ({ useAuth: () => useAuthMock() }));
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

const emptyDashboard = {
  tasks: { today: [], overdue: [], completedThisWeek: 0 },
  upcoming: { next7Days: [], next30Days: [], next90Days: [] },
  opportunities: { categories: [], recent: [] },
  hermesFeed: { events: [], hasMore: false },
  graph: { nodes: [], links: [] },
  generatedAt: new Date().toISOString(),
};

function withQuery(node: React.JSX.Element) {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>;
}

function renderPage() {
  return withQuery(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/chat/:sessionId" element={<div>chat session</div>} />
        <Route path="/chat" element={<div>chat page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

const baseUser = { id: 'u-1', email: 'jaiveersk25@gmail.com', displayName: 'Jaiveer', schedulerEnabled: true };

beforeEach(() => {
  vi.restoreAllMocks();
  useAuthMock.mockReturnValue({
    user: baseUser, loading: false, mcpToken: null,
    login: vi.fn(), logout: vi.fn(), refresh: vi.fn(), rotateToken: vi.fn(), signup: vi.fn(), setUser: vi.fn(),
  });
  vi.spyOn(api, 'dashboard').mockResolvedValue(emptyDashboard as never);
  vi.spyOn(api, 'runs').mockResolvedValue({ runs: [] } as never);
  vi.spyOn(api, 'hermesInfo').mockResolvedValue({ baseUrl: 'http://localhost:8642', token: 'mcp_t' } as never);
});

describe('DashboardPage (collaborator home)', () => {
  it('greets the user and shows the presence pill', async () => {
    render(renderPage());
    expect(await screen.findByRole('heading', { name: /jaiveer/i })).toBeInTheDocument();
    expect(screen.getAllByText('HERMES IS ONLINE').length).toBeGreaterThanOrEqual(1);
  });

  it('shows Hermes as working while a run is in flight', async () => {
    vi.spyOn(api, 'runs').mockResolvedValue({
      runs: [{ id: 'r1', kind: 'subscription', status: 'running', createdAt: new Date().toISOString() }],
    } as never);
    render(renderPage());
    expect(await screen.findByText('HERMES IS WORKING')).toBeInTheDocument();
  });

  it('shows Hermes as paused when the scheduler is off', async () => {
    useAuthMock.mockReturnValue({
      user: { ...baseUser, schedulerEnabled: false }, loading: false, mcpToken: null,
      login: vi.fn(), logout: vi.fn(), refresh: vi.fn(), rotateToken: vi.fn(), signup: vi.fn(), setUser: vi.fn(),
    });
    render(renderPage());
    expect(await screen.findByText('HERMES IS PAUSED')).toBeInTheDocument();
  });

  it('renders the Ask Hermes bar with suggestion chips', async () => {
    render(renderPage());
    expect(await screen.findByPlaceholderText(/Research, summarize, plan/)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /What should I focus on today/ })).toBeInTheDocument();
  });

  it('adds a task from the Tasks card', async () => {
    const user = userEvent.setup();
    const createTask = vi.spyOn(api, 'createTask').mockResolvedValue({
      task: { id: 't-new', title: 'Fix login', notes: null, category: 'work', status: 'todo', priority: 0, dueAt: null, completedAt: null, createdBy: 'user', batchId: null, sentToHermesAt: null, objectId: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), archivedAt: null },
    } as never);
    render(renderPage());
    await user.click(await screen.findByRole('button', { name: 'Add task for today' }));
    await user.type(await screen.findByPlaceholderText('Add a task for today…'), 'Fix login');
    await user.click(screen.getByRole('button', { name: 'ADD' }));
    await waitFor(() => expect(createTask).toHaveBeenCalledWith({ title: 'Fix login', category: 'work' }));
  });

  it('Ask Hermes sends and navigates to the chat', async () => {
    vi.spyOn(api, 'hermesCreateSession').mockResolvedValue({ object: 'hermes.session', session: { id: 'web_123' } } as never);
    vi.spyOn(api, 'hermesChat').mockResolvedValue({ object: 'hermes.session.chat.completion', session_id: 'web_123', message: { role: 'assistant', content: 'ok' } } as never);
    const user = userEvent.setup();
    render(renderPage());
    await screen.findByPlaceholderText(/Research, summarize, plan/);
    await user.type(screen.getByPlaceholderText(/Research, summarize, plan/), 'What should I focus on?');
    await user.click(screen.getByRole('button', { name: /SEND/ }));
    expect(await screen.findByText('chat session')).toBeInTheDocument();
  });

  it('shows the since-you-were-away when new events exist', async () => {
    try { localStorage.setItem('hermieos_last_seen', String(Date.now() - 60_000)); } catch {}
    vi.spyOn(api, 'dashboard').mockResolvedValue({
      ...emptyDashboard,
      hermesFeed: { events: [{ id: 'n1', kind: 'object_created', objectId: null, title: 'A new thing', body: null, createdAt: new Date(Date.now() - 10_000).toISOString(), payload: {} }], hasMore: false },
    } as never);
    render(renderPage());
    expect(await screen.findByText(/1 THING SINCE YOUR LAST VISIT/)).toBeInTheDocument();
    expect(screen.getAllByText('NEW').length).toBeGreaterThan(0);
  });

  it('reports how long Hermes worked and recommends today\'s task', async () => {
    try { localStorage.setItem('hermieos_last_seen', String(Date.now() - 60_000)); } catch {}
    vi.spyOn(api, 'runs').mockResolvedValue({
      runs: [{
        id: 'r1', kind: 'subscription', status: 'succeeded',
        createdAt: new Date(Date.now() - 30_000).toISOString(),
        startedAt: new Date(Date.now() - 30_000 - 3 * 3600_000 - 12 * 60_000).toISOString(),
        finishedAt: new Date(Date.now() - 30_000).toISOString(),
        error: null,
      }],
    } as never);
    vi.spyOn(api, 'listTasks').mockResolvedValue({
      tasks: [{
        id: 't-1', title: 'Write the report', notes: null, category: 'work', status: 'todo',
        priority: 1, dueAt: new Date(Date.now() + 86_400_000).toISOString(), completedAt: null,
        createdBy: 'user', batchId: null, sentToHermesAt: null, objectId: null,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), archivedAt: null,
      }],
      hasMore: false,
    } as never);
    render(renderPage());
    expect(await screen.findByText(/HERMES WORKED FOR/)).toBeInTheDocument();
    expect(await screen.findByText(/3H 12M/)).toBeInTheDocument();
    expect(await screen.findByText(/WRITE THE REPORT/i)).toBeInTheDocument();
  });

  it('shows ALL CAUGHT UP when nothing happened since the last visit', async () => {
    try { localStorage.setItem('hermieos_last_seen', String(Date.now() - 10_000)); } catch {}
    vi.spyOn(api, 'dashboard').mockResolvedValue({
      ...emptyDashboard,
      hermesFeed: { events: [{ id: 'o1', kind: 'object_created', objectId: null, title: 'Old thing', body: null, createdAt: new Date(Date.now() - 60_000).toISOString(), payload: {} }], hasMore: false },
    } as never);
    render(renderPage());
    expect(await screen.findByText(/ALL CAUGHT UP/)).toBeInTheDocument();
  });
});
