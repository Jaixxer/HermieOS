import { randomUUID } from 'node:crypto';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { schema, type Database } from '@hermieos/db';
import { getDb } from './db.js';

// --- Object types (return shapes) ---

export interface ObjectRow {
  id: string;
  userId: string;
  type: schema.ObjectRow['type'];
  title: string;
  summary: string | null;
  body: Record<string, unknown>;
  status: schema.ObjectRow['status'];
  priority: number;
  tags: string[];
  createdBy: schema.ObjectRow['createdBy'];
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  revision: number;
}

export interface ObjectRevision {
  id: string;
  objectId: string;
  revision: number;
  body: Record<string, unknown>;
  summary: string | null;
  title: string;
  status: schema.ObjectRevision['status'];
  actor: schema.ObjectRevision['actor'];
  hermesRunId: string | null;
  reason: string | null;
  createdAt: Date;
}

// --- Helpers ---

function actorFromSource(source: string): 'user' | 'hermes' | 'system' {
  if (source === 'user') return 'user';
  if (source === 'system') return 'system';
  return 'hermes';
}

function rowToObject(row: schema.ObjectRow, revision: number): ObjectRow {
  return {
    id: row.id,
    userId: row.userId,
    type: row.type,
    title: row.title,
    summary: row.summary,
    body: (row.body ?? {}) as Record<string, unknown>,
    status: row.status,
    priority: row.priority,
    tags: row.tags ?? [],
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt,
    revision,
  };
}

// --- Public API ---

export interface CreateObjectInput {
  type: schema.ObjectRow['type'];
  title: string;
  summary?: string;
  body?: Record<string, unknown>;
  status?: schema.ObjectRow['status'];
  tags?: string[];
  source: string;
  hermesRunId?: string;
}

export async function createObject(userId: string, input: CreateObjectInput): Promise<ObjectRow> {
  const db = getDb();
  const id = randomUUID();
  const body = input.body ?? {};
  const tags = input.tags ?? [];
  const status = input.status ?? 'active';
  const actor = actorFromSource(input.source);

  return await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.objects)
      .values({
        id,
        userId,
        type: input.type,
        title: input.title,
        summary: input.summary ?? null,
        body,
        status,
        tags,
        createdBy: actor,
      })
      .returning();
    if (!row) throw new Error('create_object: no row returned');

    await tx.insert(schema.objectRevisions).values({
      objectId: id,
      userId,
      revision: 1,
      body,
      summary: input.summary ?? null,
      title: input.title,
      status,
      actor,
      hermesRunId: input.hermesRunId ?? null,
      reason: null,
    });

    await tx.insert(schema.objectEvents).values({
      objectId: id,
      userId,
      kind: 'created',
      actor,
      payload: { source: input.source },
    });

    await tx.insert(schema.feedEvents).values({
      userId,
      kind: 'object_created',
      objectId: id,
      title: input.title,
      body: input.summary ?? null,
      payload: { type: input.type, source: input.source },
    });

    return rowToObject(row, 1);
  });
}

