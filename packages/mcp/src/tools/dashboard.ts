import {
  archiveTaskArgsSchema,
  addTaskProgressArgsSchema,
  createTaskArgsSchema,
  createUpcomingArgsSchema,
  listTaskProgressArgsSchema,
  listTasksArgsSchema,
  listUpcomingArgsSchema,
  sendTasksToHermesArgsSchema,
  updateTaskArgsSchema,
  updateUpcomingArgsSchema,
  archiveUpcomingArgsSchema,
  dashboardArgsSchema,
  getTaskArgsSchema,
  getTaskAnalyticsArgsSchema,
} from '@hermieos/domain';
import type { z } from 'zod';
import { type AuthedContext } from '../auth.js';
import { type ToolRegistry } from '../registry.js';
import { archiveTask, createTask, getTask, listTasks, markTasksSentToHermes, updateTask } from '../data/tasks.js';
import { addTaskUpdate, listTaskUpdates } from '../data/task-updates.js';
import { getTaskAnalytics } from '../data/task-analytics.js';
import { archiveUpcoming, createUpcoming, getUpcoming, listUpcoming, updateUpcoming } from '../data/upcoming.js';
import { getDashboard } from '../data/dashboard.js';
import { recordFeedEvent } from '../data/feed.js';

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

export function registerDashboardTools(registry: ToolRegistry): void {
  // --- Tasks (Today's Mission) ---

  tool(registry, {
    name: 'create_task',
    description:
      'Add a new task to the user\'s task board (it shows on the day it is assigned to, and on "Today\'s Mission" when that day is today). Use this when the user describes something they need to do, or when hermes proactively proposes a task (e.g. "I will research X"). category should be one of: work, learning, research, health, admin, personal, other. scheduledFor assigns the calendar day (YYYY-MM-DD); dueAt is the hard deadline (ISO 8601 datetime). Use delegateNote for a standing brief when you are taking the task on yourself.',
    schema: createTaskArgsSchema,
    handler: async (ctx, args) => {
      const task = await createTask(ctx.userId, {
        title: args.title,
        notes: args.notes,
        category: args.category,
        status: args.status,
        priority: args.priority,
        scheduledFor: args.scheduledFor ?? null,
        dueAt: args.dueAt ? new Date(args.dueAt) : undefined,
        delegateNote: args.delegateNote,
        objectId: args.objectId,
        batchId: args.batchId,
        createdBy: 'hermes',
      });
      await recordFeedEvent(ctx.userId, {
        kind: 'task_finished',
        objectId: task.objectId,
        title: `New task: ${task.title}`,
        body: task.notes ?? null,
        payload: { taskId: task.id, category: task.category, status: task.status },
      });
      return { task };
    },
  });

  tool(registry, {
    name: 'update_task',
    description:
      'Update one or more fields on an existing task by id: status, priority, title, notes, scheduledFor (YYYY-MM-DD day assignment; null clears it), dueAt (deadline; null clears it), delegateNote (the standing brief for a delegated task). Use this to mark status, reschedule, or move a task to another day.',
    schema: updateTaskArgsSchema,
    handler: async (ctx, args) => {
      const task = await updateTask(ctx.userId, args.id, {
        title: args.title,
        notes: args.notes,
        category: args.category,
        status: args.status,
        priority: args.priority,
        scheduledFor: args.scheduledFor,
        dueAt: args.dueAt === undefined ? undefined : args.dueAt === null ? null : new Date(args.dueAt),
        delegateNote: args.delegateNote,
      });
      return { task };
    },
  });

  tool(registry, {
    name: 'add_task_progress',
    description:
      'Append a progress entry to a task\'s shared log — this is how you report back on delegated work and how the user reports back to you. The user sees every entry in the app; on a delegated task it also lands in that task\'s conversation. body is what changed and what is left (be concrete). percent (0-100) is an optional progress claim: 1-99 moves a todo task to in_progress, 100 does NOT auto-complete it (the user closes it). kind: "progress" (default), "blocker" (you need the user), "handoff" (a part is now theirs to do), "note", "status".',
    schema: addTaskProgressArgsSchema,
    handler: async (ctx, args) => {
      const result = await addTaskUpdate(ctx.userId, args.id, {
        actor: 'hermes',
        kind: args.kind,
        body: args.body,
        percent: args.percent ?? null,
        sharedWithHermesAt: new Date(),
      });
      if (!result) return { updated: false, reason: 'task_not_found' };
      return { updated: true, update: result.update, progressPercent: result.progressPercent, status: result.status };
    },
  });

  tool(registry, {
    name: 'list_task_progress',
    description:
      'Read the progress log of one task, newest first: every entry the user and you have written (actor tells you which). Use it to catch up on a delegated task before continuing it.',
    schema: listTaskProgressArgsSchema,
    handler: async (ctx, args) => {
      const updates = await listTaskUpdates(ctx.userId, args.id, { limit: args.limit });
      if (updates === null) return { found: false, updates: [] };
      return { found: true, updates };
    },
  });

  tool(registry, {
    name: 'list_tasks',
    description:
      'List the user\'s tasks. Filter by status, category, batch id, assigned day (scheduledFor, YYYY-MM-DD), deadline window (dueFrom/dueTo), or whether they are delegated to you (delegated: true). Default: all non-archived.',
    schema: listTasksArgsSchema,
    handler: async (ctx, args) => {
      const result = await listTasks(ctx.userId, {
        status: args.status,
        category: args.category,
        scheduledFor: args.scheduledFor,
        dueFrom: args.dueFrom ? new Date(args.dueFrom) : undefined,
        dueTo: args.dueTo ? new Date(args.dueTo) : undefined,
        delegated: args.delegated,
        since: args.since ? new Date(args.since) : undefined,
        until: args.until ? new Date(args.until) : undefined,
        batchId: args.batchId,
        limit: args.limit,
      });
      return result;
    },
  });

  tool(registry, {
    name: 'get_task',
    description:
      'Fetch a single task by id, including its full progress log (newest first) so you can see what the user and you have each done on it.',
    schema: getTaskArgsSchema,
    handler: async (ctx, args) => {
      const task = await getTask(ctx.userId, args.id);
      if (!task) return { task: null, updates: [] };
      const updates = await listTaskUpdates(ctx.userId, args.id, { limit: 50 });
      return { task, updates: updates ?? [] };
    },
  });

  tool(registry, {
    name: 'archive_task',
    description: 'Soft-archive a task. Use for completed/irrelevant items.',
    schema: archiveTaskArgsSchema,
    handler: async (ctx, args) => {
      const ok = await archiveTask(ctx.userId, args.id);
      return { archived: ok };
    },
  });

  tool(registry, {
    name: 'get_task_analytics',
    description:
      'Mission analytics over the user\'s own tasks. Returns how many tasks were completed today, are pending/in-progress/overdue, how many were pushed to tomorrow (deferred), and a per-day created/completed trend for the last N days. Use to answer questions like "what did I get done today?" or to summarize the user\'s mission progress.',
    schema: getTaskAnalyticsArgsSchema,
    handler: async (ctx, args) => {
      return getTaskAnalytics(ctx.userId, args.days);
    },
  });

  tool(registry, {
    name: 'send_tasks_to_hermes',
    description:
      'Mark a list of tasks (created via create_task with batchId) as sent. The caller is expected to have already started a Hermes run that ingests the batch — this tool just records the dispatch timestamp so the UI can show the user which batches are acknowledged.',
    schema: sendTasksToHermesArgsSchema,
    handler: async (ctx, args) => {
      const updated = await markTasksSentToHermes(ctx.userId, args.taskIds);
      return { updated };
    },
  });

  // --- Upcoming (Upcoming card) ---

  tool(registry, {
    name: 'create_upcoming',
    description:
      'Add a date-anchored item to the user\'s "Upcoming" list: appointments, deadlines, milestones, reminders. occursAt is an ISO 8601 datetime. kind should be one of: appointment, deadline, milestone, reminder, event.',
    schema: createUpcomingArgsSchema,
    handler: async (ctx, args) => {
      const item = await createUpcoming(ctx.userId, {
        title: args.title,
        subtitle: args.subtitle,
        kind: args.kind,
        occursAt: new Date(args.occursAt),
        location: args.location,
        notes: args.notes,
        createdBy: 'hermes',
      });
      await recordFeedEvent(ctx.userId, {
        kind: 'notification',
        title: `Upcoming: ${item.title}`,
        body: item.subtitle ?? null,
        payload: { upcomingId: item.id, occursAt: item.occursAt.toISOString() },
      });
      return { upcoming: item };
    },
  });

  tool(registry, {
    name: 'update_upcoming',
    description: 'Update an existing upcoming item by id.',
    schema: updateUpcomingArgsSchema,
    handler: async (ctx, args) => {
      const item = await updateUpcoming(ctx.userId, args.id, {
        title: args.title,
        subtitle: args.subtitle,
        kind: args.kind,
        occursAt: args.occursAt ? new Date(args.occursAt) : undefined,
        location: args.location,
        notes: args.notes,
      });
      return { upcoming: item };
    },
  });

  tool(registry, {
    name: 'list_upcoming',
    description: 'List upcoming items. Defaults to the next 30 days from now.',
    schema: listUpcomingArgsSchema,
    handler: async (ctx, args) => {
      const result = await listUpcoming(ctx.userId, {
        since: args.since ? new Date(args.since) : undefined,
        until: args.until ? new Date(args.until) : undefined,
        kind: args.kind,
        limit: args.limit,
      });
      return result;
    },
  });

  tool(registry, {
    name: 'archive_upcoming',
    description: 'Mark an upcoming item as completed/archived.',
    schema: archiveUpcomingArgsSchema,
    handler: async (ctx, args) => {
      const ok = await archiveUpcoming(ctx.userId, args.id);
      return { archived: ok };
    },
  });

  // --- Dashboard aggregate ---

  tool(registry, {
    name: 'get_dashboard',
    description:
      'Single round-trip fetch of all dashboard data: today\'s board (tasks assigned to today, due today, or in progress — each with its deadline, delegation state and progress entry), overdue tasks, upcoming within 7/30/90 days, opportunity bucket counts (from objects(type=\'opportunity\')), recent hermes feed events, and the user\'s knowledge graph. Use this to render the home dashboard.',
    schema: dashboardArgsSchema,
    handler: async (ctx) => {
      const data = await getDashboard(ctx.userId);
      return data;
    },
  });
}
