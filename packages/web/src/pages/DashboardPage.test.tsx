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

  it('renders the Quick Add Task field with the delegate option', async () => {
    render(renderPage());
    expect(await screen.findByPlaceholderText(/What needs to get done/)).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /Delegate to Hermes/i })).toBeInTheDocument();
  });

  it('captures a task via Quick Add', async () => {
    const user = userEvent.setup();
    const createTask = vi.spyOn(api, 'createTask').mockResolvedValue({
      task: { id: 't-new', title: 'Fix login', notes: null, category: 'work', status: 'todo', priority: 0, dueAt: null, completedAt: null, createdBy: 'user', batchId: null, sentToHermesAt: null, objectId: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), archivedAt: null },
    } as never);
    render(renderPage());
    await user.type(await screen.findByPlaceholderText(/What needs to get done/), 'Fix login');
    await user.click(screen.getByRole('button', { name: /CAPTURE/ }));
    await waitFor(() => expect(createTask).toHaveBeenCalledWith({ title: 'Fix login', category: 'work' }));
  });

  it('delegates a task to Hermes when the option is enabled', async () => {
    const user = userEvent.setup();
    const createTask = vi.spyOn(api, 'createTask').mockResolvedValue({
      task: { id: 't-hermes', title: 'Research competitors', notes: null, category: 'work', status: 'todo', priority: 0, dueAt: null, completedAt: null, createdBy: 'user', batchId: null, sentToHermesAt: null, objectId: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), archivedAt: null },
    } as never);
    const delegateTask = vi.spyOn(api, 'delegateTask').mockResolvedValue({ sessionId: 'sess-1', delegated: true } as never);
    render(renderPage());
    await user.type(await screen.findByPlaceholderText(/What needs to get done/), 'Research competitors');
    await user.click(screen.getByRole('switch', { name: /Delegate to Hermes/i }));
    await user.click(screen.getByRole('button', { name: /CAPTURE/ }));
    await waitFor(() => {
      expect(createTask).toHaveBeenCalledWith({ title: 'Research competitors', category: 'work' });
      expect(delegateTask).toHaveBeenCalledWith('t-hermes', { context: expect.any(String) });
    });
  });

  it('CHAT WITH HERMES opens the chat page', async () => {
    const user = userEvent.setup();
    render(renderPage());
    await user.click(await screen.findByRole('link', { name: /CHAT WITH HERMES/i }));
    expect(await screen.findByText('chat page')).toBeInTheDocument();
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
