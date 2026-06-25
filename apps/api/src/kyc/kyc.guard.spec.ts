import { KycGuard } from './kyc.guard';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ExecutionContext } from '@nestjs/common';

describe('KycGuard', () => {
  let guard: KycGuard;
  const mockKycService = {
    getKycRecord: jest.fn(),
    getDailySpent: jest.fn(),
    getLimitForTier: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    guard = new KycGuard(mockKycService as any);
  });

  describe('canActivate', () => {
    it('should allow transaction under limit for NONE tier user', async () => {
      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => ({
            user: { userId: 'user-1' },
            body: { amount: '50' },
          }),
        }),
      } as ExecutionContext;

      mockKycService.getKycRecord.mockResolvedValue(null);
      mockKycService.getDailySpent.mockResolvedValue(20);
      mockKycService.getLimitForTier.mockReturnValue(100);

      const result = await guard.canActivate(mockContext);

      expect(result).toBe(true);
    });

    it('should block transaction over limit for NONE tier user', async () => {
      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => ({
            user: { userId: 'user-1' },
            body: { amount: '150' },
          }),
        }),
      } as ExecutionContext;

      mockKycService.getKycRecord.mockResolvedValue(null);
      mockKycService.getDailySpent.mockResolvedValue(0);
      mockKycService.getLimitForTier.mockReturnValue(100);

      await expect(guard.canActivate(mockContext)).rejects.toThrow(ForbiddenException);
    });

    it('should block transaction exceeding daily limit', async () => {
      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => ({
            user: { userId: 'user-1' },
            body: { amount: '500' },
          }),
        }),
      } as ExecutionContext;

      mockKycService.getKycRecord.mockResolvedValue({
        tier: 'BASIC',
      });
      mockKycService.getDailySpent.mockResolvedValue(4600);
      mockKycService.getLimitForTier.mockReturnValue(5000);

      await expect(guard.canActivate(mockContext)).rejects.toThrow(ForbiddenException);
    });

    it('should allow high-value transaction for BASIC tier user', async () => {
      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => ({
            user: { userId: 'user-1' },
            body: { amount: '3000' },
          }),
        }),
      } as ExecutionContext;

      mockKycService.getKycRecord.mockResolvedValue({
        tier: 'BASIC',
      });
      mockKycService.getDailySpent.mockResolvedValue(1500);
      mockKycService.getLimitForTier.mockReturnValue(5000);

      const result = await guard.canActivate(mockContext);

      expect(result).toBe(true);
    });

    it('should throw UnauthorizedException if user not found', async () => {
      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => ({
            user: null,
            body: { amount: '100' },
          }),
        }),
      } as ExecutionContext;

      await expect(guard.canActivate(mockContext)).rejects.toThrow(UnauthorizedException);
    });

    it('should return true if amount is invalid', async () => {
      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => ({
            user: { userId: 'user-1' },
            body: { amount: null },
          }),
        }),
      } as ExecutionContext;

      const result = await guard.canActivate(mockContext);

      expect(result).toBe(true);
    });
  });
});
