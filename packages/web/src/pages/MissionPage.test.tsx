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

import { MissionPage } from './MissionPage';
import { api, type Task, type TaskAnalytics } from '../api';
import { AuthProvider } from '../auth';

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't-1',
    userId: 'u-1',
    title: 'Write the report',
    notes: null,
    category: 'work',
    status: 'todo',
    priority: 0,
    dueAt: new Date().toISOString(),
    completedAt: null,
    createdBy: 'user',
    batchId: null,
    sentToHermesAt: null,
    objectId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    archivedAt: null,
    ...overrides,
  };
}

function makeAnalytics(overrides: Partial<TaskAnalytics> = {}): TaskAnalytics {
  const now = new Date();
  const d = (offset: number): string => {
    const x = new Date(now);
    x.setDate(x.getDate() + offset);
    return x.toISOString().slice(0, 10);
  };
  return {
    generatedAt: now.toISOString(),
    today: { total: 2, completed: 1, inProgress: 0, pending: 1, overdue: 0, completionRate: 0.5 },
    deferredTomorrow: 1,
    last7Days: [-6, -5, -4, -3, -2, -1, 0].map((off) => ({
      date: d(off),
      created: 0,
      completed: 0,
    })),
    ...overrides,
  };
}

function renderPage(): ReturnType<typeof render> {
  const qc = makeQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/mission']}>
        <AuthProvider>
          <MissionPage />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('MissionPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(api, 'listTasks').mockResolvedValue({ tasks: [], hasMore: false });
    vi.spyOn(api, 'taskAnalytics').mockResolvedValue(makeAnalytics());
  });

  it('renders the header and progress ring', async () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /today's mission/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(/50%/)).toBeInTheDocument();
    });
  });

  it('shows tasks from the API', async () => {
    vi.spyOn(api, 'listTasks').mockResolvedValue({
      tasks: [makeTask({ title: 'Write the report' }), makeTask({ id: 't-2', title: 'Go for a run', category: 'health' })],
      hasMore: false,
    });
    renderPage();
    expect(await screen.findByText('Write the report')).toBeInTheDocument();
    expect(screen.getByText('Go for a run')).toBeInTheDocument();
  });

  it('marks a task done on toggle', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'listTasks').mockResolvedValue({ tasks: [makeTask()], hasMore: false });
    const updateSpy = vi.spyOn(api, 'updateTask').mockResolvedValue({ task: makeTask({ status: 'done' }) });
    vi.spyOn(api, 'archiveTask').mockResolvedValue({ archived: true });

    renderPage();
    const btn = await screen.findByRole('button', { name: 'Mark as done' });
    await user.click(btn);
    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith('t-1', { status: 'done' });
    });
  });

  it('defer-to-tomorrow sets dueAt to tomorrow end-of-day', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'listTasks').mockResolvedValue({ tasks: [makeTask()], hasMore: false });
    const updateSpy = vi.spyOn(api, 'updateTask').mockResolvedValue({ task: makeTask() });
    vi.spyOn(api, 'archiveTask').mockResolvedValue({ archived: true });

    renderPage();
    const btn = await screen.findByRole('button', { name: 'Defer to tomorrow' });
    await user.click(btn);
    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledTimes(1);
    });
    const [id, body] = updateSpy.mock.calls[0]!;
    expect(id).toBe('t-1');
    const due = new Date((body as { dueAt: string }).dueAt);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    expect(due.getFullYear()).toBe(tomorrow.getFullYear());
    expect(due.getMonth()).toBe(tomorrow.getMonth());
    expect(due.getDate()).toBe(tomorrow.getDate());
  });

  it('delegates a task to Hermes with context from the dialog', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'listTasks').mockResolvedValue({ tasks: [makeTask()], hasMore: false });
    const delegateSpy = vi.spyOn(api, 'delegateTask').mockResolvedValue({ sessionId: 'task-t-1', delegated: true });

    renderPage();
    const delegateBtn = await screen.findByRole('button', { name: 'Delegate to Hermes' });
    await user.click(delegateBtn);

    // Dialog opens with the task title + optional context box.
    expect(screen.getByText(/The task stays on your mission/)).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText(/Context \(optional\)/), 'Board wants it Friday, one page max');
    await user.click(screen.getByRole('button', { name: 'Delegate' }));

    await waitFor(() => {
      expect(delegateSpy).toHaveBeenCalledWith('t-1', {
        context: 'Board wants it Friday, one page max',
      });
    });
  });

  it('delegates without context when the box is left empty', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'listTasks').mockResolvedValue({ tasks: [makeTask()], hasMore: false });
    const delegateSpy = vi.spyOn(api, 'delegateTask').mockResolvedValue({ sessionId: 'task-t-1', delegated: true });

    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Delegate to Hermes' }));
    await user.click(screen.getByRole('button', { name: 'Delegate' }));

    await waitFor(() => {
      expect(delegateSpy).toHaveBeenCalledWith('t-1', { context: undefined });
    });
  });

  it('shows the delegated state and a link to the conversation once sent', async () => {
    vi.spyOn(api, 'listTasks').mockResolvedValue({
      tasks: [makeTask({ sentToHermesAt: new Date().toISOString() })],
      hasMore: false,
    });
    renderPage();
    expect(await screen.findByText('Delegated to Hermes')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Open Hermes conversation' });
    expect(link).toHaveAttribute('href', '/chat/task-t-1');
    // No delegate button for an already-delegated task.
    expect(screen.queryByRole('button', { name: 'Delegate to Hermes' })).not.toBeInTheDocument();
  });

  it('adds a task via the quick-add form', async () => {
    const user = userEvent.setup();
    const createSpy = vi.spyOn(api, 'createTask').mockResolvedValue({ task: makeTask() });
    renderPage();
    const input = screen.getByPlaceholderText('Add a task…');
    await user.type(input, 'New mission task');
    await user.click(screen.getByRole('button', { name: '' }) ?? screen.getByRole('button'));
    await waitFor(() => {
      expect(createSpy).toHaveBeenCalledWith({ title: 'New mission task', category: 'work' });
    });
  });
});
