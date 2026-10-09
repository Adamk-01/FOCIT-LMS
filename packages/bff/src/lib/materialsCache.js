/**
 * Bounded In-Memory L1 Cache with Stale-While-Revalidate (SWR) Mechanics
 *
 * Implements:
 * 1. Two-Tier TTL: Fresh (5 min) and Stale (60 min).
 * 2. Bounded Heap Footprint: Strict LRU eviction capped at 500 courses (<15MB V8 heap).
 * 3. Zero Redis Coupling: Operates completely autonomously in local process memory.
 */

const DEFAULT_FRESH_TTL_MS = 5 * 60 * 1000;    // 5 minutes
const DEFAULT_STALE_TTL_MS = 60 * 60 * 1000;   // 60 minutes
const MAX_CACHE_ENTRIES = 500;

export class MaterialsCache {
  /**
   * @param {object} [options]
   * @param {number} [options.freshTtlMs]
   * @param {number} [options.staleTtlMs]
   * @param {number} [options.maxEntries]
   */
  constructor(options = {}) {
    this.freshTtlMs = options.freshTtlMs ?? DEFAULT_FRESH_TTL_MS;
    this.staleTtlMs = options.staleTtlMs ?? DEFAULT_STALE_TTL_MS;
    this.maxEntries = options.maxEntries ?? MAX_CACHE_ENTRIES;

    /** @type {Map<string, { data: any, fetchedAtMs: number, freshUntilMs: number, staleUntilMs: number }>} */
    this.store = new Map();
  }

  /**
   * Reads from the cache, categorizing the entry as 'FRESH', 'STALE', or 'MISS'.
   * Updates LRU access ordering on hit.
   *
   * @param {string|number} key
   * @returns {{ status: 'FRESH'|'STALE'|'MISS', data: any|null }}
   */
  get(key) {
    const stringKey = String(key);
    const entry = this.store.get(stringKey);

    if (!entry) {
      return { status: 'MISS', data: null };
    }

    const now = Date.now();

    // Expired past the maximum stale boundary -> Hard evict
    if (now > entry.staleUntilMs) {
      this.store.delete(stringKey);
      return { status: 'MISS', data: null };
    }

    // Refresh LRU ordering (re-insert at end of Map keys)
    this.store.delete(stringKey);
    this.store.set(stringKey, entry);

    if (now <= entry.freshUntilMs) {
      return { status: 'FRESH', data: entry.data };
    }

    // Between freshUntilMs and staleUntilMs
    return { status: 'STALE', data: entry.data };
  }

  /**
   * Stores freshly fetched data with two-tier TTL boundaries.
   * Evicts least-recently-used item if capacity is exceeded.
   *
   * @param {string|number} key
   * @param {any} data
   */
  set(key, data) {
    const stringKey = String(key);
    const now = Date.now();

    // Enforce bounded heap footprint: evict oldest entry if at capacity
    if (this.store.size >= this.maxEntries && !this.store.has(stringKey)) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) {
        this.store.delete(oldestKey);
      }
    }

    this.store.set(stringKey, {
      data,
      fetchedAtMs: now,
      freshUntilMs: now + this.freshTtlMs,
      staleUntilMs: now + this.staleTtlMs,
    });
  }

  /**
   * Administrative purge of a cache entry.
   * @param {string|number} key
   */
  invalidate(key) {
    this.store.delete(String(key));
  }

  /**
   * Total number of cached entries.
   * @returns {number}
   */
  get size() {
    return this.store.size;
  }

  /**
   * Clears the entire cache store.
   */
  clear() {
    this.store.clear();
  }
}

export const materialsCache = new MaterialsCache();
