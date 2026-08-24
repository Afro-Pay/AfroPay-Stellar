import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { RATE_LIMIT_METADATA, RateLimitOptions } from "./rate-limit.decorator";
import { RedisRateLimiter } from "./redis-rate-limiter";

function readPositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

@Injectable()
export class RateLimitGuardRedis implements CanActivate {
  // Optional in case we want a fallback.
  constructor(
    private readonly reflector: Reflector,
    private readonly redisLimiter: RedisRateLimiter,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<RateLimitOptions>(
      RATE_LIMIT_METADATA,
      [context.getHandler(), context.getClass()],
    );

    if (!options) return true;

    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();

    const limit = readPositiveInt(
      process.env[options.limitEnv ?? ""],
      readPositiveInt(process.env.RATE_LIMIT_MAX, options.limit ?? 60),
    );

    const windowMs = readPositiveInt(
      process.env[options.windowMsEnv ?? ""],
      readPositiveInt(
        process.env.RATE_LIMIT_WINDOW_MS,
        options.windowMs ?? 60_000,
      ),
    );

    const now = Date.now();
    const realKey = `${options.keyPrefix}:${this.clientKey(request)}`;
    const result = await this.redisLimiter.consume(
      realKey,
      limit,
      windowMs,
      now,
    );

    response?.setHeader?.("X-RateLimit-Limit", String(limit));
    response?.setHeader?.("X-RateLimit-Remaining", String(Math.max(0, result.remaining)));
    response?.setHeader?.(
      "X-RateLimit-Reset",
      new Date(result.resetAt).toISOString(),
    );

    if (result.remaining >= 0) return true;

    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((result.resetAt - now) / 1000),
    );
    response?.setHeader?.("Retry-After", String(retryAfterSeconds));

    throw new HttpException(
      {
        code: "RATE_LIMITED",
        message:
          "Too many requests. Please retry after the rate limit window resets.",
        retryAfterSeconds,
        limit,
        windowMs,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private clientKey(request: any): string {
    const userId = request?.user?.userId ?? request?.user?.sub;
    if (userId) return `user:${userId}`;

    // `request.ip` honours Express's configured trusted-proxy boundary. Raw
    // forwarding headers are attacker-controlled and must not select buckets.
    return `ip:${request?.ip ?? request?.socket?.remoteAddress ?? "unknown"}`;
  }
}
