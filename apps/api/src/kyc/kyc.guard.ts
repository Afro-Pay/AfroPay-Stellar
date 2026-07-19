import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { KycService } from './kyc.service';

@Injectable()
export class KycGuard implements CanActivate {
  constructor(private kycService: KycService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const userId = request.user?.userId;
    const amount = parseFloat(request.body?.amount);
    const assetCode = request.body?.assetCode;

    if (!userId) {
      throw new UnauthorizedException('User not found');
    }

    if (!amount || amount <= 0 || !assetCode) {
      return true; // Let other validators handle this
    }

    const amountUsd = await this.kycService.normalizeAmountToUsd(amount.toString(), assetCode);
    await this.kycService.assertWithinDailyLimit(userId, amountUsd);

    return true;
  }
}
