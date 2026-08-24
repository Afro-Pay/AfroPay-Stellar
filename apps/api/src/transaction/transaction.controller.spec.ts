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

  it('rejects page zero through query validation', async () => {
    const pipe = new ValidationPipe({ transform: true, whitelist: true });

    await expect(
      pipe.transform({ page: '0' }, { type: 'query', metatype: GetTransactionsQueryDto }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
