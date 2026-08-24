import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Prevents UUID guessing from exposing or mutating another user's wallet. */
@Injectable()
export class WalletOwnershipGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      user?: { userId?: string };
      params?: { id?: string };
    }>();
    const userId = request.user?.userId;
    const walletId = request.params?.id;

    if (!userId || !walletId) {
      throw new ForbiddenException('Wallet access denied');
    }

    const wallet = await this.prisma.wallet.findUnique({
      where: { id: walletId },
      select: { userId: true },
    });
    if (!wallet || wallet.userId !== userId) {
      // Deliberately use the same response for missing and foreign wallets to
      // avoid turning the endpoint into a UUID enumeration oracle.
      throw new ForbiddenException('Wallet access denied');
    }

    return true;
  }
}
