import {
  archiveCategoryArgsSchema,
  archiveSubscriptionArgsSchema,
  createCategoryArgsSchema,
  createSubscriptionArgsSchema,
  getObjectTimelineArgsSchema,
  getRecentActivityArgsSchema,
  getRelatedObjectsArgsSchema,
  linkObjectsArgsSchema,
  listCategoriesArgsSchema,
  listSubscriptionsArgsSchema,
  markFeedReadArgsSchema,
  recordFeedbackArgsSchema,
  traverseGraphArgsSchema,
  unlinkObjectsArgsSchema,
  updateCategoryArgsSchema,
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
  runSubscriptionNow,
  updateSubscription,
} from '../data/subscriptions.js';
import {
  archiveCategory,
  createCategory,
  listCategories,
  updateCategory,
} from '../data/categories.js';
import { recordFeedback } from '../data/feedback.js';
import { getRecentActivity, markFeedRead } from '../data/feed.js';
import { getObjectTimeline } from '../data/timeline.js';
import { listCalendarEvents, upsertCalendarEvent } from '../data/calendar.js';
import { listCalendarEventsArgsSchema, createCalendarEventArgsSchema } from '@hermieos/domain';

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
      "Create a recurring monitoring Subscription. Cadence is one of: hourly, every_6_hours, every_12_hours, daily, weekly, or cron:<expr>. Provide either categoryId (UUID of an existing scouting category) or categoryName (snake_case string; a new category will be created if it doesn't exist). Omit both for a non-scouting subscription (e.g. feedback_review, ad-hoc).",
    schema: createSubscriptionArgsSchema,
    handler: async (ctx, args) => {
      const s = await createSubscription(ctx.userId, {
        name: args.name,
        target: args.target,
        instruction: args.instruction,
        cadence: args.cadence,
        categoryId: args.categoryId ?? null,
        categoryName: args.categoryName ?? null,
      });
      return { subscription: s };
    },
  });

  tool(registry, {
    name: 'update_subscription',
    description:
      'Update a Subscription. At least one field is required. Changing the cadence resets next_run_at. Pass categoryId: null to demote a scout to a non-scout subscription (it will no longer appear in the Scouting Inbox).',
    schema: updateSubscriptionArgsSchema,
    handler: async (ctx, args) => {
      const s = await updateSubscription(ctx.userId, args.id, {
        name: args.name,
        target: args.target,
        instruction: args.instruction,
        cadence: args.cadence,
        status: args.status,
        categoryId: args.categoryId,
      });
      return { subscription: s };
    },
  });

  // --- Categories ---

  tool(registry, {
    name: 'create_category',
    description:
      "Create a scouting category (a user-managed bucket for the Scouting Inbox). name must be lowercase snake_case. The new category appears on the Scouting page immediately. If a category with the same name already exists for this user, this is a no-op (the existing category is returned).",
    schema: createCategoryArgsSchema,
    handler: async (ctx, args) => {
      const c = await createCategory({
        userId: ctx.userId,
        name: args.name,
        color: args.color,
        icon: args.icon,
      });
      return { category: c };
    },
  });

  tool(registry, {
    name: 'update_category',
    description:
      "Rename, recolor, reicon, or re-order a category. At least one field is required. Renaming keeps the same id; subscriptions and findings follow the id, so they automatically re-bucket.",
    schema: updateCategoryArgsSchema,
    handler: async (ctx, args) => {
      const c = await updateCategory({
        userId: ctx.userId,
        id: args.id,
        name: args.name,
        color: args.color,
        icon: args.icon,
        sortOrder: args.sortOrder,
      });
      return { category: c };
    },
  });

  tool(registry, {
    name: 'archive_category',
    description:
      "Archive a category. It disappears from the Scouting Inbox and any subscriptions that pointed at it lose their category (they become non-scout). The category row stays in the database for history.",
    schema: archiveCategoryArgsSchema,
    handler: async (ctx, args) => {
      const c = await archiveCategory(ctx.userId, args.id);
      return { category: c };
    },
  });

  tool(registry, {
    name: 'list_categories',
    description:
      "List the user's scouting categories. Default excludes archived. Use includeArchived to see all.",
    schema: listCategoriesArgsSchema,
    handler: async (ctx, args) => {
      const r = await listCategories({
        userId: ctx.userId,
        includeArchived: args.includeArchived,
      });
      return { categories: r.categories };
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

  // --- Calendar (Google Calendar sync) ---

  tool(registry, {
    name: 'list_calendar_events',
    description:
      "List the user's calendar events in a date range. Events are synced from Google Calendar (when connected) and stored locally. Use this to know what meetings, deadlines, or scheduled blocks the user has on a given day so you can plan around them. Returns events ordered by start time, ascending.",
    schema: listCalendarEventsArgsSchema,
    handler: async (ctx, args) => {
      const from = args.from ? new Date(args.from) : new Date();
      const to = args.to
        ? new Date(args.to)
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const events = await listCalendarEvents(ctx.userId, { from, to, limit: args.limit });
      return {
        events: events.map((e) => ({
          id: e.id,
          externalId: e.externalId,
          calendarId: e.calendarId,
          title: e.title,
          description: e.description,
          location: e.location,
          startsAt: e.startsAt.toISOString(),
          endsAt: e.endsAt.toISOString(),
          allDay: e.allDay,
          status: e.status,
          attendees: e.attendees,
        })),
        count: events.length,
      };
    },
  });

  tool(registry, {
    name: 'create_calendar_event',
    description:
      "Create a calendar event for the user. Useful for scheduling a reminder, follow-up, or task the user mentioned. The event is stored locally and (when Google Calendar is connected) will be pushed to Google on next sync. Provide externalId (any unique string — e.g. a hash of title+start), title, startsAt and endsAt as ISO datetimes.",
    schema: createCalendarEventArgsSchema,
    handler: async (ctx, args) => {
      const externalId = args.externalId;
      const event = await upsertCalendarEvent(ctx.userId, {
        externalId,
        calendarId: args.calendarId,
        title: args.title,
        description: args.description ?? null,
        location: args.location ?? null,
        startsAt: new Date(args.startsAt),
        endsAt: new Date(args.endsAt),
        allDay: args.allDay ?? false,
        status: 'confirmed',
        attendees: (args.attendees ?? []).map((a) => ({ email: a.email, name: a.name })),
        raw: { source: 'mcp_hermieos_create_calendar_event' },
      });
      return {
        event: {
          id: event.id,
          externalId: event.externalId,
          title: event.title,
          startsAt: event.startsAt.toISOString(),
          endsAt: event.endsAt.toISOString(),
        },
      };
    },
  });
}
