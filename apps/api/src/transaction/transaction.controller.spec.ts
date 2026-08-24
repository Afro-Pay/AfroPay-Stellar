import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { TransactionController } from './transaction.controller';
import { GetTransactionsQueryDto } from './dto';

describe('TransactionController', () => {
  const transactionService = {
    getTransactions: jest.fn(),
  };
  const controller = new TransactionController(transactionService as any);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('passes the maximum page size and filters to the service', async () => {
    const query = {
      page: 2,
      limit: 100,
      status: 'SUCCESS',
      assetCode: 'USDC',
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-01-31T23:59:59.999Z',
    };
    const response = { data: [], total: 100, page: 2, limit: 100 };
    transactionService.getTransactions.mockResolvedValue(response);

    await expect(controller.transactions({ user: { userId: 'user-1' } }, query as any)).resolves.toEqual(
      response,
    );
    expect(transactionService.getTransactions).toHaveBeenCalledWith('user-1', query);
  });

  it('returns an empty page when the requested page is beyond the result set', async () => {
    const query = { page: 3, limit: 100 };
    const response = { data: [], total: 150, page: 3, limit: 100 };
    transactionService.getTransactions.mockResolvedValue(response);

    await expect(controller.transactions({ user: { userId: 'user-1' } }, query as any)).resolves.toEqual(
      response,
    );
  });

  describe('sendPayment', () => {
    const mockSendDto = {
      destinationPublicKey: 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
      amount: '50.00',
      assetCode: 'USDC',
    };
    const validKey = '11111111-2222-4333-8444-555555555555';

    it('rejects missing Idempotency-Key with 400 Bad Request', async () => {
      const mockReq = { user: { userId: 'user-1' } };
      const mockRes = { status: jest.fn() };

      await expect(
        controller.sendPayment(mockReq, mockSendDto, mockRes, undefined),
      ).rejects.toThrow(new BadRequestException('Idempotency-Key header is required'));
    });

    it('rejects empty Idempotency-Key with 400 Bad Request', async () => {
      const mockReq = { user: { userId: 'user-1' } };
      const mockRes = { status: jest.fn() };

      await expect(
        controller.sendPayment(mockReq, mockSendDto, mockRes, '   '),
      ).rejects.toThrow(new BadRequestException('Idempotency-Key header is required'));
    });

    it('rejects malformed Idempotency-Key with 400 Bad Request', async () => {
      const mockReq = { user: { userId: 'user-1' } };
      const mockRes = { status: jest.fn() };

      await expect(
        controller.sendPayment(mockReq, mockSendDto, mockRes, 'invalid-uuid-format'),
      ).rejects.toThrow(new BadRequestException('Idempotency-Key header must be a valid UUID'));
    });

    it('processes fresh transfer and keeps default 201 Created status', async () => {
      const mockReq = { user: { userId: 'user-1' } };
      const mockRes = { status: jest.fn() };

      (transactionService as any).sendPayment = jest.fn().mockResolvedValue({
        txId: 'tx-100',
        status: 'PENDING',
        idempotentReplay: false,
      });

      const res = await controller.sendPayment(mockReq, mockSendDto, mockRes, validKey);

      expect(res).toEqual({ txId: 'tx-100', status: 'PENDING' });
      expect(mockRes.status).not.toHaveBeenCalled();
      expect((transactionService as any).sendPayment).toHaveBeenCalledWith(
        'user-1',
        mockSendDto,
        validKey,
      );
    });

    it('replays duplicate request and sets status to 200 OK', async () => {
      const mockReq = { user: { userId: 'user-1' } };
      const mockRes = { status: jest.fn() };

      (transactionService as any).sendPayment = jest.fn().mockResolvedValue({
        txId: 'tx-100',
        status: 'PENDING',
        idempotentReplay: true,
      });

      const res = await controller.sendPayment(mockReq, mockSendDto, mockRes, validKey);

      expect(res).toEqual({ txId: 'tx-100', status: 'PENDING' });
      expect(mockRes.status).toHaveBeenCalledWith(200);
    });
  });
});
