import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_METADATA = 'rate-limit:options';

export interface RateLimitOptions {
  keyPrefix: string;
  limit?: number;
  windowMs?: number;
  limitEnv?: string;
  windowMsEnv?: string;
}

export const RateLimit = (options: RateLimitOptions) =>
  SetMetadata(RATE_LIMIT_METADATA, options);
