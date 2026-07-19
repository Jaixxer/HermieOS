import { describe, expect, it, vi } from 'vitest';
import { TtlCache } from './index.js';

describe('TtlCache', () => {
  it('returns undefined for missing keys', () => {
    const c = new TtlCache<string, number>({ ttlMs: 1000 });
    expect(c.get('x')).toBeUndefined();
  });

  it('returns the value when not expired', () => {
    const c = new TtlCache<string, number>({ ttlMs: 1000 });
    c.set('x', 42);
    expect(c.get('x')).toBe(42);
  });

  it('expires after ttl', () => {
    let now = 1_000_000;
    const c = new TtlCache<string, number>({ ttlMs: 100, now: () => now });
    c.set('x', 42);
    now += 50;
    expect(c.get('x')).toBe(42);
    now += 200;
    expect(c.get('x')).toBeUndefined();
  });

  it('respects maxEntries by dropping the oldest', () => {
    const c = new TtlCache<string, number>({ ttlMs: 10_000, maxEntries: 2 });
    c.set('a', 1);
    c.set('b', 2);
    c.set('c', 3);
    expect(c.get('a')).toBeUndefined();
    expect(c.get('b')).toBe(2);
    expect(c.get('c')).toBe(3);
    expect(c.size).toBe(2);
  });

  it('delete works', () => {
    const c = new TtlCache<string, number>({ ttlMs: 1000 });
    c.set('x', 1);
    expect(c.delete('x')).toBe(true);
    expect(c.get('x')).toBeUndefined();
    expect(c.delete('x')).toBe(false);
  });

  it('uses injected clock', () => {
    const spy = vi.fn(() => 1_000_000);
    const c = new TtlCache<string, number>({ ttlMs: 100, now: spy });
    c.set('x', 1);
    expect(spy).toHaveBeenCalled();
  });
});
