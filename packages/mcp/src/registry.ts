import type { z } from 'zod';
import type { AuthedContext } from './auth.js';

export interface ToolDefinition<S extends z.ZodObject<z.ZodRawShape>> {
  name: string;
  description: string;
  schema: S;
  handler: (ctx: AuthedContext, args: z.infer<S>) => Promise<unknown>;
}

export type AnyToolDefinition = ToolDefinition<z.ZodObject<z.ZodRawShape>>;

export class ToolRegistry {
  private readonly tools = new Map<string, AnyToolDefinition>();

  register<S extends z.ZodObject<z.ZodRawShape>>(def: ToolDefinition<S>): void {
    if (this.tools.has(def.name)) {
      throw new Error(`tool already registered: ${def.name}`);
    }
    this.tools.set(def.name, def as unknown as AnyToolDefinition);
  }

  get(name: string): AnyToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(): AnyToolDefinition[] {
    return Array.from(this.tools.values());
  }
}
