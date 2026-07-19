import {
  archiveObjectArgsSchema,
  createObjectArgsSchema,
  getObjectArgsSchema,
  getObjectRevisionArgsSchema,
  listObjectRevisionsArgsSchema,
  listObjectsArgsSchema,
  revertObjectArgsSchema,
  searchObjectsArgsSchema,
  updateObjectArgsSchema,
} from '@hermieos/domain';
import type { z } from 'zod';
import { type AuthedContext } from '../auth.js';
import { type ToolRegistry } from '../registry.js';
import {
  archiveObject,
  createObject,
  getObject,
  getObjectRevision,
  listObjectRevisions,
  listObjects,
  revertObject,
  searchObjects,
  updateObject,
} from '../data/objects.js';

/**
 * Typed wrapper around `ToolRegistry.register` that infers handler args from
 * the zod schema. Use this in tool-registration files; reserve the
 * registry's untyped `register` for the framework code.
 */
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

export function registerObjectTools(registry: ToolRegistry): void {
  tool(registry, {
    name: 'create_object',
    description:
      'Create a new Object (project, research, discovery, decision, opportunity, learning_path, note, collection). Returns the created object and its initial revision number (1).',
    schema: createObjectArgsSchema,
    handler: async (ctx, args) => {
      const obj = await createObject(ctx.userId, {
        type: args.type,
        title: args.title,
        summary: args.summary,
        body: args.body,
        status: args.status,
        tags: args.tags,
        source: args.source,
      });
      return { object: obj, revision: 1 };
    },
  });

  tool(registry, {
    name: 'update_object',
    description:
      'Partially update an Object. At least one content field must be provided. Writes a new revision only if content actually changed; updates priority without creating a revision. Optionally appends a note.',
    schema: updateObjectArgsSchema,
    handler: async (ctx, args) => {
      const result = await updateObject(ctx.userId, {
        id: args.id,
        title: args.title,
        summary: args.summary,
        body: args.body,
        status: args.status,
        tags: args.tags,
        reason: args.reason,
        appendNote: args.appendNote,
        source: args.source,
      });
      return result;
    },
  });

  tool(registry, {
    name: 'revert_object',
    description:
      'Revert an Object to a prior revision. The reverted content is applied as a new update (new revision); old revisions are untouched.',
    schema: revertObjectArgsSchema,
    handler: async (ctx, args) => {
      const obj = await revertObject(ctx.userId, {
        id: args.id,
        revision: args.revision,
        reason: args.reason,
        source: args.source,
      });
      return { object: obj };
    },
  });

  tool(registry, {
    name: 'archive_object',
    description: 'Soft-archive an Object. Reversible. The row stays.',
    schema: archiveObjectArgsSchema,
    handler: async (ctx, args) => {
      const obj = await archiveObject(ctx.userId, {
        id: args.id,
        reason: args.reason,
        source: args.source,
      });
      return { object: obj };
    },
  });

  tool(registry, {
    name: 'get_object',
    description: 'Fetch a single Object by id. Returns null if not found.',
    schema: getObjectArgsSchema,
    handler: async (ctx, args) => {
      const obj = await getObject(ctx.userId, args.id);
      return { object: obj };
    },
  });

  tool(registry, {
    name: 'list_objects',
    description:
      'List Objects for the current user. Filterable by type, status, and tag. Cursor-paginated by updatedAt descending.',
    schema: listObjectsArgsSchema,
    handler: async (ctx, args) => {
      const result = await listObjects(ctx.userId, {
        type: args.type,
        status: args.status,
        tag: args.tag,
        limit: args.limit,
        cursor: args.cursor,
      });
      return result;
    },
  });

  tool(registry, {
    name: 'search_objects',
    description:
      'Postgres full-text search over title (A), summary (B), and body (C). Returns hits ranked by ts_rank_cd, with a ts_headline snippet.',
    schema: searchObjectsArgsSchema,
    handler: async (ctx, args) => {
      const hits = await searchObjects(ctx.userId, {
        query: args.query,
        type: args.type,
        limit: args.limit,
      });
      return { hits };
    },
  });

  tool(registry, {
    name: 'get_object_revision',
    description: 'Fetch a specific revision of an Object.',
    schema: getObjectRevisionArgsSchema,
    handler: async (ctx, args) => {
      const rev = await getObjectRevision(ctx.userId, args.id, args.revision);
      return { revision: rev };
    },
  });

  tool(registry, {
    name: 'list_object_revisions',
    description: 'List revisions of an Object, newest first, cursor-paginated.',
    schema: listObjectRevisionsArgsSchema,
    handler: async (ctx, args) => {
      const result = await listObjectRevisions(ctx.userId, args.id, args.limit, args.cursor);
      return result;
    },
  });
}
