import { and, eq, sql, or, inArray } from 'drizzle-orm';
import { schema } from '@hermieos/db';
import { getDb } from './db.js';
import { getObject } from './objects.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RelationshipRow {
  id: string;
  userId: string;
  fromId: string;
  toId: string;
  kind: schema.ObjectRelationship['kind'];
  confidence: number;
  reason: string;
  source: string;
  createdAt: Date;
}

/** A relationship edge enriched with the neighbouring object's title + type.
 *  The `direction` field tells the caller whether the current object of
 *  interest is the source (`outbound`) or target (`inbound`) of the edge. */
export interface RelatedObject {
  /** The neighbouring object's id. */
  id: string;
  /** The neighbouring object's type. */
  type: string;
  /** The neighbouring object's title. */
  title: string;
  /** `outbound` = this object → neighbour, `inbound` = neighbour → this object. */
  direction: 'outbound' | 'inbound';
  kind: schema.ObjectRelationship['kind'];
  confidence: number;
  reason: string;
  createdAt: Date;
}

export interface RelatedObjectsInput {
  objectId: string;
  /** Optional filter: only return edges of this kind. */
  kind?: schema.ObjectRelationship['kind'];
  /** Optional filter: only return edges with confidence >= this threshold. */
  minConfidence?: number;
  /** Optional filter: return only inbound, outbound, or both (default). */
  direction?: 'inbound' | 'outbound' | 'both';
  limit: number;
}

export interface GraphNode {
  objectId: string;
  title: string;
  type: string;
  depth: number;
  /** The path of relationship edges from the start node to this node. */
  path: Array<{ kind: string; confidence: number; reason: string }>;
}

export interface TraverseGraphInput {
  startObjectId: string;
  maxDepth: number;
  /** Optional filter: only follow edges of these kinds. */
  kinds?: Array<schema.ObjectRelationship['kind']>;
  /** Optional filter: only follow edges with confidence >= this threshold. */
  minConfidence?: number;
  limit: number;
}

