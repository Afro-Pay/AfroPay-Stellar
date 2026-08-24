import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { randomUUID } from 'crypto';

export const LOCK_TTL_MS = 10_000;
const HEARTBEAT_INTERVAL_MS = 3_000;
const RELEASE_SCRIPT =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
const EXTEND_SCRIPT =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end";

export class LockNotAcquiredError extends Error {
  constructor(key: string) {
    super(`Lock is already held: ${key}`);
    this.name = 'LockNotAcquiredError';
  }
}

export class LockLostError extends Error {
  constructor(key: string) {
    super(`Lock lease was lost: ${key}`);
    this.name = 'LockLostError';
  }
}

export interface RedisLock {
  readonly key: string;
  extend(): Promise<void>;
  release(): Promise<void>;
}

class InMemoryRedisLockStore {
  private readonly entries = new Map<string, { token: string; expiresAt: number }>();

  acquire(key: string, token: string, ttlMs: number): boolean {
    const current = this.entries.get(key);
    if (current && current.expiresAt > Date.now()) return false;
    this.entries.set(key, { token, expiresAt: Date.now() + ttlMs });
    return true;
  }

  extend(key: string, token: string, ttlMs: number): boolean {
    const current = this.entries.get(key);
    if (!current || current.token !== token || current.expiresAt <= Date.now()) return false;
    current.expiresAt = Date.now() + ttlMs;
    return true;
  }

  release(key: string, token: string): boolean {
    const current = this.entries.get(key);
    if (!current || current.token !== token) return false;
    this.entries.delete(key);
    return true;
  }
}

@Injectable()
export class RedisLockService implements OnModuleDestroy {
  private static readonly testStore = new InMemoryRedisLockStore();
  private readonly redis?: Redis;
  private readonly memory?: InMemoryRedisLockStore;

  constructor() {
    const redisUrl = process.env.REDIS_URL;
    if (process.env.NODE_ENV === 'test' || !redisUrl) {
      this.memory = RedisLockService.testStore;
    } else {
      this.redis = new Redis(redisUrl);
    }
  }

  async acquire(key: string, ttlMs = LOCK_TTL_MS): Promise<RedisLock> {
    const token = randomUUID();
    const acquired = this.memory
      ? this.memory.acquire(key, token, ttlMs)
      : (await this.redis!.set(key, token, 'PX', ttlMs, 'NX')) === 'OK';
    if (!acquired) throw new LockNotAcquiredError(key);

    let stopped = false;
    let lost = false;
    const extend = async () => {
      const renewed = this.memory
        ? this.memory.extend(key, token, ttlMs)
        : Number(await this.redis!.eval(EXTEND_SCRIPT, 1, key, token, ttlMs));
      if (!renewed) {
        lost = true;
        throw new LockLostError(key);
      }
    };
    const heartbeat = async () => {
      while (!stopped) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, HEARTBEAT_INTERVAL_MS);
          timer.unref?.();
        });
        if (!stopped) {
          try {
            await extend();
          } catch {
            lost = true;
            return;
          }
        }
      }
    };
    void heartbeat();

    return {
      key,
      extend,
      release: async () => {
        stopped = true;
        const released = this.memory
          ? this.memory.release(key, token)
          : Number(await this.redis!.eval(RELEASE_SCRIPT, 1, key, token));
        if (lost && !released) throw new LockLostError(key);
      },
    };
  }

  async withLock<T>(key: string, work: () => Promise<T>, ttlMs = LOCK_TTL_MS): Promise<T> {
    const lock = await this.acquire(key, ttlMs);
    try {
      return await work();
    } finally {
      await lock.release();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis?.quit();
  }
}