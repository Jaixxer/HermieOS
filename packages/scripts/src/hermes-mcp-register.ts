/**
 * Hermes MCP registration — the CLI-only path.
 *
 * Registers the HermieOS MCP server with the user's EXISTING Hermes
 * install through Hermes's own CLI (`hermes mcp add`) instead of
 * touching its config.yaml directly. Hermes's CLI owns its config:
 * it writes the `mcp_servers.hermieos` block itself, stores the bearer
 * token in its own `~/.env` (referenced via ${ENV_VAR} substitution),
 * and tests the connection before enabling the server.
 *
 * Non-interactive: the CLI prompts on stdin ("requires authentication?",
 * "API key / Bearer token", and on failure "save anyway?") — we drive
 * those prompts with piped answers.
 *
 * Env:
 *   HERMES_USER_EMAIL  - HermieOS account email (required; the token
 *                        is read from the DB for this user)
 *   DATABASE_URL       - Postgres URL (defaults like profile-gen)
 *   HERMES_MCP_TOKEN   - override the per-user token (skip the DB)
 *   HERMES_MCP_URL     - the URL Hermes should use to reach our MCP
 *                        server (required; derive it in the installer)
 *   HERMES_CLI_CMD     - how to invoke the Hermes CLI. Defaults to
 *                        `hermes`. For a containerized Hermes pass
 *                        e.g. `docker exec -i hermieos-hermes hermes`.
 *
 * Exit 0 when the server is registered and connected; 1 otherwise.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { eq } from 'drizzle-orm';
import { createDatabase, closeDatabase, schema } from '@hermieos/db';

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgres://hermieos:hermieos@localhost:5432/hermieos';
}
const dbUrl: string = process.env.DATABASE_URL ?? '';
const email: string = process.env.HERMES_USER_EMAIL ?? '';
if (!email) {
  // eslint-disable-next-line no-console
  console.error('HERMES_USER_EMAIL is required');
  process.exit(1);
}
const mcpUrl: string = process.env.HERMES_MCP_URL ?? '';
if (!mcpUrl) {
  // eslint-disable-next-line no-console
  console.error('HERMES_MCP_URL is required');
  process.exit(1);
}
const CLI = process.env.HERMES_CLI_CMD ?? 'hermes';
// HERMES_CLI_CMD may carry its own argv (e.g. `docker exec -i box hermes`).
const CLI_ARGV = CLI.split(/\s+/).filter(Boolean);
const SERVER = 'hermieos';

function runCli(args: string[], input?: string): { ok: boolean; out: string } {
  const res = spawnSync(CLI_ARGV[0]!, [...CLI_ARGV.slice(1), ...args], {
    input,
    encoding: 'utf8',
    env: process.env,
    timeout: 60_000,
  });
  const out = `${res.stdout ?? ''}${res.stderr ?? ''}`;
  if (res.error) out + `\n[spawn error] ${res.error.message}`;
  return { ok: res.status === 0, out };
}

async function main(): Promise<void> {
  // 1. Resolve the bearer token — from the DB for the given user,
  //    or an explicit override.
  let token = process.env.HERMES_MCP_TOKEN;
  if (!token) {
    const db = createDatabase({ url: dbUrl });
    const [user] = await db
      .select({ mcpToken: schema.users.mcpToken })
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .limit(1);
    await closeDatabase(db);
    if (!user) {
      // eslint-disable-next-line no-console
      console.error(`No HermieOS user with email ${email}`);
      process.exit(1);
    }
    token = user.mcpToken ?? undefined;
  }
  if (!token) {
    // eslint-disable-next-line no-console
    console.error(`User ${email} has no mcp_token; sign up first or set HERMES_MCP_TOKEN`);
    process.exit(1);
  }

  // 2. Does the server already exist? The CLI asks to overwrite in
  //    that case — answer 'y' up front.
  const list = runCli(['mcp', 'list']);
  const exists = list.out.includes(SERVER);
  const overwritePrefix = exists ? 'y\n' : '';

  // 3. Drive `hermes mcp add hermieos --url <url> --auth header`:
  //      - requires authentication?  -> y
  //      - API key / Bearer token:    -> <token>
  //      - save anyway? (on failure)  -> n (don't save a broken entry)
  const answers = `${overwritePrefix}y\n${token}\nn\n`;
  const add = runCli(['mcp', 'add', SERVER, '--url', mcpUrl, '--auth', 'header'], answers);

  if (add.ok || (!add.out.includes('Failed to connect') && add.out.includes('Connected'))) {
    // eslint-disable-next-line no-console
    console.log(add.out.split('\n').filter((l) => l.trim().length > 0).slice(0, 12).join('\n'));
    // eslint-disable-next-line no-console
    console.log(`\n✓ Registered '${SERVER}' via the Hermes CLI (${mcpUrl}).`);
    process.exit(0);
  }

  // eslint-disable-next-line no-console
  console.log(add.out.split('\n').filter((l) => l.trim().length > 0).slice(0, 20).join('\n'));
  // eslint-disable-next-line no-console
  console.error(
    `\n✗ '${SERVER}' could not be registered — check HERMES_MCP_URL (${mcpUrl}) and that the MCP server is running, then retry.`,
  );
  process.exit(1);
}

void main();
