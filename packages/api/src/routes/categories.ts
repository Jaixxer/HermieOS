import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createTtlCache } from '@hermieos/cache';
import {
  archiveCategory,
  createCategory,
  listCategories,
  updateCategory,
  type CategoryRow,
} from '@hermieos/mcp/src/data/categories.js';
import { categoryColorSchema, categoryIconSchema, opportunityCategorySchema } from '@hermieos/domain';
import { BadRequest, NotFound, Unauthorized, sendError } from '../errors.js';

const CATEGORIES_CACHE_TTL_MS = 60_000;
const CATEGORIES_CACHE_MAX = 1000;
const categoriesCache = createTtlCache<string, { categories: CategoryRow[] }>({
  ttlMs: CATEGORIES_CACHE_TTL_MS,
  maxEntries: CATEGORIES_CACHE_MAX,
});

function cacheKey(userId: string, includeArchived: boolean): string {
  return `cat:${userId}:${includeArchived ? 1 : 0}`;
}

function invalidateCategoriesCache(userId: string): void {
  categoriesCache.delete(cacheKey(userId, true));
  categoriesCache.delete(cacheKey(userId, false));
}

const createBody = z.object({
  name: opportunityCategorySchema,
  color: categoryColorSchema.optional(),
  icon: categoryIconSchema.optional(),
});

const updateBody = z
  .object({
    name: opportunityCategorySchema.optional(),
    color: categoryColorSchema.optional(),
    icon: categoryIconSchema.optional(),
    sortOrder: z.coerce.number().int().min(0).max(999).optional(),
  })
  .refine(
    (v) =>
      v.name !== undefined ||
      v.color !== undefined ||
      v.icon !== undefined ||
      v.sortOrder !== undefined,
    { message: 'At least one updatable field must be provided' },
  );

const listQuery = z.object({
  includeArchived: z.enum(['true', 'false']).optional(),
});

const idParam = z.object({ id: z.string().uuid() });

export async function registerCategoryRoutes(app: FastifyInstance): Promise<void> {
  // GET /categories?includeArchived=...
  app.get('/categories', async (req, reply) => {
    if (!req.user) {
      return sendError(reply, new Unauthorized(), String(req.id));
    }
    const q = listQuery.safeParse(req.query);
    const includeArchived = q.success && q.data.includeArchived === 'true';
    const key = cacheKey(req.user.id, includeArchived);
    const cached = categoriesCache.get(key);
    if (cached !== undefined) {
      reply.header('x-cache', 'hit');
      return cached;
    }
    const result = await listCategories({ userId: req.user.id, includeArchived });
    categoriesCache.set(key, result);
    reply.header('x-cache', 'miss');
    return result;
  });

  // POST /categories
  app.post('/categories', async (req, reply) => {
    if (!req.user) {
      return sendError(reply, new Unauthorized(), String(req.id));
    }
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) {
      return sendError(reply, new BadRequest('invalid_input', parsed.error.flatten()), String(req.id));
    }
    // Dedup: if a category with the same name (case-insensitive) exists,
    // return it instead of creating a duplicate. The unique index
    // would also catch it, but that surfaces as a 500.
    const { findCategoryByName } = await import('@hermieos/mcp/src/data/categories.js');
    const existing = await findCategoryByName(req.user.id, parsed.data.name);
    if (existing) {
      invalidateCategoriesCache(req.user.id);
      return { category: existing };
    }
    const c = await createCategory({
      userId: req.user.id,
      name: parsed.data.name,
      color: parsed.data.color ?? 'slate',
      icon: parsed.data.icon ?? 'help-circle',
    });
    invalidateCategoriesCache(req.user.id);
    return { category: c };
  });

  // PATCH /categories/:id
  app.patch('/categories/:id', async (req, reply) => {
    if (!req.user) {
      return sendError(reply, new Unauthorized(), String(req.id));
    }
    const params = idParam.safeParse(req.params);
    if (!params.success) {
      return sendError(reply, new BadRequest('invalid id'), String(req.id));
    }
    const parsed = updateBody.safeParse(req.body);
    if (!parsed.success) {
      return sendError(reply, new BadRequest('invalid_input', parsed.error.flatten()), String(req.id));
    }
    try {
      const c = await updateCategory({
        userId: req.user.id,
        id: params.data.id,
        name: parsed.data.name,
        color: parsed.data.color,
        icon: parsed.data.icon,
        sortOrder: parsed.data.sortOrder,
      });
      invalidateCategoriesCache(req.user.id);
      return { category: c };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return sendError(reply, new NotFound(message), String(req.id));
    }
  });

  // POST /categories/:id/archive
  app.post('/categories/:id/archive', async (req, reply) => {
    if (!req.user) {
      return sendError(reply, new Unauthorized(), String(req.id));
    }
    const params = idParam.safeParse(req.params);
    if (!params.success) {
      return sendError(reply, new BadRequest('invalid id'), String(req.id));
    }
    try {
      const c = await archiveCategory(req.user.id, params.data.id);
      invalidateCategoriesCache(req.user.id);
      return { category: c };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return sendError(reply, new NotFound(message), String(req.id));
    }
  });
}
