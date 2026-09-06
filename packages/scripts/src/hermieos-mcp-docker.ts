/**
 * hermieos-mcp-docker — manage the HermieOS MCP server in Docker.
 *
 * Two modes are supported:
 *
 *   - `start`  — build (if needed) and run the MCP server as a Docker
 *     container named `hermieos-mcp`, on the shared Docker network
 *     `hermieos_default`. This is the mode that lets the existing
 *     Hermes container resolve it by container name (no
 *     host.docker.internal required).
 *   - `stop`   — stop and remove the container.
 *   - `status` — print whether the container is running.
 *
 * The MCP server reads `DATABASE_URL` from the environment to reach
 * the same Postgres the rest of the stack uses. When run via Docker,
 * the DB host is the gateway IP on the `hermieos_default` network
 * (172.21.0.1 by default — adjust `HERMIEOS_DB_HOST` if your
 * gateway is different).
 *
 * Usage:
 *   pnpm --filter @hermieos/scripts hermieos-mcp-docker start
 *   pnpm --filter @hermieos/scripts hermieos-mcp-docker stop
 *   pnpm --filter @hermieos/scripts hermieos-mcp-docker status
 *
 * Env (all optional):
 *   HERMIEOS_MCP_CONTAINER_NAME   container name, default 'hermieos-mcp'
 *   HERMIEOS_MCP_NETWORK          Docker network, default 'hermieos_default'
 *   HERMIEOS_MCP_IMAGE            image name, default 'hermieos/mcp:dev'
 *   HERMIEOS_MCP_PORT             host port to publish, default 3002
 *   HERMIEOS_DB_HOST              Postgres host reachable from the
 *                                 container, default '172.21.0.1'
 *                                 (the bridge gateway of `hermieos_default`)
 *   DATABASE_URL                  full Postgres URL, used as the env
 *                                 inside the container. If unset, built
 *                                 from HERMIEOS_DB_HOST + defaults
 *                                 (hermieos:hermieos/hermieos:5432).
 *   HERMIEOS_IMAGE_BUILD          '1' to force `docker build` even when
 *                                 the image already exists.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CONTAINER_NAME = process.env.HERMIEOS_MCP_CONTAINER_NAME ?? 'hermieos-mcp';
const NETWORK = process.env.HERMIEOS_MCP_NETWORK ?? 'hermieos_default';
const IMAGE = process.env.HERMIEOS_MCP_IMAGE ?? 'hermieos/mcp:dev';
const HOST_PORT = process.env.HERMIEOS_MCP_PORT ?? '3002';
const DB_HOST = process.env.HERMIEOS_DB_HOST ?? '172.17.0.1';

function sh(cmd: string, args: string[]): { stdout: string; stderr: string; status: number } {
  const res = spawnSync(cmd, args, { encoding: 'utf8' });
  return {
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
    status: res.status ?? 0,
  };
}

function docker(args: string[]): { stdout: string; stderr: string; status: number } {
  return sh('docker', args);
}

function networkExists(name: string): boolean {
  const { stdout, status } = docker(['network', 'ls', '--format', '{{.Name}}']);
  if (status !== 0) return false;
  return stdout.split('\n').map((l) => l.trim()).includes(name);
}

function containerRunning(name: string): boolean {
  const { stdout, status } = docker(['ps', '--format', '{{.Names}}', '--filter', `name=^${name}$`]);
  if (status !== 0) return false;
  return stdout
    .split('\n')
    .map((l) => l.trim())
    .includes(name);
}

function imageExists(name: string): boolean {
  const { stdout, status } = docker(['images', '--format', '{{.Repository}}:{{.Tag}}', name]);
  if (status !== 0) return false;
  return stdout.split('\n').map((l) => l.trim()).includes(name);
}

function ensureNetwork(name: string): void {
  if (networkExists(name)) {
    // eslint-disable-next-line no-console
    console.log(`network ${name} exists`);
    return;
  }
  // eslint-disable-next-line no-console
  console.log(`creating network ${name}`);
  const { status, stderr } = docker(['network', 'create', name]);
  if (status !== 0) {
    // eslint-disable-next-line no-console
    console.error(`failed to create network ${name}: ${stderr}`);
    process.exit(1);
  }
}

function buildImage(image: string, force: boolean): void {
  if (!force && imageExists(image)) {
    // eslint-disable-next-line no-console
    console.log(`image ${image} already exists, skipping build (set HERMIEOS_IMAGE_BUILD=1 to force)`);
    return;
  }
  // eslint-disable-next-line no-console
  console.log(`building ${image} (packages/mcp/Dockerfile, context = repo root)`);
  const repoRoot = findRepoRoot();
  const { status, stderr } = docker([
    'build',
    '-f',
    join(repoRoot, 'packages', 'mcp', 'Dockerfile'),
    '--build-arg',
    'CI=true',
    '-t',
    image,
    repoRoot,
  ]);
  if (status !== 0) {
    // eslint-disable-next-line no-console
    console.error(`docker build failed: ${stderr}`);
    process.exit(1);
  }
}

function findRepoRoot(): string {
  // The script lives at packages/scripts/src/. Walk up to find the
  // monorepo root (the directory that has pnpm-workspace.yaml).
  let dir = __dirname;
  for (let i = 0; i < 5; i += 1) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    dir = join(dir, '..');
  }
  // eslint-disable-next-line no-console
  console.error('could not locate monorepo root from ' + __dirname);
  process.exit(1);
}

function buildDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  // Best-effort: assume hermieos:hermieos/hermieos on the DB host.
  return `postgres://hermieos:hermieos@${DB_HOST}:5432/hermieos`;
}

function start(): void {
  if (containerRunning(CONTAINER_NAME)) {
    // eslint-disable-next-line no-console
    console.log(`container ${CONTAINER_NAME} is already running`);
    return;
  }
  // The MCP server needs to reach the host's Postgres. In most
  // environments, Postgres listens on 127.0.0.1:5432 only — it's not
  // reachable from container bridge networks. The simplest portable
  // approach is to run the MCP container with `--network host`: it
  // shares the host's network stack, so it can reach Postgres at
  // 127.0.0.1:5432 directly, and it binds 3002 on the host so the
  // Hermes container (when configured with HERMIEOS_MCP_MODE=host)
  // can reach it via host.docker.internal.
  //
  // Drawback: the MCP container is not on the `hermieos_default`
  // custom network, so it isn't reachable as `hermieos-mcp` from
  // other containers. That works for the "host" mode of
  // hermes-profile-gen, which writes http://host.docker.internal:3002/mcp.
  // For the "docker" mode (which writes http://hermieos-mcp:3002/mcp),
  // we instead start the MCP on the shared network and rely on a
  // separate DB route — see startDockerNetworked().
  if (process.env.HERMIEOS_MCP_NETWORK === 'host') {
    startHostNetworked();
    return;
  }
  startOnSharedNetwork();
}

function startHostNetworked(): void {
  // eslint-disable-next-line no-console
  console.log(`starting ${CONTAINER_NAME} with --network host (MCP shares host's network)`);
  buildImage(IMAGE, process.env.HERMIEOS_IMAGE_BUILD === '1');
  const dbUrl = process.env.DATABASE_URL ?? 'postgres://hermieos:hermieos@127.0.0.1:15432/hermieos';
  const { status, stderr } = docker([
    'run',
    '-d',
    '--rm',
    '--name',
    CONTAINER_NAME,
    '--network',
    'host',
    '-e',
    `DATABASE_URL=${dbUrl}`,
    '-e',
    'NODE_ENV=production',
    '-e',
    'LOG_LEVEL=info',
    '-e',
    `MCP_PORT=${HOST_PORT}`,
    IMAGE,
  ]);
  if (status !== 0) {
    // eslint-disable-next-line no-console
    console.error(`docker run failed: ${stderr}`);
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.log(`started ${CONTAINER_NAME} on host network (port ${HOST_PORT})`);
  const hermesLocation = (process.env.HERMES_LOCATION ?? 'docker').toLowerCase();
  const mcpUrlHint =
    hermesLocation === 'local'
      ? `http://127.0.0.1:${HOST_PORT}/mcp`
      : `http://host.docker.internal:${HOST_PORT}/mcp`;
  // eslint-disable-next-line no-console
  console.log(
    `Set HERMIEOS_MCP_MODE=host (or HERMES_MCP_URL=${mcpUrlHint}) ` +
      `and restart Hermes to pick it up.`,
  );
}

function startOnSharedNetwork(): void {
  ensureNetwork(NETWORK);
  const hasDefaultBridge = networkExists('bridge');
  if (hasDefaultBridge && NETWORK !== 'bridge') {
    // eslint-disable-next-line no-console
    console.log(`default bridge exists; MCP will attach to it for Postgres`);
  }
  buildImage(IMAGE, process.env.HERMIEOS_IMAGE_BUILD === '1');
  const dbUrl = buildDatabaseUrl();
  const { status, stderr } = docker([
    'run',
    '-d',
    '--rm',
    '--name',
    CONTAINER_NAME,
    '--network',
    NETWORK,
    '-p',
    `${HOST_PORT}:3002`,
    '-e',
    `DATABASE_URL=${dbUrl}`,
    '-e',
    'NODE_ENV=production',
    '-e',
    'LOG_LEVEL=info',
    IMAGE,
  ]);
  if (status !== 0) {
    // eslint-disable-next-line no-console
    console.error(`docker run failed: ${stderr}`);
    process.exit(1);
  }
  if (hasDefaultBridge && NETWORK !== 'bridge') {
    const conn = docker(['network', 'connect', 'bridge', CONTAINER_NAME]);
    if (conn.status !== 0) {
      // eslint-disable-next-line no-console
      console.warn(`could not attach ${CONTAINER_NAME} to bridge: ${conn.stderr}`);
    }
  }
  // eslint-disable-next-line no-console
  console.log(`started ${CONTAINER_NAME} on ${NETWORK} (port ${HOST_PORT})`);
}

function stop(): void {
  const { status, stderr } = docker(['rm', '-f', CONTAINER_NAME]);
  if (status !== 0) {
    // eslint-disable-next-line no-console
    console.error(`docker rm -f ${CONTAINER_NAME} failed: ${stderr}`);
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.log(`stopped ${CONTAINER_NAME}`);
}

function status(): void {
  const running = containerRunning(CONTAINER_NAME);
  // eslint-disable-next-line no-console
  console.log(`${CONTAINER_NAME}: ${running ? 'running' : 'stopped'}`);
  process.exit(running ? 0 : 1);
}

function connectHermesToNetwork(hermesName: string): void {
  if (!networkExists(NETWORK)) {
    // eslint-disable-next-line no-console
    console.error(`network ${NETWORK} does not exist; start the MCP first`);
    process.exit(1);
  }
  const inspect = docker(['network', 'inspect', NETWORK, '--format', '{{range .Containers}}{{.Name}} {{end}}']);
  if (inspect.status === 0 && inspect.stdout.split(/\s+/).includes(hermesName)) {
    // eslint-disable-next-line no-console
    console.log(`container ${hermesName} is already on ${NETWORK}`);
    return;
  }
  const { status, stderr } = docker(['network', 'connect', NETWORK, hermesName]);
  if (status !== 0) {
    // eslint-disable-next-line no-console
    console.error(`failed to connect ${hermesName} to ${NETWORK}: ${stderr}`);
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.log(`connected ${hermesName} to ${NETWORK}`);
}

function main(): void {
  const cmd = process.argv[2] ?? 'status';
  switch (cmd) {
    case 'start':
      start();
      break;
    case 'stop':
      stop();
      break;
    case 'status':
      status();
      break;
    case 'connect-hermes': {
      const name = process.argv[3] ?? 'hermes-test';
      connectHermesToNetwork(name);
      break;
    }
    case 'help':
    case '-h':
    case '--help':
      // eslint-disable-next-line no-console
      console.log(
        'Usage: hermieos-mcp-docker <start|stop|status|connect-hermes [name]>\n' +
          '  start  — build (if needed) and run the MCP container\n' +
          '  stop   — stop and remove the MCP container\n' +
          '  status — report whether the container is running\n' +
          '  connect-hermes [name] — connect an existing Hermes container\n' +
          '                          to the shared network (default name:\n' +
          '                          hermes-test)',
      );
      break;
    default:
      // eslint-disable-next-line no-console
      console.error(`unknown command: ${cmd}`);
      process.exit(2);
  }
}

// `execFileSync` is only used to keep the import; touch it so it isn't dropped.
void execFileSync;

main();
