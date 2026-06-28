import { Test, TestingModule } from '@nestjs/testing';
import { AnchorController } from '../anchor.controller';
import { WalletService } from '../../wallet/wallet.service';
import { ForbiddenException } from '@nestjs/common';

describe('AnchorController', () => {
  let controller: AnchorController;
  let walletService: WalletService;

  const mockUserId = '123';
  const mockUserWallet = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AnchorController],
      providers: [
        {
          provide: WalletService,
          useValue: {
            findByUserId: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<AnchorController>(AnchorController);
    walletService = module.get<WalletService>(WalletService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('validateAccountOwnership', () => {
    it('should throw 403 if account does not match user wallet', async () => {
      const invalidAccount = 'GXYZ1234567890ABCDEFGHIJKLMNOPQRSTUVW';
      
      jest.spyOn(walletService, 'findByUserId').mockResolvedValue({
        publicKey: mockUserWallet,
      } as any);

      await expect(
        controller['validateAccountOwnership'](mockUserId, invalidAccount),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should pass if account matches user wallet', async () => {
      jest.spyOn(walletService, 'findByUserId').mockResolvedValue({
        publicKey: mockUserWallet,
      } as any);

      await expect(
        controller['validateAccountOwnership'](mockUserId, mockUserWallet),
      ).resolves.not.toThrow();
    });

    it('should throw 403 if user has no wallet', async () => {
      jest.spyOn(walletService, 'findByUserId').mockResolvedValue(null);

      await expect(
        controller['validateAccountOwnership'](mockUserId, mockUserWallet),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
