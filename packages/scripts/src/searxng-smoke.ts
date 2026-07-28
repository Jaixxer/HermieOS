/**
 * SearXNG smoke test — verifies that the local SearXNG container is up,
 * the JSON API works, and the Hermes profile is wired to it.
 *
 * Run with: tsx packages/scripts/src/searxng-smoke.ts
 *
 * Exits 0 on success, 1 on any failure. Prints a clear summary.
 */
import { execFileSync } from 'node:child_process';

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

const SEARXNG_HOST = process.env.SEARXNG_HOST ?? 'http://localhost:8888';
const HERMES_CONTAINER = process.env.HERMES_CONTAINER ?? 'hermieos-hermes';

function dockerExec(args: string[]): string {
  try {
    return execFileSync('docker', ['exec', HERMES_CONTAINER, ...args], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (e) {
    const err = e as { stderr?: Buffer; stdout?: Buffer; message?: string };
    const out = (err.stderr ?? err.stdout ?? Buffer.from(err.message ?? '')).toString();
    throw new Error(out || err.message || 'docker exec failed');
  }
}

async function main(): Promise<void> {
  const checks: Check[] = [];

  // 1. SearXNG is reachable on the host
  try {
    const res = await fetch(`${SEARXNG_HOST}/`, { method: 'GET' });
    checks.push({
      name: `SearXNG HTTP ${SEARXNG_HOST}/`,
      ok: res.status === 200,
      detail: `status ${res.status}`,
    });
  } catch (e) {
    checks.push({ name: 'SearXNG reachable', ok: false, detail: (e as Error).message });
  }

  // 2. JSON API works
  try {
    const url = `${SEARXNG_HOST}/search?q=hermieos&format=json`;
    const res = await fetch(url);
    const body = (await res.json()) as { results?: unknown[]; answers?: unknown[] };
    const count = (body.results?.length ?? 0) + (body.answers?.length ?? 0);
    checks.push({
      name: 'SearXNG JSON API',
      ok: res.status === 200 && count > 0,
      detail: `${count} results for "hermieos"`,
    });
  } catch (e) {
    checks.push({ name: 'SearXNG JSON API', ok: false, detail: (e as Error).message });
  }

  // 3. Hermes web.backend is searxng
  try {
    const out = dockerExec(['hermes', 'config', 'get', 'web']);
    const hasSearxng = /^backend:\s*searxng\s*$/m.test(out);
    checks.push({
      name: 'Hermes web.backend = searxng',
      ok: hasSearxng,
      detail: hasSearxng ? 'set' : `got: ${out.split('\n').slice(0, 3).join(' / ')}`,
    });
  } catch (e) {
    checks.push({ name: 'Hermes web.backend = searxng', ok: false, detail: (e as Error).message });
  }

  // 4. SEARXNG_URL is reachable from the hermes container
  try {
    const out = dockerExec(['sh', '-c', 'curl -sf http://searxng:8080/ -o /dev/null && echo ok || echo fail']);
    checks.push({
      name: 'Hermes → searxng:8080',
      ok: out === 'ok',
      detail: out,
    });
  } catch (e) {
    checks.push({ name: 'Hermes → searxng:8080', ok: false, detail: (e as Error).message });
  }

  // 5. Web toolset is enabled
  try {
    const out = dockerExec(['hermes', 'tools', 'list']);
    const enabled = /web\s+.*Web Search/i.test(out);
    checks.push({
      name: 'Hermes "web" toolset enabled',
      ok: enabled,
      detail: enabled ? 'web_search available' : 'web not found in hermes tools list',
    });
  } catch (e) {
    checks.push({ name: 'Hermes "web" toolset enabled', ok: false, detail: (e as Error).message });
  }

  // Report
  const failed = checks.filter((c) => !c.ok);
  for (const c of checks) {
    const mark = c.ok ? '\u001b[32m✓\u001b[0m' : '\u001b[31m✗\u001b[0m';
    // eslint-disable-next-line no-console
    console.log(`${mark} ${c.name}  (${c.detail})`);
  }
  // eslint-disable-next-line no-console
  console.log('');
  // eslint-disable-next-line no-console
  console.log(`${checks.length - failed.length}/${checks.length} checks passed`);

  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
