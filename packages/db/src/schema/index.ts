import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

export const objectTypeEnum = pgEnum('object_type', [
  'project',
  'research',
  'discovery',
  'decision',
  'opportunity',
  'learning_path',
  'note',
  'collection',
]);

export const objectStatusEnum = pgEnum('object_status', [
  'active',
  'in_progress',
  'completed',
  'open',
  'resolved',
  'archived',
]);

export const relationshipKindEnum = pgEnum('relationship_kind', [
  'related_to',
  'derived_from',
  'blocks',
  'cites',
  'part_of',
]);

export const feedbackKindEnum = pgEnum('feedback_kind', [
  'like',
  'save',
  'ignore',
  'archive',
  'suggest',
]);

export const actorEnum = pgEnum('actor', ['user', 'hermes', 'system']);

export const runKindEnum = pgEnum('run_kind', [
  'subscription',
  'feedback_review',
  'ad_hoc',
  'system_notify',
]);

export const runStatusEnum = pgEnum('run_status', [
  'dispatched',
  'running',
  'succeeded',
  'failed',
  'cancelled',
]);

export const subscriptionStatusEnum = pgEnum('subscription_status', [
  'active',
  'paused',
  'archived',
]);

export const notificationPriorityEnum = pgEnum('notification_priority', [
  'low',
  'normal',
  'high',
]);

export const feedEventKindEnum = pgEnum('feed_event_kind', [
  'research_completed',
  'opportunity_discovered',
  'recommendation_changed',
  'project_updated',
  'decision_requested',
  'subscription_update',
  'task_finished',
  'notification',
  'object_created',
  'object_archived',
  'decision_resolved',
  'priority_changed',
]);

export const objectEventKindEnum = pgEnum('object_event_kind', [
  'created',
  'updated',
  'completed',
  'decision_added',
  'decision_resolved',
  'discovery_linked',
  'archived',
  'restarted',
  'note_added',
  'priority_changed',
  'reverted_to_revision',
]);

// --- users ---

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    displayName: text('display_name').notNull(),
    mcpToken: text('mcp_token').notNull(),
    schedulerEnabled: boolean('scheduler_enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [
    unique('users_email_unique').on(t.email),
    unique('users_mcp_token_unique').on(t.mcpToken),
    index('users_archived_at_idx').on(t.archivedAt),
  ],
);

// --- sessions (auth) ---

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull(),
    userAgent: text('user_agent'),
    ip: text('ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    unique('sessions_token_unique').on(t.token),
    index('sessions_user_id_idx').on(t.userId),
    index('sessions_expires_at_idx').on(t.expiresAt),
  ],
);

// --- objects ---

export const objects = pgTable(
  'objects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: objectTypeEnum('type').notNull(),
    title: text('title').notNull(),
    summary: text('summary'),
    body: jsonb('body').$type<Record<string, unknown>>().notNull().default({}),
    status: objectStatusEnum('status').notNull().default('active'),
    priority: integer('priority').notNull().default(0),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    createdBy: actorEnum('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    // search_vector is a PostgreSQL GENERATED ALWAYS AS STORED column
    // added by drizzle/0001_add_object_search_vector.sql. It is NOT
    // declared as a Drizzle column because Drizzle does not support
    // generated columns. The searchObjects() function queries it via
    // raw SQL (db.execute).
  },
  (t) => [
    index('objects_user_type_status_updated_idx').on(
      t.userId,
      t.type,
      t.status,
      t.updatedAt,
    ),
    index('objects_user_archived_idx').on(t.userId, t.archivedAt),
  ],
);

// --- object_revisions ---

export const objectRevisions = pgTable(
  'object_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    objectId: uuid('object_id')
      .notNull()
      .references(() => objects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),
    body: jsonb('body').$type<Record<string, unknown>>().notNull(),
    summary: text('summary'),
    title: text('title').notNull(),
    status: objectStatusEnum('status').notNull(),
    actor: actorEnum('actor').notNull(),
    hermesRunId: uuid('hermes_run_id'),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('object_revisions_object_revision_unique').on(t.objectId, t.revision),
    index('object_revisions_object_id_idx').on(t.objectId, t.createdAt),
  ],
);

// --- object_events ---

export const objectEvents = pgTable(
  'object_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    objectId: uuid('object_id')
      .notNull()
      .references(() => objects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: objectEventKindEnum('kind').notNull(),
    actor: actorEnum('actor').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('object_events_object_id_created_idx').on(t.objectId, t.createdAt),
    index('object_events_user_id_created_idx').on(t.userId, t.createdAt),
  ],
);

// --- object_relationships ---

