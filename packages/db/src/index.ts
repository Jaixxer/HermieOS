import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

export type Database = ReturnType<typeof createDatabase>;

export interface CreateDatabaseOptions {
  url: string;
  max?: number;
}

export function createDatabase(opts: CreateDatabaseOptions) {
  const client = postgres(opts.url, {
    max: opts.max ?? 10,
    prepare: false, // we run migrations with drizzle-kit; runtime uses non-prepared statements
  });
  const db = drizzle(client, { schema, casing: 'snake_case' });
  return Object.assign(db, { $client: client });
}

export async function closeDatabase(db: Database): Promise<void> {
  await db.$client.end();
}

export { schema };
export * from './schema/index.js';
