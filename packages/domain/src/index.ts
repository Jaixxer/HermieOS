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

export const createSubscriptionArgsSchema = z.object({
  name: z.string().min(1).max(200),
  target: z.string().min(1).max(500),
  instruction: z.string().min(1).max(5000),
  cadence: z.string().min(1).max(50),
  source: z.string().min(1).max(500),
});

export const updateSubscriptionArgsSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1).max(200).optional(),
    target: z.string().min(1).max(500).optional(),
    instruction: z.string().min(1).max(5000).optional(),
    cadence: z.string().min(1).max(50).optional(),
    status: subscriptionStatusSchema.optional(),
    source: z.string().min(1).max(500),
  })
  .refine(
    (v) =>
      v.name !== undefined ||
      v.target !== undefined ||
      v.instruction !== undefined ||
      v.cadence !== undefined ||
      v.status !== undefined,
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