export interface UpdateObjectInput {
  id: string;
  title?: string;
  summary?: string;
  body?: Record<string, unknown>;
  status?: schema.ObjectRow['status'];
  tags?: string[];
  reason?: string;
  appendNote?: string;
  source: string;
  hermesRunId?: string;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a === 'object') {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

export interface UpdateObjectResult {
  object: ObjectRow;
  revisionCreated: number;
}

export async function updateObject(
  userId: string,
  input: UpdateObjectInput,
): Promise<UpdateObjectResult> {
  const db = getDb();
  const actor = actorFromSource(input.source);

  return await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(schema.objects)
      .where(and(eq(schema.objects.id, input.id), eq(schema.objects.userId, userId)))
      .limit(1);
    if (!current) throw new Error('object not found');
    if (current.archivedAt) throw new Error('object is archived');

    // Determine which fields actually changed.
    const nextTitle = input.title ?? current.title;
    const nextSummary = input.summary === undefined ? current.summary : input.summary;
    const nextBody =
      input.appendNote !== undefined
        ? appendNoteToBody(current.body as Record<string, unknown>, input.appendNote)
        : input.body ?? (current.body as Record<string, unknown>);
    const nextStatus = input.status ?? current.status;
    const nextTags = input.tags ?? current.tags;

    const contentChanged =
      nextTitle !== current.title ||
      nextSummary !== current.summary ||
      !deepEqual(nextBody, current.body) ||
      nextStatus !== current.status ||
      !deepEqual(nextTags, current.tags);

    const [updated] = await tx
      .update(schema.objects)
      .set({
        title: nextTitle,
        summary: nextSummary,
        body: nextBody,
        status: nextStatus,
        tags: nextTags,
        updatedAt: new Date(),
      })
      .where(eq(schema.objects.id, input.id))
      .returning();
    if (!updated) throw new Error('update failed');

    let nextRevisionNumber = 1;
    let revisionCreated = 0;
    if (contentChanged) {
      const [latest] = await tx
        .select({ revision: schema.objectRevisions.revision })
        .from(schema.objectRevisions)
        .where(eq(schema.objectRevisions.objectId, input.id))
        .orderBy(desc(schema.objectRevisions.revision))
        .limit(1);
      nextRevisionNumber = (latest?.revision ?? 0) + 1;
      await tx.insert(schema.objectRevisions).values({
        objectId: input.id,
        userId,
        revision: nextRevisionNumber,
        body: nextBody,
        summary: nextSummary,
        title: nextTitle,
        status: nextStatus,
        actor,
        hermesRunId: input.hermesRunId ?? null,
        reason: input.reason ?? null,
      });
      revisionCreated = nextRevisionNumber;

      // Emit a single updated event. Note events are emitted separately below
      // when an appendNote is involved.
      await tx.insert(schema.objectEvents).values({
        objectId: input.id,
        userId,
        kind: 'updated',
        actor,
        payload: {
          source: input.source,
          revision: nextRevisionNumber,
          reason: input.reason ?? null,
        },
      });
    }

    if (input.appendNote !== undefined) {
      await tx.insert(schema.objectEvents).values({
        objectId: input.id,
        userId,
        kind: 'note_added',
        actor,
        payload: { text: input.appendNote, source: input.source },
      });
    }

    return { object: rowToObject(updated, nextRevisionNumber), revisionCreated };
  });
}

function appendNoteToBody(
  body: Record<string, unknown>,
  note: string,
): Record<string, unknown> {
  const notes = Array.isArray(body.notes) ? (body.notes as unknown[]) : [];
  return { ...body, notes: [...notes, { text: note, at: new Date().toISOString() }] };
}

export interface ArchiveObjectInput {
  id: string;
  reason?: string;
  source: string;
  hermesRunId?: string;
}

export async function archiveObject(userId: string, input: ArchiveObjectInput): Promise<ObjectRow> {
  const db = getDb();
  const actor = actorFromSource(input.source);

  return await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(schema.objects)
      .where(and(eq(schema.objects.id, input.id), eq(schema.objects.userId, userId)))
      .limit(1);
    if (!current) throw new Error('object not found');
    if (current.archivedAt) return rowToObject(current, await latestRevisionNumber(tx, input.id));

    const [updated] = await tx
      .update(schema.objects)
      .set({ archivedAt: new Date(), updatedAt: new Date(), status: 'archived' })
      .where(eq(schema.objects.id, input.id))
      .returning();
    if (!updated) throw new Error('archive failed');

    await tx.insert(schema.objectEvents).values({
      objectId: input.id,
      userId,
      kind: 'archived',
      actor,
      payload: { source: input.source, reason: input.reason ?? null },
    });

    return rowToObject(updated, await latestRevisionNumber(tx, input.id));
  });
}

async function latestRevisionNumber(
  db: Pick<Database, 'select'>,
  objectId: string,
): Promise<number> {
  const [latest] = await db
    .select({ revision: schema.objectRevisions.revision })
    .from(schema.objectRevisions)
    .where(eq(schema.objectRevisions.objectId, objectId))
    .orderBy(desc(schema.objectRevisions.revision))
    .limit(1);
  return latest?.revision ?? 1;
}

export async function getObject(userId: string, id: string): Promise<ObjectRow | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.objects)
    .where(and(eq(schema.objects.id, id), eq(schema.objects.userId, userId)))
    .limit(1);
  if (!row) return null;
  const rev = await latestRevisionNumber(db, id);
  return rowToObject(row, rev);
}

export interface ListObjectsInput {
  type?: schema.ObjectRow['type'];
  status?: schema.ObjectRow['status'];
  tag?: string;
  limit: number;
  cursor?: string;
  includeArchived?: boolean;
}