export const objectRelationships = pgTable(
  'object_relationships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    fromId: uuid('from_id')
      .notNull()
      .references(() => objects.id, { onDelete: 'cascade' }),
    toId: uuid('to_id')
      .notNull()
      .references(() => objects.id, { onDelete: 'cascade' }),
    kind: relationshipKindEnum('kind').notNull(),
    confidence: real('confidence').notNull(),
    reason: text('reason').notNull(),
    source: text('source').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('object_relationships_unique').on(t.fromId, t.toId, t.kind),
    index('object_relationships_from_idx').on(t.fromId),
    index('object_relationships_to_idx').on(t.toId),
  ],
);

// --- feed_events ---

export const feedEvents = pgTable(
  'feed_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: feedEventKindEnum('kind').notNull(),
    objectId: uuid('object_id').references(() => objects.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    body: text('body'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('feed_events_user_created_idx').on(t.userId, t.createdAt),
    index('feed_events_user_unread_idx').on(t.userId, t.readAt),
    index('feed_events_object_idx').on(t.objectId),
  ],
);

// --- subscriptions ---

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    target: text('target').notNull(),
    instruction: text('instruction').notNull(),
    cadence: text('cadence').notNull(),
    nextRunAt: timestamp('next_run_at', { withTimezone: true }).notNull().defaultNow(),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    lastRunId: uuid('last_run_id'),
    nextRetryAt: timestamp('next_retry_at', { withTimezone: true }),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    lastError: text('last_error'),
    status: subscriptionStatusEnum('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('subscriptions_user_status_next_idx').on(t.userId, t.status, t.nextRunAt),
    index('subscriptions_user_retry_idx').on(t.userId, t.nextRetryAt),
  ],
);

// --- notifications ---

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    objectId: uuid('object_id').references(() => objects.id, { onDelete: 'set null' }),
    feedEventId: uuid('feed_event_id').references(() => feedEvents.id, {
      onDelete: 'set null',
    }),
    title: text('title').notNull(),
    message: text('message').notNull(),
    priority: notificationPriorityEnum('priority').notNull(),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('notifications_user_created_idx').on(t.userId, t.createdAt),
    index('notifications_user_unread_idx').on(t.userId, t.readAt),
  ],
);

// --- feedback ---

export const feedback = pgTable(
  'feedback',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    objectId: uuid('object_id')
      .notNull()
      .references(() => objects.id, { onDelete: 'cascade' }),
    kind: feedbackKindEnum('kind').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('feedback_user_object_kind_unique').on(t.userId, t.objectId, t.kind),
    index('feedback_user_created_idx').on(t.userId, t.createdAt),
  ],
);

// --- hermes_runs ---

export const hermesRuns = pgTable(
  'hermes_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: runKindEnum('kind').notNull(),
    subscriptionId: uuid('subscription_id').references(() => subscriptions.id, {
      onDelete: 'set null',
    }),
    prompt: text('prompt').notNull(),
    hermesRunId: text('hermes_run_id'),
    attempt: integer('attempt').notNull().default(1),
    status: runStatusEnum('status').notNull().default('dispatched'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('hermes_runs_user_created_idx').on(t.userId, t.createdAt),
    index('hermes_runs_user_status_idx').on(t.userId, t.status),
    index('hermes_runs_subscription_idx').on(t.subscriptionId),
  ],
);

// --- relations (Drizzle query helper, optional) ---

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  objects: many(objects),
  subscriptions: many(subscriptions),
  feedEvents: many(feedEvents),
  feedback: many(feedback),
  hermesRuns: many(hermesRuns),
  notifications: many(notifications),
}));

export const objectsRelations = relations(objects, ({ one, many }) => ({
  user: one(users, { fields: [objects.userId], references: [users.id] }),
  revisions: many(objectRevisions),
  events: many(objectEvents),
}));

export const objectRevisionsRelations = relations(objectRevisions, ({ one }) => ({
  object: one(objects, { fields: [objectRevisions.objectId], references: [objects.id] }),
  user: one(users, { fields: [objectRevisions.userId], references: [users.id] }),
}));

// --- type exports ---

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type ObjectRow = typeof objects.$inferSelect;
export type NewObject = typeof objects.$inferInsert;
export type ObjectRevision = typeof objectRevisions.$inferSelect;
export type NewObjectRevision = typeof objectRevisions.$inferInsert;
export type ObjectEvent = typeof objectEvents.$inferSelect;
export type ObjectRelationship = typeof objectRelationships.$inferSelect;
export type FeedEvent = typeof feedEvents.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;
export type Notification = typeof notifications.$inferSelect;
export type Feedback = typeof feedback.$inferSelect;
export type HermesRun = typeof hermesRuns.$inferSelect;
export type NewHermesRun = typeof hermesRuns.$inferInsert;
export type Session = typeof sessions.$inferSelect;
