import { useState } from 'react';
import { api, ApiError } from '../api';
import { useQueryClient } from '@tanstack/react-query';

type FeedbackKind = 'like' | 'save' | 'ignore' | 'archive' | 'suggest';

const KIND_LABELS: Record<FeedbackKind, string> = {
  like: '👍 Like',
  save: '★ Save',
  ignore: 'Mute',
  archive: 'Archive',
  suggest: 'Suggest',
};

export function FeedbackButtons({ objectId, compact = false }: { objectId: string; compact?: boolean }): React.JSX.Element {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<FeedbackKind | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestText, setSuggestText] = useState('');

  async function send(kind: FeedbackKind, note?: string): Promise<void> {
    setBusy(kind);
    setErr(null);
    try {
      await api.recordFeedback(objectId, { kind, note });
      qc.invalidateQueries({ queryKey: ['feed'] });
      qc.invalidateQueries({ queryKey: ['object', objectId] });
      qc.invalidateQueries({ queryKey: ['search'] });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="relative">
      <div className={`flex ${compact ? 'gap-1' : 'gap-2'}`}>
        {(Object.keys(KIND_LABELS) as FeedbackKind[]).map((k) => (
          <button
            key={k}
            className={compact ? 'btn-ghost text-xs px-2 py-1' : 'btn-secondary'}
            disabled={busy !== null}
            onClick={() => {
              if (k === 'suggest') {
                setSuggestOpen(true);
              } else {
                void send(k);
              }
            }}
            title={k}
          >
            {KIND_LABELS[k]}
          </button>
        ))}
      </div>
      {err ? <div className="text-xs text-rose-400 mt-1">{err}</div> : null}
      {suggestOpen ? (
        <div className="absolute right-0 top-full mt-2 z-20 card w-72">
          <textarea
            className="input h-20 resize-none"
            placeholder="What should Hermes research next?"
            value={suggestText}
            onChange={(e) => setSuggestText(e.target.value)}
          />
          <div className="flex justify-end gap-2 mt-2">
            <button className="btn-ghost" onClick={() => setSuggestOpen(false)}>
              Cancel
            </button>
            <button
              className="btn-primary"
              disabled={!suggestText.trim() || busy !== null}
              onClick={() => {
                void send('suggest', suggestText.trim()).then(() => {
                  setSuggestOpen(false);
                  setSuggestText('');
                });
              }}
            >
              Send
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
