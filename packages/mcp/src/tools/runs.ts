import { getRecentRunsArgsSchema } from '@hermieos/domain';
import type { z } from 'zod';
import { type AuthedContext } from '../auth.js';
import { type ToolRegistry } from '../registry.js';
import { getRecentRuns } from '../data/runs.js';

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

export function registerRunsTool(registry: ToolRegistry): void {
  tool(registry, {
    name: 'get_recent_runs',
    description:
      "Read-only: the user\'s recent Hermes runs (newest first). For the future Kanban view. Cannot be used to create or modify runs.",
    schema: getRecentRunsArgsSchema,
    handler: async (ctx, args) => {
      return getRecentRuns(ctx.userId, args.status, args.limit);
    },
  });
}
