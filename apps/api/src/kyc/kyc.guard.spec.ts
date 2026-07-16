import { KycGuard } from './kyc.guard';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ExecutionContext } from '@nestjs/common';

describe('KycGuard', () => {
  let guard: KycGuard;
  const mockKycService = {
    normalizeAmountToUsd: jest.fn(),
    assertWithinDailyLimit: jest.fn(),
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
            body: { amount: '50', assetCode: 'USD' },
          }),
        }),
      } as ExecutionContext;

      mockKycService.normalizeAmountToUsd.mockResolvedValue(50);
      mockKycService.assertWithinDailyLimit.mockResolvedValue(undefined);

      const result = await guard.canActivate(mockContext);

      expect(result).toBe(true);
      expect(mockKycService.normalizeAmountToUsd).toHaveBeenCalledWith('50', 'USD');
      expect(mockKycService.assertWithinDailyLimit).toHaveBeenCalledWith('user-1', 50);
    });

    it('should block transaction over limit for NONE tier user', async () => {
      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => ({
            user: { userId: 'user-1' },
            body: { amount: '150', assetCode: 'USD' },
          }),
        }),
      } as ExecutionContext;

      mockKycService.normalizeAmountToUsd.mockResolvedValue(150);
      mockKycService.assertWithinDailyLimit.mockRejectedValue(
        new ForbiddenException('Transaction limit exceeded'),
      );

      await expect(guard.canActivate(mockContext)).rejects.toThrow(ForbiddenException);
    });

    it('should block transaction exceeding daily limit', async () => {
      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => ({
            user: { userId: 'user-1' },
            body: { amount: '500', assetCode: 'USD' },
          }),
        }),
      } as ExecutionContext;

      mockKycService.normalizeAmountToUsd.mockResolvedValue(500);
      mockKycService.assertWithinDailyLimit.mockRejectedValue(
        new ForbiddenException('Transaction limit exceeded'),
      );

      await expect(guard.canActivate(mockContext)).rejects.toThrow(ForbiddenException);
    });

    it('should allow high-value transaction for BASIC tier user', async () => {
      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => ({
            user: { userId: 'user-1' },
            body: { amount: '3000', assetCode: 'USD' },
          }),
        }),
      } as ExecutionContext;

      mockKycService.normalizeAmountToUsd.mockResolvedValue(3000);
      mockKycService.assertWithinDailyLimit.mockResolvedValue(undefined);

      const result = await guard.canActivate(mockContext);

      expect(result).toBe(true);
    });

    it('should throw UnauthorizedException if user not found', async () => {
      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => ({
            user: null,
            body: { amount: '100', assetCode: 'USD' },
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
            body: { amount: null, assetCode: 'USD' },
          }),
        }),
      } as ExecutionContext;

      const result = await guard.canActivate(mockContext);

      expect(result).toBe(true);
      expect(mockKycService.normalizeAmountToUsd).not.toHaveBeenCalled();
    });
  });
});
