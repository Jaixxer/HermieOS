import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ChatPage } from './ChatPage';
import { api } from '../api';
import * as authModule from '../auth';

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

function renderPage(initial = '/'): React.JSX.Element {
  return withQuery(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/chat/:sessionId" element={<ChatPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const sampleHermesInfo = {
  baseUrl: 'http://localhost:8642',
  token: 'mcp_test_token',
};

const sampleSession = {
  id: 'web_123',
  source: 'dashboard',
  model: 'mimo-v2.5',
  title: 'Refactor auth',
  preview: 'Where do I start?',
  message_count: 4,
  last_active: Math.floor(Date.now() / 1000),
  has_system_prompt: false,
  has_model_config: false,
};

const sampleMessages = [
  {
    id: 1,
    session_id: 'web_123',
    role: 'user' as const,
    content: 'Where do I start?',
    timestamp: Math.floor(Date.now() / 1000) - 60,
  },
  {
    id: 2,
    session_id: 'web_123',
    role: 'assistant' as const,
    content: 'Look at the auth-middleware first.',
    timestamp: Math.floor(Date.now() / 1000) - 30,
  },
];

beforeEach(() => {
  vi.restoreAllMocks();
  // Default: hermes-info succeeds, sessions returns one session, messages returns two.
  vi.spyOn(api, 'hermesInfo').mockResolvedValue(sampleHermesInfo);
  vi.spyOn(api, 'hermesListSessions').mockResolvedValue({
    object: 'list',
    data: [sampleSession],
    limit: 200,
    offset: 0,
    has_more: false,
  });
  vi.spyOn(api, 'hermesGetMessages').mockResolvedValue({
    object: 'list',
    session_id: 'web_123',
    data: sampleMessages,
  });
});

describe('ChatPage', () => {
  it('fetches hermes info and shows the header status', async () => {
    render(renderPage('/chat'));
    expect(await screen.findByTestId('hermes-base-url')).toHaveTextContent('localhost:8642');
  });

  it('lists sessions grouped by source with the source label', async () => {
    const sessions = [
      { ...sampleSession, id: 's1', source: 'discord' },
      { ...sampleSession, id: 's2', source: 'telegram' },
      { ...sampleSession, id: 's3', source: 'telegram' },
      { ...sampleSession, id: 's4', source: 'cron' },
    ];
    vi.spyOn(api, 'hermesListSessions').mockResolvedValue({
      object: 'list',
      data: sessions,
      limit: 200,
      offset: 0,
      has_more: false,
    });
    render(renderPage('/chat'));
    expect(await screen.findByText('Telegram')).toBeInTheDocument();
    expect(screen.getByText('Discord')).toBeInTheDocument();
    expect(screen.getByText('Cron')).toBeInTheDocument();
  });

  it('shows the empty state when no session is selected', async () => {
    render(renderPage('/chat'));
    expect(await screen.findByText(/start a conversation/i)).toBeInTheDocument();
  });

  it('shows messages for the selected session', async () => {
    render(renderPage('/chat/web_123'));
    expect(await screen.findByText(/where do i start/i)).toBeInTheDocument();
    expect(await screen.findByText(/look at the auth-middleware first/i)).toBeInTheDocument();
  });

  it('filters sessions by source via the source chips', async () => {
    vi.spyOn(api, 'hermesListSessions').mockResolvedValue({
      object: 'list',
      data: [
        { ...sampleSession, id: 'd-1', source: 'discord' },
        { ...sampleSession, id: 't-1', source: 'telegram' },
      ],
      limit: 200,
      offset: 0,
      has_more: false,
    });
    render(renderPage('/chat'));
    expect(await screen.findByText('Discord')).toBeInTheDocument();
    expect(screen.getByText('Telegram')).toBeInTheDocument();
    // Click the Telegram chip
    const tgChip = screen.getByRole('button', { name: /telegram/i });
    tgChip.click();
    await waitFor(() => {
      expect(screen.queryByText('Discord')).not.toBeInTheDocument();
    });
  });

  it('sends a chat message when the user clicks Send', async () => {
    const chatSpy = vi.spyOn(api, 'hermesChat').mockResolvedValue({
      object: 'hermes.session.chat.completion',
      session_id: 'web_123',
      message: { role: 'assistant', content: 'OK' },
    });
    render(renderPage('/chat/web_123'));
    await screen.findByText(/where do i start/i);
    const textarea = screen.getByPlaceholderText(/message hermes agent/i);
    // Simulate typing
    textarea.focus();
    await import('@testing-library/user-event').then(async ({ default: userEvent }) => {
      const user = userEvent.setup();
      await user.type(textarea, 'what about caching?');
      const sendBtn = screen.getByRole('button', { name: '' });
      await user.click(sendBtn);
    });
    await waitFor(() => {
      expect(chatSpy).toHaveBeenCalled();
    });
  });

  it('opens the new session dialog when the user clicks New session', async () => {
    render(renderPage('/chat'));
    const newBtns = await screen.findAllByRole('button', { name: /new session/i });
    newBtns[0]?.click();
    expect(await screen.findByRole('heading', { name: /new session/i })).toBeInTheDocument();
  });

  it('shows an error card when hermes-info fails to load', async () => {
    vi.spyOn(api, 'hermesInfo').mockRejectedValue(new Error('hermes is down'));
    render(renderPage('/chat'));
    expect(await screen.findByText(/couldn't connect to hermes agent/i)).toBeInTheDocument();
    expect(screen.getByText(/hermes is down/i)).toBeInTheDocument();
  });

  it('shows the title of the active session in the header when set', async () => {
    render(renderPage('/chat/web_123'));
    // The session sample has title "Refactor auth" — appears in the header
    // (renamable) and the session list. The header one is the first match.
    const matches = await screen.findAllByText('Refactor auth');
    expect(matches.length).toBeGreaterThan(0);
  });

  it('falls back to the preview when the session has no title', async () => {
    const spy = vi.spyOn(api, 'hermesListSessions').mockResolvedValue({
      object: 'list',
      data: [
        {
          id: 'web_xyz',
          source: 'dashboard',
          model: 'mimo-v2.5',
          title: null as unknown as string,
          preview: 'Where do I start?',
          message_count: 2,
          last_active: Math.floor(Date.now() / 1000),
          has_system_prompt: false,
          has_model_config: false,
        },
      ],
      limit: 200,
      offset: 0,
      has_more: false,
    });
    render(renderPage('/chat/web_xyz'));
    await screen.findByText(/where do i start/i);
    expect(spy).toHaveBeenCalled();
  });

  it('opens an inline rename form when the header title is clicked', async () => {
    const renameSpy = vi.spyOn(api, 'hermesRenameSession').mockResolvedValue({
      object: 'hermes.session',
      session: { ...sampleSession, title: 'Auth refactor' },
    });
    render(renderPage('/chat/web_123'));
    // The first "Refactor auth" is the header (renamable) title button.
    const matches = await screen.findAllByText('Refactor auth');
    matches[0]?.click();
    const input = await screen.findByPlaceholderText(/session title/i);
    const form = input.closest('form');
    expect(form).toBeTruthy();
    form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await waitFor(() => {
      expect(renameSpy).toHaveBeenCalled();
    });
  });
});