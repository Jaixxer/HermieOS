export interface TtlCacheOptions {
  ttlMs: number;
  /** Optional max entries. 0 = unbounded. Default 0. */
  maxEntries?: number;
  /** Optional clock for tests. */
  now?: () => number;
}

interface Entry<V> {
  value: V;
  expiresAt: number;
}

export class TtlCache<K, V> {
  private readonly map = new Map<K, Entry<V>>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(opts: TtlCacheOptions) {
    this.ttlMs = opts.ttlMs;
    this.maxEntries = opts.maxEntries ?? 0;
    this.now = opts.now ?? Date.now;
  }

  get(key: K): V | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (e.expiresAt <= this.now()) {
      this.map.delete(key);
      return undefined;
    }
    return e.value;
  }

  set(key: K, value: V): void {
    if (this.maxEntries > 0 && this.map.size >= this.maxEntries && !this.map.has(key)) {
      // drop oldest
      const first = this.map.keys().next().value;
      if (first !== undefined) this.map.delete(first);
    }
    this.map.set(key, { value, expiresAt: this.now() + this.ttlMs });
  }

  delete(key: K): boolean {
    return this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}

export function createTtlCache<K, V>(opts: TtlCacheOptions): TtlCache<K, V> {
  return new TtlCache<K, V>(opts);
}
