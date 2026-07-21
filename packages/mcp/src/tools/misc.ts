import {
  archiveSubscriptionArgsSchema,
  createSubscriptionArgsSchema,
  getObjectTimelineArgsSchema,
  getRecentActivityArgsSchema,
  getRelatedObjectsArgsSchema,
  linkObjectsArgsSchema,
  listSubscriptionsArgsSchema,
  markFeedReadArgsSchema,
  recordFeedbackArgsSchema,
  traverseGraphArgsSchema,
  unlinkObjectsArgsSchema,
  updateSubscriptionArgsSchema,
} from '@hermieos/domain';
import type { z } from 'zod';
import { type AuthedContext } from '../auth.js';
import { type ToolRegistry } from '../registry.js';
import { linkObjects, unlinkObjects, getRelatedObjects, traverseGraph } from '../data/relationships.js';
import {
  archiveSubscription,
  createSubscription,
  listSubscriptions,
  updateSubscription,
} from '../data/subscriptions.js';
import { recordFeedback } from '../data/feedback.js';
import { getRecentActivity, markFeedRead } from '../data/feed.js';
import { getObjectTimeline } from '../data/timeline.js';

function tool<S extends z.ZodTypeAny>(
  registry: ToolRegistry,
  def: {
    name: string;
    description: string;
    schema: S;
    handler: (ctx: AuthedContext, args: z.infer<S>) => Promise<unknown>;
  },
): void {
  registry.register({
    name: def.name,
    description: def.description,
    schema: def.schema,
    handler: def.handler as (ctx: AuthedContext, args: unknown) => Promise<unknown>,
  });
}

export function registerRelationshipAndSubscriptionTools(registry: ToolRegistry): void {
  // --- Relationships ---

  tool(registry, {
    name: 'link_objects',
    description:
      'Create or update a typed relationship between two Objects. Confidence is 0..1, with a short reason. Source is the hermes run or user identifier.',
    schema: linkObjectsArgsSchema,
    handler: async (ctx, args) => {
      const r = await linkObjects(
        ctx.userId,
        args.fromId,
        args.toId,
        args.kind,
        args.confidence,
        args.reason,
        args.source,
      );
      return { relationship: r };
    },
  });

  tool(registry, {
    name: 'unlink_objects',
    description: 'Remove a relationship by (from, to, kind).',
    schema: unlinkObjectsArgsSchema,
    handler: async (ctx, args) => {
      return unlinkObjects(ctx.userId, args.fromId, args.toId, args.kind);
    },
  });

  tool(registry, {
    name: 'get_related_objects',
    description:
      'Returns the objects directly connected to a given object. Considers both directions: outbound (this object links to) and inbound (linked to this object). Filters by kind, minimum confidence, and direction.',
    schema: getRelatedObjectsArgsSchema,
    handler: async (ctx, args) => {
      return getRelatedObjects(ctx.userId, {
        objectId: args.objectId,
        kind: args.kind,
        minConfidence: args.minConfidence,
        direction: args.direction ?? 'both',
        limit: args.limit,
      });
    },
  });

  tool(registry, {
    name: 'traverse_graph',
    description:
      'Breadth-first exploration of the relationship graph starting from an object. Returns nodes at each depth with the full path of edges that connect them to the start node. Cycle-safe (visited set). Max depth is configurable (default 3).',
    schema: traverseGraphArgsSchema,
    handler: async (ctx, args) => {
      return traverseGraph(ctx.userId, {
        startObjectId: args.objectId,
        maxDepth: args.maxDepth,
        kinds: args.kinds,
        minConfidence: args.minConfidence,
        limit: args.limit,
      });
    },
  });

  // --- Subscriptions ---

  tool(registry, {
    name: 'create_subscription',
    description:
      'Create a recurring monitoring Subscription. Cadence is one of: hourly, every_6_hours, every_12_hours, daily, weekly, or cron:<expr>.',
    schema: createSubscriptionArgsSchema,
    handler: async (ctx, args) => {
      const s = await createSubscription(ctx.userId, {
        name: args.name,
        target: args.target,
        instruction: args.instruction,
        cadence: args.cadence,
      });
      return { subscription: s };
    },
  });

  tool(registry, {
    name: 'update_subscription',
    description:
      'Update a Subscription. At least one field is required. Changing the cadence resets next_run_at.',
    schema: updateSubscriptionArgsSchema,
    handler: async (ctx, args) => {
      const s = await updateSubscription(ctx.userId, args.id, {
        name: args.name,
        target: args.target,
        instruction: args.instruction,
        cadence: args.cadence,
        status: args.status,
      });
      return { subscription: s };
    },
  });

  tool(registry, {
    name: 'list_subscriptions',
    description: 'List the current user\'s Subscriptions, newest first.',
    schema: listSubscriptionsArgsSchema,
    handler: async (ctx, args) => {
      return listSubscriptions(ctx.userId, args.status, args.limit);
    },
  });

  tool(registry, {
    name: 'archive_subscription',
    description: 'Archive a Subscription. Reversible via update_subscription.',
    schema: archiveSubscriptionArgsSchema,
    handler: async (ctx, args) => {
      const s = await archiveSubscription(ctx.userId, args.id);
      return { subscription: s };
    },
  });

  // --- Feedback ---

  tool(registry, {
    name: 'record_feedback',
    description:
      "Record a user reaction on an Object. Kind is one of like / save / ignore / archive / suggest. 'archive' also archives the object.",
    schema: recordFeedbackArgsSchema,
    handler: async (ctx, args) => {
      const f = await recordFeedback(ctx.userId, args.objectId, args.kind, args.payload);
      return { feedback: f };
    },
  });

  // --- Feed + Timeline ---

  tool(registry, {
    name: 'get_recent_activity',
    description:
      'The user\'s Feed. Returns the most recent feed events (newest first), optionally since a timestamp, optionally filtered by kinds.',
    schema: getRecentActivityArgsSchema,
    handler: async (ctx, args) => {
      return getRecentActivity(
        ctx.userId,
        {
          since: args.since ? new Date(args.since) : undefined,
          limit: args.limit,
          kinds: args.kinds,
        },
      );
    },
  });

  tool(registry, {
    name: 'mark_feed_read',
    description: 'Mark feed events as read up to the given timestamp.',
    schema: markFeedReadArgsSchema,
    handler: async (ctx, args) => {
      return markFeedRead(ctx.userId, new Date(args.upTo));
    },
  });

  tool(registry, {
    name: 'get_object_timeline',
    description:
      'The timeline of a specific Object: created, updated, completed, archived, note_added, reverted_to_revision, etc. Cursor-paginated by createdAt.',
    schema: getObjectTimelineArgsSchema,
    handler: async (ctx, args) => {
      return getObjectTimeline(ctx.userId, args.id, args.limit, args.cursor);
    },
  });
}
