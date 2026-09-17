import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  RefreshCw,
  Loader2,
  X,
  Trash2,
  Calendar as CalendarIcon,
  MapPin,
  Users,
  Save,
  ExternalLink,
} from 'lucide-react';
import { api, getApiBase, type CalendarEvent, type Task, type Upcoming } from '../api';
import { cn } from '../lib/utils';
import { Sheet } from '../components/ui/sheet';
import { mediaMatches } from '../mobile';

/**
 * Calendar — the schedule desk. Editorial grid, red today-marker,
 * hard-edged event blocks, dark event modal. Same frame as the rest
 * of HermieOS: cream workspace + nav rail.
 */

type View = 'month' | 'week' | 'day';

/** A calendar day can show Google events, mission tasks, and upcoming items. */
interface ScheduleItem {
  kind: 'event' | 'task' | 'upcoming';
  id: string;
  title: string;
  date: Date;
  event?: CalendarEvent;
  task?: Task;
  upcoming?: Upcoming;
  /** Task assigned to this day (scheduledFor) rather than due on it. */
  planned?: boolean;
}

/** Local calendar day as YYYY-MM-DD — the unit tasks are scheduled in. */
function dayKeyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}
function startOfWeek(d: Date): Date {
  const day = d.getDay();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - day);
}
function endOfWeek(d: Date): Date {
  const day = d.getDay();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + (6 - day), 23, 59, 59, 999);
}
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}
function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
function monthLabel(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}
function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

const inputCls =
  'w-full border border-p5-dark-line bg-white px-3 py-2 h-12 sm:h-auto text-[16px] sm:text-[13px] text-p5-dark outline-none placeholder:text-p5-dark-muted focus:border-accent transition';

