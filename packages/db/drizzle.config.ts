import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'drizzle-kit';

// Best-effort repo-root .env load so `pnpm db:migrate` works after
// `cp .env.example .env` without `set -a; . ./.env`. Never overrides real env.
try {
  const candidates = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '..', '..', '.env'),
  ];
  const loader = (
    process as unknown as { loadEnvFile?: (p?: string) => void }
  ).loadEnvFile;
  if (typeof loader === 'function') {
    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate)) loader.call(process, candidate);
      } catch {
        // ignore
      }
    }
  }
} catch {
  // ignore
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://hermieos:hermieos@localhost:15432/hermieos',
  },
  casing: 'snake_case',
  verbose: true,
});
