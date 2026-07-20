/**
 * Hermes capabilities probe.
 *
 * Hits GET /v1/capabilities on a running Hermes (real or fake) and
 * prints the advertised feature flags. Used to verify that the
 * Hermes container is up and the scheduler can rely on the run
 * tracking surface (/v1/runs/{id}, /v1/runs/{id}/stop, etc).
 *
 * Env:
 *   HERMES_GATEWAY_URL  - base URL, default http://127.0.0.1:8642
 *   HERMES_API_KEY      - bearer, default empty
 */
const url = `${process.env.HERMES_GATEWAY_URL ?? 'http://127.0.0.1:8642'}/v1/capabilities`;
const key = process.env.HERMES_API_KEY ?? '';

async function main(): Promise<void> {
  const t0 = Date.now();
  const headers: Record<string, string> = { accept: 'application/json' };
  if (key) headers['authorization'] = `Bearer ${key}`;
  const res = await fetch(url, { method: 'GET', headers });
  const elapsed = Date.now() - t0;
  if (!res.ok) {
    // eslint-disable-next-line no-console
    console.error(`hermes ${res.status} ${res.statusText} (${elapsed}ms)`);
    process.exit(1);
  }
  const body = (await res.json()) as {
    object?: string;
    platform?: string;
    model?: string;
    auth?: { type: string; required: boolean };
    features?: Record<string, boolean>;
  };
  // eslint-disable-next-line no-console
  console.log(`hermes capabilities (${elapsed}ms):`);
  // eslint-disable-next-line no-console
  console.log(`  platform: ${body.platform ?? '?'}`);
  // eslint-disable-next-line no-console
  console.log(`  model: ${body.model ?? '?'}`);
  // eslint-disable-next-line no-console
  console.log(`  auth: ${body.auth?.type ?? '?'} (required: ${body.auth?.required ?? '?'})`);
  // eslint-disable-next-line no-console
  console.log('  features:');
  for (const [k, v] of Object.entries(body.features ?? {})) {
    // eslint-disable-next-line no-console
    console.log(`    ${k}: ${v}`);
  }
  // The scheduler depends on these three:
  const required: Array<[string, string]> = [
    ['run_submission', 'POST /v1/runs'],
    ['run_status', 'GET /v1/runs/{id}'],
    ['run_stop', 'POST /v1/runs/{id}/stop'],
  ];
  let missing = 0;
  for (const [flag, endpoint] of required) {
    if (!body.features?.[flag]) {
      // eslint-disable-next-line no-console
      console.error(`  MISSING: ${flag} (${endpoint})`);
      missing += 1;
    }
  }
  if (missing > 0) {
    // eslint-disable-next-line no-console
    console.error(`\n  ${missing} required feature(s) missing; scheduler run tracking will fail.`);
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.log('\n  OK — required run tracking endpoints are advertised.');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('probe failed:', err);
  process.exit(1);
});