export function CalendarPage(): React.JSX.Element {
  const qc = useQueryClient();
  // Always start on the full month grid — even on phones — so the whole
  // schedule is visible by default. Day/week remain one tap away.
  const [view, setView] = React.useState<View>('month');
  const [cursor, setCursor] = React.useState<Date>(new Date());
  const [selectedDate, setSelectedDate] = React.useState<Date>(new Date());
  const [showEventModal, setShowEventModal] = React.useState(false);
  const [editingEvent, setEditingEvent] = React.useState<CalendarEvent | null>(null);

  const from = React.useMemo(() => {
    if (view === 'month') return startOfWeek(startOfMonth(cursor));
    if (view === 'week') return startOfWeek(cursor);
    return startOfDay(cursor);
  }, [view, cursor]);
  const to = React.useMemo(() => {
    if (view === 'month') return endOfWeek(endOfMonth(cursor));
    if (view === 'week') return endOfWeek(cursor);
    return endOfDay(cursor);
  }, [view, cursor]);

  const status = useQuery({
    queryKey: ['calendar', 'auth', 'status'],
    queryFn: () => api.calendarAuthStatus(),
    staleTime: 60_000,
  });
  const events = useQuery({
    queryKey: ['calendar', 'events', from.toISOString(), to.toISOString()],
    queryFn: () =>
      api.calendarListEvents({
        from: from.toISOString(),
        to: to.toISOString(),
        limit: 250,
      }),
    staleTime: 30_000,
  });

  // Tasks — placed on the schedule by their ASSIGNED DAY (scheduledFor) and by
  // their DEADLINE (dueAt), so planning a task for Friday puts it on Friday even
  // with no deadline. Fetched for the visible window only: the API takes from/to
  // day keys now, so this no longer downloads every task and filters in the
  // browser.
  const calendarTasks = useQuery({
    queryKey: ['calendar', 'tasks', dayKeyOf(from), dayKeyOf(to)],
    queryFn: () => api.listTasks({ from: dayKeyOf(from), to: dayKeyOf(to), limit: 200 }),
    staleTime: 60_000,
  });
  const calendarUpcoming = useQuery({
    queryKey: ['calendar', 'upcoming'],
    queryFn: () => api.listUpcoming({ days: 120, limit: 100 }),
    staleTime: 30_000,
  });

  async function syncNow(): Promise<void> {
    await api.calendarSync({
      from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      to: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
    });
    await qc.invalidateQueries({ queryKey: ['calendar'] });
  }

  const eventsOnDay = React.useCallback(
    (d: Date): ScheduleItem[] => {
      const evs: ScheduleItem[] = (events.data?.events ?? [])
        .filter((e) => isSameDay(new Date(e.startsAt), d))
        .map((e) => ({ kind: 'event' as const, id: e.id, title: e.title, date: new Date(e.startsAt), event: e }));
      const key = dayKeyOf(d);
      const tasks: ScheduleItem[] = (calendarTasks.data?.tasks ?? [])
        .filter((t) => t.status !== 'done' && t.status !== 'cancelled')
        .map((t): ScheduleItem | null => {
          const due = t.dueAt ? new Date(t.dueAt) : null;
          if (due && isSameDay(due, d)) {
            return { kind: 'task', id: t.id, title: t.title, date: due, task: t, planned: false };
          }
          if (t.scheduledFor === key) {
            return { kind: 'task', id: t.id, title: t.title, date: startOfDay(d), task: t, planned: true };
          }
          return null;
        })
        .filter((x): x is ScheduleItem => x !== null);
      const upcoming: ScheduleItem[] = (calendarUpcoming.data?.items ?? [])
        .filter((u) => !u.completedAt && isSameDay(new Date(u.occursAt), d))
        .map((u) => ({ kind: 'upcoming' as const, id: u.id, title: u.title, date: new Date(u.occursAt), upcoming: u }));
      return [...evs, ...tasks, ...upcoming].sort((a, b) => a.date.getTime() - b.date.getTime());
    },
    [events.data, calendarTasks.data, calendarUpcoming.data],
  );

  function navigate(direction: number): void {
    const c = new Date(cursor);
    if (view === 'month') c.setMonth(c.getMonth() + direction);
    else if (view === 'week') c.setDate(c.getDate() + 7 * direction);
    else c.setDate(c.getDate() + direction);
    setCursor(c);
  }
  function goToday(): void {
    const t = new Date();
    setCursor(t);
    setSelectedDate(t);
  }
  /** Events open the edit modal; tasks + upcoming select the day. */
  function openItem(item: ScheduleItem): void {
    if (item.kind === 'event' && item.event) {
      setEditingEvent(item.event);
      setShowEventModal(true);
    } else {
      setSelectedDate(item.date);
    }
  }

  return (
    <div className="h-screen overflow-hidden flex bg-p5-cream text-p5-dark flex-1 min-w-0">
      <main className="flex-1 min-w-0 min-h-0 flex flex-col">
        {/* Header */}
        <div className="min-h-[52px] shrink-0 px-4 sm:px-6 py-2 sm:py-0 border-b border-black/10 flex flex-wrap items-center gap-x-3 gap-y-2 bg-p5-cream">
          <CalendarIcon className="w-4 h-4 text-accent" />
          <span className="text-[11px] font-black tracking-[0.16em] uppercase">Schedule</span>
          <div className="ml-auto flex items-center gap-2">
            <GoogleConnectButton status={status.data} onSync={syncNow} />
            <div className="mx-1 h-5 w-px bg-black/10" />
            <button
              type="button"
              onClick={goToday}
              className="border border-p5-dark-line px-2.5 py-1.5 min-h-[44px] sm:min-h-0 inline-flex items-center text-[10px] font-black tracking-[0.12em] text-p5-dark transition hover:border-p5-dark hover:bg-p5-dark hover:text-p5-cream"
            >
              TODAY
            </button>
            <div className="flex items-center border border-p5-dark-line">
              <button
                type="button"
                onClick={() => navigate(-1)}
                title="Previous"
                className="flex h-11 w-11 sm:h-7 sm:w-7 items-center justify-center text-p5-dark-muted transition hover:text-p5-dark"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => navigate(1)}
                title="Next"
                className="flex h-11 w-11 sm:h-7 sm:w-7 items-center justify-center border-l border-p5-dark-line text-p5-dark-muted transition hover:text-p5-dark"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
            <span className="min-w-0 text-center font-mono text-[12px] sm:text-[13px] font-bold text-p5-dark">
              {view === 'day' ? cursor.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : monthLabel(cursor).toUpperCase()}
            </span>
            <div className="mx-1 h-5 w-px bg-black/10" />
            <ViewSwitcher view={view} onChange={setView} />
            <button
              type="button"
              onClick={() => { setEditingEvent(null); setShowEventModal(true); }}
              className="inline-flex items-center justify-center gap-1.5 bg-accent px-3.5 py-2 min-h-[44px] sm:min-h-0 basis-full sm:basis-auto text-[10px] font-black tracking-[0.12em] text-white transition hover:bg-accent-hover"
            >
              <Plus className="w-3.5 h-3.5" /> NEW EVENT
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-auto p-6">
          {status.isLoading ? (
            <div className="py-20 text-center font-mono text-[12px] tracking-widest text-p5-dark-muted">LOADING THE SCHEDULE…</div>
          ) : view === 'month' ? (
            <>
              <MonthGrid
                cursor={cursor}
                selected={selectedDate}
                onSelect={setSelectedDate}
                eventsOnDay={eventsOnDay}
                onEventClick={openItem}
              />
              {/* Phones: the grid can only carry dots at 390 px, so the tapped
                  day's actual items are listed right below it. */}
              <DayAgenda cursor={selectedDate} eventsOnDay={eventsOnDay} onEventClick={openItem} />
            </>
          ) : view === 'week' ? (
            <WeekGrid
              cursor={cursor}
              eventsOnDay={eventsOnDay}
              onEventClick={openItem}
            />
          ) : (
            <DayList
              cursor={cursor}
              eventsOnDay={eventsOnDay}
              onEventClick={openItem}
            />
          )}
        </div>
      </main>

      {showEventModal ? (
        <EventModal
          event={editingEvent}
          initialDate={selectedDate}
          onClose={() => {
            setShowEventModal(false);
            setEditingEvent(null);
          }}
          onSaved={async () => {
            setShowEventModal(false);
            setEditingEvent(null);
            await qc.invalidateQueries({ queryKey: ['calendar'] });
          }}
        />
      ) : null}
    </div>
  );
}

