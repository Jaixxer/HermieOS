#!/usr/bin/env tsx
/**
 * Live end-to-end check for the chat flow:
 *   1. Login to the API to get a session cookie.
 *   2. Read /me/hermes-info to get the Hermes base URL + token.
 *   3. List existing sessions.
 *   4. Create a new session.
 *   5. Send a message and read the assistant response.
 *   6. Read messages back and verify both user + assistant bubbles exist.
 *
 * Exits 0 on success, 1 on failure. Logs a green/red summary line.
 */
import { setTimeout as sleep } from 'node:timers/promises';

const API = process.env.API_BASE ?? 'http://localhost:3001';
const EMAIL = process.env.HERMIEOS_TEST_EMAIL ?? 'jaiveersk25@gmail.com';
const PASSWORD = process.env.HERMIEOS_TEST_PASSWORD ?? 'testpassword1!';

async function http<T>(url: string, init: RequestInit = {}): Promise<{ status: number; body: T; setCookie: string | null }> {
  const res = await fetch(url, init);
  const setCookie = res.headers.get('set-cookie');
  const text = await res.text();
  let body: T;
  try {
    body = text ? (JSON.parse(text) as T) : ({} as T);
  } catch {
    body = text as unknown as T;
  }
  return { status: res.status, body, setCookie };
}

function pass(msg: string): void {
  process.stdout.write(`  \u001b[32m✓\u001b[0m ${msg}\n`);
}
function fail(msg: string): void {
  process.stdout.write(`  \u001b[31m✗\u001b[0m ${msg}\n`);
  process.exitCode = 1;
}

async function main(): Promise<void> {
  process.stdout.write('chat live check\n');

  // 1. Login
  const login = await http<{ user: { id: string }; token: string; mcpToken: string }>(
    `${API}/auth/login`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    },
  );
  if (login.status !== 200) {
    fail(`login failed: ${login.status} ${JSON.stringify(login.body)}`);
    return;
  }
  pass('login');
  const cookie = login.setCookie?.split(';')[0] ?? '';
  if (!cookie.startsWith('hermieos_session=')) {
    fail(`no session cookie in login response`);
    return;
  }

  // 2. Hermes info
  const info = await http<{ baseUrl: string; token: string }>(`${API}/me/hermes-info`, {
    headers: { cookie },
  });
  if (info.status !== 200 || !info.body.baseUrl || !info.body.token) {
    fail(`/me/hermes-info returned ${info.status} ${JSON.stringify(info.body)}`);
    return;
  }
  pass(`/me/hermes-info → ${info.body.baseUrl}`);

  // 3. List sessions
  const list = await http<{ data: Array<{ id: string; source: string }> }>(
    `${info.body.baseUrl}/api/sessions?limit=10`,
    { headers: { authorization: `Bearer ${info.body.token}` } },
  );
  if (list.status !== 200) {
    fail(`list sessions failed: ${list.status} ${JSON.stringify(list.body)}`);
    return;
  }
  pass(`list sessions (${list.body.data?.length ?? 0} sessions)`);

  // 4. Create session
  const create = await http<{ session: { id: string; source: string; model: string } }>(
    `${info.body.baseUrl}/api/sessions`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${info.body.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ source: 'api_server', model: 'hermes-agent' }),
    },
  );
  if (create.status !== 201 || !create.body.session?.id) {
    fail(`create session failed: ${create.status} ${JSON.stringify(create.body)}`);
    return;
  }
  const sessionId = create.body.session.id;
  pass(`create session ${sessionId}`);

  // 5. Send message
  const send = await http<{ message: { role: string; content: string } }>(
    `${info.body.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/chat`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${info.body.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ message: 'Reply with the single word: ok' }),
    },
  );
  if (send.status !== 200 || !send.body.message?.content) {
    fail(`chat failed: ${send.status} ${JSON.stringify(send.body)}`);
    return;
  }
  const reply = send.body.message.content.trim();
  if (!reply) {
    fail('chat returned empty content');
    return;
  }
  pass(`chat reply (${reply.length} chars)`);

  // 6. Verify messages list
  const msgs = await http<{ data: Array<{ role: string; content: string }> }>(
    `${info.body.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/messages`,
    { headers: { authorization: `Bearer ${info.body.token}` } },
  );
  if (msgs.status !== 200) {
    fail(`read messages failed: ${msgs.status}`);
    return;
  }
  const roles = (msgs.body.data ?? []).map((m) => m.role);
  if (!roles.includes('user') || !roles.includes('assistant')) {
    fail(`expected both user + assistant in messages, got: ${roles.join(',')}`);
    return;
  }
  pass(`messages: ${roles.join(', ')}`);

  // Cleanup: delete the test session
  await http(`${info.body.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${info.body.token}` },
  });
  pass(`cleanup session ${sessionId}`);

  // small grace to allow downstream logs to flush
  await sleep(50);
  process.stdout.write(process.exitCode === 1 ? '\nchat live check: \u001b[31mFAIL\u001b[0m\n' : '\nchat live check: \u001b[32mPASS\u001b[0m\n');
}

main().catch((err) => {
  fail(`uncaught: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
});
