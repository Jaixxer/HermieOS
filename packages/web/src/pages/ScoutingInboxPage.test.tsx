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

import { ScoutingInboxPage } from './ScoutingInboxPage';
import { api, type Subscription, type ObjectSummary } from '../api';
import { AuthProvider } from '../auth';

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
}

function makeCategory(overrides: Partial<import('../api').Category> = {}): import('../api').Category {
  return {
    id: 'cat-iot',
    name: 'iot',
    color: 'sky',
    icon: 'radar',
    sortOrder: 50,
    archivedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeSubscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: 's-1',
    name: 'ESPHome new projects',
    target: 'github:esphome',
    instruction: 'Find new ESPHome projects >100 stars',
    cadence: 'daily',
    nextRunAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
    lastRunAt: new Date(Date.now() - 2 * 60 * 60_000).toISOString(),
    lastRunId: null,
    nextRetryAt: null,
    consecutiveFailures: 0,
    lastError: null,
    status: 'active',
    categoryId: 'cat-iot',
    category: 'iot',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeOpportunity(overrides: Partial<ObjectSummary> = {}): ObjectSummary {
  return {
    id: 'o-1',
    type: 'opportunity',
    status: 'open',
    title: 'ESP32 WiFi thermostat',
    summary: 'New repo with 250 stars',
    priority: 5,
    tags: ['esp32', 'thermostat'],
    archivedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as ObjectSummary;
}

function renderPage(ui: React.ReactElement): ReturnType<typeof render> {
  const qc = makeQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/scouting']}>
        <AuthProvider>
          {ui}
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ScoutingInboxPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Default: 8 well-known categories (mirrors SUGGESTED_CATEGORIES
    // in packages/domain).
    vi.spyOn(api, 'categories').mockResolvedValue({
      categories: [
        makeCategory({ id: 'cat-job', name: 'job', color: 'emerald', icon: 'briefcase', sortOrder: 10 }),
        makeCategory({ id: 'cat-startup', name: 'startup', color: 'sky', icon: 'trending-up', sortOrder: 20 }),
        makeCategory({ id: 'cat-research', name: 'research_paper', color: 'purple', icon: 'file-text', sortOrder: 30 }),
        makeCategory({ id: 'cat-saas', name: 'saas_idea', color: 'amber', icon: 'lightbulb', sortOrder: 40 }),
        makeCategory({ id: 'cat-iot', name: 'iot', color: 'teal', icon: 'radar', sortOrder: 50 }),
        makeCategory({ id: 'cat-grant', name: 'grant', color: 'rose', icon: 'dollar-sign', sortOrder: 60 }),
        makeCategory({ id: 'cat-comp', name: 'competition', color: 'indigo', icon: 'trophy', sortOrder: 70 }),
        makeCategory({ id: 'cat-other', name: 'other', color: 'slate', icon: 'layers', sortOrder: 80 }),
      ],
    });
  });

  it('shows an empty state when there are no scouts', async () => {
    vi.spyOn(api, 'subscriptions').mockResolvedValue({ subscriptions: [] });
    vi.spyOn(api, 'listObjects').mockResolvedValue({ objects: [], nextCursor: null });

    renderPage(<ScoutingInboxPage />);

    await waitFor(() => {
      expect(screen.getByText(/no scouts yet/i)).toBeInTheDocument();
    });
  });

  it('renders the page header and roster even with no scouts', async () => {
    vi.spyOn(api, 'subscriptions').mockResolvedValue({ subscriptions: [] });
    vi.spyOn(api, 'listObjects').mockResolvedValue({ objects: [], nextCursor: null });

    renderPage(<ScoutingInboxPage />);

    expect(screen.getByRole('heading', { name: /scouting/i, level: 1 })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /new scout/i })).toBeInTheDocument();
    expect(await screen.findByText(/no scouts yet/i)).toBeInTheDocument();
  });

  it('shows a scout in the roster deck when one exists', async () => {
    const s = makeSubscription();
    vi.spyOn(api, 'subscriptions').mockResolvedValue({ subscriptions: [s] });
    vi.spyOn(api, 'listObjects').mockResolvedValue({ objects: [], nextCursor: null });
    vi.spyOn(api, 'scoutMetrics').mockResolvedValue({
      totalRuns: 5,
      succeededRuns: 4,
      failedRuns: 1,
      cancelledRuns: 0,
      last7DaysRuns: 3,
      last7DaysSucceeded: 2,
      avgRuntimeMs: 12_000,
      opportunitiesCreated: 8,
      topSources: [{ source: 'github', count: 8 }],
      lastSuccessAt: new Date().toISOString(),
      lastRunAt: new Date().toISOString(),
    });
    vi.spyOn(api, 'scoutRuns').mockResolvedValue({ runs: [] });
    vi.spyOn(api, 'scoutFindings').mockResolvedValue({ objects: [] });

    renderPage(<ScoutingInboxPage />);

    // The scout name appears in the card title AND the expanded file.
    // Scope to the first matching article.
    const matches = await screen.findAllByText(/ESPHome new projects/i);
    const card = matches[0]!.closest('article')!;
    expect(within(card).getByText(/github:esphome/i)).toBeInTheDocument();
    expect(within(card).getAllByText(/^Daily$/).length).toBeGreaterThan(0);
  });

  it('clicking Run Now calls runScoutNow', async () => {
    const s = makeSubscription();
    const user = userEvent.setup();
    vi.spyOn(api, 'subscriptions').mockResolvedValue({ subscriptions: [s] });
    vi.spyOn(api, 'listObjects').mockResolvedValue({ objects: [], nextCursor: null });
    vi.spyOn(api, 'scoutMetrics').mockResolvedValue({
      totalRuns: 0, succeededRuns: 0, failedRuns: 0, cancelledRuns: 0,
      last7DaysRuns: 0, last7DaysSucceeded: 0, avgRuntimeMs: null,
      opportunitiesCreated: 0, topSources: [], lastSuccessAt: null, lastRunAt: null,
    });
    vi.spyOn(api, 'scoutRuns').mockResolvedValue({ runs: [] });
    vi.spyOn(api, 'scoutFindings').mockResolvedValue({ objects: [] });
    const runNow = vi.spyOn(api, 'runScoutNow').mockResolvedValue({ subscription: s });

    renderPage(<ScoutingInboxPage />);

    const btn = await screen.findByRole('button', { name: /run now/i });
    await user.click(btn);
    await waitFor(() => {
      expect(runNow).toHaveBeenCalledWith(s.id);
    });
  });

  it('clicking Pause calls updateSubscription with paused status', async () => {
    const s = makeSubscription();
    const user = userEvent.setup();
    vi.spyOn(api, 'subscriptions').mockResolvedValue({ subscriptions: [s] });
    vi.spyOn(api, 'listObjects').mockResolvedValue({ objects: [], nextCursor: null });
    vi.spyOn(api, 'scoutMetrics').mockResolvedValue({
      totalRuns: 0, succeededRuns: 0, failedRuns: 0, cancelledRuns: 0,
      last7DaysRuns: 0, last7DaysSucceeded: 0, avgRuntimeMs: null,
      opportunitiesCreated: 0, topSources: [], lastSuccessAt: null, lastRunAt: null,
    });
    vi.spyOn(api, 'scoutRuns').mockResolvedValue({ runs: [] });
    vi.spyOn(api, 'scoutFindings').mockResolvedValue({ objects: [] });
    const update = vi.spyOn(api, 'updateSubscription').mockResolvedValue({ subscription: { ...s, status: 'paused' } });

    renderPage(<ScoutingInboxPage />);

    // The Pause button lives in the Scout detail panel header.
    // There may be multiple "Pause" buttons (filter tabs use a different
    // text "paused" not "Pause" — only the icon button label is "Pause").
    const btn = await screen.findByRole('button', { name: /^pause$/i });
    await user.click(btn);
    await waitFor(() => {
      expect(update).toHaveBeenCalledWith(s.id, { status: 'paused' });
    });
  });

  it('starts with no operative file expanded', async () => {
    const s = makeSubscription();
    vi.spyOn(api, 'subscriptions').mockResolvedValue({ subscriptions: [s] });
    vi.spyOn(api, 'listObjects').mockResolvedValue({ objects: [], nextCursor: null });
    vi.spyOn(api, 'scoutMetrics').mockResolvedValue({
      totalRuns: 0, succeededRuns: 0, failedRuns: 0, cancelledRuns: 0,
      last7DaysRuns: 0, last7DaysSucceeded: 0, avgRuntimeMs: null,
      opportunitiesCreated: 0, topSources: [], lastSuccessAt: null, lastRunAt: null,
    });
    vi.spyOn(api, 'scoutRuns').mockResolvedValue({ runs: [] });
    vi.spyOn(api, 'scoutFindings').mockResolvedValue({ objects: [] });
    renderPage(<ScoutingInboxPage />);
    await screen.findByText(/ESPHome new projects/i);
    expect(screen.queryByText(/operative file/i)).not.toBeInTheDocument();
  });

  it('opens the operative file when a scout card is clicked', async () => {
    const s = makeSubscription();
    const user = userEvent.setup();
    vi.spyOn(api, 'subscriptions').mockResolvedValue({ subscriptions: [s] });
    vi.spyOn(api, 'listObjects').mockResolvedValue({ objects: [], nextCursor: null });
    vi.spyOn(api, 'scoutMetrics').mockResolvedValue({
      totalRuns: 0, succeededRuns: 0, failedRuns: 0, cancelledRuns: 0,
      last7DaysRuns: 0, last7DaysSucceeded: 0, avgRuntimeMs: null,
      opportunitiesCreated: 0, topSources: [], lastSuccessAt: null, lastRunAt: null,
    });
    vi.spyOn(api, 'scoutRuns').mockResolvedValue({ runs: [] });
    vi.spyOn(api, 'scoutFindings').mockResolvedValue({ objects: [] });
    renderPage(<ScoutingInboxPage />);
    await user.click(await screen.findByText(/ESPHome new projects/i));
    expect(await screen.findByText(/operative file/i)).toBeInTheDocument();
  });

  it('shows real metrics in the operative dossier when metrics load', async () => {
    const s = makeSubscription();
    vi.spyOn(api, 'subscriptions').mockResolvedValue({ subscriptions: [s] });
    vi.spyOn(api, 'listObjects').mockResolvedValue({ objects: [], nextCursor: null });
    vi.spyOn(api, 'scoutMetrics').mockResolvedValue({
      totalRuns: 42,
      succeededRuns: 40,
      failedRuns: 2,
      cancelledRuns: 0,
      last7DaysRuns: 10,
      last7DaysSucceeded: 9,
      avgRuntimeMs: 154_000,
      opportunitiesCreated: 16,
      topSources: [
        { source: 'github', count: 12 },
        { source: 'reddit', count: 4 },
      ],
      lastSuccessAt: new Date().toISOString(),
      lastRunAt: new Date().toISOString(),
    });
    vi.spyOn(api, 'scoutRuns').mockResolvedValue({ runs: [] });
    vi.spyOn(api, 'scoutFindings').mockResolvedValue({ objects: [makeOpportunity()] });

    const user = userEvent.setup();
    renderPage(<ScoutingInboxPage />);

    // Open the operative file first.
    await user.click(await screen.findByText(/ESPHome new projects/i));

    await waitFor(() => {
      expect(screen.getByText('42')).toBeInTheDocument();
    });
    // Success rate = 40/42 = 95%
    expect(screen.getByText('95%')).toBeInTheDocument();
    expect(screen.getByText(/2m 34s/i)).toBeInTheDocument();
  });

  it('does not show fake "42 runs, 40 (95%)" or "2m 34s" defaults when metrics are absent', async () => {
    const s = makeSubscription();
    vi.spyOn(api, 'subscriptions').mockResolvedValue({ subscriptions: [s] });
    vi.spyOn(api, 'listObjects').mockResolvedValue({ objects: [], nextCursor: null });
    vi.spyOn(api, 'scoutMetrics').mockResolvedValue({
      totalRuns: 0,
      succeededRuns: 0,
      failedRuns: 0,
      cancelledRuns: 0,
      last7DaysRuns: 0,
      last7DaysSucceeded: 0,
      avgRuntimeMs: null,
      opportunitiesCreated: 0,
      topSources: [],
      lastSuccessAt: null,
      lastRunAt: null,
    });
    vi.spyOn(api, 'scoutRuns').mockResolvedValue({ runs: [] });
    vi.spyOn(api, 'scoutFindings').mockResolvedValue({ objects: [] });

    const user = userEvent.setup();
    renderPage(<ScoutingInboxPage />);

    // Open the operative file, then assert no fake defaults appear.
    await user.click(await screen.findByText(/ESPHome new projects/i));

    await waitFor(() => {
      expect(screen.getByText(/operative file/i)).toBeInTheDocument();
    });
    // No fake hardcoded 95% or 2m 34s anywhere
    expect(screen.queryByText('95%')).not.toBeInTheDocument();
    expect(screen.queryByText(/2m 34s/i)).not.toBeInTheDocument();
  });

  it('labels each scout with its category in the roster card', async () => {
    const s = makeSubscription({ category: 'iot' });
    vi.spyOn(api, 'subscriptions').mockResolvedValue({ subscriptions: [s] });
    vi.spyOn(api, 'listObjects').mockResolvedValue({ objects: [], nextCursor: null });
    vi.spyOn(api, 'scoutMetrics').mockResolvedValue({
      totalRuns: 0, succeededRuns: 0, failedRuns: 0, cancelledRuns: 0,
      last7DaysRuns: 0, last7DaysSucceeded: 0, avgRuntimeMs: null,
      opportunitiesCreated: 0, topSources: [], lastSuccessAt: null, lastRunAt: null,
    });
    vi.spyOn(api, 'scoutRuns').mockResolvedValue({ runs: [] });
    vi.spyOn(api, 'scoutFindings').mockResolvedValue({ objects: [] });
    renderPage(<ScoutingInboxPage />);
    const matches = await screen.findAllByText(/ESPHome new projects/i);
    const card = matches[0]!.closest('article')!;
    expect(within(card).getByText(/iot/i)).toBeInTheDocument();
  });

  it('filters scouts by All / Active / Paused / Archived', async () => {
    const s1 = makeSubscription({ id: 'a', name: 'Active one', status: 'active', category: 'iot' });
    const s2 = makeSubscription({ id: 'p', name: 'Paused one', status: 'paused', category: 'iot' });
    vi.spyOn(api, 'subscriptions').mockResolvedValue({ subscriptions: [s1, s2] });
    vi.spyOn(api, 'listObjects').mockResolvedValue({ objects: [], nextCursor: null });
    vi.spyOn(api, 'scoutMetrics').mockResolvedValue({
      totalRuns: 0, succeededRuns: 0, failedRuns: 0, cancelledRuns: 0,
      last7DaysRuns: 0, last7DaysSucceeded: 0, avgRuntimeMs: null,
      opportunitiesCreated: 0, topSources: [], lastSuccessAt: null, lastRunAt: null,
    });
    vi.spyOn(api, 'scoutRuns').mockResolvedValue({ runs: [] });
    vi.spyOn(api, 'scoutFindings').mockResolvedValue({ objects: [] });

    const user = userEvent.setup();
    renderPage(<ScoutingInboxPage />);

    // The dossier auto-expands the first scout; cards carry role="article".
    const findCard = async (name: string): Promise<HTMLElement | null> => {
      const cards = screen.queryAllByRole('article');
      for (const c of cards) {
        if (c.textContent?.includes(name)) return c;
      }
      return null;
    };

    // Default filter is "active" -> only Active one in the deck.
    await waitFor(async () => {
      const card = await findCard('Active one');
      expect(card).not.toBeNull();
    });
    expect(await findCard('Paused one')).toBeNull();

    // Click "All" -> both in the deck.
    await user.click(screen.getByRole('button', { name: /^all$/i }));
    await waitFor(async () => {
      const card = await findCard('Paused one');
      expect(card).not.toBeNull();
    });

    // Click "Paused" -> only paused one in the deck.
    await user.click(screen.getByRole('button', { name: /^paused$/i }));
    await waitFor(async () => {
      const card = await findCard('Active one');
      expect(card).toBeNull();
    });
    expect(await findCard('Paused one')).not.toBeNull();
  });

  it('has a "Hermes Feed →" link in the header that points to /feed', async () => {
    vi.spyOn(api, 'subscriptions').mockResolvedValue({ subscriptions: [] });
    vi.spyOn(api, 'listObjects').mockResolvedValue({ objects: [], nextCursor: null });
    renderPage(<ScoutingInboxPage />);
    const link = await screen.findByRole('link', { name: /hermes feed/i });
    expect(link).toHaveAttribute('href', '/feed');
  });
});
