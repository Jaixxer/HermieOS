/**
 * Hermes MCP config writer.
 *
 * Reads the per-user `mcp_token` from Postgres and merges a
 * `mcp_servers.hermieos` block into the user's existing Hermes
 * `config.yaml`. Preserves any other settings (model, other MCP
 * servers, tool_loop_guardrails, etc.).
 *
 * Why merge and not overwrite: the user may have other MCP
 * servers configured, custom model settings, or persona tweaks.
 * We only own the `mcp_servers.hermieos` block; everything else
 * is theirs.
 *
 * Idempotent: re-runs update the bearer if it changed (e.g., after
 * a token rotation). The API_KEY on the .env is also regenerated
 * only if missing.
 *
 * Config file location: when HERMES_PROFILE_NAME is set, the
 * config is written to $HERMES_HOME/profiles/<name>/config.yaml.
 * Otherwise the main $HERMES_HOME/config.yaml is used. The latter
 * is what the gateway actually reads by default — profiles are
 * selected explicitly via `hermes profile use` or the gateway's
 * --profile flag. The "do not create profiles in hermes" mode
 * (HERMES_PROFILE_NAME unset) writes to the main config so the
 * running gateway picks it up without restarting profiles.
 *
 * MCP server URL: derived from HERMIEOS_MCP_MODE.
 *   - "host"  : MCP runs on the Docker host; default URL is
 *               http://host.docker.internal:3002/mcp (works when
 *               Hermes is in a container with host-gateway).
 *   - "docker": MCP runs in a sibling container on the same Docker
 *               network; default URL is http://<HERMES_MCP_CONTAINER_NAME>:3002/mcp
 *               (default container name: hermieos-mcp).
 * Set HERMES_MCP_URL to override explicitly.
 *
 * Env:
 *   DATABASE_URL                - Postgres URL (required)
 *   HERMES_USER_EMAIL           - HermieOS user email (required)
 *   HERMES_HOME                 - Hermes data root, default /opt/hermes
 *   HERMES_PROFILE_NAME         - if set, write to profiles/<name>/{config.yaml,.env}
 *                                 otherwise the main $HERMES_HOME/{config.yaml,.env}
 *   HERMES_API_PORT             - API server port, default 8642
 *   HERMES_API_HOST             - API server bind, default 0.0.0.0
 *   HERMIEOS_MCP_MODE           - 'host' (default) or 'docker'
 *   HERMES_MCP_CONTAINER_NAME   - container name when in 'docker' mode,
 *                                 default 'hermieos-mcp'
 *   HERMES_MCP_URL              - override the URL written into config
 *   HERMES_MCP_PORT             - MCP port, default 3002
 *   HERMES_MCP_TOKEN            - override the per-user token (skip DB)
 *   HERMES_API_KEY              - override the API server bearer
 */
import { randomBytes } from 'node:crypto';
import { writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { createDatabase, closeDatabase, schema } from '@hermieos/db';
import YAML from 'yaml';

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgres://hermieos:hermieos@localhost:5432/hermieos';
}
if (!process.env.HERMES_USER_EMAIL) {
  // eslint-disable-next-line no-console
  console.error('HERMES_USER_EMAIL is required');
  process.exit(1);
}

const PROFILE = process.env.HERMES_PROFILE_NAME;
const HOME = process.env.HERMES_HOME ?? '/opt/hermes';
// When a profile name is set, write under profiles/<name>/. Otherwise
// write to the main HERMES_HOME — the gateway reads this by default.
const PROFILE_DIR = PROFILE ? join(HOME, 'profiles', PROFILE) : HOME;
const ENV_FILE = join(PROFILE_DIR, '.env');
const CONFIG_FILE = join(PROFILE_DIR, 'config.yaml');

const db = createDatabase({ url: process.env.DATABASE_URL });

type HermesConfig = Record<string, unknown>;

function readConfig(path: string): HermesConfig {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, 'utf8');
  return YAML.parse(raw) as HermesConfig;
}

function buildHermieosMcpBlock(mcpUrl: string, mcpToken: string): Record<string, unknown> {
  return {
    url: mcpUrl,
    headers: { Authorization: `Bearer ${mcpToken}` },
    enabled: true,
    tools: { resources: false, prompts: false },
  };
}

function buildMergedConfig(input: {
  mcpUrl: string;
  mcpToken: string;
  existing: HermesConfig;
  model: string;
  inferenceProvider: string;
  inferenceBaseUrl: string | undefined;
  skillsExternalDirs?: string[];
}): HermesConfig {
  const merged: HermesConfig = { ...input.existing };

  // model — only write if not present
  if (!merged.model) {
    merged.model = {
      default: input.model,
      provider: input.inferenceProvider,
      ...(input.inferenceBaseUrl ? { base_url: input.inferenceBaseUrl } : {}),
    };
  }

  // mcp_servers.hermieos — owned by HermieOS; overwrite just this entry
  const mcpServers = (merged.mcp_servers as Record<string, unknown> | undefined) ?? {};
  merged.mcp_servers = {
    ...mcpServers,
    hermieos: buildHermieosMcpBlock(input.mcpUrl, input.mcpToken),
  };

  // tool_loop_guardrails — only if not present
  if (!merged.tool_loop_guardrails) {
    merged.tool_loop_guardrails = {
      hard_stop_enabled: true,
      hard_stop_after: { exact_failure: 5, idempotent_no_progress: 5 },
    };
  }

  // skills.external_dirs — add HermieOS skills repo dir if provided
  if (input.skillsExternalDirs && input.skillsExternalDirs.length > 0) {
    const skills = (merged.skills as Record<string, unknown> | undefined) ?? {};
    const existingDirs = Array.isArray(skills.external_dirs) ? [...skills.external_dirs] : [];
    const newDirs = input.skillsExternalDirs.filter((d) => !existingDirs.includes(d));
    if (newDirs.length > 0) {
      merged.skills = {
        ...skills,
        external_dirs: [...existingDirs, ...newDirs],
      };
    }
  }

  return merged;
}

