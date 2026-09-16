import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
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

import { TasksPage } from './TasksPage';
import { api, type Task, type TaskUpdate } from '../api';
import { AuthProvider } from '../auth';

function makeQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
    scheduledFor: todayKey(),
    dueAt: null,
    completedAt: null,
    createdBy: 'user',
    batchId: null,
    sentToHermesAt: null,
    delegateNote: null,
    delegatedAt: null,
    progressPercent: 0,
    latestUpdate: null,
    updatesCount: 0,
    objectId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    archivedAt: null,
    ...overrides,
  };
}

function makeUpdate(overrides: Partial<TaskUpdate> = {}): TaskUpdate {
  return {
    id: 'up-1',
    taskId: 't-1',
    userId: 'u-1',
    actor: 'user',
    kind: 'progress',
    body: 'Outline done',
    percent: 30,
    sharedWithHermesAt: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function renderPage(): ReturnType<typeof render> {
  const qc = makeQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/tasks']}>
        <AuthProvider>
          <TasksPage />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('TasksPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(api, 'listTasks').mockResolvedValue({ tasks: [], hasMore: false, days: [], counts: {} });
    vi.spyOn(api, 'listTaskUpdates').mockResolvedValue({ updates: [] });
  });

  it('renders the header and a seven-day week strip', async () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /tasks/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /BY DAY/i })).toBeInTheDocument();
    });
    const cells = screen.getAllByRole('button').filter((b) => b.hasAttribute('aria-pressed'));
    expect(cells).toHaveLength(7); // Mon..Sun
    expect(cells.filter((c) => c.getAttribute('aria-pressed') === 'true')).toHaveLength(1);
  });

  it('loads the selected day’s board', async () => {
    const listSpy = vi.spyOn(api, 'listTasks').mockResolvedValue({
      tasks: [makeTask()],
      hasMore: false,
      day: todayKey(),
    });
    renderPage();
    expect(await screen.findByText('Write the report')).toBeInTheDocument();
    expect(listSpy).toHaveBeenCalledWith(expect.objectContaining({ day: todayKey(), limit: 100 }));
  });

  it('shows the deadline and the latest progress entry on a card', async () => {
    const due = new Date();
    due.setHours(18, 30, 0, 0);
    vi.spyOn(api, 'listTasks').mockResolvedValue({
      tasks: [
        makeTask({
          dueAt: due.toISOString(),
          progressPercent: 40,
          updatesCount: 1,
          latestUpdate: makeUpdate({ body: 'Halfway through the draft', percent: 40 }),
        }),
      ],
      hasMore: false,
    });
    renderPage();
    expect(await screen.findByText(/DEADLINE TODAY/i)).toBeInTheDocument();
    expect(screen.getByText(/40%/)).toBeInTheDocument();
    expect(screen.getByText(/Halfway through the draft/)).toBeInTheDocument();
  });

  it('creates a task with a day, a deadline and guidance for Hermes', async () => {
    const user = userEvent.setup();
    const createSpy = vi.spyOn(api, 'createTask').mockResolvedValue({ task: makeTask() });
    renderPage();

    await user.type(screen.getByPlaceholderText('What needs doing?'), 'File the visa form');
    await user.click(screen.getByRole('button', { name: /NOTES & GUIDANCE FOR HERMES/i }));
    await user.type(
      screen.getByPlaceholderText(/How should Hermes go about this/i),
      'Fill from my passport, stop before paying.',
    );
    await user.click(screen.getByRole('button', { name: /ADD TASK/i }));

    await waitFor(() => {
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'File the visa form',
          category: 'work',
          scheduledFor: todayKey(),
          delegateNote: 'Fill from my passport, stop before paying.',
        }),
      );
    });
  });

  it('logs a progress update on a task', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'listTasks').mockResolvedValue({ tasks: [makeTask()], hasMore: false });
    const progressSpy = vi
      .spyOn(api, 'addTaskProgress')
      .mockResolvedValue({ update: makeUpdate(), progressPercent: 30, status: 'in_progress', sharedWithHermes: false });

    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Show progress log' }));
    await user.type(screen.getByPlaceholderText(/What moved\? What's left\?/), 'Outline done');
    await user.type(screen.getByRole('spinbutton'), '30');
    await user.click(screen.getByRole('button', { name: /LOG UPDATE/i }));

    await waitFor(() => {
      expect(progressSpy).toHaveBeenCalledWith('t-1', { body: 'Outline done', percent: 30, kind: 'progress' });
    });
  });

  it('shows the progress log with both authors', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'listTasks').mockResolvedValue({
      tasks: [makeTask({ delegatedAt: new Date().toISOString() })],
      hasMore: false,
    });
    vi.spyOn(api, 'listTaskUpdates').mockResolvedValue({
      updates: [
        makeUpdate({ id: 'up-2', actor: 'hermes', body: 'Drafted the intro', percent: 60 }),
        makeUpdate({ id: 'up-1', actor: 'user', body: 'Pulled the numbers', percent: 20 }),
      ],
    });

    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Show progress log' }));
    expect(await screen.findByText('Drafted the intro')).toBeInTheDocument();
    expect(screen.getByText('Pulled the numbers')).toBeInTheDocument();
    expect(screen.getByText('HERMES')).toBeInTheDocument();
    expect(screen.getByText('YOU')).toBeInTheDocument();
    // Delegated tasks tell the user the note goes to Hermes.
    expect(screen.getByText(/RELAYED TO HERMES/)).toBeInTheDocument();
  });

  it('delegates with the stored guidance note prefilled', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'listTasks').mockResolvedValue({
      tasks: [makeTask({ delegateNote: 'Use the Q2 spreadsheet.' })],
      hasMore: false,
    });
    const delegateSpy = vi
      .spyOn(api, 'delegateTask')
      .mockResolvedValue({ sessionId: 'task-t-1', delegated: true, progressEntriesShared: 0 });

    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Delegate to Hermes' }));

    const noteBox = screen.getByPlaceholderText(/How to go about it/i);
    expect(noteBox).toHaveValue('Use the Q2 spreadsheet.');
    await user.type(screen.getByPlaceholderText(/Context \(optional\)/i), 'Board wants it Friday');
    await user.click(screen.getByRole('button', { name: /^DELEGATE$/i }));

    await waitFor(() => {
      expect(delegateSpy).toHaveBeenCalledWith('t-1', {
        note: 'Use the Q2 spreadsheet.',
        context: 'Board wants it Friday',
      });
    });
  });

  it('switches to the delegated view and links to the conversation', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'listTasks').mockImplementation(async (params = {}) => {
      if (params.delegated) {
        return {
          tasks: [makeTask({ id: 't-9', title: 'Delegated chore', delegatedAt: new Date().toISOString() })],
          hasMore: false,
        };
      }
      return { tasks: [], hasMore: false };
    });

    renderPage();
    await user.click(screen.getByRole('button', { name: /DELEGATED/i }));

    expect(await screen.findByText('Delegated chore')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Open Hermes conversation' });
    expect(link).toHaveAttribute('href', '/chat/task-t-9');
  });

  it('marks a task cleared from the card', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'listTasks').mockResolvedValue({ tasks: [makeTask()], hasMore: false });
    const updateSpy = vi.spyOn(api, 'updateTask').mockResolvedValue({ task: makeTask({ status: 'done' }) });

    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Mark as done' }));
    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith('t-1', { status: 'done' });
    });
  });

  it('loads another day’s board when a week-strip cell is clicked', async () => {
    const user = userEvent.setup();
    const listSpy = vi.spyOn(api, 'listTasks').mockResolvedValue({ tasks: [], hasMore: false, counts: {} });
    renderPage();

    const cells = screen.getAllByRole('button').filter((b) => b.hasAttribute('aria-pressed'));
    const sunday = cells[6]!; // Mon..Sun
    const dow = (new Date().getDay() + 6) % 7; // Mon = 0
    const expected = new Date();
    expected.setDate(expected.getDate() + (6 - dow));
    const key = `${expected.getFullYear()}-${String(expected.getMonth() + 1).padStart(2, '0')}-${String(
      expected.getDate(),
    ).padStart(2, '0')}`;

    await user.click(sunday);
    await waitFor(() => {
      expect(listSpy).toHaveBeenCalledWith(expect.objectContaining({ day: key, limit: 100 }));
    });
  });
});
