import type { z } from 'zod';
import type { AuthedContext } from './auth.js';

export interface ToolDefinition {
  name: string;
  description: string;
  /** Zod schema for the tool's input. Will be passed to MCP as inputSchema. */
  schema: z.ZodTypeAny;
  handler: (ctx: AuthedContext, args: unknown) => Promise<unknown>;
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  register(def: ToolDefinition): void {
    if (this.tools.has(def.name)) {
      throw new Error(`tool already registered: ${def.name}`);
    }
    this.tools.set(def.name, def);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }
}
