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
import { api, type CalendarEvent } from '../api';
import { Sidebar } from '../components/Sidebar';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Loading } from '../components/Loading';
import { cn } from '../lib/utils';

type View = 'month' | 'week' | 'day';

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

export function CalendarPage(): React.JSX.Element {
  const qc = useQueryClient();
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

  async function syncNow(): Promise<void> {
    await api.calendarSync({
      from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      to: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
    });
    await qc.invalidateQueries({ queryKey: ['calendar'] });
  }

  const eventsOnDay = React.useCallback(
    (d: Date) => {
      const all = events.data?.events ?? [];
      return all.filter((e) => {
        const start = new Date(e.startsAt);
        return isSameDay(start, d);
      });
    },
    [events.data],
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

  return (
    <div className="h-screen overflow-hidden flex bg-page text-text-primary">
      <Sidebar activePath="/calendar" className="hidden lg:flex" />
      <main className="flex-1 min-w-0 min-h-0 flex flex-col">
        {/* Header */}
        <div className="h-[52px] shrink-0 px-6 border-b border-border-default flex items-center gap-3 bg-surface-0/95 backdrop-blur">
          <CalendarIcon className="w-4 h-4 text-accent-text" />
          <h1 className="text-[14px] font-semibold">Calendar</h1>
          <div className="ml-auto flex items-center gap-2">
            <GoogleConnectButton status={status.data} onSync={syncNow} />
            <div className="w-px h-5 bg-border-default mx-1" />
            <Button size="sm" variant="ghost" onClick={goToday}>Today</Button>
            <div className="flex items-center">
              <Button size="icon" variant="ghost" onClick={() => navigate(-1)} title="Previous">
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Button size="icon" variant="ghost" onClick={() => navigate(1)} title="Next">
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
            <span className="text-[13px] font-medium min-w-[140px] text-center">
              {view === 'day' ? cursor.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : monthLabel(cursor)}
            </span>
            <div className="w-px h-5 bg-border-default mx-1" />
            <ViewSwitcher view={view} onChange={setView} />
            <Button size="sm" onClick={() => { setEditingEvent(null); setShowEventModal(true); }}>
              <Plus className="w-3.5 h-3.5" /> New event
            </Button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-auto p-6">
          {status.isLoading ? (
            <Loading text="Loading calendar…" />
          ) : view === 'month' ? (
            <MonthGrid
              cursor={cursor}
              selected={selectedDate}
              onSelect={setSelectedDate}
              eventsOnDay={eventsOnDay}
              onEventClick={(ev) => {
                setEditingEvent(ev);
                setShowEventModal(true);
              }}
            />
          ) : view === 'week' ? (
            <WeekGrid
              cursor={cursor}
              eventsOnDay={eventsOnDay}
              onEventClick={(ev) => {
                setEditingEvent(ev);
                setShowEventModal(true);
              }}
            />
          ) : (
            <DayList
              cursor={cursor}
              eventsOnDay={eventsOnDay}
              onEventClick={(ev) => {
                setEditingEvent(ev);
                setShowEventModal(true);
              }}
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
    <div className="flex items-center rounded-md border border-border-default p-0.5">
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          onClick={() => onChange(t.value)}
          className={cn(
            'text-[12px] px-2 py-0.5 rounded transition',
            view === t.value ? 'bg-accent text-accent-fg font-medium' : 'text-text-tertiary hover:bg-surface-1',
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
          <Button
            size="sm"
            variant="outline"
            onClick={() => setSetupOpen(true)}
            className="gap-1.5"
          >
            <CalendarIcon className="w-3.5 h-3.5" />
            Connect Google Calendar
          </Button>
        ) : (
          <div className="flex items-center gap-2">
            <Input
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="Client ID"
              className="w-40 h-8"
              disabled={setupSaving}
            />
            <Input
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder="Client Secret"
              className="w-40 h-8"
              disabled={setupSaving}
            />
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSetupOpen(false)}
              disabled={setupSaving}
            >
              Cancel
            </Button>
            <Button
              size="sm"
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
            >
              <Save className="w-3 h-3" />
              Save
            </Button>
          </div>
        )}
        {setupError ? (
          <span className="text-[11px] text-status-failed">{setupError}</span>
        ) : null}
        <a
          href="https://console.cloud.google.com/apis/library"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] text-accent-text hover:underline"
        >
          Enable Calendar API <ExternalLink className="w-3 h-3 inline" />
        </a>
      </div>
    );
  }
  if (!status.connected) {
    return (
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const { url } = await api.calendarAuthUrl(window.location.origin + '/calendar');
            window.location.href = url;
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CalendarIcon className="w-3.5 h-3.5" />}
        Connect Google Calendar
      </Button>
    );
  }
  return (
    <div className="flex items-center gap-1">
      <span className="text-[11px] text-text-quaternary">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1" />
        {status.email ?? 'Connected'}
      </span>
      <Button size="icon" variant="ghost" onClick={onSync} title="Sync now">
        <RefreshCw className="w-3.5 h-3.5" />
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={async () => {
          if (!confirm('Disconnect Google Calendar? Future runs won\'t see your events.')) return;
          await api.calendarDisconnect();
          await qc.invalidateQueries({ queryKey: ['calendar'] });
        }}
        title="Disconnect"
      >
        Disconnect
      </Button>
    </div>
  );
}

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
  eventsOnDay: (d: Date) => CalendarEvent[];
  onEventClick: (e: CalendarEvent) => void;
}): React.JSX.Element {
  const gridStart = startOfWeek(startOfMonth(cursor));
  const days: Date[] = [];
  let d = new Date(gridStart);
  for (let i = 0; i < 42; i++) {
    days.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return (
    <Card>
      <CardContent className="p-2">
        <div className="grid grid-cols-7 mb-1">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
            <div key={d} className="text-[11px] text-text-quaternary text-center py-1">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-px bg-border-default rounded-md overflow-hidden">
          {days.map((day) => {
            const inMonth = day.getMonth() === cursor.getMonth();
            const isToday = isSameDay(day, new Date());
            const isSelected = isSameDay(day, selected);
            const dayEvents = eventsOnDay(day);
            return (
              <button
                key={day.toISOString()}
                type="button"
                onClick={() => onSelect(day)}
                className={cn(
                  'bg-surface-0 hover:bg-surface-1 p-1.5 text-left h-[88px] flex flex-col gap-0.5 transition',
                  !inMonth && 'opacity-40',
                )}
              >
                <div className="flex items-center gap-1">
                  <span
                    className={cn(
                      'text-[11px] w-5 h-5 rounded-full flex items-center justify-center',
                      isToday && 'bg-accent text-accent-fg font-semibold',
                      !isToday && isSelected && 'ring-1 ring-accent',
                      !isToday && !isSelected && 'text-text-secondary',
                    )}
                  >
                    {day.getDate()}
                  </span>
                </div>
                <div className="flex-1 min-h-0 space-y-0.5 overflow-hidden">
                  {dayEvents.slice(0, 3).map((ev) => (
                    <div
                      key={ev.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        onEventClick(ev);
                      }}
                      className="text-[10px] px-1 py-0.5 rounded truncate bg-accent/15 text-accent-text hover:bg-accent/25 cursor-pointer"
                    >
                      {ev.title}
                    </div>
                  ))}
                  {dayEvents.length > 3 ? (
                    <div className="text-[10px] text-text-quaternary px-1">
                      +{dayEvents.length - 3} more
                    </div>
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function WeekGrid({
  cursor,
  eventsOnDay,
  onEventClick,
}: {
  cursor: Date;
  eventsOnDay: (d: Date) => CalendarEvent[];
  onEventClick: (e: CalendarEvent) => void;
}): React.JSX.Element {
  const start = startOfWeek(cursor);
  const days: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    days.push(d);
  }
  return (
    <div className="grid grid-cols-7 gap-2">
      {days.map((day) => {
        const dayEvents = eventsOnDay(day).sort(
          (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
        );
        return (
          <Card key={day.toISOString()} className="min-h-[300px]">
            <CardContent className="p-3">
              <div className="text-[12px] font-medium mb-2 flex items-baseline gap-1">
                {day.toLocaleDateString(undefined, { weekday: 'short' })}
                <span className="text-text-quaternary">{day.getDate()}</span>
              </div>
              <div className="space-y-1">
                {dayEvents.length === 0 ? (
                  <div className="text-[11px] text-text-quaternary italic">No events</div>
                ) : (
                  dayEvents.map((ev) => (
                    <div
                      key={ev.id}
                      onClick={() => onEventClick(ev)}
                      className="text-[11px] px-2 py-1.5 rounded bg-accent/15 text-accent-text hover:bg-accent/25 cursor-pointer"
                    >
                      <div className="font-medium truncate">{ev.title}</div>
                      {!ev.allDay ? (
                        <div className="text-[10px] opacity-70">
                          {new Date(ev.startsAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                          {' – '}
                          {new Date(ev.endsAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      ) : (
                        <div className="text-[10px] opacity-70">All day</div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function DayList({
  cursor,
  eventsOnDay,
  onEventClick,
}: {
  cursor: Date;
  eventsOnDay: (d: Date) => CalendarEvent[];
  onEventClick: (e: CalendarEvent) => void;
}): React.JSX.Element {
  const dayEvents = eventsOnDay(cursor).sort(
    (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
  );
  return (
    <Card>
      <CardContent className="p-4">
        <h2 className="text-[14px] font-medium mb-3">
          {cursor.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
        </h2>
        {dayEvents.length === 0 ? (
          <div className="text-[12px] text-text-quaternary py-8 text-center">
            No events. Click "New event" to add one.
          </div>
        ) : (
          <div className="space-y-2">
            {dayEvents.map((ev) => (
              <div
                key={ev.id}
                onClick={() => onEventClick(ev)}
                className="border border-border-default rounded-lg p-3 hover:border-accent cursor-pointer"
              >
                <div className="flex items-start gap-3">
                  <div className="text-[11px] text-text-tertiary w-20 shrink-0 pt-0.5">
                    {ev.allDay ? 'All day' : (
                      <>
                        {new Date(ev.startsAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                        <div className="text-text-quaternary">– {new Date(ev.endsAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</div>
                      </>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-medium">{ev.title}</div>
                    {ev.description ? <div className="text-[12px] text-text-tertiary mt-1 line-clamp-2">{ev.description}</div> : null}
                    {ev.location ? (
                      <div className="flex items-center gap-1 text-[11px] text-text-tertiary mt-1">
                        <MapPin className="w-3 h-3" /> {ev.location}
                      </div>
                    ) : null}
                    {ev.attendees.length > 0 ? (
                      <div className="flex items-center gap-1 text-[11px] text-text-tertiary mt-1">
                        <Users className="w-3 h-3" /> {ev.attendees.length} attendee{ev.attendees.length !== 1 ? 's' : ''}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <Card className="w-full max-w-lg mx-4">
        <CardContent className="p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-[15px] font-semibold">{event ? 'Edit event' : 'New event'}</h3>
            <Button size="icon" variant="ghost" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          </div>
          <div>
            <label className="text-[11px] text-text-quaternary">Title</label>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full mt-1 h-9 px-3 rounded-md border border-border-default bg-surface-0 text-[13px]"
            />
          </div>
          <div className="flex items-center gap-2 text-[12px] text-text-secondary">
            <input
              id="all-day"
              type="checkbox"
              checked={allDay}
              onChange={(e) => setAllDay(e.target.checked)}
            />
            <label htmlFor="all-day">All day</label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] text-text-quaternary">Starts</label>
              <input
                type={allDay ? 'date' : 'datetime-local'}
                value={allDay ? startsAt.slice(0, 10) : startsAt}
                onChange={(e) => setStartsAt(allDay ? `${e.target.value}T00:00` : e.target.value)}
                className="w-full mt-1 h-9 px-2 rounded-md border border-border-default bg-surface-0 text-[12px]"
              />
            </div>
            <div>
              <label className="text-[11px] text-text-quaternary">Ends</label>
              <input
                type={allDay ? 'date' : 'datetime-local'}
                value={allDay ? endsAt.slice(0, 10) : endsAt}
                onChange={(e) => setEndsAt(allDay ? `${e.target.value}T23:59` : e.target.value)}
                className="w-full mt-1 h-9 px-2 rounded-md border border-border-default bg-surface-0 text-[12px]"
              />
            </div>
          </div>
          <div>
            <label className="text-[11px] text-text-quaternary">Location</label>
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="w-full mt-1 h-9 px-3 rounded-md border border-border-default bg-surface-0 text-[13px]"
            />
          </div>
          <div>
            <label className="text-[11px] text-text-quaternary">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full mt-1 px-3 py-2 rounded-md border border-border-default bg-surface-0 text-[13px]"
            />
          </div>
          {err ? <div className="text-[12px] text-status-failed">{err}</div> : null}
          <div className="flex items-center justify-between pt-1">
            <div>
              {event ? (
                <Button size="sm" variant="destructive" onClick={remove} disabled={busy}>
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                </Button>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
              <Button size="sm" onClick={save} disabled={busy}>
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                Save
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function toLocalIso(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
