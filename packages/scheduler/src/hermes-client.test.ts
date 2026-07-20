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