export async function listObjects(
  userId: string,
  input: ListObjectsInput,
): Promise<{ objects: ObjectRow[]; nextCursor: string | null }> {
  const db = getDb();
  const conditions = [eq(schema.objects.userId, userId)];
  if (input.type) conditions.push(eq(schema.objects.type, input.type));
  if (input.status) conditions.push(eq(schema.objects.status, input.status));
  if (!input.includeArchived) conditions.push(isNull(schema.objects.archivedAt));
  if (input.tag) conditions.push(sql`${schema.objects.tags} @> ARRAY[${input.tag}]::text[]`);

  let cursorTs: Date | null = null;
  if (input.cursor) {
    const decoded = Buffer.from(input.cursor, 'base64url').toString('utf8');
    const parsed = new Date(decoded);
    if (Number.isNaN(parsed.getTime())) throw new Error('invalid cursor');
    cursorTs = parsed;
    conditions.push(sql`${schema.objects.updatedAt} < ${cursorTs.toISOString()}`);
  }

  const rows = await db
    .select()
    .from(schema.objects)
    .where(and(...conditions))
    .orderBy(desc(schema.objects.updatedAt))
    .limit(input.limit + 1);

  const sliced = rows.slice(0, input.limit);
  const last = sliced[sliced.length - 1];
  const nextCursor = rows.length > input.limit && last ? Buffer.from(last.updatedAt.toISOString()).toString('base64url') : null;

  // Fetch revisions for each (small N in MVP).
  const out: ObjectRow[] = [];
  for (const r of sliced) {
    const rev = await latestRevisionNumber(db, r.id);
    out.push(rowToObject(r, rev));
  }
  return { objects: out, nextCursor };
}

export interface SearchObjectsInput {
  query: string;
  type?: schema.ObjectRow['type'];
  limit: number;
}

export interface SearchHit extends ObjectRow {
  rank: number;
  snippet: string;
}

export async function searchObjects(
  userId: string,
  input: SearchObjectsInput,
): Promise<SearchHit[]> {
  const db = getDb();
  // websearch_to_tsquery is friendly to natural-language queries.
  // Rank is from ts_rank_cd. Snippet is a short highlight from the title/summary.
  const conditions = [eq(schema.objects.userId, userId), isNull(schema.objects.archivedAt)];
  if (input.type) conditions.push(eq(schema.objects.type, input.type));

  const tsq = sql`websearch_to_tsquery('english', ${input.query})`;
  conditions.push(sql`search_vector @@ ${tsq}`);

  const rows = await db.execute<{
    id: string;
    user_id: string;
    type: schema.ObjectRow['type'];
    title: string;
    summary: string | null;
    body: Record<string, unknown>;
    status: schema.ObjectRow['status'];
    priority: number;
    tags: string[];
    created_by: schema.ObjectRow['createdBy'];
    created_at: Date;
    updated_at: Date;
    archived_at: Date | null;
    rank: number;
    snippet: string;
  }>(sql`
    SELECT
      id, user_id, type, title, summary, body, status, priority, tags,
      created_by, created_at, updated_at, archived_at,
      ts_rank_cd(search_vector, ${tsq}) AS rank,
      coalesce(
        ts_headline(
          'english',
          coalesce(title, '') || ' ' || coalesce(summary, ''),
          ${tsq},
          'StartSel=<mark>, StopSel=</mark>, MaxFragments=1, MaxWords=20, MinWords=5'
        ),
        ''
      ) AS snippet
    FROM objects
    WHERE ${and(...conditions)}
    ORDER BY rank DESC, updated_at DESC
    LIMIT ${input.limit}
  `);

  // postgres.js returns rows as an array directly.
  const list = (Array.isArray(rows) ? rows : []) as Array<{
    id: string;
    user_id: string;
    type: schema.ObjectRow['type'];
    title: string;
    summary: string | null;
    body: Record<string, unknown>;
    status: schema.ObjectRow['status'];
    priority: number;
    tags: string[];
    created_by: schema.ObjectRow['createdBy'];
    created_at: Date;
    updated_at: Date;
    archived_at: Date | null;
    rank: number;
    snippet: string;
  }>;

  return list.map((r) => ({
    ...rowToObject(
      {
        id: r.id,
        userId: r.user_id,
        type: r.type,
        title: r.title,
        summary: r.summary,
        body: r.body,
        status: r.status,
        priority: r.priority,
        tags: r.tags,
        createdBy: r.created_by,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        archivedAt: r.archived_at,
      },
      1, // revision number not relevant for search hits
    ),
    rank: r.rank,
    snippet: r.snippet,
  }));
}

