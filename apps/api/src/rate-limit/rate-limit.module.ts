import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { RateLimitGuardRedis } from "./rate-limit.guard.redis";
import { RateLimitRedisModule } from "./rate-limit.redis.module";

@Module({
  imports: [RateLimitRedisModule],
  providers: [
    {
      provide: APP_GUARD,
      useClass: RateLimitGuardRedis,
    },
  ],
})
export class RateLimitModule {}