function ViewSwitcher({ view, onChange }: { view: View; onChange: (v: View) => void }): React.JSX.Element {
  const tabs: Array<{ value: View; label: string }> = [
    { value: 'month', label: 'Month' },
    { value: 'week', label: 'Week' },
    { value: 'day', label: 'Day' },
  ];
  return (
    <div className="flex items-center border border-p5-dark-line">
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          onClick={() => onChange(t.value)}
          className={cn(
            'px-2.5 py-1.5 min-h-[44px] sm:min-h-0 inline-flex items-center text-[10px] font-black tracking-[0.1em] uppercase transition',
            view === t.value ? 'bg-accent text-white' : 'text-p5-dark-muted hover:bg-black/[0.03] hover:text-p5-dark',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function GoogleConnectButton({
  status,
  onSync,
}: {
  status: {
    connected: boolean;
    email: string | null;
    configured: boolean;
    hasUserConfiguredCredentials: boolean;
  } | undefined;
  onSync: () => Promise<void>;
}): React.JSX.Element {
  const qc = useQueryClient();
  const [busy, setBusy] = React.useState(false);
  const [setupOpen, setSetupOpen] = React.useState(false);
  const [clientId, setClientId] = React.useState('');
  const [clientSecret, setClientSecret] = React.useState('');
  const [setupSaving, setSetupSaving] = React.useState(false);
  const [setupError, setSetupError] = React.useState<string | null>(null);

  if (!status) return <></>;

  // Not configured at all — show setup form so the user can paste their own credentials.
  if (!status.configured) {
    return (
      <div className="flex items-center gap-2">
        {!setupOpen ? (
          <button
            type="button"
            onClick={() => setSetupOpen(true)}
            className="inline-flex items-center gap-1.5 border border-p5-dark-line px-3 py-1.5 min-h-[44px] sm:min-h-0 text-[10px] font-black tracking-[0.12em] text-p5-dark transition hover:border-p5-dark hover:bg-p5-dark hover:text-p5-cream"
          >
            <CalendarIcon className="w-3.5 h-3.5" />
            CONNECT GOOGLE CALENDAR
          </button>
        ) : (
          <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
            <input
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="Client ID"
              className="h-12 sm:h-8 w-full sm:w-40 border border-p5-dark-line bg-white px-2 text-[16px] sm:text-[12px] text-p5-dark outline-none placeholder:text-p5-dark-muted focus:border-accent"
              disabled={setupSaving}
            />
            <input
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder="Client Secret"
              className="h-12 sm:h-8 w-full sm:w-40 border border-p5-dark-line bg-white px-2 text-[16px] sm:text-[12px] text-p5-dark outline-none placeholder:text-p5-dark-muted focus:border-accent"
              disabled={setupSaving}
            />
            <button
              type="button"
              onClick={() => setSetupOpen(false)}
              disabled={setupSaving}
              className="px-2.5 py-1.5 text-[10px] font-black tracking-[0.12em] text-p5-dark-muted transition hover:text-p5-dark"
            >
              CANCEL
            </button>
            <button
              type="button"
              disabled={setupSaving || !clientId.trim() || !clientSecret.trim()}
              onClick={async () => {
                setSetupSaving(true);
                setSetupError(null);
                try {
                  await api.googleOAuthAppUpsert({
                    clientId: clientId.trim(),
                    clientSecret: clientSecret.trim(),
                  });
                  await qc.invalidateQueries({ queryKey: ['calendar', 'auth', 'status'] });
                  setSetupOpen(false);
                } catch (e) {
                  setSetupError(e instanceof Error ? e.message : 'Failed to save');
                } finally {
                  setSetupSaving(false);
                }
              }}
              className="inline-flex items-center gap-1 bg-accent px-2.5 py-1.5 text-[10px] font-black tracking-[0.12em] text-white transition hover:bg-accent-hover disabled:opacity-40"
            >
              <Save className="w-3 h-3" />
              SAVE
            </button>
          </div>
        )}
        {setupError ? (
          <span className="text-[11px] text-status-failed">{setupError}</span>
        ) : null}
        <a
          href="https://console.cloud.google.com/apis/library"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] font-bold text-accent hover:underline"
        >
          Enable Calendar API <ExternalLink className="w-3 h-3 inline" />
        </a>
      </div>
    );
  }
  if (!status.connected) {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const { url } = await api.calendarAuthUrl(getApiBase() + '/calendar');
            window.location.href = url;
          } finally {
            setBusy(false);
          }
        }}
        className="inline-flex items-center gap-1.5 border border-p5-dark-line px-3 py-1.5 text-[10px] font-black tracking-[0.12em] text-p5-dark transition hover:border-p5-dark hover:bg-p5-dark hover:text-p5-cream"
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CalendarIcon className="w-3.5 h-3.5" />}
        CONNECT GOOGLE CALENDAR
      </button>
    );
  }
  return (
    <div className="flex items-center gap-1">
      <span className="font-mono text-[11px] text-p5-dark-muted">
        <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
        {status.email ?? 'Connected'}
      </span>
      <button
        type="button"
        onClick={onSync}
        title="Sync now"
        className="flex h-7 w-7 items-center justify-center text-p5-dark-muted transition hover:text-p5-dark"
      >
        <RefreshCw className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={async () => {
          if (!confirm('Disconnect Google Calendar? Future runs won\'t see your events.')) return;
          await api.calendarDisconnect();
          await qc.invalidateQueries({ queryKey: ['calendar'] });
        }}
        title="Disconnect"
        className="border border-p5-dark-line px-2.5 py-1 text-[10px] font-black tracking-[0.1em] text-p5-dark-muted transition hover:border-status-failed hover:text-status-failed"
      >
        DISCONNECT
      </button>
    </div>
  );
}

