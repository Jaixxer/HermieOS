/**
 * Knowledge Graph visualization using SVG + a simple force-directed layout.
 *
 * No external layout library — the simulation runs in a requestAnimationFrame
 * loop. Nodes repel each other, links attract, and a center-force keeps the
 * graph from drifting. The simulation stabilises after ~100 iterations.
 *
 * Clicking a node navigates to the object detail page.
 * Hovering highlights the node's connections.
 */
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api, type ObjectSummary } from '../api';

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

const COLORS: Record<string, string> = {
  project: '#3b82f6',
  research: '#8b5cf6',
  discovery: '#f59e0b',
  decision: '#ef4444',
  opportunity: '#10b981',
  learning_path: '#06b6d4',
  note: '#6b7280',
  collection: '#f97316',
};

const RADIUS_BY_PRIORITY = [6, 8, 10, 12, 14, 16];

function nodeRadius(priority: number): number {
  const idx = Math.min(Math.max(priority + 2, 0), RADIUS_BY_PRIORITY.length - 1);
  return RADIUS_BY_PRIORITY[idx] ?? 8;
}

// ---------------------------------------------------------------------------
// Force simulation
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
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let dist = Math.sqrt(dx * dx + dy * dy) || 1;
        if (dist > 500) continue; // skip far-away nodes
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

  // Compute layout when data arrives
  const layout = React.useMemo(() => {
    if (!data || data.nodes.length === 0) return null;

    const nodeMap = new Map<string, GraphNode>();
    const nodes: GraphNode[] = data.nodes.map((n) => {
      const node = {
        ...n,
        x: (Math.random() - 0.5) * 400,
        y: (Math.random() - 0.5) * 400,
        vx: 0,
        vy: 0,
      };
      nodeMap.set(n.id, node);
      return node;
    });

    const links: GraphLink[] = data.links.map((l) => ({
      source: nodeMap.get(l.source) ?? nodes[0]!,
      target: nodeMap.get(l.target) ?? nodes[0]!,
      kind: l.kind,
      confidence: l.confidence,
      reason: l.reason,
    })).filter((l) => l.source && l.target);

    simulate(nodes, links);

    // Compute bounding box and center
    const pad = 60;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      if (n.x < minX) minX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.x > maxX) maxX = n.x;
      if (n.y > maxY) maxY = n.y;
    }
    const width = Math.max(maxX - minX + pad * 2, 600);
    const height = Math.max(maxY - minY + pad * 2, 400);
    for (const n of nodes) {
      n.x = n.x - minX + pad;
      n.y = n.y - minY + pad;
    }

    return { nodes, links, width, height, nodeMap };
  }, [data]);

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
  if (!layout) return <></>;

  const hoveredLinks = hoveredId
    ? layout.links.filter((l) => l.source.id === hoveredId || l.target.id === hoveredId)
    : [];

  return (
    <div className="relative" style={{ overflow: 'hidden' }}>
      <svg
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        className="w-full border border-slate-800 rounded-lg bg-slate-950"
        style={{ minHeight: 500 }}
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
          return (
            <g
              key={n.id}
              transform={`translate(${n.x},${n.y})`}
              className="cursor-pointer"
              onClick={() => navigate(`/objects/${n.id}`)}
              onMouseEnter={() => { setHovered(n.id); }}
              onMouseLeave={() => { setHovered(null); }}
            >
              <circle
                r={isHovered ? r + 2 : r}
                fill={COLORS[n.type] ?? '#6b7280'}
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

      {/* Legend */}
      <div className="absolute bottom-3 right-3 flex flex-wrap gap-2 bg-slate-900/80 p-2 rounded-md border border-slate-700 text-[11px]">
        {Object.entries(COLORS).map(([type, color]) => (
          <span key={type} className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
            {type}
          </span>
        ))}
      </div>
    </div>
  );
}
