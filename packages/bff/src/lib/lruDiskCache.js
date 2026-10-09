import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export class LRUDiskCache {
  constructor(cacheDir, maxSizeBytes) {
    this.cacheDir = cacheDir;
    this.maxSizeBytes = maxSizeBytes;
    this.currentSizeBytes = 0;
    
    // Pessimistic space reservation ledger
    this.reservedBytes = 0;
    
    this.entries = new Map(); // key -> { path, size, lastAccessed }
    this.inflight = new Map(); // key -> Promise<path>
  }

  async init() {
    await fs.mkdir(this.cacheDir, { recursive: true });
    // In a full production setup, a directory sweep would occur here to rebuild 
    // the `entries` map and `currentSizeBytes` across server restarts.
  }

  has(key) {
    return this.entries.has(key);
  }

  isInflight(key) {
    return this.inflight.has(key);
  }

  async getOrWait(key) {
    // Await the active Promise lock if a concurrent request is downloading it
    if (this.inflight.has(key)) {
      await this.inflight.get(key);
    }
    
    const meta = this.entries.get(key);
    if (!meta) throw new Error('Cache miss after waiting for lock');
    
    meta.lastAccessed = Date.now();
    return meta.path;
  }

  async _evictToFit(neededBytes) {
    // Calculates eviction target using physically written bytes + synchronously reserved bytes
    while (this.currentSizeBytes + this.reservedBytes + neededBytes > this.maxSizeBytes) {
      if (this.entries.size === 0) break; // Cannot evict further

      let oldestKey;
      let oldestTime = Infinity;
      
      for (const [key, meta] of this.entries.entries()) {
        if (meta.lastAccessed < oldestTime) {
          oldestTime = meta.lastAccessed;
          oldestKey = key;
        }
      }

      if (oldestKey) {
        const meta = this.entries.get(oldestKey);
        this.entries.delete(oldestKey);
        await fs.unlink(meta.path).catch(() => {});
        this.currentSizeBytes -= meta.size;
      }
    }
  }

  writeToCache(key, upstreamBody, rawContentLength) {
    // 1. Sanitize the header: Never trust upstream payload metadata blindly
    let initialReservation = parseInt(rawContentLength, 10);
    if (Number.isNaN(initialReservation) || initialReservation <= 0) {
      initialReservation = 10 * 1024 * 1024; // Fallback to 10MB chunk for missing headers
    }
    
    // Hard ceiling for a single file to prevent unbounded growth
    const MAX_FILE_SIZE = 500 * 1024 * 1024; 
    if (initialReservation > MAX_FILE_SIZE) {
      throw new Error('File exceeds maximum allowed cache size');
    }

    // 2. Pessimistic Space Reservation
    this.reservedBytes += initialReservation;

    const safeKey = crypto.createHash('md5').update(key).digest('hex');
    const localPath = path.join(this.cacheDir, `${safeKey}.bin`);

    const downloadPromise = (async () => {
      let actualReservation = initialReservation;
      let totalBytesStreamed = 0;
      
      try {
        await this._evictToFit(actualReservation);

        const writeStream = createWriteStream(localPath);
        const self = this;

        // 3. Active Byte-Counter Transform Stream
        const { Transform } = await import('node:stream');
        const quotaGuard = new Transform({
          async transform(chunk, encoding, callback) {
            totalBytesStreamed += chunk.length;

            // Instantly abort if it breaches the hard architectural limit
            if (totalBytesStreamed > MAX_FILE_SIZE) {
              return callback(new Error('QUOTA_EXCEEDED: Stream exceeded maximum allowed file size'));
            }

            // Dynamically reserve more space if the stream exceeds a malicious/missing header
            if (totalBytesStreamed > actualReservation) {
              const extraNeeded = Math.max(chunk.length, 10 * 1024 * 1024); // Grab in 10MB blocks
              try {
                await self._evictToFit(extraNeeded);
                self.reservedBytes += extraNeeded;
                actualReservation += extraNeeded;
              } catch (err) {
                return callback(new Error('QUOTA_EXCEEDED: Dynamic cache allocation failed'));
              }
            }

            callback(null, chunk);
          }
        });

        await pipeline(upstreamBody, quotaGuard, writeStream);

        const stat = await fs.stat(localPath);
        
        this.currentSizeBytes += stat.size;
        this.entries.set(key, {
          path: localPath,
          size: stat.size,
          lastAccessed: Date.now()
        });

        return localPath;
      } catch (err) {
        // 2. Strict In-Flight Cleanup
        // If the Moodle stream drops or the disk write fails, destroy the corrupted file
        await fs.unlink(localPath).catch(() => {});
        throw err;
      } finally {
        this.reservedBytes -= actualReservation;
        this.inflight.delete(key);
      }
    })();

    this.inflight.set(key, downloadPromise);
    return downloadPromise;
  }
}
