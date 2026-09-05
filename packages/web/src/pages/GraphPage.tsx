/**
 * Knowledge Graph visualization using SVG + a simple force-directed layout.
 *
 * Improvements over the original:
 *  - Type filter pills (show/hide node types)
 *  - Stats header (node/link counts, by type)
 *  - Zoom + pan (wheel, drag on background)
 *  - Link labels show kind + confidence + reason on hover
 *  - Type-based clustering (nodes of the same type start near each other)
 *  - Isolated-node toggle
 */
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { cn } from '../lib/utils';
import { Sheet } from '../components/ui/sheet';
import { isTouchDevice } from '../mobile';
import { Search, ZoomIn, ZoomOut, Maximize2, Network } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GraphNode {
  id: string;
  title: string;
  type: string;
  priority: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface GraphLink {
  source: GraphNode;
  target: GraphNode;
  kind: string;
  confidence: number;
  reason: string;
}

const TYPE_META: Record<string, { label: string; color: string }> = {
  project: { label: 'Projects', color: '#3b82f6' },
  research: { label: 'Research', color: '#8b5cf6' },
  discovery: { label: 'Discoveries', color: '#f59e0b' },
  decision: { label: 'Decisions', color: '#ef4444' },
  opportunity: { label: 'Opportunities', color: '#10b981' },
  learning_path: { label: 'Learning paths', color: '#06b6d4' },
  note: { label: 'Notes', color: '#6b7280' },
  collection: { label: 'Collections', color: '#f97316' },
};

function typeLabel(type: string): string {
  return TYPE_META[type]?.label ?? type;
}

function nodeColor(type: string): string {
  return TYPE_META[type]?.color ?? '#94a3b8';
}

const RADIUS_BY_PRIORITY = [6, 8, 10, 12, 14, 16];

function nodeRadius(priority: number): number {
  const idx = Math.min(Math.max(priority + 2, 0), RADIUS_BY_PRIORITY.length - 1);
  return RADIUS_BY_PRIORITY[idx] ?? 8;
}

const TYPE_ORDER = ['project', 'research', 'discovery', 'decision', 'opportunity', 'learning_path', 'note', 'collection'];

// ---------------------------------------------------------------------------
// Force simulation with type-based clustering seed
// ---------------------------------------------------------------------------

function simulate(nodes: GraphNode[], links: GraphLink[]): void {
  const iterations = 300;
  const alphaDecay = 0.02;
  let alpha = 1;

  for (let it = 0; it < iterations && alpha > 0.001; it++) {
    alpha *= 1 - alphaDecay;

    // Repulsion between all node pairs
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]!;
        const b = nodes[j]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        if (dist > 500) continue;
        const force = (alpha * 300) / (dist * dist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx -= fx;
        a.vy -= fy;
        b.vx += fx;
        b.vy += fy;
      }
    }

    // Attraction along links
    for (const link of links) {
      const s = link.source;
      const t = link.target;
      const dx = t.x - s.x;
      const dy = t.y - s.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = (dist - 80) * alpha * 0.01 * link.confidence;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      s.vx += fx;
      s.vy += fy;
      t.vx -= fx;
      t.vy -= fy;
    }

    // Center gravity
    for (const node of nodes) {
      const dx = -node.x;
      const dy = -node.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      node.vx += (dx / dist) * alpha * 0.05;
      node.vy += (dy / dist) * alpha * 0.05;
    }

    // Apply velocity with damping
    for (const node of nodes) {
      node.vx *= 0.6;
      node.vy *= 0.6;
      node.x += node.vx;
      node.y += node.vy;
    }
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GraphPage(): React.JSX.Element {
  const { data, isLoading, error } = useQuery({
    queryKey: ['graph'],
    queryFn: () => api.graph(),
    refetchOnWindowFocus: false,
  });

  const navigate = useNavigate();
  const [hoveredId, setHovered] = React.useState<string | null>(null);
  const [tooltip, setTooltip] = React.useState<{ x: number; y: number; node: GraphNode; links: GraphLink[] } | null>(null);
  const [hiddenTypes, setHiddenTypes] = React.useState<Set<string>>(new Set());
  const [hideIsolated, setHideIsolated] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [zoom, setZoom] = React.useState(1);
  const [pan, setPan] = React.useState({ x: 0, y: 0 });
  const dragRef = React.useRef<{ startX: number; startY: number; panX: number; panY: number; moved: boolean } | null>(null);
  const pinchRef = React.useRef<{ dist: number; zoom: number } | null>(null);
  const pointersRef = React.useRef(new Map<number, { x: number; y: number }>());
  const [selectedNode, setSelectedNode] = React.useState<GraphNode | null>(null);
  const isTouch = isTouchDevice();
  const svgWrapRef = React.useRef<HTMLDivElement>(null);

  const layout = React.useMemo(() => {
    if (!data || data.nodes.length === 0) return null;

    // Apply filters
    const ids = new Set(data.nodes.map((n) => n.id));
    const filteredNodes = data.nodes.filter((n) => {
      if (hiddenTypes.has(n.type)) { ids.delete(n.id); return false; }
      return true;
    });
    const connectedIds = new Set<string>();
    for (const l of data.links) {
      if (ids.has(l.source) && ids.has(l.target)) {
        connectedIds.add(l.source);
        connectedIds.add(l.target);
      }
    }
    const visibleNodes = filteredNodes.filter((n) => !hideIsolated || connectedIds.has(n.id));
    if (visibleNodes.length === 0) return null;

    const visibleIds = new Set(visibleNodes.map((n) => n.id));
    const visibleLinks = data.links.filter(
      (l) => visibleIds.has(l.source) && visibleIds.has(l.target),
    );

    const q = query.trim().toLowerCase();
    const matched = q ? new Set(visibleNodes.filter((n) => n.title.toLowerCase().includes(q)).map((n) => n.id)) : null;

    const nodeMap = new Map<string, GraphNode>();
    const typeIdx = new Map<string, number>();
    const nodes: GraphNode[] = visibleNodes.map((n) => {
      const cluster = TYPE_ORDER.indexOf(n.type);
      const idx = typeIdx.get(n.type) ?? 0;
      typeIdx.set(n.type, idx + 1);
      const angle = (idx / Math.max(visibleNodes.length, 1)) * Math.PI * 2 + cluster * 0.9;
      const r = 120 + cluster * 90;
      const node = {
        ...n,
        x: (Math.random() - 0.5) * 120 + Math.cos(angle) * r,
        y: (Math.random() - 0.5) * 120 + Math.sin(angle) * r,
        vx: 0,
        vy: 0,
      };
      nodeMap.set(n.id, node);
      return node;
    });

    const links: GraphLink[] = visibleLinks
      .map((l) => ({
        source: nodeMap.get(l.source)!,
        target: nodeMap.get(l.target)!,
        kind: l.kind,
        confidence: l.confidence,
        reason: l.reason,
      }))
      .filter((l) => l.source && l.target);

    simulate(nodes, links);

    // Bounding box + center
    const pad = 70;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      if (n.x < minX) minX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.x > maxX) maxX = n.x;
      if (n.y > maxY) maxY = n.y;
    }
    const width = Math.max(maxX - minX + pad * 2, 700);
    const height = Math.max(maxY - minY + pad * 2, 480);
    for (const n of nodes) {
      n.x = n.x - minX + pad;
      n.y = n.y - minY + pad;
    }

    return { nodes, links, width, height, nodeMap, matched, totalNodes: data.nodes.length };
  }, [data, hiddenTypes, hideIsolated, query]);

  const resetView = (): void => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const zoomAt = (factor: number): void => {
    setZoom((z) => Math.min(Math.max(z * factor, 0.3), 3));
  };

  if (isLoading) return <div className="p-8 text-center text-slate-400">Computing graph layout…</div>;
  if (error) return <div className="p-8 text-center text-red-400">Failed to load graph.</div>;
  if (!data || data.nodes.length === 0) {
    return (
      <div className="p-8 text-center text-slate-500">
        <p className="text-lg">No relationships yet.</p>
        <p className="mt-2 text-sm">
          Link objects together using the Hermes research agent or the object detail page.
        </p>
      </div>
    );
  }
  if (!layout) {
    return (
      <div className="p-8 text-center text-slate-500">
        <p className="text-lg">No visible nodes.</p>
        <p className="mt-2 text-sm">Adjust the type filters to show more of the graph.</p>
      </div>
    );
  }

  const typesPresent = TYPE_ORDER.filter((t) => data.nodes.some((n) => n.type === t));
  const typeCounts = new Map<string, number>();
  for (const n of data.nodes) typeCounts.set(n.type, (typeCounts.get(n.type) ?? 0) + 1);

  const hoveredLinks = hoveredId
    ? layout.links.filter((l) => l.source.id === hoveredId || l.target.id === hoveredId)
    : [];
  const linkLabel = tooltip
    ? tooltip.links.map((l) => ({
        kind: l.kind.replace(/_/g, ' '),
        conf: Math.round(l.confidence * 100),
        reason: l.reason,
      }))
    : [];

  const viewBox = `${-pan.x} ${-pan.y} ${layout.width / zoom} ${layout.height / zoom}`;

  return (
    <div className="flex-1 min-w-0 min-h-0 overflow-y-auto flex flex-col bg-page text-text-primary">
        {/* Header */}
        <div className="min-h-[52px] shrink-0 px-4 sm:px-6 py-2 sm:py-0 border-b border-border-default flex flex-wrap items-center gap-x-3 gap-y-2 bg-surface-0/95">
          <div className="w-8 h-8 rounded-lg bg-surface-2 flex items-center justify-center text-text-secondary">
            <Network className="w-4 h-4" />
          </div>
          <div>
            <h1 className="text-[14px] font-semibold">Knowledge Graph</h1>
            <p className="text-[11px] text-text-tertiary">
              {layout.totalNodes} nodes · {layout.links.length} links
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-text-quaternary" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter by title…"
                className="h-12 sm:h-8 w-full sm:w-48 pl-8 pr-2 rounded-lg border border-border-default bg-surface-0 text-[16px] sm:text-[12px] text-text-primary placeholder:text-text-quaternary focus:border-accent focus:outline-none"
              />
            </div>
            <button
              type="button"
              onClick={() => setHideIsolated((v) => !v)}
              className={cn(
                'h-8 px-3 rounded-lg text-[11px] font-medium border transition',
                hideIsolated
                  ? 'bg-accent text-accent-fg border-accent'
                  : 'bg-surface-0 text-text-secondary border-border-default hover:border-border-strong',
              )}
            >
              Hide isolated
            </button>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => zoomAt(1.2)} title="Zoom in" className="w-11 h-11 sm:w-7 sm:h-7 rounded-md hover:bg-surface-2 flex items-center justify-center text-text-secondary">
                <ZoomIn className="w-4 h-4" />
              </button>
              <button type="button" onClick={() => zoomAt(0.8)} title="Zoom out" className="w-11 h-11 sm:w-7 sm:h-7 rounded-md hover:bg-surface-2 flex items-center justify-center text-text-secondary">
                <ZoomOut className="w-4 h-4" />
              </button>
              <button type="button" onClick={resetView} title="Reset view" className="w-11 h-11 sm:w-7 sm:h-7 rounded-md hover:bg-surface-2 flex items-center justify-center text-text-secondary">
                <Maximize2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Type filter bar */}
        <div className="shrink-0 px-6 py-2 border-b border-border-default flex items-center gap-2 flex-wrap bg-surface-0/60">
          <span className="text-[11px] text-text-tertiary mr-1">Types:</span>
          {typesPresent.map((t) => {
            const hidden = hiddenTypes.has(t);
            return (
              <button
                key={t}
                type="button"
                onClick={() => {
                  const next = new Set(hiddenTypes);
                  if (hidden) next.delete(t);
                  else next.add(t);
                  setHiddenTypes(next);
                }}
                className={cn(
                  'flex items-center gap-1.5 px-2.5 py-1 min-h-[44px] sm:min-h-0 rounded-full text-[11px] font-medium border transition',
                  hidden
                    ? 'bg-surface-0 text-text-quaternary border-border-default opacity-50 line-through'
                    : 'bg-surface-0 text-text-secondary border-border-default hover:border-border-strong',
                )}
              >
                <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: nodeColor(t) }} />
                {typeLabel(t)} ({typeCounts.get(t) ?? 0})
              </button>
            );
          })}
        </div>

        {/* Graph canvas */}
        <div
          ref={svgWrapRef}
          className="flex-1 min-h-0 overflow-hidden relative bg-page"
          style={{ cursor: 'grab', touchAction: 'none' }}
          onWheel={(e) => {
            const factor = e.deltaY < 0 ? 1.1 : 0.9;
            setZoom((z) => Math.min(Math.max(z * factor, 0.3), 3));
          }}
          onPointerDown={(e) => {
            try { (e.target as Element).setPointerCapture?.(e.pointerId); } catch { /* noop */ }
            pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (pointersRef.current.size === 1) {
              dragRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y, moved: false };
              pinchRef.current = null;
            } else if (pointersRef.current.size === 2) {
              const [a, b] = [...pointersRef.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
              pinchRef.current = { dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), zoom };
              dragRef.current = null;
            }
          }}
          onPointerMove={(e) => {
            if (!pointersRef.current.has(e.pointerId)) return;
            pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
            const pinch = pinchRef.current;
            if (pinch && pointersRef.current.size >= 2) {
              const [a, b] = [...pointersRef.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
              const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
              setZoom(Math.min(Math.max((pinch.zoom * dist) / pinch.dist, 0.3), 3));
              return;
            }
            if (!dragRef.current) return;
            const dx = e.clientX - dragRef.current.startX;
            const dy = e.clientY - dragRef.current.startY;
            if (Math.abs(dx) + Math.abs(dy) > 4) dragRef.current.moved = true;
            setPan({ x: dragRef.current.panX - dx / zoom, y: dragRef.current.panY - dy / zoom });
          }}
          onPointerUp={(e) => {
            pointersRef.current.delete(e.pointerId);
            if (pointersRef.current.size < 2) pinchRef.current = null;
            if (pointersRef.current.size === 0) dragRef.current = null;
          }}
          onPointerCancel={(e) => {
            pointersRef.current.delete(e.pointerId);
            pinchRef.current = null;
            dragRef.current = null;
          }}
        >
          <svg
            viewBox={viewBox}
            className="w-full h-full"
            style={{ minHeight: 400 }}
            onMouseMove={(e) => {
              if (dragRef.current?.moved) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const x = pan.x + ((e.clientX - rect.left) / rect.width) * (layout.width / zoom);
              const y = pan.y + ((e.clientY - rect.top) / rect.height) * (layout.height / zoom);
              const hit = layout.nodes.find((n) => Math.abs(n.x - x) < 14 && Math.abs(n.y - y) < 14);
              if (hit) {
                setHovered(hit.id);
                setTooltip({ x, y, node: hit, links: layout.links.filter((l) => l.source.id === hit.id || l.target.id === hit.id) });
              } else {
                setHovered(null);
                setTooltip(null);
              }
            }}
            onMouseLeave={() => { setHovered(null); setTooltip(null); }}
          >
            <defs>
              {layout.links.map((l, i) => (
                <marker
                  key={`arrow-${i}`}
                  id={`arrow-${i}`}
                  viewBox="0 0 6 6"
                  refX={6}
                  refY={3}
                  markerWidth={4}
                  markerHeight={4}
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 6 3 L 0 6 z" fill={l.confidence > 0.7 ? '#94a3b8' : '#475569'} />
                </marker>
              ))}
            </defs>

            {/* Links */}
            {layout.links.map((l, i) => (
              <line
                key={`link-${i}`}
                x1={l.source.x}
                y1={l.source.y}
                x2={l.target.x}
                y2={l.target.y}
                stroke={hoveredId ? (hoveredLinks.includes(l) ? '#f1f5f9' : '#1e293b') : l.confidence > 0.7 ? '#475569' : '#1e293b'}
                strokeWidth={hoveredLinks.includes(l) ? 2.5 : Math.max(l.confidence * 2, 0.5)}
                strokeOpacity={hoveredId ? (hoveredLinks.includes(l) ? 1 : 0.1) : 0.6}
                markerEnd={hoveredLinks.includes(l) ? `url(#arrow-${i})` : undefined}
              />
            ))}

            {/* Link labels (visible on hover) */}
            {hoveredLinks.map((l, i) => {
              const mx = (l.source.x + l.target.x) / 2;
              const my = (l.source.y + l.target.y) / 2;
              return (
                <text
                  key={`link-label-${i}`}
                  x={mx}
                  y={my - 5}
                  textAnchor="middle"
                  className="text-[10px] fill-slate-300 pointer-events-none select-none"
                >
                  {l.kind.replace(/_/g, ' ')} ({Math.round(l.confidence * 100)}%)
                </text>
              );
            })}

            {/* Nodes */}
            {layout.nodes.map((n) => {
              const r = nodeRadius(n.priority);
              const isHovered = hoveredId === n.id;
              const isDimmed = hoveredId && !isHovered && !hoveredLinks.some((l) => l.source.id === n.id || l.target.id === n.id);
              const isMatched = layout.matched === null || layout.matched.has(n.id);
              return (
                <g
                  key={n.id}
                  transform={`translate(${n.x},${n.y})`}
                  className="cursor-pointer"
                  opacity={isMatched ? 1 : 0.12}
                  onClick={() => {
                    if (dragRef.current?.moved) return;
                    if (isTouch) { setSelectedNode(n); return; }
                    navigate(`/objects/${n.id}`);
                  }}
                >
                  <circle
                    r={isHovered ? r + 2 : r}
                    fill={nodeColor(n.type)}
                    opacity={isDimmed ? 0.2 : 1}
                    stroke={isHovered ? '#fff' : 'transparent'}
                    strokeWidth={2}
                  />
                  <text
                    y={r + 12}
                    textAnchor="middle"
                    className="text-[9px] fill-slate-400 pointer-events-none select-none"
                    opacity={isDimmed ? 0.2 : 1}
                  >
                    {n.title.length > 16 ? n.title.slice(0, 14) + '…' : n.title}
                  </text>
                </g>
              );
            })}
          </svg>

          {/* Tooltip */}
          {tooltip && linkLabel.length > 0 ? (
            <div
              className="absolute pointer-events-none bg-surface-0 border border-border-default rounded-lg shadow-xl px-3 py-2 text-[11px] max-w-[240px]"
              style={{
                left: Math.min(tooltip.x * zoom - pan.x * zoom, (svgWrapRef.current?.clientWidth ?? 400) - 250),
                top: Math.max(tooltip.y * zoom - pan.y * zoom + 14, 4),
              }}
            >
              <div className="font-semibold text-text-primary mb-1 truncate">{tooltip.node.title}</div>
              {linkLabel.map((l, i) => (
                <div key={i} className="text-text-tertiary leading-snug mt-0.5">
                  <span className="text-text-secondary font-medium">{l.kind}</span> · {l.conf}%{l.reason ? ` — ${l.reason}` : ''}
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {/* Legend */}
        <div className="shrink-0 px-6 py-2 border-t border-border-default flex items-center gap-4 bg-surface-0/80 text-[11px] text-text-tertiary flex-wrap">
          {typesPresent.map((t) => (
            <span key={t} className="flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: nodeColor(t) }} />
              {typeLabel(t)}
            </span>
          ))}
          <span className="ml-auto hidden sm:inline">Scroll to zoom · drag to pan · click a node to open</span>
          <span className="ml-auto sm:hidden">Pinch to zoom · drag to pan · tap a node</span>
        </div>
      <Sheet
        open={selectedNode !== null}
        onClose={() => setSelectedNode(null)}
        label="Graph node"
        footer={
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setSelectedNode(null)}
              className="flex-1 sm:flex-none px-4 py-2 min-h-[48px] sm:min-h-0 text-[11px] font-black tracking-[0.12em] text-p5-dark-muted"
            >
              CLOSE
            </button>
            <button
              type="button"
              onClick={() => { if (selectedNode) navigate(`/objects/${selectedNode.id}`); }}
              className="flex-1 sm:flex-none bg-accent px-4 py-2 min-h-[48px] sm:min-h-0 text-[11px] font-black tracking-[0.12em] text-white"
            >
              OPEN
            </button>
          </div>
        }
      >
        {selectedNode ? (
          <div className="p-5 sm:p-6">
            <div className="p5-kicker text-accent">{selectedNode.type}</div>
            <h2 className="mt-2 font-p5-serif text-[24px] leading-tight text-p5-dark">{selectedNode.title}</h2>
            <p className="mt-2 font-mono text-[11px] text-p5-dark-muted">
              {typeof selectedNode.priority === 'number' ? `PRIORITY ${selectedNode.priority}` : 'IN THE GRAPH'}
            </p>
          </div>
        ) : null}
      </Sheet>
    </div>
  );
}
