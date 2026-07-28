import { z } from 'zod';

// --- Enums ---

export const objectTypeSchema = z.enum([
  'project',
  'research',
  'discovery',
  'decision',
  'opportunity',
  'learning_path',
  'note',
  'collection',
]);

export type ObjectType = z.infer<typeof objectTypeSchema>;

export const objectStatusSchema = z.enum([
  'active',
  'in_progress',
  'completed',
  'open',
  'resolved',
  'archived',
]);

export const feedbackKindSchema = z.enum(['like', 'save', 'ignore', 'archive', 'suggest']);

export const subscriptionStatusSchema = z.enum(['active', 'paused', 'archived']);

export const notificationPrioritySchema = z.enum(['low', 'normal', 'high']);

export const runKindSchema = z.enum([
  'subscription',
  'feedback_review',
  'ad_hoc',
  'system_notify',
]);

export const runStatusSchema = z.enum([
  'dispatched',
  'running',
  'succeeded',
  'failed',
  'cancelled',
]);

export const taskStatusSchema = z.enum([
  'todo',
  'in_progress',
  'blocked',
  'done',
  'cancelled',
]);

export const taskCategorySchema = z.enum([
  'work',
  'learning',
  'research',
  'health',
  'admin',
  'personal',
  'other',
]);

export const upcomingKindSchema = z.enum([
  'appointment',
  'deadline',
  'milestone',
  'reminder',
  'event',
]);

