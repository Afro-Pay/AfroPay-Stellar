import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { Sep24Controller } from '../sep24.controller';
import { Sep24Service } from '../sep24.service';
import { AnchorService } from '../anchor.service';

describe('Sep24Controller', () => {
  let controller: Sep24Controller;
  let sep24Service: Sep24Service;

  const mockAccount = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEFGHIJKLMNOPQRSTUV';
  const mockReq = { sep10User: { account: mockAccount } };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [Sep24Controller],
      providers: [
        {
          provide: Sep24Service,
          useValue: {
            getSep24Info: jest.fn().mockReturnValue({
              deposit: { USDC: { enabled: true } },
              withdraw: { USDC: { enabled: true } },
            }),
            createInteractiveSession: jest.fn().mockResolvedValue({
              type: 'interactive_customer_info_needed',
              url: 'http://localhost:3000/anchor/interactive?token=test-jwt',
              id: 'mock-tx-id',
            }),
            getTransactionById: jest.fn().mockResolvedValue({
              id: 'mock-tx-id',
              kind: 'deposit',
              status: 'incomplete',
            }),
            getTransactionsByAccount: jest.fn().mockResolvedValue({
              transactions: [],
            }),
            getSessionData: jest.fn().mockResolvedValue({
              id: 'mock-tx-id',
              kind: 'deposit',
              stellarAccount: mockAccount,
              assetCode: 'USDC',
              status: 'incomplete',
            }),
            confirmInteractiveSession: jest.fn().mockResolvedValue({
              id: 'mock-tx-id',
              status: 'pending_user_transfer_start',
              kind: 'deposit',
              assetCode: 'USDC',
              memo: 'abc123',
              memoType: 'text',
            }),
          },
        },
        {
          provide: AnchorService,
          useValue: {
            verifySep10Token: jest.fn().mockResolvedValue({ sub: mockAccount }),
          },
        },
      ],
    }).compile();

    controller = module.get<Sep24Controller>(Sep24Controller);
    sep24Service = module.get<Sep24Service>(Sep24Service);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // GET /sep24/info
  // -------------------------------------------------------------------------

  describe('getInfo', () => {
    it('returns SEP-24 capability info', () => {
      const info = controller.getInfo();
      expect(info.deposit).toBeDefined();
      expect(info.withdraw).toBeDefined();
      expect(sep24Service.getSep24Info).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // POST /sep24/transactions/deposit/interactive
  // -------------------------------------------------------------------------

  describe('depositInteractive', () => {
    it('creates a deposit session and returns interactive URL', async () => {
      const result = await controller.depositInteractive(mockReq, {
        asset_code: 'USDC',
      });

      expect(result.type).toBe('interactive_customer_info_needed');
      expect(result.url).toContain('token=');
      expect(result.id).toBe('mock-tx-id');
      expect(sep24Service.createInteractiveSession).toHaveBeenCalledWith(
        mockAccount,
        'deposit',
        'USDC',
        undefined,
        undefined,
      );
    });

    it('throws BadRequestException when asset_code is missing', async () => {
      await expect(
        controller.depositInteractive(mockReq, { asset_code: '' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // -------------------------------------------------------------------------
  // POST /sep24/transactions/withdraw/interactive
  // -------------------------------------------------------------------------

  describe('withdrawInteractive', () => {
    it('creates a withdrawal session', async () => {
      const result = await controller.withdrawInteractive(mockReq, {
        asset_code: 'USDC',
        amount: '100',
      });

      expect(result.type).toBe('interactive_customer_info_needed');
      expect(sep24Service.createInteractiveSession).toHaveBeenCalledWith(
        mockAccount,
        'withdraw',
        'USDC',
        undefined,
        '100',
      );
    });
  });

  // -------------------------------------------------------------------------
  // GET /sep24/transaction
  // -------------------------------------------------------------------------

  describe('getTransaction', () => {
    it('returns a transaction by ID', async () => {
      const result = await controller.getTransaction(mockReq, 'mock-tx-id');
      expect(result.transaction.id).toBe('mock-tx-id');
      expect(sep24Service.getTransactionById).toHaveBeenCalledWith('mock-tx-id', mockAccount);
    });

    it('throws BadRequestException when id is missing', async () => {
      await expect(controller.getTransaction(mockReq, '')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // GET /sep24/transactions
  // -------------------------------------------------------------------------

  describe('getTransactions', () => {
    it('returns transactions for the authenticated account', async () => {
      const result = await controller.getTransactions(mockReq, 'USDC', 'deposit', '10');
      expect(result.transactions).toBeDefined();
      expect(sep24Service.getTransactionsByAccount).toHaveBeenCalledWith(
        mockAccount,
        'USDC',
        'deposit',
        10,
      );
    });
  });

  // -------------------------------------------------------------------------
  // GET /sep24/interactive/session
  // -------------------------------------------------------------------------

  describe('getInteractiveSession', () => {
    it('returns session data for a valid token', async () => {
      const result = await controller.getInteractiveSession('valid-token');
      expect(result.id).toBe('mock-tx-id');
      expect(result.kind).toBe('deposit');
    });

    it('throws BadRequestException when token is missing', async () => {
      await expect(controller.getInteractiveSession('')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // POST /sep24/interactive/confirm
  // -------------------------------------------------------------------------

  describe('confirmInteractiveSession', () => {
    it('confirms the session and returns updated transaction', async () => {
      const result = await controller.confirmInteractiveSession({
        token: 'valid-token',
        kyc_data: { first_name: 'Test', last_name: 'User' },
        payment_method: 'bank_transfer',
      });

      expect(result.status).toBe('pending_user_transfer_start');
      expect(result.memo).toBe('abc123');
    });

    it('throws BadRequestException when token is missing', async () => {
      await expect(
        controller.confirmInteractiveSession({
          token: '',
          kyc_data: { first_name: 'Test' },
          payment_method: 'bank_transfer',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when kyc_data is missing', async () => {
      await expect(
        controller.confirmInteractiveSession({
          token: 'valid-token',
          kyc_data: null as any,
          payment_method: 'bank_transfer',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when payment_method is missing', async () => {
      await expect(
        controller.confirmInteractiveSession({
          token: 'valid-token',
          kyc_data: { first_name: 'Test' },
          payment_method: '',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