// ============================================================================
// Event chip (shared by month + week views)
// ============================================================================

function EventChip({ item, onClick, compact }: { item: ScheduleItem; onClick: () => void; compact?: boolean }): React.JSX.Element {
  const isEvent = item.kind === 'event';
  const badge =
    item.kind === 'event' ? null : item.kind === 'task' ? (item.planned ? 'PLAN' : 'DUE') : 'GOAL';
  const borderCls = isEvent
    ? 'border-accent bg-accent/10 hover:bg-accent/25'
    : item.kind === 'task'
      ? 'border-amber-500 bg-amber-500/10 hover:bg-amber-500/25'
      : 'border-purple-500 bg-purple-500/10 hover:bg-purple-500/25';
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`w-full cursor-pointer border-l-2 px-1.5 py-0.5 text-left transition ${borderCls} ${compact ? 'space-y-0' : ''}`}
    >
      <div className="flex items-center gap-1.5">
        {badge ? (
          <span
            className={`shrink-0 font-mono text-[8px] font-black tracking-wide ${
              item.kind === 'task' ? 'text-amber-600' : 'text-purple-600'
            } ${compact ? 'hidden sm:inline' : ''}`}
          >
            {badge}
          </span>
        ) : null}
        <span className="truncate text-[10px] font-bold text-p5-dark">{item.title}</span>
      </div>
      {!compact && isEvent && item.event && !item.event.allDay ? (
        <div className="font-mono text-[9px] text-p5-dark-muted">
          {timeOf(item.event.startsAt)}–{timeOf(item.event.endsAt)}
        </div>
      ) : null}
    </button>
  );
}

// ============================================================================
// Month grid
// ============================================================================

