import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createTtlCache } from '@hermieos/cache';
import { getDashboard } from '@hermieos/mcp/src/data/dashboard.js';
import {
  createTask,
  updateTask,
  archiveTask,
  markTasksSentToHermes,
  markTaskDelegated,
  listTasks,
  listTasksForDay,
  listTasksInDayRange,
  getTask,
  dayStart,
  toDayKey,
  type TaskRow,
} from '@hermieos/mcp/src/data/tasks.js';
import {
  addTaskUpdate,
  listTaskUpdates,
  markUpdateSharedWithHermes,
  type TaskUpdateRow,
} from '@hermieos/mcp/src/data/task-updates.js';
import { getTaskAnalytics } from '@hermieos/mcp/src/data/task-analytics.js';
import { createUpcoming, updateUpcoming, archiveUpcoming, listUpcoming } from '@hermieos/mcp/src/data/upcoming.js';
import { ensureGatewaySession, gatewayFromEnv } from '../gateway-sessions.js';
import { BadRequest, NotFound, ServiceUnavailable, Unauthorized, sendError } from '../errors.js';

const DASHBOARD_CACHE_TTL_MS = Number(process.env.DASHBOARD_CACHE_TTL_MS ?? 30_000);
const DASHBOARD_CACHE_MAX = 1000;
const dashboardCache = createTtlCache<string, unknown>({
  ttlMs: DASHBOARD_CACHE_TTL_MS,
  maxEntries: DASHBOARD_CACHE_MAX,
});

function dashboardKey(userId: string): string {
  return `dash:${userId}`;
}

function invalidateDashboard(userId: string): void {
  dashboardCache.delete(dashboardKey(userId));
}

const taskStatusEnum = z.enum(['todo', 'in_progress', 'blocked', 'done', 'cancelled']);
const taskCategoryEnum = z.enum(['work', 'learning', 'research', 'health', 'admin', 'personal', 'other']);
const upcomingKindEnum = z.enum(['appointment', 'deadline', 'milestone', 'reminder', 'event']);

/** A calendar day with no time part — the unit of task scheduling. */
const dayKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected a YYYY-MM-DD calendar day');

/** Progress log entry kinds. Mirrors @hermieos/domain taskUpdateKindSchema. */
const taskUpdateKindEnum = z.enum(['progress', 'blocker', 'handoff', 'note', 'status']);

const createTaskBody = z.object({
  title: z.string().min(1).max(500),
  notes: z.string().max(5000).optional(),
  category: taskCategoryEnum.optional(),
  status: taskStatusEnum.optional(),
  priority: z.coerce.number().int().optional(),
  scheduledFor: dayKey.optional(),
  dueAt: z.string().datetime().optional(),
  delegateNote: z.string().max(4000).optional(),
  objectId: z.string().uuid().optional(),
  batchId: z.string().uuid().optional(),
});

const updateTaskBody = z
  .object({
    title: z.string().min(1).max(500).optional(),
    notes: z.string().max(5000).optional(),
    category: taskCategoryEnum.optional(),
    status: taskStatusEnum.optional(),
    priority: z.coerce.number().int().optional(),
    scheduledFor: dayKey.nullable().optional(),
    dueAt: z.string().datetime().nullable().optional(),
    delegateNote: z.string().max(4000).nullable().optional(),
  })
  .refine(
    (v) =>
      v.title !== undefined ||
      v.notes !== undefined ||
      v.category !== undefined ||
      v.status !== undefined ||
      v.priority !== undefined ||
      v.scheduledFor !== undefined ||
      v.dueAt !== undefined ||
      v.delegateNote !== undefined,
    { message: 'At least one updatable field must be provided' },
  );

/** Delegation is optional context on top of the task itself — the
 *  task stays yours; Hermes just gets the brief. `note` is persisted on
 *  the task as the standing brief (delegateNote), `context` is a
 *  one-shot addition for this hand-off. */
const delegateTaskBody = z.object({
  context: z.string().max(4000).optional(),
  note: z.string().max(4000).optional(),
});

