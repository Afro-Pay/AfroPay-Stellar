import { ExecutionContext, HttpException, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

type ThrottlerLimitDetail = Parameters<ThrottlerGuard['throwThrottlingException']>[1];

@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected async throwThrottlingException(
    context: ExecutionContext,
    throttlerLimitDetail: ThrottlerLimitDetail,
  ): Promise<void> {
    const retryAfter = Math.ceil((throttlerLimitDetail.timeToExpire ?? 60000) / 1000);
    const response = context.switchToHttp().getResponse();
    response.header('Retry-After', String(retryAfter));
    throw new HttpException(
      {
        statusCode: 429,
        error: 'Too Many Requests',
        message: `Rate limit exceeded. Please try again in ${retryAfter} seconds.`,
        retryAfter,
      },
      429,
    );
  }
}
