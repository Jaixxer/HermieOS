import { notifyUserArgsSchema } from '@hermieos/domain';
import type { z } from 'zod';
import { type AuthedContext } from '../auth.js';
import { type ToolRegistry } from '../registry.js';
import { notifyUser, RateLimitError } from '../data/notifications.js';

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

export function registerNotifyTool(registry: ToolRegistry): void {
  tool(registry, {
    name: 'notify_user',
    description:
      "Request a notification. The MCP server enforces a daily limit per user (default 5). The 6th call in a day is rejected with a clear error.",
    schema: notifyUserArgsSchema,
    handler: async (ctx, args) => {
      try {
        const n = await notifyUser(ctx.userId, {
          title: args.title,
          message: args.message,
          priority: args.priority,
          objectId: args.objectId,
          source: args.source,
        });
        return { notification: n };
      } catch (err) {
        if (err instanceof RateLimitError) {
          // Re-throw with a clear, structured message the model can reason about.
          throw new Error(
            `rate limit: ${err.count}/${err.limit} notifications today. ` +
              `Hold further notifications until tomorrow or pick the most important one.`,
          );
        }
        throw err;
      }
    },
  });
}
