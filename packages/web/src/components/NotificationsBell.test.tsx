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

import { NotificationsBell } from './NotificationsBell';
import { api, type Notification } from '../api';

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
}

function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: 'n-1',
    objectId: null,
    title: 'Research completed',
    message: 'Your ROS2 report is done',
    priority: 'normal',
    readAt: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function renderBell(): ReturnType<typeof render> {
  const qc = makeQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/']}>
        <NotificationsBell />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('NotificationsBell', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(api, 'notificationUnreadCount').mockResolvedValue({ unread: 0 });
    vi.spyOn(api, 'notifications').mockResolvedValue({ notifications: [], unread: 0 });
    vi.spyOn(api, 'markNotificationRead').mockResolvedValue({ ok: true });
    vi.spyOn(api, 'markAllNotificationsRead').mockResolvedValue({ updated: 0 });
  });

  it('renders the bell with no badge when unread is zero', async () => {
    renderBell();
    expect(screen.getByRole('button', { name: /notifications/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText('99+')).not.toBeInTheDocument();
    });
  });

  it('shows the unread count badge', async () => {
    vi.spyOn(api, 'notificationUnreadCount').mockResolvedValue({ unread: 3 });
    renderBell();
    await waitFor(() => {
      expect(screen.getByText('3')).toBeInTheDocument();
    });
  });

  it('opens the panel and lists notifications newest first', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'notificationUnreadCount').mockResolvedValue({ unread: 2 });
    vi.spyOn(api, 'notifications').mockResolvedValue({
      notifications: [
        makeNotification({ id: 'n-2', title: 'Newer note', message: 'second' }),
        makeNotification({ id: 'n-1', title: 'Older note', message: 'first' }),
      ],
      unread: 2,
    });
    renderBell();
    await user.click(screen.getByRole('button', { name: /notifications/i }));
    expect(await screen.findByText('Newer note')).toBeInTheDocument();
    expect(screen.getByText('Older note')).toBeInTheDocument();
  });

  it('marks a notification read when clicked', async () => {
    const user = userEvent.setup();
    const markSpy = vi.spyOn(api, 'markNotificationRead').mockResolvedValue({ ok: true });
    vi.spyOn(api, 'notificationUnreadCount').mockResolvedValue({ unread: 1 });
    vi.spyOn(api, 'notifications').mockResolvedValue({
      notifications: [makeNotification({ id: 'n-1', title: 'Click me' })],
      unread: 1,
    });
    renderBell();
    await user.click(screen.getByRole('button', { name: /notifications/i }));
    await user.click(await screen.findByText('Click me'));
    await waitFor(() => {
      expect(markSpy).toHaveBeenCalledWith('n-1');
    });
  });

  it('shows an empty state', async () => {
    const user = userEvent.setup();
    renderBell();
    await user.click(screen.getByRole('button', { name: /notifications/i }));
    expect(await screen.findByText(/no notifications yet/i)).toBeInTheDocument();
  });
});