// Category color + icon enums (mirrors the postgres enums).
export const categoryColorSchema = z.enum([
  'emerald',
  'sky',
  'purple',
  'amber',
  'rose',
  'slate',
  'teal',
  'indigo',
]);
export const categoryIconSchema = z.enum([
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

// Scouting inbox buckets. Same values as the `kind` field on
// objects(type='opportunity').body. Subscriptions with a category feed the
// Scouting Inbox; subscriptions without (NULL) are non-scouting (feedback_review, etc).
//
// The schema accepts ANY non-empty string — Hermes can create new
// categories on the fly (e.g. "ai_security", "climate_grants"). The
// `SUGGESTED_CATEGORIES` constant below lists the well-known ones the
// UI surfaces as one-click suggestions.
export const SUGGESTED_CATEGORIES = [
  'job',
  'startup',
  'research_paper',
  'saas_idea',
  'iot',
  'grant',
  'competition',
  'other',
] as const;
export const opportunityCategorySchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/, {
    message:
      'category must be lowercase snake_case (letters, digits, underscores; must start with a letter)',
  });

// --- Categories (user-managed) ---

export const createCategoryArgsSchema = z.object({
  name: opportunityCategorySchema,
  color: categoryColorSchema.default('slate'),
  icon: categoryIconSchema.default('help-circle'),
  source: z.string().min(1).max(500),
});
export const updateCategoryArgsSchema = z
  .object({
    id: z.string().uuid(),
    name: opportunityCategorySchema.optional(),
    color: categoryColorSchema.optional(),
    icon: categoryIconSchema.optional(),
    sortOrder: z.coerce.number().int().min(0).max(999).optional(),
    source: z.string().min(1).max(500),
  })
  .refine(
    (v) =>
      v.name !== undefined ||
      v.color !== undefined ||
      v.icon !== undefined ||
      v.sortOrder !== undefined,
    { message: 'At least one updatable field must be provided' },
  );
export const archiveCategoryArgsSchema = z.object({
  id: z.string().uuid(),
  source: z.string().min(1).max(500),
});
export const listCategoriesArgsSchema = z.object({
  includeArchived: z.coerce.boolean().optional(),
  source: z.string().min(1).max(500),
});

export const relationshipKindSchema = z.enum([
  'related_to',
  'derived_from',
  'blocks',
  'cites',
  'part_of',
]);

// --- Object body schemas (per type) ---

export const researchBodySchema = z
  .object({
    question: z.string().min(1),
    methodology: z.string().optional(),
    findings: z
      .array(
        z.object({
          claim: z.string(),
          sources: z.array(z.string().url()).default([]),
        }),
      )
      .default([]),
    sources: z.array(z.string().url()).default([]),
    confidence: z.number().min(0).max(1).optional(),
  })
  .passthrough();

export const decisionBodySchema = z
  .object({
    context: z.string().optional(),
    options: z
      .array(
        z.object({
          id: z.string(),
          label: z.string(),
          description: z.string().optional(),
        }),
      )
      .default([]),
    recommendation: z.string().optional(),
  })
  .passthrough();

export const opportunityBodySchema = z
  .object({
    kind: z.string(),
    url: z.string().url().optional(),
    deadline: z.string().datetime().optional(),
    estimatedValue: z.string().optional(),
  })
  .passthrough();

export const noteBodySchema = z.object({ text: z.string().min(1) }).passthrough();

export const collectionBodySchema = z
  .object({ objectIds: z.array(z.string().uuid()).default([]) })
  .passthrough();

export const learningPathBodySchema = z
  .object({
    steps: z
      .array(
        z.object({
          objectId: z.string().uuid().optional(),
          description: z.string().optional(),
        }),
      )
      .default([]),
  })
  .passthrough();

export const projectBodySchema = z
  .object({ description: z.string().optional() })
  .passthrough();

export const discoveryBodySchema = z
  .object({ description: z.string().optional(), sourceUrl: z.string().url().optional() })
  .passthrough();

// --- MCP tool argument schemas ---

export const createObjectArgsSchema = z.object({
  type: objectTypeSchema,
  title: z.string().min(1).max(500),
  summary: z.string().max(2000).optional(),
  body: z.record(z.unknown()).optional(),
  status: objectStatusSchema.optional(),
  tags: z.array(z.string().min(1).max(64)).max(32).optional(),
  priority: z.coerce.number().int().optional(),
  source: z.string().min(1).max(500),
});

export const updateObjectArgsSchema = z
  .object({
    id: z.string().uuid(),
    title: z.string().min(1).max(500).optional(),
    summary: z.string().max(2000).optional(),
    body: z.record(z.unknown()).optional(),
    status: objectStatusSchema.optional(),
    tags: z.array(z.string().min(1).max(64)).max(32).optional(),
  priority: z.coerce.number().int().optional(),
    reason: z.string().max(500).optional(),
    appendNote: z.string().max(5000).optional(),
    source: z.string().min(1).max(500),
  })
  .refine(
    (v) =>
      v.title !== undefined ||
      v.summary !== undefined ||
      v.body !== undefined ||
      v.status !== undefined ||
      v.tags !== undefined ||
      v.priority !== undefined ||
      v.appendNote !== undefined,
    { message: 'At least one updatable field must be provided' },
  );

export const revertObjectArgsSchema = z.object({
  id: z.string().uuid(),
  revision: z.number().int().positive(),
  reason: z.string().max(500).optional(),
  source: z.string().min(1).max(500),
});

export const archiveObjectArgsSchema = z.object({
  id: z.string().uuid(),
  reason: z.string().max(500).optional(),
  source: z.string().min(1).max(500),
});

export const getObjectArgsSchema = z.object({ id: z.string().uuid() });
export const listObjectsArgsSchema = z.object({
  type: objectTypeSchema.optional(),
  status: objectStatusSchema.optional(),
  tag: z.string().optional(),
  limit: z.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});
export const searchObjectsArgsSchema = z.object({
  query: z.string().min(1).max(500),
  type: objectTypeSchema.optional(),
  limit: z.number().int().min(1).max(100).default(25),
});

export const linkObjectsArgsSchema = z.object({
  fromId: z.string().uuid(),
  toId: z.string().uuid(),
  kind: relationshipKindSchema,
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1).max(500),
  source: z.string().min(1).max(500),
});

export const unlinkObjectsArgsSchema = z.object({
  fromId: z.string().uuid(),
  toId: z.string().uuid(),
  kind: relationshipKindSchema,
  source: z.string().min(1).max(500),
});

