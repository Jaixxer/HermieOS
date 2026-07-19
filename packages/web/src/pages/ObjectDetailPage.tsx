import { useParams, Link, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import { api } from '../api';
import { FeedbackButtons } from '../components/FeedbackButtons';

type Tab = 'current' | 'timeline' | 'revisions' | 'related';

export function ObjectDetailPage(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  const [tab, setTab] = useState<Tab>('current');
  const qc = useQueryClient();
  const nav = useNavigate();

  if (!id) return <div>Missing id</div>;

  const { data, isLoading, error } = useQuery({
    queryKey: ['object', id],
    queryFn: () => api.object(id),
  });

  const revert = useMutation({
    mutationFn: (revision: number) => api.revertObject(id, revision),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['object', id] });
      qc.invalidateQueries({ queryKey: ['object', id, 'revisions'] });
      qc.invalidateQueries({ queryKey: ['object', id, 'timeline'] });
    },
  });

  const archive = useMutation({
    mutationFn: () => api.archiveObject(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['object', id] });
      qc.invalidateQueries({ queryKey: ['feed'] });
      nav('/');
    },
  });

  if (isLoading) return <div className="text-slate-400">Loading…</div>;
  if (error || !data) return <div className="text-rose-400">Object not found</div>;

  const obj = data.object;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span className="badge">{obj.type}</span>
            <span className="badge">{obj.status}</span>
            {obj.archivedAt ? <span className="badge bg-rose-900/40 text-rose-300">archived</span> : null}
            <span>priority {obj.priority}</span>
          </div>
          <h1 className="mt-2 text-2xl font-semibold">{obj.title}</h1>
          {obj.summary ? <p className="mt-1 text-slate-400">{obj.summary}</p> : null}
          {obj.tags.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {obj.tags.map((t) => (
                <span key={t} className="badge">
                  #{t}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <div className="flex flex-col gap-2 items-end">
          <FeedbackButtons objectId={obj.id} />
          {!obj.archivedAt ? (
            <button
              className="btn-ghost text-xs"
              onClick={() => {
                if (window.confirm('Archive this object?')) {
                  archive.mutate();
                }
              }}
            >
              Archive
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex gap-1 border-b border-slate-800">
        {(['current', 'timeline', 'revisions', 'related'] as Tab[]).map((t) => (
          <button
            key={t}
            className={`px-3 py-1.5 text-sm border-b-2 -mb-px ${tab === t ? 'border-sky-500 text-slate-100' : 'border-transparent text-slate-400 hover:text-slate-200'}`}
            onClick={() => setTab(t)}
          >
            {`${t[0]?.toUpperCase() ?? ''}${t.slice(1)}`}
            {t === 'related' ? ` (${obj.related.length})` : ''}
          </button>
        ))}
      </div>

      {tab === 'current' ? <CurrentTab body={obj.body} /> : null}
      {tab === 'timeline' ? <TimelineTab objectId={id} /> : null}
      {tab === 'revisions' ? (
        <RevisionsTab
          objectId={id}
          onRevert={(n) => {
            if (window.confirm(`Revert to revision ${n}?`)) revert.mutate(n);
          }}
        />
      ) : null}
      {tab === 'related' ? <RelatedTab items={obj.related} /> : null}
    </div>
  );
}

function CurrentTab({ body }: { body: Record<string, unknown> }): React.JSX.Element {
  const entries = Object.entries(body);
  if (entries.length === 0) {
    return <div className="card text-slate-400">No body content.</div>;
  }
  return (
    <div className="card space-y-2">
      {entries.map(([k, v]) => (
        <div key={k} className="text-sm">
          <div className="label">{k}</div>
          <div className="text-slate-200 whitespace-pre-wrap break-words">{formatValue(v)}</div>
        </div>
      ))}
    </div>
  );
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v, null, 2);
}

function TimelineTab({ objectId }: { objectId: string }): React.JSX.Element {
  const { data, fetchNextPage, hasNextPage, isLoading } = useInfiniteQuery({
    queryKey: ['object', objectId, 'timeline'],
    queryFn: ({ pageParam }) =>
      api.objectTimeline(objectId, { limit: 25, cursor: pageParam as string | undefined }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  if (isLoading) return <div className="text-slate-400">Loading…</div>;

  const events = data?.pages.flatMap((p: { events: import('../api').ObjectEvent[] }) => p.events) ?? [];
  if (events.length === 0) return <div className="card text-slate-400">No events yet.</div>;

  return (
    <div className="space-y-2">
      {events.map((e) => (
        <div key={e.id} className="card text-sm">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span className="badge">{e.kind}</span>
            <span>{new Date(e.createdAt).toLocaleString()}</span>
            <span>by {e.actor}</span>
          </div>
          {Object.keys(e.payload).length > 0 ? (
            <pre className="mt-1 text-xs text-slate-300 whitespace-pre-wrap">
              {JSON.stringify(e.payload, null, 2)}
            </pre>
          ) : null}
        </div>
      ))}
      {hasNextPage ? (
        <button className="btn-secondary" onClick={() => fetchNextPage()}>
          Load more
        </button>
      ) : null}
    </div>
  );
}

function RevisionsTab({
  objectId,
  onRevert,
}: {
  objectId: string;
  onRevert: (revision: number) => void;
}): React.JSX.Element {
  const { data, fetchNextPage, hasNextPage, isLoading } = useInfiniteQuery({
    queryKey: ['object', objectId, 'revisions'],
    queryFn: ({ pageParam }) =>
      api.objectRevisions(objectId, { limit: 25, cursor: pageParam as string | undefined }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  if (isLoading) return <div className="text-slate-400">Loading…</div>;

  const revisions = data?.pages.flatMap((p: { revisions: import('../api').ObjectRevision[] }) => p.revisions) ?? [];
  if (revisions.length === 0) return <div className="card text-slate-400">No revisions yet.</div>;

  return (
    <div className="space-y-2">
      {revisions.map((r) => (
        <div key={r.id} className="card text-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span className="badge">rev {r.revision}</span>
              <span>{new Date(r.createdAt).toLocaleString()}</span>
              <span>by {r.createdBy}</span>
            </div>
            <button className="btn-ghost text-xs" onClick={() => onRevert(r.revision)}>
              Revert to this
            </button>
          </div>
          {r.reason ? <div className="mt-1 text-slate-300">{r.reason}</div> : null}
          <div className="mt-1 text-slate-200">{r.title}</div>
          {r.summary ? <p className="mt-1 text-slate-400 text-xs">{r.summary}</p> : null}
        </div>
      ))}
      {hasNextPage ? (
        <button className="btn-secondary" onClick={() => fetchNextPage()}>
          Load more
        </button>
      ) : null}
    </div>
  );
}

function RelatedTab({ items }: { items: Array<{ id: string; type: string; title: string; reason: string | null; confidence: number }> }): React.JSX.Element {
  if (items.length === 0) return <div className="card text-slate-400">No related objects.</div>;
  return (
    <ul className="space-y-2">
      {items.map((r) => (
        <li key={r.id} className="card flex items-center justify-between">
          <div>
            <Link to={`/objects/${r.id}`} className="font-medium hover:underline">
              {r.title}
            </Link>
            <div className="text-xs text-slate-400">
              <span className="badge mr-2">{r.type}</span>
              {r.reason ? <span>{r.reason}</span> : null}
            </div>
          </div>
          <div className="text-xs text-slate-500">conf {r.confidence.toFixed(2)}</div>
        </li>
      ))}
    </ul>
  );
}
