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
    // Generated columns (managed via SQL migrations, not Drizzle):
    //   search_vector — tsvector (0001)
    //   embedding     — vector(1536) (0004, pgvector extension)
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

// --- categories (user-managed scouting buckets) ---

// Color is one of: emerald, sky, purple, amber, rose, slate, teal, indigo.
// Icons are: briefcase, trending-up, file-text, lightbulb, radar, trophy,
// graduation-cap, dollar-sign, cpu, layers, help-circle.
export const categoryColorEnum = pgEnum('category_color', [
  'emerald',
  'sky',
  'purple',
  'amber',
  'rose',
  'slate',
  'teal',
  'indigo',
]);

export const categoryIconEnum = pgEnum('category_icon', [
  'briefcase',
  'trending-up',
  'file-text',
  'lightbulb',
  'radar',
  'trophy',
  'graduation-cap',
  'dollar-sign',
  'cpu',
  'layers',
  'help-circle',
]);

export const categories = pgTable(
  'categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: categoryColorEnum('color').notNull().default('slate'),
    icon: categoryIconEnum('icon').notNull().default('help-circle'),
    sortOrder: integer('sort_order').notNull().default(0),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Active categories per user are unique on (user_id, lower(name)).
    // We enforce case-insensitive uniqueness at the DB level for the
    // active rows so the server doesn't have to.
    unique('categories_user_name_unique').on(t.userId, t.name),
    index('categories_user_archived_idx').on(t.userId, t.archivedAt),
    index('categories_user_sort_idx').on(t.userId, t.sortOrder),
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
    // Scouting bucket. NULL for non-scout subscriptions (feedback_review,
    // ad_hoc, etc). When set, the dashboard shows this subscription in
    // the Scouting Inbox under that category. Replaces the old free-form
    // `category` text column; the text column is kept for back-compat
    // during the migration window and read by no current code.
    categoryId: uuid('category_id').references(() => categories.id, {
      onDelete: 'set null',
    }),
    category: text('category'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('subscriptions_user_status_next_idx').on(t.userId, t.status, t.nextRunAt),
    index('subscriptions_user_retry_idx').on(t.userId, t.nextRetryAt),
    index('subscriptions_user_category_idx').on(t.userId, t.categoryId),
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

// --- push_subscriptions ---

export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull(),
    authKey: text('auth_key').notNull(),
    p256dhKey: text('p256dh_key').notNull(),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('push_subscriptions_endpoint_unique').on(t.endpoint),
    index('push_subscriptions_user_idx').on(t.userId),
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

// --- tasks (Dashboard "Today's Mission") ---
// Hermes creates and manages tasks; user marks status from the dashboard.
// Multiple tasks can be batched and sent to hermes in a single MCP call.

export const taskStatusEnum = pgEnum('task_status', [
  'todo',
  'in_progress',
  'blocked',
  'done',
  'cancelled',
]);

export const taskCategoryEnum = pgEnum('task_category', [
  'work',
  'learning',
  'research',
  'health',
  'admin',
  'personal',
  'other',
]);

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    notes: text('notes'),
    category: taskCategoryEnum('category').notNull().default('other'),
    status: taskStatusEnum('status').notNull().default('todo'),
    priority: integer('priority').notNull().default(0),
    dueAt: timestamp('due_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    // provenance: who set this task? user (typed in dashboard) or hermes (chat)
    createdBy: actorEnum('created_by').notNull(),
    // the dashboard batch that included this task, for grouping + "sent to hermes" state
    batchId: uuid('batch_id'),
    sentToHermesAt: timestamp('sent_to_hermes_at', { withTimezone: true }),
    // optional link to an Object for the knowledge graph
    objectId: uuid('object_id').references(() => objects.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [
    index('tasks_user_status_due_idx').on(t.userId, t.status, t.dueAt),
    index('tasks_user_batch_idx').on(t.userId, t.batchId),
    index('tasks_user_category_idx').on(t.userId, t.category),
    index('tasks_user_archived_idx').on(t.userId, t.archivedAt),
  ],
);

// --- upcoming (Dashboard "Upcoming") ---
// Time-anchored personal items: visa appointments, biometrics, deadlines,
// milestones. Hermes adds these in chat; user adds manually too.

export const upcomingKindEnum = pgEnum('upcoming_kind', [
  'appointment',
  'deadline',
  'milestone',
  'reminder',
  'event',
]);

export const upcoming = pgTable(
  'upcoming',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    subtitle: text('subtitle'),
    kind: upcomingKindEnum('kind').notNull().default('event'),
    occursAt: timestamp('occurs_at', { withTimezone: true }).notNull(),
    location: text('location'),
    notes: text('notes'),
    createdBy: actorEnum('created_by').notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [
    index('upcoming_user_occurs_idx').on(t.userId, t.occursAt),
    index('upcoming_user_archived_idx').on(t.userId, t.archivedAt),
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
  pushSubscriptions: many(pushSubscriptions),
  tasks: many(tasks),
  upcoming: many(upcoming),
  categories: many(categories),
}));

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  user: one(users, { fields: [categories.userId], references: [users.id] }),
  subscriptions: many(subscriptions),
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
export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
export type Notification = typeof notifications.$inferSelect;
export type Feedback = typeof feedback.$inferSelect;
export type HermesRun = typeof hermesRuns.$inferSelect;
export type NewHermesRun = typeof hermesRuns.$inferInsert;
export type PushSubscription = typeof pushSubscriptions.$inferSelect;
export type NewPushSubscription = typeof pushSubscriptions.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type Upcoming = typeof upcoming.$inferSelect;
export type NewUpcoming = typeof upcoming.$inferInsert;

// --- Calendar (Google Calendar sync + MCP-exposed events) ---

export const googleOauthTokens = pgTable(
  'google_oauth_tokens',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    accessToken: text('access_token').notNull(),
    refreshToken: text('refresh_token').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    scope: text('scope').notNull().default(''),
    email: text('email').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
);

export const calendarEvents = pgTable(
  'calendar_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Google's event id (e.g. "<calendarId>_<eventId>"). Unique per user. */
    externalId: text('external_id').notNull(),
    /** Which Google calendar this came from (primary, work, …). */
    calendarId: text('calendar_id').notNull().default('primary'),
    title: text('title').notNull(),
    description: text('description'),
    location: text('location'),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    allDay: boolean('all_day').notNull().default(false),
    /** Free/busy status: free, busy, tentative, outOfOffice. */
    status: text('status').notNull().default('confirmed'),
    attendees: jsonb('attendees').$type<Array<{ email: string; name?: string; responseStatus?: string }>>().notNull().default(sql`'[]'::jsonb`),
    /** Free-form: htmlLink, hangoutLink, organizer, etag, etc. */
    raw: jsonb('raw').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('calendar_events_user_external_unique').on(t.userId, t.externalId),
    index('calendar_events_user_starts_at_idx').on(t.userId, t.startsAt),
  ],
);

export type GoogleOauthToken = typeof googleOauthTokens.$inferSelect;
export type NewGoogleOauthToken = typeof googleOauthTokens.$inferInsert;
export type CalendarEvent = typeof calendarEvents.$inferSelect;
export type NewCalendarEvent = typeof calendarEvents.$inferInsert;

// --- Per-user Google OAuth app credentials (Client ID + Secret) ---
// Stored so users can configure their own Google Cloud credentials
// instead of relying on a server-wide GOOGLE_OAUTH_CLIENT_ID env var.

export const googleOauthApps = pgTable(
  'google_oauth_apps',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    clientId: text('client_id').notNull(),
    clientSecret: text('client_secret').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
);

export type GoogleOauthApp = typeof googleOauthApps.$inferSelect;
export type NewGoogleOauthApp = typeof googleOauthApps.$inferInsert;
