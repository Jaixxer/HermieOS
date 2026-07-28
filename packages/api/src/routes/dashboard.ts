import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createTtlCache } from '@hermieos/cache';
import { getDashboard } from '@hermieos/mcp/src/data/dashboard.js';
import { createTask, updateTask, archiveTask, markTasksSentToHermes, listTasks } from '@hermieos/mcp/src/data/tasks.js';
import { createUpcoming, updateUpcoming, archiveUpcoming, listUpcoming } from '@hermieos/mcp/src/data/upcoming.js';
import { BadRequest, NotFound, Unauthorized, sendError } from '../errors.js';

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

const createTaskBody = z.object({
  title: z.string().min(1).max(500),
  notes: z.string().max(5000).optional(),
  category: taskCategoryEnum.optional(),
  status: taskStatusEnum.optional(),
  priority: z.coerce.number().int().optional(),
  dueAt: z.string().datetime().optional(),
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
    dueAt: z.string().datetime().nullable().optional(),
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
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

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
  app.get('/tasks', async (req, reply) => {
    if (!req.user) {
      return sendError(reply, new Unauthorized(), String(req.id));
    }
    const parsed = listTasksQuery.safeParse(req.query);
    if (!parsed.success) {
      return sendError(reply, new BadRequest('invalid_input', parsed.error.flatten()), String(req.id));
    }
    const result = await listTasks(req.user.id, parsed.data);
    return result;
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
      dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : undefined,
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
      dueAt:
        parsed.data.dueAt === undefined
          ? undefined
          : parsed.data.dueAt === null
            ? null
            : new Date(parsed.data.dueAt),
    });
    if (!task) {
      return sendError(reply, new NotFound('task_not_found'), String(req.id));
    }
    invalidateDashboard(req.user.id);
    return { task };
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
