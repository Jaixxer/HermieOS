import * as React from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  Star,
  ExternalLink,
  Lightbulb,
  Radar,
  FileText,
  Briefcase,
  GitBranch,
  GraduationCap,
} from 'lucide-react';
import { type ObjectSummary } from '../api';

import { useFindings } from '../hooks/data';
import { Sidebar } from '../components/Sidebar';
import { Card } from '../components/ui/card';
import { Loading } from '../components/Loading';
import { cn } from '../lib/utils';

type Tone = 'emerald' | 'sky' | 'purple' | 'amber' | 'rose' | 'slate';

const OBJECT_TYPE_META: Record<string, { label: string; tone: Tone; icon: React.ElementType }> = {
  opportunity: { label: 'Opportunity', tone: 'emerald', icon: Lightbulb },
  discovery: { label: 'Discovery', tone: 'sky', icon: Radar },
  research: { label: 'Research', tone: 'purple', icon: FileText },
  project: { label: 'Project', tone: 'amber', icon: Briefcase },
  decision: { label: 'Decision', tone: 'rose', icon: GitBranch },
  learning_path: { label: 'Learning Path', tone: 'slate', icon: GraduationCap },
};

function objectTypeMeta(type: string): { label: string; tone: Tone; icon: React.ElementType } {
  return OBJECT_TYPE_META[type] ?? { label: type, tone: 'slate', icon: Lightbulb };
}

const typeOptions: Array<{ value: 'all' | ObjectSummary['type']; label: string }> = [
  { value: 'all', label: 'All types' },
  { value: 'opportunity', label: 'Opportunities' },
  { value: 'discovery', label: 'Discoveries' },
  { value: 'research', label: 'Research' },
  { value: 'project', label: 'Projects' },
  { value: 'decision', label: 'Decisions' },
];

export function FindingsListPage(): React.JSX.Element {
  const { data: allFindings, isLoading } = useFindings();
  const [typeFilter, setTypeFilter] = React.useState<'all' | ObjectSummary['type']>('all');
  const [sortBy, setSortBy] = React.useState<'updated' | 'type'>('updated');

  const filtered = React.useMemo(() => {
    let list = allFindings ?? [];
    if (typeFilter !== 'all') {
      list = list.filter((o) => o.type === typeFilter);
    }
    if (sortBy === 'type') {
      list = [...list].sort((a, b) => a.type.localeCompare(b.type));
    }
    return list;
  }, [allFindings, typeFilter, sortBy]);

  return (
    <div className="h-screen overflow-hidden flex bg-page text-text-primary">
      <Sidebar activePath="/scouting" className="hidden lg:flex" />
      <main className="flex-1 min-w-0 min-h-0 flex flex-col">
        <div className="h-[52px] shrink-0 px-6 border-b border-border-default flex items-center gap-3 bg-surface-0/95 backdrop-blur">
          <Link
            to="/scouting"
            className="flex items-center gap-2 text-text-tertiary hover:text-text-primary transition"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="text-[13px]">Back to scouting</span>
          </Link>
          <span className="text-[11px] text-text-quaternary">/</span>
          <span className="text-[13px] font-medium text-text-primary">All findings</span>
          {allFindings ? (
            <span className="text-[11px] text-text-quaternary">({allFindings.length} total)</span>
          ) : null}
          <div className="ml-auto flex items-center gap-2">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as 'all' | ObjectSummary['type'])}
              className="text-[12px] h-8 px-2 rounded-md border border-border-default bg-surface-0 text-text-primary"
            >
              {typeOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'updated' | 'type')}
              className="text-[12px] h-8 px-2 rounded-md border border-border-default bg-surface-0 text-text-primary"
            >
              <option value="updated">Newest first</option>
              <option value="type">By type</option>
            </select>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-8">
          {isLoading ? (
            <Loading text="Loading findings…" />
          ) : filtered.length === 0 ? (
            <div className="border border-dashed border-border-default rounded-lg p-10 text-center">
              <p className="text-[13px] text-text-tertiary">
                {allFindings?.length === 0
                  ? 'No findings yet. Hermes will record them here as scouts run.'
                  : 'No findings match the current filter.'}
              </p>
            </div>
          ) : (
            <div className="max-w-4xl mx-auto space-y-2">
              {filtered.map((o) => (
                <FindingRowItem key={o.id} obj={o} />
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function FindingRowItem({ obj }: { obj: ObjectSummary }): React.JSX.Element {
  const body = (obj as { body?: { url?: string; kind?: string; stars?: number } }).body ?? {};
  const typeMeta = objectTypeMeta(obj.type);
  const Icon = typeMeta.icon;
  const url = body.url;
  const stars = body.stars;

  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div
          className={cn(
            'w-7 h-7 shrink-0 rounded-full flex items-center justify-center',
            typeMeta.tone === 'emerald' && 'bg-emerald-100 text-emerald-700',
            typeMeta.tone === 'sky' && 'bg-sky-100 text-sky-700',
            typeMeta.tone === 'purple' && 'bg-purple-100 text-purple-700',
            typeMeta.tone === 'amber' && 'bg-amber-100 text-amber-700',
            typeMeta.tone === 'rose' && 'bg-rose-100 text-rose-700',
            typeMeta.tone === 'slate' && 'bg-slate-100 text-slate-700',
          )}
        >
          <Icon className="w-3.5 h-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Link
              to={`/objects/${obj.id}`}
              className="text-[14px] font-medium text-text-primary hover:underline truncate"
            >
              {obj.title}
            </Link>
            <span
              className={cn(
                'text-[10px] px-1.5 py-0.5 rounded-full font-medium',
                typeMeta.tone === 'emerald' && 'bg-emerald-100 text-emerald-700',
                typeMeta.tone === 'sky' && 'bg-sky-100 text-sky-700',
                typeMeta.tone === 'purple' && 'bg-purple-100 text-purple-700',
                typeMeta.tone === 'amber' && 'bg-amber-100 text-amber-700',
                typeMeta.tone === 'rose' && 'bg-rose-100 text-rose-700',
                typeMeta.tone === 'slate' && 'bg-slate-100 text-slate-700',
              )}
            >
              {typeMeta.label}
            </span>
          </div>
          {obj.summary ? (
            <div className="text-[12px] text-text-tertiary mt-1 line-clamp-2">{obj.summary}</div>
          ) : null}
          <div className="flex items-center gap-3 mt-1.5">
            {url ? (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-accent-text hover:underline inline-flex items-center gap-1"
              >
                <ExternalLink className="w-3 h-3" />
                {url.length > 50 ? `${url.slice(0, 47)}…` : url}
              </a>
            ) : null}
            {stars != null ? (
              <span className="text-[11px] text-text-quaternary inline-flex items-center gap-1">
                <Star className="w-3 h-3" /> {stars.toLocaleString()}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </Card>
  );
}
