/**
 * Token rotation flow integration test.
 *
 * Exercises the end-to-end token rotation against a running HermieOS
 * + Hermes compose stack. Skips itself if the services aren't reachable
 * so it's safe to keep alongside the unit tests.
 *
 * Pre-flight:
 *   - HermieOS API on http://127.0.0.1:3001
 *   - Postgres reachable (DATABASE_URL)
 *   - A user with HERMES_USER_EMAIL=jaiveersk25@gmail.com (or the
 *     address passed via TEST_USER_EMAIL) and a known password
 *   - The compose stack up so the hermes-init container exists
 *
 * What it does:
 *   1. Records the current mcp_token from the DB
 *   2. Calls /me/mcp-token/rotate via the API
 *   3. Asserts the token in the DB changed
 *   4. Re-runs the profile generator (without restarting Hermes)
 *   5. Reads the new token from the Hermes config (in the named
 *      volume via docker exec) and asserts it matches the new DB token
 *
 * Cleanup: restores the original token at the end.
 */
import { spawnSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDatabase, closeDatabase, schema } from '@hermieos/db';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const API_URL = process.env.HERMIEOS_API_URL ?? 'http://127.0.0.1:3001';
const COMPOSE_PROJECT = process.env.HERMIEOS_COMPOSE_PROJECT ?? 'hermieos';
const TEST_USER = process.env.TEST_USER_EMAIL ?? 'jaiveersk25@gmail.com';
const TEST_PASSWORD = process.env.TEST_USER_PASSWORD ?? 'testpassword1!';
const INIT_CONTAINER = `${COMPOSE_PROJECT}-hermes-init`;
const HERMES_CONTAINER = `${COMPOSE_PROJECT}-hermes`;

const db = createDatabase({ url: process.env.DATABASE_URL ?? 'postgres://hermieos:hermieos@127.0.0.1:15432/hermieos' });

function sh(cmd: string, args: string[]): { stdout: string; status: number } {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  return { stdout: r.stdout ?? '', status: r.status ?? 0 };
}

async function http(path: string, init: RequestInit & { cookie?: string } = {}): Promise<Response> {
  const headers: Record<string, string> = { ...((init.headers as Record<string, string>) ?? {}) };
  if (init.cookie) headers['cookie'] = init.cookie;
  return fetch(`${API_URL}${path}`, { ...init, headers });
}

let originalToken: string | null = null;
let newToken: string | null = null;

async function preflightOrSkip(): Promise<boolean> {
  try {
    const healthRes = await fetch(`${API_URL}/`);
    if (!healthRes.ok) return false;
  } catch {
    return false;
  }
  const c = sh('docker', ['inspect', '--type=container', INIT_CONTAINER, '--format', '{{.Id}}']);
  if (c.status !== 0) return false;
  return true;
}

beforeAll(async () => {
  if (!(await preflightOrSkip())) {
    // eslint-disable-next-line no-console
    console.warn('preflight failed: HermieOS API or compose stack not reachable; skipping');
  }
  const [u] = await db
    .select({ id: schema.users.id, mcpToken: schema.users.mcpToken })
    .from(schema.users)
    .where(eq(schema.users.email, TEST_USER))
    .limit(1);
  originalToken = u?.mcpToken ?? null;
});

afterAll(async () => {
  if (originalToken && newToken) {
    await db
      .update(schema.users)
      .set({ mcpToken: originalToken, updatedAt: new Date() })
      .where(eq(schema.users.mcpToken, newToken));
  }
  await closeDatabase(db);
});

describe('token rotation flow', () => {
  it('rotates the mcp_token, regenerates the profile, and the new token reaches Hermes config', async () => {
    if (!originalToken) {
      // eslint-disable-next-line no-console
      console.warn(`no user ${TEST_USER}; skipping`);
      return;
    }

    // 1. Login.
    const loginRes = await http('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: TEST_USER, password: TEST_PASSWORD }),
    });
    expect(loginRes.status).toBe(200);
    const setCookie = loginRes.headers.get('set-cookie') ?? '';
    const cookie = setCookie.split(';')[0] ?? '';
    expect(cookie).toMatch(/^hermieos_session=/);

    // 2. Rotate.
    const rotRes = await http('/me/mcp-token/rotate', { method: 'POST', cookie });
    expect(rotRes.status).toBe(200);
    const rotated = (await rotRes.json()) as { mcpToken: string };
    newToken = rotated.mcpToken;
    expect(newToken).toMatch(/^mcp_/);
    expect(newToken).not.toBe(originalToken);

    // 3. DB should reflect the new token.
    const [u] = await db
      .select({ mcpToken: schema.users.mcpToken })
      .from(schema.users)
      .where(eq(schema.users.email, TEST_USER))
      .limit(1);
    expect(u?.mcpToken).toBe(newToken);

    // 4. Run hermes-profile-gen via the compose init container. It
    //    reads users.mcp_token from the DB and writes the new token
    //    into the hermes-data volume.
    const repoRoot = findRepoRoot();
    expect(repoRoot).not.toBeNull();
    const prevCwd = process.cwd();
    process.chdir(repoRoot as string);
    try {
      const gen = sh('docker', [
        'compose', '--project-name', COMPOSE_PROJECT, 'run', '--rm', 'hermes-init',
      ]);
      expect(gen.status).toBe(0);
    } finally {
      process.chdir(prevCwd);
    }

    // 5. Read the config from the volume (via docker exec) and
    //    confirm the token Hermes has is the new one.
    const cfgRes = sh('docker', [
      'exec', HERMES_CONTAINER, 'cat', '/opt/data/config.yaml',
    ]);
    expect(cfgRes.status).toBe(0);
    const cfg = cfgRes.stdout;
    expect(cfg).toContain(`Bearer ${newToken}`);
    expect(cfg).not.toContain(`Bearer ${originalToken}`);
  }, 120_000);
});

function findRepoRoot(): string | null {
  let dir = __dirname;
  for (let i = 0; i < 6; i += 1) {
    if (existsSync(join(dir, 'docker-compose.yml'))) return dir;
    dir = dirname(dir);
  }
  return null;
}
