interface CacheEntry<V> {
  expiresAt: number;
  value: Promise<V>;
}

/** Small bounded cache that also coalesces concurrent requests for one key. */
export class AsyncTtlCache<K, V> {
  private readonly entries = new Map<K, CacheEntry<V>>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
    private readonly now: () => number = Date.now,
  ) {}

  getOrCreate(key: K, factory: () => Promise<V>): Promise<V> {
    const timestamp = this.now();
    const existing = this.entries.get(key);
    if (existing && existing.expiresAt > timestamp) {
      this.entries.delete(key);
      this.entries.set(key, existing);
      return existing.value;
    }
    if (existing) this.entries.delete(key);

    const value = factory();
    if (this.ttlMs <= 0) return value;

    const entry: CacheEntry<V> = { expiresAt: timestamp + this.ttlMs, value };
    this.entries.set(key, entry);
    this.evictExpiredAndOverflow(timestamp);
    void value.catch(() => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
    });
    return value;
  }

  clear(): void {
    this.entries.clear();
  }

  private evictExpiredAndOverflow(timestamp: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= timestamp) this.entries.delete(key);
    }
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as K | undefined;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}
