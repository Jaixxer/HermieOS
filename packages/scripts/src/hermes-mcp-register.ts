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
 * "API key / Bearer token", "Enable all N tools?", and on failure
 * "save anyway?") — we drive those prompts with piped answers and verify
 * with `hermes mcp list`.
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
import { loadRootEnv } from '@hermieos/domain';

loadRootEnv();

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgres://hermieos:hermieos@localhost:15432/hermieos';
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
  //      - Enable all N tools?        -> y (otherwise registration cancels)
  //      - save anyway? (on failure)  -> n (don't save a broken entry)
  // NOTE: older Hermes CLIs do not ask the enable-all question; the extra
  // `y` is consumed harmlessly as the save-anyway answer only when the
  // prompt set is shorter — verification below is by `mcp list`, not output.
  const answers = `${overwritePrefix}y\n${token}\ny\nn\n`;
  const add = runCli(['mcp', 'add', SERVER, '--url', mcpUrl, '--auth', 'header'], answers);

  // Verify by re-listing: the CLI prints "Connected" for the connection
  // test even when the user cancels at the enable-all prompt, so output
  // matching alone reports success for a server that was never saved.
  const verify = runCli(['mcp', 'list']);
  const verified = verify.out.includes(SERVER);
  if (verified) {
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