export interface TraverseGraphResult {
  startNode: { objectId: string; title: string; type: string };
  nodes: GraphNode[];
  edgeCount: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function assertObjectOwned(
  userId: string,
  objectId: string,
): Promise<void> {
  const obj = await getObject(userId, objectId);
  if (!obj) throw new Error('object not found');
}

function rowToRelationship(row: schema.ObjectRelationship): RelationshipRow {
  return {
    id: row.id,
    userId: row.userId,
    fromId: row.fromId,
    toId: row.toId,
    kind: row.kind,
    confidence: row.confidence,
    reason: row.reason,
    source: row.source,
    createdAt: row.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Write operations
// ---------------------------------------------------------------------------

export async function linkObjects(
  userId: string,
  fromId: string,
  toId: string,
  kind: schema.ObjectRelationship['kind'],
  confidence: number,
  reason: string,
  source: string,
): Promise<RelationshipRow> {
  if (fromId === toId) throw new Error('cannot link an object to itself');
  if (confidence < 0 || confidence > 1) throw new Error('confidence must be in [0, 1]');
  await assertObjectOwned(userId, fromId);
  await assertObjectOwned(userId, toId);
  const db = getDb();
  // upsert by (from_id, to_id, kind)
  const existing = await db
    .select()
    .from(schema.objectRelationships)
    .where(
      and(
        eq(schema.objectRelationships.userId, userId),
        eq(schema.objectRelationships.fromId, fromId),
        eq(schema.objectRelationships.toId, toId),
        eq(schema.objectRelationships.kind, kind),
      ),
    )
    .limit(1);
  if (existing[0]) {
    const [row] = await db
      .update(schema.objectRelationships)
      .set({ confidence, reason, source })
      .where(eq(schema.objectRelationships.id, existing[0].id))
      .returning();
    if (!row) throw new Error('update failed');
    return rowToRelationship(row);
  }
  const [row] = await db
    .insert(schema.objectRelationships)
    .values({ userId, fromId, toId, kind, confidence, reason, source })
    .returning();
  if (!row) throw new Error('insert failed');
  return rowToRelationship(row);
}

export async function unlinkObjects(
  userId: string,
  fromId: string,
  toId: string,
  kind: schema.ObjectRelationship['kind'],
): Promise<{ ok: true }> {
  const db = getDb();
  await db
    .delete(schema.objectRelationships)
    .where(
      and(
        eq(schema.objectRelationships.userId, userId),
        eq(schema.objectRelationships.fromId, fromId),
        eq(schema.objectRelationships.toId, toId),
        eq(schema.objectRelationships.kind, kind),
      ),
    );
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Read operations — 1-hop neighbours
// ---------------------------------------------------------------------------

/**
 * Returns the objects directly connected to `objectId` via relationship
 * edges. Considers both directions:
 *   - outbound: this object is the `fromId` — it *links to* the neighbour
 *   - inbound:  this object is the `toId`   — the neighbour *links to* it
 *
 * Filters by kind, minimum confidence, and direction are applied before
 * the join to the objects table so the query is efficient.
 */
export async function getRelatedObjects(
  userId: string,
  input: RelatedObjectsInput,
): Promise<RelatedObject[]> {
  const db = getDb();
  const { objectId, kind, minConfidence, direction, limit } = input;
  const rows: RelatedObject[] = [];

  // --- Outbound edges: FROM this object TO neighbour ---
  if (!direction || direction === 'outbound' || direction === 'both') {
    const conditions = [
      eq(schema.objectRelationships.userId, userId),
      eq(schema.objectRelationships.fromId, objectId),
    ];
    if (kind) conditions.push(eq(schema.objectRelationships.kind, kind));
    if (minConfidence !== undefined) {
      conditions.push(sql`${schema.objectRelationships.confidence} >= ${minConfidence}`);
    }

    const outRows = await db
      .select({
        id: schema.objects.id,
        type: schema.objects.type,
        title: schema.objects.title,
        kind: schema.objectRelationships.kind,
        confidence: schema.objectRelationships.confidence,
        reason: schema.objectRelationships.reason,
        createdAt: schema.objectRelationships.createdAt,
      })
      .from(schema.objectRelationships)
      .innerJoin(schema.objects, eq(schema.objectRelationships.toId, schema.objects.id))
      .where(and(...conditions))
      .orderBy(sql`${schema.objectRelationships.confidence} DESC`)
      .limit(limit - rows.length);

    for (const r of outRows) {
      rows.push({
        id: r.id,
        type: r.type,
        title: r.title,
        direction: 'outbound',
        kind: r.kind,
        confidence: r.confidence,
        reason: r.reason,
        createdAt: r.createdAt,
      });
    }
  }

  // --- Inbound edges: FROM neighbour TO this object ---
  if (rows.length < limit && (!direction || direction === 'inbound' || direction === 'both')) {
    const conditions = [
      eq(schema.objectRelationships.userId, userId),
      eq(schema.objectRelationships.toId, objectId),
    ];
    if (kind) conditions.push(eq(schema.objectRelationships.kind, kind));
    if (minConfidence !== undefined) {
      conditions.push(sql`${schema.objectRelationships.confidence} >= ${minConfidence}`);
    }

    const inRows = await db
      .select({
        id: schema.objects.id,
        type: schema.objects.type,
        title: schema.objects.title,
        kind: schema.objectRelationships.kind,
        confidence: schema.objectRelationships.confidence,
        reason: schema.objectRelationships.reason,
        createdAt: schema.objectRelationships.createdAt,
      })
      .from(schema.objectRelationships)
      .innerJoin(schema.objects, eq(schema.objectRelationships.fromId, schema.objects.id))
      .where(and(...conditions))
      .orderBy(sql`${schema.objectRelationships.confidence} DESC`)
      .limit(limit - rows.length);

    for (const r of inRows) {
      rows.push({
        id: r.id,
        type: r.type,
        title: r.title,
        direction: 'inbound',
        kind: r.kind,
        confidence: r.confidence,
        reason: r.reason,
        createdAt: r.createdAt,
      });
    }
  }

  return rows.slice(0, limit);
}

/**
 * Lightweight version of getRelatedObjects that returns a summary suitable
 * for embedding in an Object detail response. Returns only id, type, title,
 * reason, and confidence — no direction or kind.
 */
export async function getRelatedObjectsSummary(
  userId: string,
  objectId: string,
  limit = 20,
): Promise<Array<{ id: string; type: string; title: string; reason: string | null; confidence: number }>> {
  const rows = await getRelatedObjects(userId, { objectId, limit });
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    title: r.title,
    reason: r.reason,
    confidence: r.confidence,
  }));
}

// ---------------------------------------------------------------------------
// Graph traversal — BFS N-hops, cycle-safe
// ---------------------------------------------------------------------------

/**
 * Breadth-first traversal of the relationship graph starting from
 * `startObjectId`. Builds a visited set to prevent cycles and respects
 * the max depth, kind filter, and minimum confidence threshold.
 *
 * Complexity: O(V + E) where V = nodes visited and E = edges traversed.
 * In practice bounded by maxDepth × limit.
 */
export async function traverseGraph(
  userId: string,
  input: TraverseGraphInput,
): Promise<TraverseGraphResult> {
  const { startObjectId, maxDepth, kinds, minConfidence, limit } = input;

  const startObj = await getObject(userId, startObjectId);
  if (!startObj) throw new Error('start object not found');

  const visited = new Set<string>([startObjectId]);
  const nodes: GraphNode[] = [];
  let edgeCount = 0;

  // BFS queue: items to explore at the current depth
  let frontier: GraphNode[] = [
    {
      objectId: startObjectId,
      title: startObj.title,
      type: startObj.type,
      depth: 0,
      path: [],
    },
  ];

  for (let depth = 1; depth <= maxDepth && nodes.length < limit; depth++) {
    if (frontier.length === 0) break;

    const nextFrontier: GraphNode[] = [];

    for (const parent of frontier) {
      if (nodes.length >= limit) break;

      // Fetch 1-hop neighbours for this parent node
      const neighbours = await getRelatedObjects(userId, {
        objectId: parent.objectId,
        ...(kinds !== undefined ? { kind: undefined /* we filter below */ } : {}),
        minConfidence,
        limit: limit - nodes.length,
      });

      for (const n of neighbours) {
        if (nodes.length >= limit) break;

        // Apply kind filter (getRelatedObjects only filters by single kind)
        if (kinds !== undefined && !kinds.includes(n.kind)) continue;

        if (visited.has(n.id)) continue;
        visited.add(n.id);
        edgeCount++;

        const node: GraphNode = {
          objectId: n.id,
          title: n.title,
          type: n.type,
          depth,
          path: [
            ...parent.path,
            {
              kind: n.kind,
              confidence: n.confidence,
              reason: n.reason,
            },
          ],
        };
        nodes.push(node);
        nextFrontier.push(node);
      }
    }

    frontier = nextFrontier;
  }

  return {
    startNode: { objectId: startObjectId, title: startObj.title, type: startObj.type },
    nodes,
    edgeCount,
  };
}