function MonthGrid({
  cursor,
  selected,
  onSelect,
  eventsOnDay,
  onEventClick,
}: {
  cursor: Date;
  selected: Date;
  onSelect: (d: Date) => void;
  eventsOnDay: (d: Date) => ScheduleItem[];
  onEventClick: (e: ScheduleItem) => void;
}): React.JSX.Element {
  const gridStart = startOfWeek(startOfMonth(cursor));
  const days: Date[] = [];
  let d = new Date(gridStart);
  for (let i = 0; i < 42; i++) {
    days.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  const today = new Date();
  return (
    <div className="overflow-hidden border-2 border-black/15 bg-p5-panel p5-anim-slide">
      <div className="grid grid-cols-7 border-b-2 border-black/10">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((dow) => (
          <div key={dow} className="p5-kicker py-2 text-center text-p5-dark-muted">{dow}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const inMonth = day.getMonth() === cursor.getMonth();
          const isToday = isSameDay(day, today);
          const isSelected = isSameDay(day, selected);
          const dayEvents = eventsOnDay(day);
          const visible = dayEvents.slice(0, 3);
          const overflow = dayEvents.length - visible.length;
          const taskCount = dayEvents.filter((i) => i.kind === 'task').length;
          const goalCount = dayEvents.filter((i) => i.kind === 'upcoming').length;
          const eventCount = dayEvents.filter((i) => i.kind === 'event').length;
          return (
            <button
              key={day.toISOString()}
              type="button"
              data-day={dayKeyOf(day)}
              aria-label={day.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
              onClick={() => onSelect(day)}
              className={cn(
                'flex h-[88px] sm:h-[104px] flex-col gap-0.5 border-b border-r border-black/[0.06] p-1 sm:p-1.5 text-left transition',
                'hover:bg-black/[0.03]',
                !inMonth && 'opacity-40',
                isSelected && 'bg-accent/5',
              )}
            >
              <span
                className={cn(
                  'flex h-5 w-5 items-center justify-center text-[11px] font-bold',
                  isToday && 'bg-accent text-white',
                  isSelected && !isToday && 'border border-accent text-accent',
                  !isToday && !isSelected && 'text-p5-dark-muted',
                )}
              >
                {day.getDate()}
              </span>
              {/* Mobile: quiet colored dots — full grid fits the screen, nothing
                  looks crammed. Tap the day for the full list. */}
              {dayEvents.length > 0 ? (
                <div className="mt-0.5 flex flex-wrap items-center gap-1 pl-0.5 sm:hidden">
                  {taskCount > 0 ? <span className="h-1.5 w-1.5 rounded-full bg-amber-500" title={`${taskCount} task${taskCount === 1 ? '' : 's'}`} /> : null}
                  {goalCount > 0 ? <span className="h-1.5 w-1.5 rounded-full bg-purple-500" title={`${goalCount} goal${goalCount === 1 ? '' : 's'}`} /> : null}
                  {eventCount > 0 ? <span className="h-1.5 w-1.5 rounded-full bg-accent" title={`${eventCount} event${eventCount === 1 ? '' : 's'}`} /> : null}
                  <span className="ml-0.5 font-mono text-[8px] text-p5-dark-muted">{dayEvents.length}</span>
                </div>
              ) : null}
              {/* Desktop: readable chips. */}
              {visible.length > 0 ? (
                <div className="mt-0.5 hidden min-h-0 flex-1 space-y-0.5 overflow-hidden sm:block">
                  {visible.map((item) => (
                    <EventChip key={`${item.kind}-${item.id}`} item={item} compact onClick={() => onEventClick(item)} />
                  ))}
                  {overflow > 0 ? (
                    <div className="px-1 font-mono text-[9px] text-p5-dark-muted">
                      +{overflow} MORE
                    </div>
                  ) : null}
                </div>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================================
// Day agenda — the phone's answer to "what is actually on this day?"
// ============================================================================

/**
 * A month cell at 390 px can only carry dots, which tells the user nothing
 * about WHAT is due. This lists the tapped day's items (time, kind, title,
 * progress) directly under the grid, so the month view stays useful on a
 * phone without leaving the month.
 */
function DayAgenda({
  cursor,
  eventsOnDay,
  onEventClick,
}: {
  cursor: Date;
  eventsOnDay: (d: Date) => ScheduleItem[];
  onEventClick: (item: ScheduleItem) => void;
}): React.JSX.Element {
  const items = eventsOnDay(cursor);
  const taskCount = items.filter((i) => i.kind === 'task').length;
  return (
    <div data-testid="day-agenda" className="mt-3 border-2 border-black/15 bg-p5-panel sm:hidden">
      <div className="flex items-center justify-between gap-2 border-b-2 border-black/10 px-3.5 py-2.5">
        <div className="min-w-0">
          <div className="p5-kicker text-p5-dark-muted">SELECTED DAY</div>
          <div className="mt-0.5 truncate text-[15px] font-black uppercase tracking-tight text-p5-dark">
            {cursor.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })}
          </div>
        </div>
        <span className="shrink-0 border border-black/15 px-2 py-1 font-mono text-[9px] font-black tracking-[0.12em] text-p5-dark-muted">
          {items.length === 0
            ? 'CLEAR'
            : `${items.length} ITEM${items.length === 1 ? '' : 'S'}${taskCount > 0 ? ` · ${taskCount} TASK${taskCount === 1 ? '' : 'S'}` : ''}`}
        </span>
      </div>

      {items.length === 0 ? (
        <div className="px-3.5 py-6 text-center font-mono text-[11px] tracking-[0.14em] text-p5-dark-muted">
          NOTHING ON THIS DAY.
        </div>
      ) : (
        <ul>
          {items.map((item) => {
            const isEvent = item.kind === 'event';
            const isTask = item.kind === 'task';
            const left = isEvent
              ? item.event?.allDay
                ? 'ALL DAY'
                : item.event
                  ? timeOf(item.event.startsAt)
                  : ''
              : isTask
                ? item.planned
                  ? 'PLANNED'
                  : 'DUE'
                : 'GOAL';
            return (
              <li key={`${item.kind}-${item.id}`} className="border-b border-black/10 last:border-b-0">
                <button
                  type="button"
                  onClick={() => onEventClick(item)}
                  className="flex w-full items-start gap-3 px-3.5 py-3 text-left transition active:bg-black/[0.04]"
                >
                  <span className="mt-0.5 w-14 shrink-0 font-mono text-[10px] font-bold leading-snug text-p5-dark-muted">
                    {left}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span
                        className={cn(
                          'shrink-0 px-1.5 py-0.5 font-mono text-[9px] font-black tracking-wide',
                          isEvent
                            ? 'bg-accent/15 text-accent'
                            : isTask
                              ? 'bg-amber-500/15 text-amber-600'
                              : 'bg-purple-500/15 text-purple-600',
                        )}
                      >
                        {isEvent ? 'EVENT' : isTask ? (item.planned ? 'PLANNED' : 'TASK') : 'GOAL'}
                      </span>
                      <span className="min-w-0 text-[15px] font-black leading-snug text-p5-dark">{item.title}</span>
                    </span>
                    {isTask && item.task ? (
                      <span className="mt-1 block font-mono text-[10px] tracking-[0.06em] text-p5-dark-muted">
                        {item.task.category.toUpperCase()}
                        {item.task.progressPercent > 0 ? ` · ${item.task.progressPercent}% DONE` : ''}
                        {item.task.sentToHermesAt ? ' · DELEGATED' : ''}
                        {item.task.status === 'in_progress' ? ' · ACTIVE' : ''}
                      </span>
                    ) : null}
                    {isEvent && item.event?.location ? (
                      <span className="mt-1 block font-mono text-[10px] text-p5-dark-muted">{item.event.location}</span>
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ============================================================================
// Week grid
// ============================================================================

function WeekGrid({
  cursor,
  eventsOnDay,
  onEventClick,
}: {
  cursor: Date;
  eventsOnDay: (d: Date) => ScheduleItem[];
  onEventClick: (e: ScheduleItem) => void;
}): React.JSX.Element {
  const start = startOfWeek(cursor);
  const days: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    days.push(d);
  }
  const today = new Date();
  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[1120px] grid-cols-7 gap-3 sm:min-w-0">
        {days.map((day) => {
          const dayEvents = eventsOnDay(day);
          const isToday = isSameDay(day, today);
          return (
            <div key={day.toISOString()} className="flex min-h-[320px] flex-col border-2 border-black/15 bg-p5-panel">
              <div className={cn('flex items-baseline gap-1.5 border-b-2 border-black/10 px-3 py-2', isToday && 'bg-accent text-white')}>
                <span className="text-[12px] font-black tracking-[0.1em] uppercase">
                  {day.toLocaleDateString(undefined, { weekday: 'short' })}
                </span>
                <span className={cn('font-mono text-[13px] font-bold', isToday ? 'text-white/80' : 'text-p5-dark-muted')}>
                  {day.getDate()}
                </span>
              </div>
              <div className="flex-1 space-y-1 p-2">
                {dayEvents.length === 0 ? (
                  <div className="px-1 py-2 text-center font-mono text-[10px] tracking-[0.12em] text-p5-dark-muted">CLEAR</div>
                ) : (
                  dayEvents.map((item) => (
                    <EventChip key={`${item.kind}-${item.id}`} item={item} onClick={() => onEventClick(item)} />
                  ))
                )}
            </div>
          </div>
        );
      })}
    </div>
    </div>
  );
}

// ============================================================================
// Day list
// ============================================================================

function DayList({
  cursor,
  eventsOnDay,
  onEventClick,
}: {
  cursor: Date;
  eventsOnDay: (d: Date) => ScheduleItem[];
  onEventClick: (e: ScheduleItem) => void;
}): React.JSX.Element {
  const dayEvents = eventsOnDay(cursor);
  return (
    <div className="overflow-hidden border-2 border-black/15 bg-p5-panel">
      <div className="border-b-2 border-black/10 px-5 py-4">
        <div className="p5-kicker text-p5-dark-muted">THE DAY</div>
        <div className="mt-1 font-p5-serif text-[30px] leading-none text-p5-dark">
          {cursor.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase()}
        </div>
      </div>
      <div className="p-5">
        {dayEvents.length === 0 ? (
          <div className="py-10 text-center font-mono text-[12px] tracking-[0.14em] text-p5-dark-muted">
            NO EVENTS — CLICK NEW EVENT TO ADD ONE.
          </div>
        ) : (
          <div className="space-y-3">
            {dayEvents.map((item) => (
              <div
                key={`${item.kind}-${item.id}`}
                onClick={() => onEventClick(item)}
                className="flex cursor-pointer items-start gap-4 border border-black/15 p-4 transition hover:border-accent"
              >
                ${
                  /* Keep the time column identical for events; tasks + upcoming show a kind glyph. */
                  ''
                }
                <div className="w-20 shrink-0 border-r border-black/10 pr-3 text-right font-mono text-[12px] leading-snug text-p5-dark-muted">
                  {item.kind === 'event' && item.event ? (
                    item.event.allDay ? (
                      'ALL DAY'
                    ) : (
                      <>
                        {timeOf(item.event.startsAt)}
                        <div className="text-p5-dark-muted/70">– {timeOf(item.event.endsAt)}</div>
                      </>
                    )
                  ) : (
                    item.kind === 'task' ? 'TASK' : 'GOAL'
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`shrink-0 px-1.5 py-0.5 font-mono text-[9px] font-black tracking-wide ${
                        item.kind === 'task'
                          ? 'bg-amber-500/15 text-amber-600'
                          : item.kind === 'upcoming'
                            ? 'bg-purple-500/15 text-purple-600'
                            : 'bg-accent/15 text-accent'
                      }`}
                    >
                      {item.kind.toUpperCase()}
                    </span>
                    <span className="text-[16px] font-black tracking-tight text-p5-dark">{item.title}</span>
                  </div>
                  {item.kind === 'event' ? (
                    <>
                      {item.event!.description ? (
                        <div className="mt-1 line-clamp-2 text-[12px] text-p5-dark-muted">{item.event!.description}</div>
                      ) : null}
                      {item.event!.location ? (
                        <div className="mt-1.5 flex items-center gap-1 font-mono text-[11px] text-p5-dark-muted">
                          <MapPin className="h-3 w-3" /> {item.event!.location}
                        </div>
                      ) : null}
                      {item.event!.attendees.length > 0 ? (
                        <div className="mt-1 flex items-center gap-1 font-mono text-[11px] text-p5-dark-muted">
                          <Users className="h-3 w-3" /> {item.event!.attendees.length} attendee{item.event!.attendees.length !== 1 ? 's' : ''}
                        </div>
                      ) : null}
                    </>
                  ) : item.kind === 'task' && item.task?.notes ? (
                    <div className="mt-1 line-clamp-2 text-[12px] text-p5-dark-muted">{item.task.notes}</div>
                  ) : item.kind === 'upcoming' && item.upcoming?.subtitle ? (
                    <div className="mt-1 text-[12px] text-p5-dark-muted">{item.upcoming.subtitle}</div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Event modal
// ============================================================================

function EventModal({
  event,
  initialDate,
  onClose,
  onSaved,
}: {
  event: CalendarEvent | null;
  initialDate: Date;
  onClose: () => void;
  onSaved: () => Promise<void>;
}): React.JSX.Element {
  const [title, setTitle] = React.useState(event?.title ?? '');
  const [description, setDescription] = React.useState(event?.description ?? '');
  const [location, setLocation] = React.useState(event?.location ?? '');
  const [allDay, setAllDay] = React.useState(event?.allDay ?? false);
  const [startsAt, setStartsAt] = React.useState<string>(
    event
      ? toLocalIso(event.startsAt)
      : toLocalIso(new Date(initialDate.getTime() + 60 * 60 * 1000)),
  );
  const [endsAt, setEndsAt] = React.useState<string>(
    event ? toLocalIso(event.endsAt) : toLocalIso(new Date(initialDate.getTime() + 2 * 60 * 60 * 1000)),
  );
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  async function save(): Promise<void> {
    setErr(null);
    if (!title.trim()) {
      setErr('Title is required');
      return;
    }
    setBusy(true);
    try {
      const start = new Date(startsAt);
      const end = new Date(endsAt);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        setErr('Invalid start or end time');
        return;
      }
      if (end.getTime() <= start.getTime()) {
        setErr('End must be after start');
        return;
      }
      const externalId =
        event?.externalId ?? `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const body = {
        externalId,
        title: title.trim(),
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        allDay,
        description: description.trim() || undefined,
        location: location.trim() || undefined,
      };
      if (event) {
        await api.calendarUpdateEvent(event.id, body);
      } else {
        await api.calendarCreateEvent(body);
      }
      await onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    if (!event) return;
    if (!confirm('Delete this event?')) return;
    setBusy(true);
    try {
      await api.calendarDeleteEvent(event.id);
      await onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      label={event ? 'Edit event' : 'New event'}
      className="bg-[#1b1b1b] text-p5-text sm:max-w-lg border-white/15 border"
      footerClassName="border-white/15 bg-[#1b1b1b]"
      footer={
        <div className="flex items-center gap-2">
          {event ? (
            <button
              type="button"
              onClick={remove}
              disabled={busy}
              className="inline-flex items-center gap-1.5 border border-white/25 px-3.5 py-2 min-h-[48px] sm:min-h-0 text-[11px] font-black tracking-[0.12em] text-status-failed transition hover:bg-status-failed/10 disabled:opacity-40"
            >
              <Trash2 className="w-3.5 h-3.5" /> DELETE
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-3.5 py-2 min-h-[48px] sm:min-h-0 text-[11px] font-black tracking-[0.12em] text-p5-muted transition hover:text-p5-text"
          >
            CANCEL
          </button>
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="ml-auto inline-flex items-center gap-1.5 bg-accent px-4 py-2 min-h-[48px] sm:min-h-0 text-[11px] font-black tracking-[0.12em] text-white transition hover:bg-accent-hover disabled:opacity-40"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            SAVE
          </button>
        </div>
      }
    >
      <div className="p-5 sm:p-6">
        <div className="flex items-center justify-between">
          <h3 className="font-p5-serif text-[22px] sm:text-[24px] leading-none text-p5-text">
            {event ? 'EDIT EVENT' : 'NEW EVENT'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 sm:h-8 sm:w-8 items-center justify-center text-p5-muted transition hover:text-p5-text"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="mt-5 space-y-3">
          <div>
            <label className="p5-kicker text-p5-muted">Title</label>
            <input
              autoFocus={typeof window !== 'undefined' && window.matchMedia('(hover: hover)').matches}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={cn(inputCls, 'mt-1.5 bg-p5-ink-3 border-white/15 text-p5-text placeholder:text-p5-muted')}
            />
          </div>
          <div className="flex items-center gap-2 text-[12px] text-p5-muted">
            <input
              id="all-day"
              type="checkbox"
              checked={allDay}
              onChange={(e) => setAllDay(e.target.checked)}
              className="h-6 w-6 sm:h-4 sm:w-4 accent-[#D5001C]"
            />
            <label htmlFor="all-day">All day</label>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="p5-kicker text-p5-muted">Starts</label>
              <input
                type={allDay ? 'date' : 'datetime-local'}
                value={allDay ? startsAt.slice(0, 10) : startsAt}
                onChange={(e) => setStartsAt(allDay ? `${e.target.value}T00:00` : e.target.value)}
                className={cn(inputCls, 'mt-1.5 bg-p5-ink-3 border-white/15 text-p5-text')}
              />
            </div>
            <div>
              <label className="p5-kicker text-p5-muted">Ends</label>
              <input
                type={allDay ? 'date' : 'datetime-local'}
                value={allDay ? endsAt.slice(0, 10) : endsAt}
                onChange={(e) => setEndsAt(allDay ? `${e.target.value}T23:59` : e.target.value)}
                className={cn(inputCls, 'mt-1.5 bg-p5-ink-3 border-white/15 text-p5-text')}
              />
            </div>
          </div>
          <div>
            <label className="p5-kicker text-p5-muted">Location</label>
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className={cn(inputCls, 'mt-1.5 bg-p5-ink-3 border-white/15 text-p5-text placeholder:text-p5-muted')}
            />
          </div>
          <div>
            <label className="p5-kicker text-p5-muted">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className={cn(inputCls, 'mt-1.5 resize-none bg-p5-ink-3 border-white/15 text-p5-text placeholder:text-p5-muted')}
            />
          </div>
          {err ? <div className="text-[12px] text-status-failed font-mono">{err}</div> : null}
        </div>
      </div>
    </Sheet>
  );
}

function toLocalIso(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