export const getRelatedObjectsArgsSchema = z.object({
  objectId: z.string().uuid(),
  kind: relationshipKindSchema.optional(),
  minConfidence: z.number().min(0).max(1).optional(),
  direction: z.enum(['inbound', 'outbound', 'both']).optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

export const traverseGraphArgsSchema = z.object({
  objectId: z.string().uuid(),
  maxDepth: z.number().int().min(1).max(5).default(3),
  kinds: z.array(relationshipKindSchema).max(5).optional(),
  minConfidence: z.number().min(0).max(1).optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

export const createSubscriptionArgsSchema = z
  .object({
    name: z.string().min(1).max(200),
    target: z.string().min(1).max(500),
    instruction: z.string().min(1).max(5000),
    cadence: z.string().min(1).max(50),
    /**
     * The scouting bucket. Provide either `categoryId` (UUID of an
     * existing category) or `categoryName` (snake_case string). If
     * `categoryName` matches an existing category for the user it is
     * reused; otherwise a new category is created with default
     * appearance. Omit both for a non-scouting subscription.
     */
    categoryId: z.string().uuid().optional(),
    categoryName: opportunityCategorySchema.optional(),
    source: z.string().min(1).max(500),
  })
  .refine((v) => !(v.categoryId && v.categoryName), {
    message: 'Provide either categoryId or categoryName, not both',
  });

export const updateSubscriptionArgsSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1).max(200).optional(),
    target: z.string().min(1).max(500).optional(),
    instruction: z.string().min(1).max(5000).optional(),
    cadence: z.string().min(1).max(50).optional(),
    status: subscriptionStatusSchema.optional(),
    /**
     * Pass `categoryId: null` to demote a scout to a non-scout
     * subscription (it will no longer appear in the Scouting Inbox).
     */
    categoryId: z.string().uuid().nullable().optional(),
    source: z.string().min(1).max(500),
  })
  .refine(
    (v) =>
      v.name !== undefined ||
      v.target !== undefined ||
      v.instruction !== undefined ||
      v.cadence !== undefined ||
      v.status !== undefined ||
      v.categoryId !== undefined,
    { message: 'At least one updatable field must be provided' },
  );

export const listSubscriptionsArgsSchema = z.object({
  status: subscriptionStatusSchema.optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

export const archiveSubscriptionArgsSchema = z.object({
  id: z.string().uuid(),
  source: z.string().min(1).max(500),
});

export const recordFeedbackArgsSchema = z.object({
  objectId: z.string().uuid(),
  kind: feedbackKindSchema,
  payload: z.record(z.unknown()).optional(),
  source: z.string().min(1).max(500),
});

// --- Calendar (MCP-exposed for Hermes) ---

export const listCalendarEventsArgsSchema = z.object({
  /** ISO datetime; defaults to now. */
  from: z.string().datetime().optional(),
  /** ISO datetime; defaults to +30 days. */
  to: z.string().datetime().optional(),
  /** Max events to return. */
  limit: z.number().int().min(1).max(500).default(100),
});

export const createCalendarEventArgsSchema = z.object({
  externalId: z.string().min(1).max(512),
  title: z.string().min(1).max(512),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  calendarId: z.string().min(1).max(256).default('primary'),
  description: z.string().max(10_000).optional(),
  location: z.string().max(512).optional(),
  allDay: z.boolean().optional().default(false),
  attendees: z
    .array(
      z.object({
        email: z.string().email(),
        name: z.string().max(256).optional(),
      }),
    )
    .max(200)
    .optional()
    .default([]),
});

export const notifyUserArgsSchema = z.object({
  title: z.string().min(1).max(200),
  message: z.string().min(1).max(2000),
  priority: notificationPrioritySchema,
  objectId: z.string().uuid().optional(),
  source: z.string().min(1).max(500),
});

export const getRecentActivityArgsSchema = z.object({
  since: z.string().datetime().optional(),
  limit: z.number().int().min(1).max(200).default(50),
  kinds: z.array(z.string()).optional(),
});

export const markFeedReadArgsSchema = z.object({
  upTo: z.string().datetime(),
});

export const getObjectTimelineArgsSchema = z.object({
  id: z.string().uuid(),
  limit: z.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

export const getObjectRevisionArgsSchema = z.object({
  id: z.string().uuid(),
  revision: z.number().int().positive(),
});

export const listObjectRevisionsArgsSchema = z.object({
  id: z.string().uuid(),
  limit: z.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

export const getRecentRunsArgsSchema = z.object({
  status: runStatusSchema.optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

// --- Auth schemas ---

export const signupArgsSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(8).max(200),
  displayName: z.string().min(1).max(100),
});

export const loginArgsSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
});

// --- Task schemas (dashboard "Today's Mission") ---

export const createTaskArgsSchema = z.object({
  title: z.string().min(1).max(500),
  notes: z.string().max(5000).optional(),
  category: taskCategorySchema.optional(),
  status: taskStatusSchema.optional(),
  priority: z.coerce.number().int().optional(),
  dueAt: z.string().datetime().optional(),
  objectId: z.string().uuid().optional(),
  batchId: z.string().uuid().optional(),
  source: z.string().min(1).max(500),
});

export const updateTaskArgsSchema = z
  .object({
    id: z.string().uuid(),
    title: z.string().min(1).max(500).optional(),
    notes: z.string().max(5000).optional(),
    category: taskCategorySchema.optional(),
    status: taskStatusSchema.optional(),
    priority: z.coerce.number().int().optional(),
    dueAt: z.string().datetime().optional(),
    source: z.string().min(1).max(500),
  })
  .refine(
    (v) =>
      v.title !== undefined ||
      v.notes !== undefined ||
      v.category !== undefined ||
      v.status !== undefined ||
      v.priority !== undefined ||
      v.dueAt !== undefined,
    { message: 'At least one updatable field must be provided' },
  );

export const listTasksArgsSchema = z.object({
  status: taskStatusSchema.optional(),
  category: taskCategorySchema.optional(),
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
  batchId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

export const archiveTaskArgsSchema = z.object({
  id: z.string().uuid(),
  source: z.string().min(1).max(500),
});

export const getTaskArgsSchema = z.object({
  id: z.string().uuid(),
});

// Batch send-to-hermes: takes a list of task IDs (created in dashboard) and
// marks them as sent. The MCP server then enqueues a single Hermes run
// with the full task list in its prompt.
export const sendTasksToHermesArgsSchema = z.object({
  taskIds: z.array(z.string().uuid()).min(1).max(50),
  prompt: z.string().min(1).max(2000).optional(),
  source: z.string().min(1).max(500),
});

// --- Upcoming schemas (dashboard "Upcoming") ---

export const createUpcomingArgsSchema = z.object({
  title: z.string().min(1).max(500),
  subtitle: z.string().max(500).optional(),
  kind: upcomingKindSchema.optional(),
  occursAt: z.string().datetime(),
  location: z.string().max(500).optional(),
  notes: z.string().max(5000).optional(),
  source: z.string().min(1).max(500),
});

export const updateUpcomingArgsSchema = z
  .object({
    id: z.string().uuid(),
    title: z.string().min(1).max(500).optional(),
    subtitle: z.string().max(500).optional(),
    kind: upcomingKindSchema.optional(),
    occursAt: z.string().datetime().optional(),
    location: z.string().max(500).optional(),
    notes: z.string().max(5000).optional(),
    source: z.string().min(1).max(500),
  })
  .refine(
    (v) =>
      v.title !== undefined ||
      v.subtitle !== undefined ||
      v.kind !== undefined ||
      v.occursAt !== undefined ||
      v.location !== undefined ||
      v.notes !== undefined,
    { message: 'At least one updatable field must be provided' },
  );

export const listUpcomingArgsSchema = z.object({
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
  kind: upcomingKindSchema.optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

export const archiveUpcomingArgsSchema = z.object({
  id: z.string().uuid(),
  source: z.string().min(1).max(500),
});

// --- Dashboard aggregate (single round-trip for the home page) ---

export const dashboardArgsSchema = z.object({}).strict();

// --- Constants ---

export const NOTIFY_USER_DAILY_LIMIT = 5;
export const FEED_CACHE_TTL_MS = 120_000; // 2 minutes
export const SESSION_COOKIE_NAME = 'hermieos_session';

// --- Cadence ---

export const CADENCE_INTERVALS_MS: Record<string, number | null> = {
  hourly: 60 * 60_000,
  every_6_hours: 6 * 60 * 60_000,
  every_12_hours: 12 * 60 * 60_000,
  daily: 24 * 60 * 60_000,
  weekly: 7 * 24 * 60 * 60_000,
};

export const RETRY_BACKOFFS_MS = [60_000, 5 * 60_000, 15 * 60_000]; // 1m, 5m, 15m
