import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api';
import type { FeedEvent } from '../api';
import { useState } from 'react';
import { FeedbackButtons } from '../components/FeedbackButtons';

const KIND_LABELS: Record<string, string> = {
  object_created: 'New object',
  object_updated: 'Updated',
  object_archived: 'Archived',
  object_reverted: 'Reverted',
  link_created: 'Linked',
  feedback: 'Feedback',
  task_finished: 'Task',
  notification: 'Notification',
  system: 'System',
};

function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString();
}

export function FeedPage(): React.JSX.Element {
  const qc = useQueryClient();
  const [kinds, setKinds] = useState<string>('');

  const { data, isLoading } = useQuery({
    queryKey: ['feed', { kinds }],
    queryFn: () => api.feed({ kinds: kinds || undefined, limit: 50 }),
  });

  const markRead = useMutation({
    mutationFn: () => api.markFeedRead(new Date().toISOString()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['feed'] });
      qc.invalidateQueries({ queryKey: ['unread'] });
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Feed</h1>
        <div className="flex items-center gap-2">
          <select className="input w-auto" value={kinds} onChange={(e) => setKinds(e.target.value)}>
            <option value="">All kinds</option>
            {Object.entries(KIND_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <button
            className="btn-secondary"
            onClick={() => markRead.mutate()}
            disabled={markRead.isPending}
          >
            {markRead.isPending ? 'Marking…' : 'Mark all read'}
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="text-slate-400">Loading…</div>
      ) : !data?.events.length ? (
        <div className="card text-slate-400">
          Nothing in your feed yet. Ask Hermes to research something, or create an object from the API.
        </div>
      ) : (
        <ul className="space-y-2">
          {data.events.map((e) => (
            <li key={e.id}>
              <FeedCard event={e} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FeedCard({ event }: { event: FeedEvent }): React.JSX.Element {
  return (
    <div className="card hover:border-slate-700 transition">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span className="badge">{kindLabel(event.kind)}</span>
            <span>{formatTime(event.createdAt)}</span>
            {event.readAt ? <span className="text-slate-500">· read</span> : null}
          </div>
          <h3 className="mt-1 font-medium text-slate-100 truncate">
            {event.objectId ? (
              <Link to={`/objects/${event.objectId}`} className="hover:underline">
                {event.title}
              </Link>
            ) : (
              event.title
            )}
          </h3>
          {event.payload && Object.keys(event.payload).length > 0 ? (
            <p className="mt-1 text-sm text-slate-400 line-clamp-2">
              {summarizePayload(event.payload)}
            </p>
          ) : null}
        </div>
        {event.objectId ? (
          <FeedbackButtons objectId={event.objectId} compact />
        ) : null}
      </div>
    </div>
  );
}

function summarizePayload(payload: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(payload)) {
    if (typeof v === 'string') parts.push(`${k}: ${v}`);
    else if (typeof v === 'number' || typeof v === 'boolean') parts.push(`${k}: ${String(v)}`);
  }
  return parts.join(' · ');
}
