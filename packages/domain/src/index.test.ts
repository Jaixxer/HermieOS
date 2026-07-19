import { describe, expect, it } from 'vitest';
import {
  CADENCE_INTERVALS_MS,
  NOTIFY_USER_DAILY_LIMIT,
  RETRY_BACKOFFS_MS,
  createObjectArgsSchema,
  notifyUserArgsSchema,
  signupArgsSchema,
} from './index.js';

describe('domain schemas', () => {
  it('accepts a valid create_object payload', () => {
    const parsed = createObjectArgsSchema.parse({
      type: 'research',
      title: 'ESP32 power optimization',
      source: 'hermes-run-1',
    });
    expect(parsed.type).toBe('research');
  });

  it('rejects a create_object with no title', () => {
    expect(() =>
      createObjectArgsSchema.parse({ type: 'research', source: 'hermes-run-1' }),
    ).toThrow();
  });

  it('exposes the notify rate limit constant', () => {
    expect(NOTIFY_USER_DAILY_LIMIT).toBe(5);
  });

  it('has the expected retry backoffs (1m, 5m, 15m)', () => {
    expect(RETRY_BACKOFFS_MS).toEqual([60_000, 300_000, 900_000]);
  });

  it('exposes known cadences', () => {
    expect(CADENCE_INTERVALS_MS.hourly).toBe(3_600_000);
    expect(CADENCE_INTERVALS_MS.daily).toBe(86_400_000);
  });

  it('accepts a valid notify_user payload', () => {
    const parsed = notifyUserArgsSchema.parse({
      title: 'x',
      message: 'y',
      priority: 'high',
      source: 'hermes-run-2',
    });
    expect(parsed.priority).toBe('high');
  });

  it('requires a long-enough password on signup', () => {
    expect(() =>
      signupArgsSchema.parse({ email: 'a@b.co', password: 'short', displayName: 'A' }),
    ).toThrow();
  });
});