function readOrGenerateApiKey(): string {
  if (process.env.HERMES_API_KEY) return process.env.HERMES_API_KEY;
  if (existsSync(ENV_FILE)) {
    const txt = readFileSync(ENV_FILE, 'utf8');
    const m = txt.match(/^API_SERVER_KEY=(.+)$/m);
    if (m && m[1] && m[1].length >= 8) return m[1];
  }
  return randomBytes(32).toString('hex');
}

function buildEnv(input: { apiKey: string; apiHost: string; apiPort: string }): string {
  const profileTag = PROFILE ?? 'main';
  return [
    '# Generated by hermieos/scripts/hermes-profile-gen.ts',
    `# API server settings for the '${profileTag}' config`,
    `API_SERVER_ENABLED=true`,
    `API_SERVER_HOST=${input.apiHost}`,
    `API_SERVER_PORT=${input.apiPort}`,
    `API_SERVER_KEY=${input.apiKey}`,
    `API_SERVER_MODEL_NAME=${profileTag}`,
    '',
  ].join('\n');
}

async function main(): Promise<void> {
  // 1. find the user
  const email = process.env.HERMES_USER_EMAIL!;
  const [user] = await db
    .select({ id: schema.users.id, mcpToken: schema.users.mcpToken, email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);
  if (!user) {
    // eslint-disable-next-line no-console
    console.error(`No HermieOS user with email ${email}`);
    process.exit(1);
  }
  const mcpToken = process.env.HERMES_MCP_TOKEN ?? user.mcpToken;
  if (!mcpToken) {
    // eslint-disable-next-line no-console
    console.error(`User ${email} has no mcp_token; sign up first or set HERMES_MCP_TOKEN`);
    process.exit(1);
  }

  mkdirSync(PROFILE_DIR, { recursive: true });

  const apiKey = readOrGenerateApiKey();
  const apiHost = process.env.HERMES_API_HOST ?? '0.0.0.0';
  const apiPort = process.env.HERMES_API_PORT ?? '8642';
  const model = process.env.HERMES_MODEL ?? 'hermes-agent';
  const inferenceProvider = process.env.HERMES_INFERENCE_PROVIDER ?? 'auto';
  const inferenceBaseUrl = process.env.HERMES_INFERENCE_BASE_URL;
  const skillsExternalDirs = process.env.HERMES_SKILLS_EXTERNAL_DIRS
    ? process.env.HERMES_SKILLS_EXTERNAL_DIRS.split(':').filter(Boolean)
    : undefined;

  // Derive the MCP URL from HERMIEOS_MCP_MODE.
  //   'host'  -> http://host.docker.internal:<mcp_port>/mcp
  //   'docker'-> http://<container_name>:<mcp_port>/mcp
  // HERMES_MCP_URL wins as an explicit override.
  const mcpPort = process.env.HERMES_MCP_PORT ?? '3002';
  const mcpMode = (process.env.HERMIEOS_MCP_MODE ?? 'host').toLowerCase();
  const defaultMcpUrl =
    mcpMode === 'docker'
      ? `http://${process.env.HERMES_MCP_CONTAINER_NAME ?? 'hermieos-mcp'}:${mcpPort}/mcp`
      : `http://host.docker.internal:${mcpPort}/mcp`;
  const mcpUrl = process.env.HERMES_MCP_URL ?? defaultMcpUrl;

  // Read existing config to know what to preserve
  const existing = readConfig(CONFIG_FILE);

  // Write config.yaml (merging with existing)
  const merged = buildMergedConfig({
    mcpUrl,
    mcpToken,
    existing,
    model,
    inferenceProvider,
    inferenceBaseUrl,
    skillsExternalDirs,
  });
  const yaml = [
    '# Generated by hermieos/scripts/hermes-profile-gen.ts',
    '# The mcp_servers.hermieos block is owned by HermieOS; other',
    '# keys are preserved. Re-run after a token rotation to refresh.',
    '',
    YAML.stringify(merged, { indent: 2, lineWidth: 0 }),
  ].join('\n');
  writeFileSync(CONFIG_FILE, yaml, { encoding: 'utf8', mode: 0o600 });
  // eslint-disable-next-line no-console
  console.log(`wrote ${CONFIG_FILE} (merged with existing keys = [${Object.keys(existing).join(', ')}], mcp_url=${mcpUrl})`);

  // Write .env
  const env = buildEnv({ apiKey, apiHost, apiPort });
  writeFileSync(ENV_FILE, env, { encoding: 'utf8', mode: 0o600 });
  // eslint-disable-next-line no-console
  console.log(`wrote ${ENV_FILE} (api_key=${Object.keys(existing).length > 0 ? 'reused-or-set' : 'GENERATED'})`);

  await closeDatabase(db);
}

main().catch(async (err) => {
  // eslint-disable-next-line no-console
  console.error('mcp config writer failed:', err);
  await closeDatabase(db);
  process.exit(1);
});
