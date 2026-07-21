/**
 * Hermes MCP token rotation helper.
 *
 * The flow:
 *   1. POST /me/mcp-token/rotate against the HermieOS API. The user
 *      (or an admin) must be logged in; the endpoint returns the new
 *      token once. The old token is invalidated immediately for any
 *      new MCP connection attempt.
 *   2. Re-run hermes-profile-gen to write the new token into Hermes's
 *      config. Same env vars as the initial setup, so it picks up
 *      the right profile path / MCP URL.
 *   3. Ask Hermes to reload MCP servers. Hermes exposes this as a
 *      slash command (`/reload-mcp`), not an HTTP endpoint, so we
 *      shell out via the Docker socket. If the docker command fails
 *      (e.g. Hermes runs outside Docker, or the container is named
 *      differently), we fall back to restarting the container, which
 *      forces Hermes to re-read the config on startup.
 *
 * Usage:
 *   pnpm --filter @hermieos/scripts hermes-token-rotate
 *
 * Env:
 *   HERMIEOS_API_URL   - HermieOS API base URL, default http://127.0.0.1:3001
 *   HERMIEOS_COOKIE    - session cookie (e.g. from `curl -c /tmp/c`). If
 *                        unset, we look at HERMIEOS_AUTH (HTTP basic
 *                        header) as a fallback.
 *   HERMIEOS_AUTH      - alternative to cookie; pre-built Authorization
 *                        header value (e.g. "Bearer <jwt>").
 *   HERMES_HOME        - Hermes data root, default /opt/hermes
 *   HERMES_PROFILE_NAME- profile name; default empty (= main config)
 *   HERMES_CONTAINER   - container name for the reload step, default
 *                        hermieos-hermes. Set HERMES_CONTAINER=skip
 *                        to skip the reload step entirely.
 *   DATABASE_URL       - Postgres URL (passed through to
 *                        hermes-profile-gen).
 *   HERMIEOS_MCP_MODE  - 'host' or 'docker', passed through.
 *   HERMES_USER_EMAIL  - email of the user whose token we're rotating.
 *                        Required.
 *   Plus everything hermes-profile-gen accepts.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function findComposeRoot(): string | null {
  // Walk up from this script looking for docker-compose.yml.
  let dir = __dirname;
  for (let i = 0; i < 6; i += 1) {
    if (existsSync(join(dir, 'docker-compose.yml'))) return dir;
    dir = dirname(dir);
  }
  return null;
}

function sh(cmd: string, args: string[]): { stdout: string; stderr: string; status: number } {
  const res = spawnSync(cmd, args, { encoding: 'utf8' });
  return {
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
    status: res.status ?? 0,
  };
}

async function main(): Promise<void> {
  const email = process.env.HERMES_USER_EMAIL;
  if (!email) {
    // eslint-disable-next-line no-console
    console.error('HERMES_USER_EMAIL is required');
    process.exit(1);
  }

  const apiBase = process.env.HERMIEOS_API_URL ?? 'http://127.0.0.1:3001';
  const cookie = process.env.HERMIEOS_COOKIE;
  const auth = process.env.HERMIEOS_AUTH;

  if (!cookie && !auth) {
    // eslint-disable-next-line no-console
    console.error('either HERMIEOS_COOKIE or HERMIEOS_AUTH is required');
    process.exit(1);
  }

  const headers: Record<string, string> = {};
  if (cookie) headers['cookie'] = cookie;
  if (auth) headers['authorization'] = auth;

  // 1. Rotate via the API.
  // eslint-disable-next-line no-console
  console.log(`rotating mcp_token for ${email} via ${apiBase}/me/mcp-token/rotate`);
  const rotateRes = await fetch(`${apiBase}/me/mcp-token/rotate`, {
    method: 'POST',
    headers,
  });
  if (!rotateRes.ok) {
    // eslint-disable-next-line no-console
    console.error(`rotation failed: ${rotateRes.status} ${rotateRes.statusText}`);
    const text = await rotateRes.text().catch(() => '');
    // eslint-disable-next-line no-console
    console.error(text);
    process.exit(1);
  }
  const rotated = (await rotateRes.json()) as { mcpToken: string };
  // eslint-disable-next-line no-console
  console.log(`rotated. new mcp_token starts with: ${rotated.mcpToken.slice(0, 12)}…`);

  // 2. Re-run the profile generator so the new token lands in Hermes's
  // config. The generator writes to $HERMES_HOME on the host. In the
  // Compose deployment the host's $HERMES_HOME is the docker volume
  // mountpoint, which is only writable by the container's UID. So we
  // delegate to the hermes-init container (which is a one-shot service
  // that runs hermes-profile-gen as UID 10000 inside the right env).
  //
  // For host-mode deployments (no compose, no docker), we run the
  // generator directly in this process — it's a single-node setup
  // and the host user has the right permissions.
  // eslint-disable-next-line no-console
  console.log('regenerating Hermes profile…');
  const composeProject = process.env.HERMIEOS_COMPOSE_PROJECT ?? 'hermieos';
  const composeRoot = findComposeRoot();
  let usedCompose = false;
  if (composeRoot) {
    // eslint-disable-next-line no-console
    console.log(`delegating to ${composeProject}-hermes-init…`);
    const cwd = process.cwd();
    process.chdir(composeRoot);
    try {
      const gen = sh('docker', [
        'compose', '--project-name', composeProject, 'run', '--rm', 'hermes-init',
      ]);
      if (gen.status !== 0) {
        // eslint-disable-next-line no-console
        console.error(`compose run hermes-init failed:\n${gen.stderr || gen.stdout}`);
        process.exit(1);
      }
      // eslint-disable-next-line no-console
      console.log(gen.stdout.trim());
      usedCompose = true;
    } finally {
      process.chdir(cwd);
    }
  } else {
    // eslint-disable-next-line no-console
    console.warn('docker-compose.yml not found; falling back to local profile-gen.');
  }
  if (!usedCompose) {
    // eslint-disable-next-line no-console
    console.log('running hermes-profile-gen directly (host-mode deploy)');
    const gen = sh('pnpm', ['--filter', '@hermieos/scripts', 'hermes-profile-gen']);
    if (gen.status !== 0) {
      // eslint-disable-next-line no-console
      console.error(`profile-gen failed:\n${gen.stderr || gen.stdout}`);
      process.exit(1);
    }
    // eslint-disable-next-line no-console
    console.log(gen.stdout.trim());
  }

  // 3. Tell Hermes to reload MCP servers. Try the slash command first
  // (exec'd inside the container). If that fails, fall back to a
  // container restart, which has the same effect.
  const container = process.env.HERMES_CONTAINER ?? 'hermieos-hermes';
  if (container === 'skip') {
    // eslint-disable-next-line no-console
    console.log('HERMES_CONTAINER=skip; leaving the reload to the caller.');
    return;
  }
  // eslint-disable-next-line no-console
  console.log(`asking ${container} to reload MCP…`);
  const exists = sh('docker', ['inspect', '--type=container', container, '--format', '{{.State.Running}}']);
  if (exists.status !== 0) {
    // eslint-disable-next-line no-console
    console.warn(`container ${container} not running; skipping reload.`);
    return;
  }
  // /reload-mcp is a slash command. We invoke it via the hermes CLI's
  // chat command on a one-shot prompt.
  const reload = sh('docker', [
    'exec', container, 'hermes', 'chat', '-q', '/reload-mcp', '-Q',
  ]);
  if (reload.status === 0) {
    // eslint-disable-next-line no-console
    console.log('reload triggered.');
    return;
  }
  // eslint-disable-next-line no-console
  console.warn(`/reload-mcp failed (${reload.status}). Falling back to container restart.`);
  // eslint-disable-next-line no-console
  console.warn(reload.stderr || reload.stdout);
  const restart = sh('docker', ['restart', container]);
  if (restart.status !== 0) {
    // eslint-disable-next-line no-console
    console.error(`restart failed: ${restart.stderr}`);
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.log('container restarted; Hermes will pick up the new token on startup.');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
