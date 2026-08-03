import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { HermesClient, isTerminalRunStatus, isSuccessRunStatus } from './hermes-client.js';
import { makeFakeHermes, type FakeHermes } from './test-helpers/fake-hermes.js';

let hermes: FakeHermes;
let client: HermesClient;

beforeAll(async () => {
  hermes = await makeFakeHermes();
  client = new HermesClient({ baseUrl: hermes.url, apiKey: 'test-key', maxRetries: 0 });
});
afterAll(async () => {
  await hermes.close();
});

describe('HermesClient — capabilities, getRun, stopRun', () => {
  it('getCapabilities() returns the advertised feature flags', async () => {
    const caps = await client.getCapabilities();
    expect(caps.features?.run_submission).toBe(true);
    expect(caps.features?.run_status).toBe(true);
    expect(caps.features?.run_stop).toBe(true);
  });

  it('getRun() returns the run status from the gateway', async () => {
    const status = await client.getRun('run_abc');
    expect(status.runId).toBe('run_abc');
    expect(status.status).toBe('succeeded');
  });

  it('getRun() reflects the configured status (per-run override)', async () => {
    hermes.setMode({ runStatuses: { 'run_specific': 'running' } });
    const status = await client.getRun('run_specific');
    expect(status.status).toBe('running');
  });

  it('getRun() walks through the progress sequence when progressOnPoll is on', async () => {
    hermes.setMode({ progressOnPoll: true });
    const a = await client.getRun('run_progressive');
    const b = await client.getRun('run_progressive');
    const c = await client.getRun('run_progressive');
    expect(a.status).toBe('started');
    expect(b.status).toBe('running');
    expect(c.status).toBe('succeeded');
  });

  it('stopRun() returns 200 (no throw)', async () => {
    await expect(client.stopRun('run_xyz')).resolves.toBeUndefined();
  });

  it('dispatchRun -> getRun -> stopRun round-trip', async () => {
    hermes.setMode({});
    const dispatched = await client.dispatchRun({
      hermieosRunId: 'hr-1',
      userId: 'u-1',
      kind: 'subscription',
      input: 'hello',
    });
    expect(dispatched.hermesRunId).toMatch(/^run_/);
    const status = await client.getRun(dispatched.hermesRunId);
    expect(status.status).toBe('succeeded');
    await client.stopRun(dispatched.hermesRunId);
  });
});

describe('run status helpers', () => {
  it('isTerminalRunStatus recognizes the four terminal states', () => {
    expect(isTerminalRunStatus('succeeded')).toBe(true);
    expect(isTerminalRunStatus('completed')).toBe(true);
    expect(isTerminalRunStatus('failed')).toBe(true);
    expect(isTerminalRunStatus('cancelled')).toBe(true);
    expect(isTerminalRunStatus('running')).toBe(false);
    expect(isTerminalRunStatus('started')).toBe(false);
    expect(isTerminalRunStatus('stopping')).toBe(false);
  });

  it('isSuccessRunStatus treats both "succeeded" and "completed" as success', () => {
    expect(isSuccessRunStatus('succeeded')).toBe(true);
    expect(isSuccessRunStatus('completed')).toBe(true);
    expect(isSuccessRunStatus('failed')).toBe(false);
    expect(isSuccessRunStatus('cancelled')).toBe(false);
  });
});

describe('HermesClient — session isolation', () => {
  it('dispatchRun sends x-hermes-session-key: hermieos:user-<id> for per-user Honcho memory scoping', async () => {
    hermes.setMode({});
    const dispatched = await client.dispatchRun({
      hermieosRunId: 'hr-iso-1',
      userId: 'user-aaaa',
      kind: 'subscription',
      input: 'iso test',
    });
    expect(dispatched.hermesRunId).toMatch(/^run_/);
    // The recorded run is keyed by the mcp-session-id we sent in the
    // body. Verify the per-user session key + Authorization header.
    const rec = hermes.recorded.find((r) => r.sessionId === 'hermieos-run-hr-iso-1');
    expect(rec).toBeDefined();
    expect(rec?.userId).toBe('hermieos:user-user-aaaa');
    expect(rec?.authorization).toBe('Bearer test-key');
  });

  it('two users with different ids get different session keys', async () => {
    hermes.setMode({});
    await client.dispatchRun({
      hermieosRunId: 'hr-iso-2',
      userId: 'alice',
      kind: 'subscription',
      input: 'x',
    });
    await client.dispatchRun({
      hermieosRunId: 'hr-iso-3',
      userId: 'bob',
      kind: 'subscription',
      input: 'y',
    });
    const alice = hermes.recorded.find((r) => r.sessionId === 'hermieos-run-hr-iso-2');
    const bob = hermes.recorded.find((r) => r.sessionId === 'hermieos-run-hr-iso-3');
    expect(alice?.userId).toBe('hermieos:user-alice');
    expect(bob?.userId).toBe('hermieos:user-bob');
    expect(alice?.userId).not.toBe(bob?.userId);
  });

  it('each dispatch carries an mcp-session-id derived from the hermieos run id', async () => {
    hermes.setMode({});
    await client.dispatchRun({
      hermieosRunId: 'hr-iso-4',
      userId: 'u',
      kind: 'subscription',
      input: 'x',
    });
    const rec = hermes.recorded.find((r) => r.sessionId === 'hermieos-run-hr-iso-4');
    expect(rec).toBeDefined();
  });
});

describe('HermesClient — sessions + chat', () => {
  it('createSession honors a deterministic id and getSession reads it back', async () => {
    const created = await client.createSession({ id: 'finding-obj-1', title: 'ESP32 paper', source: 'api_server' });
    expect(created.session.id).toBe('finding-obj-1');
    const got = await client.getSession('finding-obj-1');
    expect(got.session.id).toBe('finding-obj-1');
  });

  it('createSession with an existing id returns 409 (resume semantics)', async () => {
    await client.createSession({ id: 'finding-dup' });
    await expect(client.createSession({ id: 'finding-dup' })).rejects.toThrow(/409|already exists/i);
  });

  it('chat posts a user turn and records the assistant reply in messages', async () => {
    await client.createSession({ id: 'finding-chat-1' });
    const reply = await client.chat('finding-chat-1', { message: 'summarize this paper' });
    expect(reply.message.role).toBe('assistant');
    expect(reply.message.content).toBe('echo: summarize this paper');
    const msgs = await client.getMessages('finding-chat-1');
    expect(msgs.data).toHaveLength(2);
    expect(msgs.data[0]?.role).toBe('user');
    expect(msgs.data[1]?.role).toBe('assistant');
  });

  it('chat on a missing session surfaces the 404', async () => {
    await expect(client.chat('finding-nope', { message: 'hi' })).rejects.toThrow(/404|not found/i);
  });

  it('renameSession updates the title; listSessions reflects the source filter', async () => {
    await client.createSession({ id: 'finding-rename', source: 'api_server' });
    await client.renameSession('finding-rename', 'Renamed');
    const got = await client.getSession('finding-rename');
    expect(got.session.title).toBe('Renamed');

    const all = await client.listSessions({ source: 'api_server', limit: 50 });
    const ids = all.data.map((s) => s.id);
    expect(ids).toContain('finding-rename');
    const none = await client.listSessions({ source: 'telegram' });
    expect(none.data.some((s) => s.id === 'finding-rename')).toBe(false);
  });

  it('deleteSession removes the session', async () => {
    await client.createSession({ id: 'finding-del' });
    await client.deleteSession('finding-del');
    await expect(client.getSession('finding-del')).rejects.toThrow(/404|not found/i);
  });
});
