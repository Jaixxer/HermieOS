import { useState } from 'react';
import { api, ApiError } from '../api';
import { useQueryClient } from '@tanstack/react-query';
import { Heart, Bookmark, BellOff, Archive, MessageSquare, Lightbulb } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';

type FeedbackKind = 'like' | 'save' | 'ignore' | 'archive' | 'suggest';

interface ActionMeta {
  label: string;
  Icon: React.ElementType;
  tone: 'emerald' | 'sky' | 'amber' | 'rose' | 'slate';
}

const KIND_META: Record<FeedbackKind, ActionMeta> = {
  like: { label: 'Like', Icon: Heart, tone: 'emerald' },
  save: { label: 'Save', Icon: Bookmark, tone: 'sky' },
  ignore: { label: 'Mute', Icon: BellOff, tone: 'amber' },
  archive: { label: 'Archive', Icon: Archive, tone: 'rose' },
  suggest: { label: 'Suggest', Icon: MessageSquare, tone: 'slate' },
};

const KIND_ORDER: FeedbackKind[] = ['like', 'save', 'suggest', 'ignore', 'archive'];

interface FeedbackButtonsProps {
  objectId: string;
  /** When true, render a single compact row of icon-only buttons.
   *  Used in tables/lists where vertical space is tight. */
  compact?: boolean;
  /** Show only specific kinds. Defaults to all five. */
  kinds?: FeedbackKind[];
  /** Called after a feedback action succeeds (so parents can do
   *  things like marking the row as muted). */
  onAction?: (kind: FeedbackKind) => void;
}

export function FeedbackButtons({
  objectId,
  compact = false,
  kinds = KIND_ORDER,
  onAction,
}: FeedbackButtonsProps): React.JSX.Element {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<FeedbackKind | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteKind, setNoteKind] = useState<FeedbackKind>('suggest');
  const [noteText, setNoteText] = useState('');
  const [archiveConfirm, setArchiveConfirm] = useState(false);
  const [lastSent, setLastSent] = useState<FeedbackKind | null>(null);

  async function send(kind: FeedbackKind, note?: string): Promise<void> {
    setBusy(kind);
    setErr(null);
    try {
      await api.recordFeedback(objectId, { kind, note });
      setLastSent(kind);
      // Invalidate everything that might show feedback-derived state.
      qc.invalidateQueries({ queryKey: ['feed'] });
      qc.invalidateQueries({ queryKey: ['object', objectId] });
      qc.invalidateQueries({ queryKey: ['search'] });
      qc.invalidateQueries({ queryKey: ['findings-for-buckets'] });
      qc.invalidateQueries({ queryKey: ['categories', 'active'] });
      qc.invalidateQueries({ queryKey: ['feedback-summary'] });
      onAction?.(kind);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Failed');
    } finally {
      setBusy(null);
    }
  }

  function handleClick(kind: FeedbackKind): void {
    if (kind === 'archive') {
      setArchiveConfirm(true);
      return;
    }
    if (compact) {
      void send(kind);
      return;
    }
    setNoteKind(kind);
    setNoteText('');
    setNoteOpen(true);
  }

  return (
    <div className="relative">
      <div className={`flex ${compact ? 'gap-1' : 'gap-1.5'} flex-wrap`}>
        {kinds.map((k) => {
          const M = KIND_META[k];
          const Icon = M.Icon;
          const isBusy = busy === k;
          const wasLast = lastSent === k && busy === null;
          return (
            <Button
              key={k}
              variant={wasLast ? 'secondary' : 'ghost'}
              size={compact ? 'icon-sm' : 'sm'}
              disabled={busy !== null}
              onClick={() => handleClick(k)}
              title={M.label}
              aria-label={M.label}
              className={compact ? `min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 ${wasLast ? `text-tone-${M.tone}-text bg-tone-${M.tone}-bg` : ''}` : wasLast ? `text-tone-${M.tone}-text bg-tone-${M.tone}-bg` : undefined}
            >
              <Icon />
              {!compact ? <span className="hidden sm:inline">{M.label}</span> : null}
            </Button>
          );
        })}
      </div>

      {err ? <div className="text-[11px] text-status-failed mt-1">{err}</div> : null}

      {archiveConfirm ? (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-surface-0 border border-border-default rounded-xl p-5 w-full max-w-sm shadow-lg">
            <h3 className="text-[15px] font-semibold text-text-primary">Archive this finding?</h3>
            <p className="text-[12px] text-text-tertiary mt-2 leading-relaxed">
              Hermes won't show this on the Scouting page again. You can find it later
              via the system filter on the Objects page.
            </p>
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="ghost" size="sm" onClick={() => setArchiveConfirm(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={busy !== null}
                onClick={() => {
                  void send('archive').then(() => setArchiveConfirm(false));
                }}
              >
                Archive
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {noteOpen ? (
        <div className="absolute right-0 top-full mt-2 z-20 bg-surface-0 border border-border-default rounded-xl shadow-lg w-80 max-w-[calc(100vw-2rem)] p-3">
          <div className="flex items-center gap-2 text-[12px] font-medium text-text-secondary mb-2">
            <MessageSquare className="w-3.5 h-3.5 text-accent-text" />
            {KIND_META[noteKind].label} — add a note (optional)
          </div>
          <Input
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="e.g. follow up with the author, find similar projects…"
            className="h-10"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && noteText.trim()) {
                void send(noteKind, noteText.trim()).then(() => {
                  setNoteOpen(false);
                  setNoteText('');
                });
              }
            }}
          />
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="ghost" size="sm" onClick={() => { setNoteOpen(false); setNoteText(''); }}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={busy !== null}
              onClick={() => {
                void send(noteKind, noteText.trim() || undefined).then(() => {
                  setNoteOpen(false);
                  setNoteText('');
                });
              }}
            >
              {compact ? 'Send' : 'Send'}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}