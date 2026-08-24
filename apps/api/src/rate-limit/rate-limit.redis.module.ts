import { Global, Module } from "@nestjs/common";
import { RedisRateLimiter } from "./redis-rate-limiter";

@Global()
@Module({
  providers: [
    {
      provide: "RATE_LIMIT_REDIS_URL",
      useFactory: () => process.env.REDIS_URL,
    },
    {
      provide: RedisRateLimiter,
      useFactory: (redisUrl: string) =>
        new RedisRateLimiter(redisUrl, "rate-limit"),
      inject: ["RATE_LIMIT_REDIS_URL"],
    },
  ],
  exports: [RedisRateLimiter],
})
export class RateLimitRedisModule {}
