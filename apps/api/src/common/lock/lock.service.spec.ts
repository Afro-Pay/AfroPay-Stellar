import {
  LockNotAcquiredError,
  RedisLockService,
} from './lock.service';

describe('RedisLockService', () => {
  let first: RedisLockService;
  let second: RedisLockService;

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    first = new RedisLockService();
    second = new RedisLockService();
  });

  it('rejects a second owner for the same key', async () => {
    const lock = await first.acquire('lock:escrow:collision', 1000);

    await expect(second.acquire('lock:escrow:collision', 1000)).rejects.toBeInstanceOf(
      LockNotAcquiredError,
    );

    await lock.release();
    await expect(second.acquire('lock:escrow:collision', 1000)).resolves.toBeDefined();
  });

  it('renews a lease and releases it for a new owner', async () => {
    const lock = await first.acquire('lock:escrow:renewal', 25);
    await new Promise((resolve) => setTimeout(resolve, 15));
    await lock.extend();
    await new Promise((resolve) => setTimeout(resolve, 15));

    await expect(second.acquire('lock:escrow:renewal', 1000)).rejects.toBeInstanceOf(
      LockNotAcquiredError,
    );
    await lock.release();
    await expect(second.acquire('lock:escrow:renewal', 1000)).resolves.toBeDefined();
  });

  it('allows recovery after a lease expires', async () => {
    const lock = await first.acquire('lock:escrow:expired', 15);
    await new Promise((resolve) => setTimeout(resolve, 25));

    await expect(second.acquire('lock:escrow:expired', 1000)).resolves.toBeDefined();
    await lock.release();
  });
});