import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { useSse } from '../sse';

const CADENCES = ['hourly', 'daily', 'weekly'];

export function SubscriptionsPage(): React.JSX.Element {
  const qc = useQueryClient();

  useSse({
    onFeed: () => {
      qc.invalidateQueries({ queryKey: ['subscriptions'] });
    },
  });

  const { data, isLoading } = useQuery({
    queryKey: ['subscriptions'],
    queryFn: () => api.subscriptions(),
  });

  const [showForm, setShowForm] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Subscriptions</h1>
        <button className="btn-primary" onClick={() => setShowForm((s) => !s)}>
          {showForm ? 'Cancel' : 'New subscription'}
        </button>
      </div>

      {showForm ? (
        <NewSubscriptionForm
          onCreated={() => {
            setShowForm(false);
            qc.invalidateQueries({ queryKey: ['subscriptions'] });
          }}
        />
      ) : null}

      {isLoading ? (
        <div className="text-slate-400">Loading…</div>
      ) : !data?.subscriptions.length ? (
        <div className="card text-slate-400">No subscriptions yet.</div>
      ) : (
        <ul className="space-y-2">
          {data.subscriptions.map((s) => (
            <li key={s.id}>
              <SubscriptionRow sub={s} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NewSubscriptionForm({ onCreated }: { onCreated: () => void }): React.JSX.Element {
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [instruction, setInstruction] = useState('');
  const [cadence, setCadence] = useState('daily');
  const [err, setErr] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => api.createSubscription({ name, target, instruction, cadence }),
    onSuccess: onCreated,
    onError: (e) => setErr(e instanceof Error ? e.message : 'Failed'),
  });

  return (
    <form
      className="card space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate();
      }}
    >
      <div>
        <label className="label">Name</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div>
        <label className="label">Target</label>
        <input
          className="input"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder="e.g. arxiv:cs.AI, hn:frontpage, topic:esp32"
          required
        />
      </div>
      <div>
        <label className="label">Instruction</label>
        <textarea
          className="input h-20 resize-none"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder="What should Hermes do with each result?"
          required
        />
      </div>
      <div>
        <label className="label">Cadence</label>
        <select className="input w-auto" value={cadence} onChange={(e) => setCadence(e.target.value)}>
          {CADENCES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      {err ? <div className="text-sm text-rose-400">{err}</div> : null}
      <button className="btn-primary" disabled={create.isPending}>
        {create.isPending ? 'Creating…' : 'Create'}
      </button>
    </form>
  );
}

function SubscriptionRow({ sub }: { sub: import('../api').Subscription }): React.JSX.Element {
  const qc = useQueryClient();
  const patch = useMutation({
    mutationFn: () => api.updateSubscription(sub.id, { status: sub.status === 'paused' ? 'active' : 'paused' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['subscriptions'] }),
  });
  const archive = useMutation({
    mutationFn: () => api.archiveSubscription(sub.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['subscriptions'] }),
  });
  return (
    <div className="card flex items-center justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span className="badge">{sub.cadence}</span>
          <span className="badge">{sub.status}</span>
          {sub.consecutiveFailures > 0 ? (
            <span className="badge bg-rose-900/40 text-rose-300">
              {sub.consecutiveFailures}× failed
            </span>
          ) : null}
        </div>
        <h3 className="mt-1 font-medium truncate">{sub.name}</h3>
        <p className="text-xs text-slate-400 truncate">target: {sub.target}</p>
        <p className="text-sm text-slate-300 line-clamp-2 mt-1">{sub.instruction}</p>
        {sub.nextRunAt ? (
          <p className="text-xs text-slate-500 mt-1">next run: {new Date(sub.nextRunAt).toLocaleString()}</p>
        ) : null}
        {sub.lastError ? <p className="text-xs text-rose-400 mt-1">last error: {sub.lastError}</p> : null}
      </div>
      <div className="flex flex-col gap-1">
        {sub.status !== 'archived' ? (
          <button className="btn-ghost text-xs" onClick={() => patch.mutate()} disabled={patch.isPending}>
            {sub.status === 'paused' ? 'Resume' : 'Pause'}
          </button>
        ) : null}
        {sub.status !== 'archived' ? (
          <button
            className="btn-ghost text-xs"
            onClick={() => {
              if (window.confirm(`Archive "${sub.name}"?`)) archive.mutate();
            }}
          >
            Archive
          </button>
        ) : null}
      </div>
    </div>
  );
}
