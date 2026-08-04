/**
 * Shared Hermes gateway session helpers for the API.
 *
 * Both finding conversations (discuss.ts) and task delegation
 * (dashboard.ts) create/reuse deterministic gateway sessions and post
 * context-seeded messages. This module is the single home for that.
 */
import { HermesClient } from '@hermieos/gateway';

/**
 * Build a HermesClient from env, mirroring the scheduler's config.
 */
export function gatewayFromEnv(): HermesClient | null {
  const baseUrl = process.env.HERMES_GATEWAY_URL;
  const apiKey = process.env.HERMES_API_KEY ?? process.env.HERMES_GATEWAY_KEY;
  if (!baseUrl || !apiKey) return null;
  return new HermesClient({ baseUrl, apiKey, timeoutMs: 15_000, maxRetries: 0 });
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/**
 * Ensure a deterministic gateway session exists (create it with the
 * given title if missing). Concurrent creates are tolerated — the
 * chat call surfaces a clean error if it is still missing.
 */
export async function ensureGatewaySession(
  gateway: HermesClient,
  sessionId: string,
  title: string,
): Promise<void> {
  try {
    await gateway.getSession(sessionId);
    return;
  } catch {
    // not found — create it below
  }
  try {
    await gateway.createSession({
      id: sessionId,
      title: truncate(title, 200),
      source: 'api_server',
    });
  } catch {
    // A concurrent create won the race; the session now exists.
  }
}
