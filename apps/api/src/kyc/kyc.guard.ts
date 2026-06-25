import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { KycService } from './kyc.service';
import { KycTier } from '@prisma/client';

@Injectable()
export class KycGuard implements CanActivate {
  constructor(private kycService: KycService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const userId = request.user?.userId;
    const amount = parseFloat(request.body?.amount);

    if (!userId) {
      throw new UnauthorizedException('User not found');
    }

    if (!amount || amount <= 0) {
      return true; // Let other validators handle this
    }

    const kycRecord = await this.kycService.getKycRecord(userId);
    const tier = kycRecord?.tier || ('NONE' as KycTier);
    const limit = this.kycService.getLimitForTier(tier);
    const dailySpent = await this.kycService.getDailySpent(userId);
    const newTotal = dailySpent + amount;

    if (newTotal > limit) {
      throw new ForbiddenException(
        `Transaction limit exceeded. Daily limit: $${limit}, Already used: $${dailySpent}, Remaining: $${Math.max(0, limit - dailySpent)}`,
      );
    }

    return true;
  }
}
