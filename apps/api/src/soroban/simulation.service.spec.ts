import { SimulationService } from './simulation.service';
import { BadRequestException } from '@nestjs/common';
import { SorobanRpc, TransactionBuilder, Networks, Keypair, Account, BASE_FEE } from 'stellar-sdk';

describe('SimulationService', () => {
  let service: SimulationService;
  let mockSorobanRpc: jest.Mocked<SorobanRpc.Server>;

  beforeEach(() => {
    service = new SimulationService();

    mockSorobanRpc = {
      simulateTransaction: jest.fn(),
      getAccount: jest.fn(),
    } as any;

    service.setRpcServer(mockSorobanRpc);
  });

  describe('simulateTransaction - Success Case', () => {
    it('should parse successful simulation output and return footprint, cost, and dynamic fee with 10% safety margin', async () => {
      const mockSuccessResponse: SorobanRpc.Api.SimulateTransactionSuccessResponse = {
        id: 'sim_123',
        latestLedger: 1000,
        events: [],
        _parsed: true,
        cost: {
          cpuInsns: '150000',
          memBytes: '2048',
        },
        minResourceFee: '1000',
        transactionData: {
          build: () => ({
            toXDR: () => 'MOCK_TRANSACTION_DATA_XDR',
          }),
          getReadOnly: () => [],
          getReadWrite: () => [],
        } as any,
      };

      mockSorobanRpc.simulateTransaction.mockResolvedValue(mockSuccessResponse);

      // Create a valid dummy transaction XDR
      const sourceKeypair = Keypair.random();
      const account = new Account(sourceKeypair.publicKey(), '100');
      const dummyTx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: Networks.TESTNET,
      })
        .setTimeout(30)
        .build();

      const startTime = Date.now();
      const result = await service.simulateTransaction({
        transactionXdr: dummyTx.toXDR(),
      });
      const duration = Date.now() - startTime;

      expect(result.success).toBe(true);
      expect(result.cost).toEqual({
        cpuInstructions: 150000,
        ramBytes: 2048,
      });

      // Min fee: 1000, Recommended (10% safety margin): 1100, Base fee: 100 -> Total: 1200
      expect(result.fees.minResourceFee).toBe('1000');
      expect(result.fees.safetyMarginPercent).toBe(10);
      expect(result.fees.recommendedResourceFee).toBe('1100');
      expect(result.fees.totalRecommendedFee).toBe('1200');
      expect(result.transactionDataXdr).toBe('MOCK_TRANSACTION_DATA_XDR');

      // Acceptance criterion: returns in under 200ms
      expect(duration).toBeLessThan(200);
    });
  });

  describe('simulateTransaction - Failure Case', () => {
    it('should catch simulation error responses and throw BadRequestException with error context', async () => {
      const mockErrorResponse: SorobanRpc.Api.SimulateTransactionErrorResponse = {
        id: 'sim_error_123',
        latestLedger: 1000,
        events: [],
        _parsed: true,
        error: 'Host function execution failed: Contract Panic',
      };

      mockSorobanRpc.simulateTransaction.mockResolvedValue(mockErrorResponse);

      const sourceKeypair = Keypair.random();
      const account = new Account(sourceKeypair.publicKey(), '100');
      const dummyTx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: Networks.TESTNET,
      })
        .setTimeout(30)
        .build();

      await expect(
        service.simulateTransaction({
          transactionXdr: dummyTx.toXDR(),
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when neither transactionXdr nor sender is provided', async () => {
      await expect(service.simulateTransaction({})).rejects.toThrow(
        'Either transactionXdr or sender/transaction parameters must be provided',
      );
    });
  });
});
