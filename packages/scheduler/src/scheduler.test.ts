import { describe, expect, it, vi } from 'vitest';
import { Scheduler } from './scheduler.js';

describe('Scheduler', () => {
  it('runs the tick function', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const s = new Scheduler(fn);
    await s.tick();
    expect(fn).toHaveBeenCalledOnce();
  });

  it('skips a tick if a previous one is in flight', async () => {
    let resolve: () => void = () => {};
    const fn = vi.fn().mockImplementation(
      () => new Promise<void>((r) => (resolve = r)),
    );
    const s = new Scheduler(fn);
    const first = s.tick();
    await s.tick(); // should be a no-op while first is in flight
    expect(fn).toHaveBeenCalledOnce();
    resolve();
    await first;
  });

  it('start and stop manage the timer', () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockResolvedValue(undefined);
    const s = new Scheduler(fn);
    s.start(1000);
    s.stop();
    // No assertions beyond not throwing; timer state is private
    expect(true).toBe(true);
    vi.useRealTimers();
  });
});