/** One entry in the shared progress log. */
const addProgressBody = z.object({
  body: z.string().min(1).max(4000),
  percent: z.coerce.number().int().min(0).max(100).optional(),
  kind: taskUpdateKindEnum.optional(),
});

const sendBatchBody = z.object({
  taskIds: z.array(z.string().uuid()).min(1).max(50),
  prompt: z.string().min(1).max(2000).optional(),
});

const createUpcomingBody = z.object({
  title: z.string().min(1).max(500),
  subtitle: z.string().max(500).optional(),
  kind: upcomingKindEnum.optional(),
  occursAt: z.string().datetime(),
  location: z.string().max(500).optional(),
  notes: z.string().max(5000).optional(),
});

const updateUpcomingBody = z
  .object({
    title: z.string().min(1).max(500).optional(),
    subtitle: z.string().max(500).optional(),
    kind: upcomingKindEnum.optional(),
    occursAt: z.string().datetime().optional(),
    location: z.string().max(500).optional(),
    notes: z.string().max(5000).optional(),
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

const listTasksQuery = z.object({
  status: taskStatusEnum.optional(),
  category: taskCategoryEnum.optional(),
  batchId: z.string().uuid().optional(),
  /** One specific day's board (assigned to that day, due that day, or in progress). */
  day: dayKey.optional(),
  /** Inclusive day range (week view): assigned into the range OR due into it. */
  from: dayKey.optional(),
  to: dayKey.optional(),
  /** Exact assigned-day filter. */
  scheduledFor: dayKey.optional(),
  /** 'true' = only tasks delegated to Hermes, 'false' = only non-delegated. */
  delegated: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/** Every calendar day from `from` to `to` inclusive (capped at 62 days). */
function enumerateDays(from: string, to: string): string[] {
  const start = dayStart(from);
  const end = dayStart(to);
  const days: string[] = [];
  const cursor = new Date(start);
  while (cursor.getTime() <= end.getTime() && days.length < 62) {
    days.push(toDayKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

/** Local midnight starting the day AFTER a YYYY-MM-DD key (for `dueTo` bounds). */
function dayAfter(day: string): Date {
  const d = dayStart(day);
  d.setDate(d.getDate() + 1);
  return d;
}

/**
 * The brief Hermes receives when a task is handed over. Carries the
 * scheduling context and the whole progress log, so re-delegating a task
 * continues where the last hand-off stopped instead of starting over.
 */
function buildDelegateBrief(task: TaskRow, progress: TaskUpdateRow[], context: string | null): string[] {
  const lines: string[] = [];
  lines.push(`Task: ${task.title}`);
  lines.push(`Category: ${task.category}`);
  lines.push(`Task id: ${task.id} (use this id with add_task_progress / get_task)`);
  lines.push(`Status: ${task.status} — progress ${task.progressPercent}%`);
  if (task.scheduledFor) lines.push(`Scheduled for: ${task.scheduledFor}`);
  if (task.dueAt) lines.push(`Deadline: ${task.dueAt.toISOString()}`);
  if (task.notes) lines.push(`Notes: ${task.notes}`);
  if (progress.length > 0) {
    lines.push('');
    lines.push('Progress log so far (newest first) — continue from here, do not redo finished parts:');
    for (const u of progress) {
      const pct = u.percent != null ? ` (${u.percent}%)` : '';
      lines.push(`  [${u.actor}] ${u.createdAt.toISOString()}${pct} — ${u.body}`);
    }
  }
  if (task.delegateNote) {
    lines.push('');
    lines.push('Guidance from the user for this task:');
    lines.push(task.delegateNote);
  }
  if (context) {
    lines.push('');
    lines.push('Context for this hand-off:');
    lines.push(context);
  }
  lines.push('');
  lines.push('Please take on this task and do it. Report back in this conversation — do not just acknowledge it.');
  lines.push(
    'Log progress as you go with add_task_progress (task id above): say what you finished, what is left, and a percent when you know one. Use kind="blocker" if you need the user, kind="handoff" for the part that is now theirs to do. The user reads that log in the app and answers there, so keep it current.',
  );
  return lines;
}

/**
 * Push one progress entry into the task's Hermes conversation so the agent
 * sees what the user just did. Only for delegated tasks, and never throws:
 * the entry is already safely in the log, so a gateway hiccup must not fail
 * the user's write.
 */
async function relayProgressToHermes(task: TaskRow, update: TaskUpdateRow): Promise<boolean> {
  const gateway = gatewayFromEnv();
  if (!gateway) return false;
  const pct = update.percent != null ? ` (${update.percent}%)` : '';
  const head =
    update.kind === 'handoff'
      ? `The user's update on task "${task.title}" — this part is now yours to do`
      : update.kind === 'blocker'
        ? `Blocker reported by the user on task "${task.title}"`
        : `Progress update from the user on task "${task.title}"`;
  const lines = [
    `${head}${pct}:`,
    update.body,
    '',
    `Task id: ${task.id}. Current status: ${task.status}, progress ${task.progressPercent}%.${
      task.dueAt ? ` Deadline: ${task.dueAt.toISOString()}.` : ''
    }`,
    'If this changes your plan, say so here; keep reporting with add_task_progress.',
  ];
  try {
    await ensureGatewaySession(gateway, `task-${task.id}`, task.title);
    await gateway.chat(`task-${task.id}`, { message: lines.join('\n') });
    return true;
  } catch {
    return false;
  }
}

const listUpcomingQuery = z.object({
  days: z.coerce.number().int().min(1).max(365).default(90),
  kind: upcomingKindEnum.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export async function registerDashboardRoutes(app: FastifyInstance): Promise<void> {
  // GET /dashboard — single round-trip for the home page.
  app.get('/dashboard', async (req, reply) => {
    if (!req.user) {
      return sendError(reply, new Unauthorized(), String(req.id));
    }
    const key = dashboardKey(req.user.id);
    const cached = dashboardCache.get(key);
    if (cached !== undefined) {
      reply.header('x-cache', 'hit');
      return cached;
    }
    const data = await getDashboard(req.user.id);
    dashboardCache.set(key, data);
    return data;
  });

  // --- Tasks ---

  // GET /tasks — list the user's tasks.
  //   ?day=YYYY-MM-DD   → that day's board (assigned, due that day, or in progress)
  //   ?from&to          → range view: assigned into the range or due into it,
  //                       plus per-day counts for the week strip
  //   otherwise         → a plain filtered list
  app.get('/tasks', async (req, reply) => {
    if (!req.user) {
      return sendError(reply, new Unauthorized(), String(req.id));
    }
    const parsed = listTasksQuery.safeParse(req.query);
    if (!parsed.success) {
      return sendError(reply, new BadRequest('invalid_input', parsed.error.flatten()), String(req.id));
    }
    const q = parsed.data;

    if (q.day) {
      const board = await listTasksForDay(req.user.id, q.day, { limit: q.limit });
      return { ...board, day: q.day };
    }

    if (q.from && q.to) {
      const days = enumerateDays(q.from, q.to);
      const assigned = await listTasksInDayRange(req.user.id, days, { limit: q.limit });
      const dueInRange = await listTasks(req.user.id, {
        dueFrom: dayStart(q.from),
        dueTo: dayAfter(q.to),
        limit: q.limit,
      });
      const merged: TaskRow[] = [];
      const seen = new Set<string>();
      for (const t of [...assigned, ...dueInRange.tasks]) {
        if (seen.has(t.id)) continue;
        seen.add(t.id);
        merged.push(t);
      }
      const counts: Record<string, { assigned: number; due: number; open: number }> = {};
      for (const d of days) counts[d] = { assigned: 0, due: 0, open: 0 };
      for (const t of merged) {
        const open = t.status !== 'done' && t.status !== 'cancelled';
        if (t.scheduledFor && counts[t.scheduledFor]) {
          counts[t.scheduledFor]!.assigned += 1;
          if (open) counts[t.scheduledFor]!.open += 1;
        }
        if (t.dueAt) {
          const key = toDayKey(new Date(t.dueAt));
          if (counts[key]) counts[key]!.due += 1;
        }
      }
      return { tasks: merged, hasMore: false, days, counts };
    }

    const result = await listTasks(req.user.id, {
      status: q.status,
      category: q.category,
      batchId: q.batchId,
      scheduledFor: q.scheduledFor,
      delegated: q.delegated === undefined ? undefined : q.delegated === 'true',
      limit: q.limit,
    });
    return result;
  });

  // GET /tasks/analytics — mission analytics: completed today, pending,
  // overdue, deferred-to-tomorrow, and a created/completed trend.
  app.get('/tasks/analytics', async (req, reply) => {
    if (!req.user) {
      return sendError(reply, new Unauthorized(), String(req.id));
    }
    const q = req.query as { days?: string };
    const days = q.days ? Math.min(Math.max(parseInt(q.days, 10) || 7, 1), 30) : 7;
    const analytics = await getTaskAnalytics(req.user.id, days);
    return analytics;
  });

  // POST /tasks — create a task from the dashboard.
  app.post('/tasks', async (req, reply) => {
    if (!req.user) {
      return sendError(reply, new Unauthorized(), String(req.id));
    }
    const parsed = createTaskBody.safeParse(req.body);
    if (!parsed.success) {
      return sendError(reply, new BadRequest('invalid_input', parsed.error.flatten()), String(req.id));
    }
    const task = await createTask(req.user.id, {
      title: parsed.data.title,
      notes: parsed.data.notes,
      category: parsed.data.category,
      status: parsed.data.status,
      priority: parsed.data.priority,
      scheduledFor: parsed.data.scheduledFor ?? null,
      dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : undefined,
      delegateNote: parsed.data.delegateNote,
      objectId: parsed.data.objectId,
      batchId: parsed.data.batchId,
      createdBy: 'user',
    });
    invalidateDashboard(req.user.id);
    return { task };
  });

  // PATCH /tasks/:id — update a task (status toggle, edit title, etc).
  app.patch('/tasks/:id', async (req, reply) => {
    if (!req.user) {
      return sendError(reply, new Unauthorized(), String(req.id));
    }
    const { id } = req.params as { id: string };
    const parsed = updateTaskBody.safeParse(req.body);
    if (!parsed.success) {
      return sendError(reply, new BadRequest('invalid_input', parsed.error.flatten()), String(req.id));
    }
    const task = await updateTask(req.user.id, id, {
      title: parsed.data.title,
      notes: parsed.data.notes,
      category: parsed.data.category,
      status: parsed.data.status,
      priority: parsed.data.priority,
      scheduledFor: parsed.data.scheduledFor,
      dueAt:
        parsed.data.dueAt === undefined
          ? undefined
          : parsed.data.dueAt === null
            ? null
            : new Date(parsed.data.dueAt),
      delegateNote: parsed.data.delegateNote,
    });
    if (!task) {
      return sendError(reply, new NotFound('task_not_found'), String(req.id));
    }
    invalidateDashboard(req.user.id);
    return { task };
  });

  // GET /tasks/:id — one task with its full progress log.
  app.get('/tasks/:id', async (req, reply) => {
    if (!req.user) {
      return sendError(reply, new Unauthorized(), String(req.id));
    }
    const { id } = req.params as { id: string };
    const task = await getTask(req.user.id, id);
    if (!task) {
      return sendError(reply, new NotFound('task_not_found'), String(req.id));
    }
    const updates = await listTaskUpdates(req.user.id, id, { limit: 100 });
    return { task, updates: updates ?? [] };
  });

  // GET /tasks/:id/updates — the shared progress log, newest first.
  app.get('/tasks/:id/updates', async (req, reply) => {
    if (!req.user) {
      return sendError(reply, new Unauthorized(), String(req.id));
    }
    const { id } = req.params as { id: string };
    const q = req.query as { limit?: string };
    const limit = q.limit ? Math.min(Math.max(parseInt(q.limit, 10) || 50, 1), 200) : 50;
    const updates = await listTaskUpdates(req.user.id, id, { limit });
    if (updates === null) {
      return sendError(reply, new NotFound('task_not_found'), String(req.id));
    }
    return { updates };
  });

  // POST /tasks/:id/updates — append a progress entry as the user.
  // On a delegated task the entry is relayed into that task's Hermes
  // conversation, so the agent always sees the latest state.
  app.post('/tasks/:id/updates', async (req, reply) => {
    if (!req.user) {
      return sendError(reply, new Unauthorized(), String(req.id));
    }
    const { id } = req.params as { id: string };
    const parsed = addProgressBody.safeParse(req.body);
    if (!parsed.success) {
      return sendError(reply, new BadRequest('invalid_input', parsed.error.flatten()), String(req.id));
    }
    const task = await getTask(req.user.id, id);
    if (!task) {
      return sendError(reply, new NotFound('task_not_found'), String(req.id));
    }
    const result = await addTaskUpdate(req.user.id, id, {
      actor: 'user',
      kind: parsed.data.kind,
      body: parsed.data.body,
      percent: parsed.data.percent ?? null,
    });
    if (!result) {
      return sendError(reply, new NotFound('task_not_found'), String(req.id));
    }

    let sharedWithHermes = false;
    if (task.delegatedAt) {
      sharedWithHermes = await relayProgressToHermes(task, result.update);
      if (sharedWithHermes) {
        await markUpdateSharedWithHermes(req.user.id, result.update.id);
        result.update.sharedWithHermesAt = new Date();
      }
    }
    invalidateDashboard(req.user.id);
    return {
      update: result.update,
      progressPercent: result.progressPercent,
      status: result.status,
      sharedWithHermes,
    };
  });

  // DELETE /tasks/:id — archive a task.
  app.delete('/tasks/:id', async (req, reply) => {
    if (!req.user) {
      return sendError(reply, new Unauthorized(), String(req.id));
    }
    const { id } = req.params as { id: string };
    const ok = await archiveTask(req.user.id, id);
    invalidateDashboard(req.user.id);
    return { archived: ok };
  });

  // POST /tasks/send-to-hermes — batch dispatch to hermes.
  // The dashboard's "Send to Hermes" button calls this once with all the
  // task IDs the user added in that batch. The API marks the tasks as sent;
  // the actual hermes run is dispatched via the MCP server's send_tasks_to_hermes
  // tool by the calling client (which has the hermes run context).
  app.post('/tasks/send-to-hermes', async (req, reply) => {
    if (!req.user) {
      return sendError(reply, new Unauthorized(), String(req.id));
    }
    const parsed = sendBatchBody.safeParse(req.body);
    if (!parsed.success) {
      return sendError(reply, new BadRequest('invalid_input', parsed.error.flatten()), String(req.id));
    }
    const updated = await markTasksSentToHermes(req.user.id, parsed.data.taskIds);
    invalidateDashboard(req.user.id);
    return {
      updated,
      prompt:
        parsed.data.prompt ??
        `The user has queued ${parsed.data.taskIds.length} new task(s) for your attention. Please review and start work on them.`,
    };
  });

  // POST /tasks/:id/delegate — hand ONE task to Hermes, with the task's
  // standing brief (note), the progress log so far, and optional one-shot
  // context. The task stays on the user's board (it is theirs to own);
  // this opens a dedicated conversation where Hermes takes it on and
  // reports back through add_task_progress. Deterministic session id:
  // task-<taskId>, so re-delegating resumes the same conversation.
  app.post('/tasks/:id/delegate', async (req, reply) => {
    if (!req.user) {
      return sendError(reply, new Unauthorized(), String(req.id));
    }
    const { id } = req.params as { id: string };
    const parsed = delegateTaskBody.safeParse(req.body);
    if (!parsed.success) {
      return sendError(reply, new BadRequest('invalid_input', parsed.error.flatten()), String(req.id));
    }
    const task = await getTask(req.user.id, id);
    if (!task) {
      return sendError(reply, new NotFound('task_not_found'), String(req.id));
    }

    // The guidance note lives on the task (it is the standing brief), so a
    // later re-delegation carries it without retyping.
    const note = parsed.data.note?.trim();
    if (note) {
      const updated = await updateTask(req.user.id, id, { delegateNote: note });
      if (updated) task.delegateNote = updated.delegateNote;
    }
    const context = parsed.data.context?.trim() ?? null;

    const gateway = gatewayFromEnv();
    if (!gateway) {
      return sendError(
        reply,
        new ServiceUnavailable('Hermes gateway is not configured (HERMES_GATEWAY_URL / HERMES_API_KEY)'),
        String(req.id),
      );
    }

    const sessionId = `task-${task.id}`;
    await ensureGatewaySession(gateway, sessionId, task.title);

    const progress = (await listTaskUpdates(req.user.id, id, { limit: 20 })) ?? [];
    await gateway.chat(sessionId, { message: buildDelegateBrief(task, progress, context).join('\n') });
    await markTaskDelegated(req.user.id, task.id);
    invalidateDashboard(req.user.id);
    return { sessionId, delegated: true, progressEntriesShared: progress.length };
  });

  // --- Upcoming ---

  app.get('/upcoming', async (req, reply) => {
    if (!req.user) {
      return sendError(reply, new Unauthorized(), String(req.id));
    }
    const parsed = listUpcomingQuery.safeParse(req.query);
    if (!parsed.success) {
      return sendError(reply, new BadRequest('invalid_input', parsed.error.flatten()), String(req.id));
    }
    const since = new Date();
    const until = new Date(since);
    until.setDate(until.getDate() + parsed.data.days);
    const result = await listUpcoming(req.user.id, {
      since,
      until,
      kind: parsed.data.kind,
      limit: parsed.data.limit,
    });
    return result;
  });

  app.post('/upcoming', async (req, reply) => {
    if (!req.user) {
      return sendError(reply, new Unauthorized(), String(req.id));
    }
    const parsed = createUpcomingBody.safeParse(req.body);
    if (!parsed.success) {
      return sendError(reply, new BadRequest('invalid_input', parsed.error.flatten()), String(req.id));
    }
    const item = await createUpcoming(req.user.id, {
      title: parsed.data.title,
      subtitle: parsed.data.subtitle,
      kind: parsed.data.kind,
      occursAt: new Date(parsed.data.occursAt),
      location: parsed.data.location,
      notes: parsed.data.notes,
      createdBy: 'user',
    });
    invalidateDashboard(req.user.id);
    return { upcoming: item };
  });

  app.patch('/upcoming/:id', async (req, reply) => {
    if (!req.user) {
      return sendError(reply, new Unauthorized(), String(req.id));
    }
    const { id } = req.params as { id: string };
    const parsed = updateUpcomingBody.safeParse(req.body);
    if (!parsed.success) {
      return sendError(reply, new BadRequest('invalid_input', parsed.error.flatten()), String(req.id));
    }
    const item = await updateUpcoming(req.user.id, id, {
      title: parsed.data.title,
      subtitle: parsed.data.subtitle,
      kind: parsed.data.kind,
      occursAt: parsed.data.occursAt ? new Date(parsed.data.occursAt) : undefined,
      location: parsed.data.location,
      notes: parsed.data.notes,
    });
    if (!item) {
      return sendError(reply, new NotFound('upcoming_not_found'), String(req.id));
    }
    invalidateDashboard(req.user.id);
    return { upcoming: item };
  });

  app.delete('/upcoming/:id', async (req, reply) => {
    if (!req.user) {
      return sendError(reply, new Unauthorized(), String(req.id));
    }
    const { id } = req.params as { id: string };
    const ok = await archiveUpcoming(req.user.id, id);
    invalidateDashboard(req.user.id);
    return { archived: ok };
  });

  // Opportunities are now objects(type='opportunity') — managed through
  // the existing /objects endpoints. Marking an opportunity read is
  // `update_object` with status='archived'. No dedicated routes here.
}