export async function getObjectRevision(
  userId: string,
  objectId: string,
  revision: number,
): Promise<ObjectRevision | null> {
  const db = getDb();
  // confirm ownership first
  const [owner] = await db
    .select({ id: schema.objects.id })
    .from(schema.objects)
    .where(and(eq(schema.objects.id, objectId), eq(schema.objects.userId, userId)))
    .limit(1);
  if (!owner) return null;
  const [r] = await db
    .select()
    .from(schema.objectRevisions)
    .where(
      and(
        eq(schema.objectRevisions.objectId, objectId),
        eq(schema.objectRevisions.revision, revision),
      ),
    )
    .limit(1);
  if (!r) return null;
  return {
    id: r.id,
    objectId: r.objectId,
    revision: r.revision,
    body: (r.body ?? {}) as Record<string, unknown>,
    summary: r.summary,
    title: r.title,
    status: r.status,
    actor: r.actor,
    hermesRunId: r.hermesRunId,
    reason: r.reason,
    createdAt: r.createdAt,
  };
}

export async function listObjectRevisions(
  userId: string,
  objectId: string,
  limit: number,
  cursor?: string,
): Promise<{ revisions: ObjectRevision[]; nextCursor: string | null }> {
  const db = getDb();
  const [owner] = await db
    .select({ id: schema.objects.id })
    .from(schema.objects)
    .where(and(eq(schema.objects.id, objectId), eq(schema.objects.userId, userId)))
    .limit(1);
  if (!owner) return { revisions: [], nextCursor: null };

  const conds = [eq(schema.objectRevisions.objectId, objectId)];
  if (cursor) {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = new Date(decoded);
    if (Number.isNaN(parsed.getTime())) throw new Error('invalid cursor');
    conds.push(sql`${schema.objectRevisions.createdAt} < ${parsed.toISOString()}`);
  }
  const rows = await db
    .select()
    .from(schema.objectRevisions)
    .where(and(...conds))
    .orderBy(desc(schema.objectRevisions.createdAt))
    .limit(limit + 1);

  const sliced = rows.slice(0, limit);
  const last = sliced[sliced.length - 1];
  const nextCursor =
    rows.length > limit && last ? Buffer.from(last.createdAt.toISOString()).toString('base64url') : null;

  return {
    revisions: sliced.map((r) => ({
      id: r.id,
      objectId: r.objectId,
      revision: r.revision,
      body: (r.body ?? {}) as Record<string, unknown>,
      summary: r.summary,
      title: r.title,
      status: r.status,
      actor: r.actor,
      hermesRunId: r.hermesRunId,
      reason: r.reason,
      createdAt: r.createdAt,
    })),
    nextCursor,
  };
}

export interface RevertObjectInput {
  id: string;
  revision: number;
  reason?: string;
  source: string;
  hermesRunId?: string;
}

export async function revertObject(
  userId: string,
  input: RevertObjectInput,
): Promise<ObjectRow> {
  const db = getDb();
  const actor = actorFromSource(input.source);
  return await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(schema.objects)
      .where(and(eq(schema.objects.id, input.id), eq(schema.objects.userId, userId)))
      .limit(1);
    if (!current) throw new Error('object not found');
    if (current.archivedAt) throw new Error('object is archived');

    const [target] = await tx
      .select()
      .from(schema.objectRevisions)
      .where(
        and(
          eq(schema.objectRevisions.objectId, input.id),
          eq(schema.objectRevisions.revision, input.revision),
        ),
      )
      .limit(1);
    if (!target) throw new Error('target revision not found');

    // Apply target content as a new update; create a new revision row.
    const [updated] = await tx
      .update(schema.objects)
      .set({
        title: target.title,
        summary: target.summary,
        body: target.body as Record<string, unknown>,
        status: target.status,
        updatedAt: new Date(),
      })
      .where(eq(schema.objects.id, input.id))
      .returning();
    if (!updated) throw new Error('revert failed');

    const nextRev = (await latestRevisionNumber(tx, input.id)) + 1;
    await tx.insert(schema.objectRevisions).values({
      objectId: input.id,
      userId,
      revision: nextRev,
      body: target.body as Record<string, unknown>,
      summary: target.summary,
      title: target.title,
      status: target.status,
      actor,
      hermesRunId: input.hermesRunId ?? null,
      reason: input.reason ?? `reverted to revision ${input.revision}`,
    });

    await tx.insert(schema.objectEvents).values({
      objectId: input.id,
      userId,
      kind: 'reverted_to_revision',
      actor,
      payload: {
        source: input.source,
        toRevision: input.revision,
        newRevision: nextRev,
        reason: input.reason ?? null,
      },
    });

    return rowToObject(updated, nextRev);
  });
}
