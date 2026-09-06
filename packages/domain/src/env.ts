import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Load the repo-root `.env` into `process.env` without new dependencies.
 *
 * Node 22+ ships `process.loadEnvFile`; we use it when available so
 * `pnpm dev:api` / `dev:mcp` / `dev:scheduler` / `tsx scripts/*` pick up
 * the same `.env` the installer writes. Existing environment values are
 * never overwritten (matching dotenv's default).
 *
 * `pnpm --filter` runs scripts with cwd = the package dir, so we probe:
 *   1. cwd/.env
 *   2. each ancestor of cwd (up to the filesystem root, capped)
 *   3. the monorepo root relative to this file (packages/domain/src -> ../..)
 */
export function loadRootEnv(): void {
  const loader = (
    process as unknown as { loadEnvFile?: (filePath?: string) => void }
  ).loadEnvFile;
  if (typeof loader !== 'function') return;

  const candidates: string[] = [];
  try {
    candidates.push(path.resolve(process.cwd(), '.env'));
    let dir = process.cwd();
    for (let i = 0; i < 5; i += 1) {
      const parent = path.dirname(dir);
      if (!parent || parent === dir) break;
      dir = parent;
      candidates.push(path.resolve(dir, '.env'));
    }
  } catch {
    // ignore — env loading is best-effort
  }
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    candidates.push(path.resolve(here, '..', '..', '..', '.env'));
  } catch {
    // ignore
  }

  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    try {
      if (fs.existsSync(candidate)) loader.call(process, candidate);
    } catch {
      // best-effort: a malformed .env must not crash the service
    }
  }
}
