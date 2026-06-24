import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  RATE_LIMIT_METADATA,
  RateLimitOptions,
} from './rate-limit.decorator';

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

const DEFAULT_LIMIT = 60;
const DEFAULT_WINDOW_MS = 60_000;

function readPositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly buckets = new Map<string, RateLimitBucket>();
  private lastCleanupAt = 0;

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const options = this.reflector.getAllAndOverride<RateLimitOptions>(
      RATE_LIMIT_METADATA,
      [context.getHandler(), context.getClass()],
    );

    if (!options) return true;

    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    const limit = readPositiveInt(
      process.env[options.limitEnv ?? ''],
      readPositiveInt(process.env.RATE_LIMIT_MAX, options.limit ?? DEFAULT_LIMIT),
    );
    const windowMs = readPositiveInt(
      process.env[options.windowMsEnv ?? ''],
      readPositiveInt(
        process.env.RATE_LIMIT_WINDOW_MS,
        options.windowMs ?? DEFAULT_WINDOW_MS,
      ),
    );
    const now = Date.now();
    this.cleanupExpiredBuckets(now);
    const key = `${options.keyPrefix}:${this.clientKey(request)}`;
    const current = this.buckets.get(key);
    const bucket =
      !current || current.resetAt <= now
        ? { count: 0, resetAt: now + windowMs }
        : current;

    bucket.count += 1;
    this.buckets.set(key, bucket);

    const remaining = Math.max(limit - bucket.count, 0);
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((bucket.resetAt - now) / 1000),
    );

    response?.setHeader?.('X-RateLimit-Limit', String(limit));
    response?.setHeader?.('X-RateLimit-Remaining', String(remaining));
    response?.setHeader?.(
      'X-RateLimit-Reset',
      new Date(bucket.resetAt).toISOString(),
    );

    if (bucket.count <= limit) {
      return true;
    }

    response?.setHeader?.('Retry-After', String(retryAfterSeconds));
    throw new HttpException(
      {
        code: 'RATE_LIMITED',
        message: 'Too many requests. Please retry after the rate limit window resets.',
        retryAfterSeconds,
        limit,
        windowMs,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  resetForTests(): void {
    this.buckets.clear();
    this.lastCleanupAt = 0;
  }

  private cleanupExpiredBuckets(now: number): void {
    if (now - this.lastCleanupAt < DEFAULT_WINDOW_MS) return;

    this.lastCleanupAt = now;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) {
        this.buckets.delete(key);
      }
    }
  }

  private clientKey(request: any): string {
    const userId = request?.user?.userId ?? request?.user?.sub;
    if (userId) return `user:${userId}`;

    const forwardedFor = request?.headers?.['x-forwarded-for'];
    if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
      return `ip:${forwardedFor.split(',')[0].trim()}`;
    }

    return `ip:${request?.ip ?? request?.socket?.remoteAddress ?? 'unknown'}`;
  }
}
