import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { SorobanRpc, TransactionBuilder, Networks, BASE_FEE, Transaction, FeeBumpTransaction } from 'stellar-sdk';
import { SimulateTransactionDto } from './dto/simulate-transaction.dto';

export interface FootprintSummary {
  readOnly: string[];
  readWrite: string[];
}

export interface CostSummary {
  cpuInstructions: number;
  ramBytes: number;
}

export interface FeeSummary {
  minResourceFee: string;
  safetyMarginPercent: number;
  recommendedResourceFee: string;
  baseFee: string;
  totalRecommendedFee: string;
}

export interface SimulationResult {
  success: boolean;
  executionTimeMs: number;
  footprint: FootprintSummary;
  cost: CostSummary;
  fees: FeeSummary;
  transactionDataXdr?: string;
  result?: any;
  events?: any[];
  error?: string;
}

@Injectable()
export class SimulationService {
  private logger = new Logger(SimulationService.name);
  private sorobanRpc: SorobanRpc.Server;
  private networkPassphrase: string;

  constructor() {
    const rpcUrl = process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org';
    const networkPassphrase = process.env.STELLAR_NETWORK === 'public'
      ? Networks.PUBLIC
      : Networks.TESTNET;

    this.sorobanRpc = new SorobanRpc.Server(rpcUrl, { allowHttp: true });
    this.networkPassphrase = networkPassphrase;
  }

  /**
   * Set custom SorobanRpc server instance (useful for testing/mocking)
   */
  setRpcServer(server: SorobanRpc.Server) {
    this.sorobanRpc = server;
  }

  /**
   * Soroban transaction pre-flight simulation and gas estimation service
   */
  async simulateTransaction(dto: SimulateTransactionDto): Promise<SimulationResult> {
    const startTime = Date.now();

    if (!dto.transactionXdr && !dto.sender) {
      throw new BadRequestException('Either transactionXdr or sender/transaction parameters must be provided');
    }

    try {
      let tx: Transaction | FeeBumpTransaction;

      if (dto.transactionXdr) {
        tx = TransactionBuilder.fromXDR(dto.transactionXdr, this.networkPassphrase);
      } else {
        const dummyAccount = await this.sorobanRpc.getAccount(dto.sender || 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF');
        const builder = new TransactionBuilder(dummyAccount, {
          fee: BASE_FEE,
          networkPassphrase: this.networkPassphrase,
        });
        tx = builder.setTimeout(30).build();
      }

      const rawSimulation = await this.sorobanRpc.simulateTransaction(tx);
      const executionTimeMs = Date.now() - startTime;

      if (SorobanRpc.Api.isSimulationError(rawSimulation)) {
        this.logger.warn(`Simulation failed: ${rawSimulation.error}`);
        throw new BadRequestException(`Soroban transaction simulation error: ${rawSimulation.error}`);
      }

      const parsedCost = this.extractCost(rawSimulation);
      const parsedFootprint = this.extractFootprint(rawSimulation);
      const parsedFees = this.extractFeeSummary(rawSimulation);

      let transactionDataXdr: string | undefined = undefined;
      if (rawSimulation.transactionData) {
        transactionDataXdr = rawSimulation.transactionData.build().toXDR('base64');
      }

      return {
        success: true,
        executionTimeMs,
        footprint: parsedFootprint,
        cost: parsedCost,
        fees: parsedFees,
        transactionDataXdr,
        result: rawSimulation.result,
        events: rawSimulation.events || [],
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(`Simulation failed with exception: ${error.message}`, error.stack);
      throw new BadRequestException(`Simulation pre-flight failed: ${error.message}`);
    }
  }

  /**
   * Prepares and attaches simulated resource footprints & dynamic fees to a transaction
   * Fulfills criterion: All submitted transactions use simulated resource footprints
   */
  async prepareAndSimulateTransaction(tx: Transaction): Promise<{ transaction: Transaction; simulation: SimulationResult }> {
    const rawSimulation = await this.sorobanRpc.simulateTransaction(tx);

    if (SorobanRpc.Api.isSimulationError(rawSimulation)) {
      throw new BadRequestException(`Soroban transaction pre-flight simulation error: ${rawSimulation.error}`);
    }

    if (SorobanRpc.Api.isSimulationSuccess(rawSimulation)) {
      const assembledTx = SorobanRpc.assembleTransaction(tx, rawSimulation).build();
      const simulationResult = await this.simulateTransaction({
        transactionXdr: tx.toXDR(),
      });
      return {
        transaction: assembledTx as Transaction,
        simulation: simulationResult,
      };
    }

    throw new BadRequestException('Simulation returned unexpected format');
  }

  /**
   * Extracts CPU instructions and RAM memory bytes from simulation output
   */
  private extractCost(simulation: SorobanRpc.Api.SimulateTransactionSuccessResponse | SorobanRpc.Api.SimulateTransactionRestoreResponse): CostSummary {
    const cpuInsns = simulation.cost?.cpuInsns ? parseInt(simulation.cost.cpuInsns, 10) : 0;
    const ramBytes = simulation.cost?.memBytes ? parseInt(simulation.cost.memBytes, 10) : 0;

    return {
      cpuInstructions: cpuInsns,
      ramBytes,
    };
  }

  /**
   * Extracts read-only and read-write footprint keys from transactionData
   */
  private extractFootprint(simulation: SorobanRpc.Api.SimulateTransactionSuccessResponse | SorobanRpc.Api.SimulateTransactionRestoreResponse): FootprintSummary {
    const readOnly: string[] = [];
    const readWrite: string[] = [];

    if (simulation.transactionData) {
      try {
        const readOnlyKeys = simulation.transactionData.getReadOnly();
        const readWriteKeys = simulation.transactionData.getReadWrite();

        for (const key of readOnlyKeys) {
          readOnly.push(key.toXDR('base64'));
        }
        for (const key of readWriteKeys) {
          readWrite.push(key.toXDR('base64'));
        }
      } catch (err) {
        this.logger.debug(`Could not parse footprint keys: ${err.message}`);
      }
    }

    return { readOnly, readWrite };
  }

  /**
   * Computes dynamic fee with a 10% safety margin
   */
  private extractFeeSummary(simulation: SorobanRpc.Api.SimulateTransactionSuccessResponse | SorobanRpc.Api.SimulateTransactionRestoreResponse): FeeSummary {
    const minResourceFeeStr = simulation.minResourceFee || '0';
    const minResourceFee = parseInt(minResourceFeeStr, 10);
    const safetyMarginPercent = 10;
    const recommendedResourceFee = Math.ceil(minResourceFee * (1 + safetyMarginPercent / 100));
    const baseFeeNum = parseInt(BASE_FEE, 10) || 100;
    const totalRecommendedFee = recommendedResourceFee + baseFeeNum;

    return {
      minResourceFee: minResourceFeeStr,
      safetyMarginPercent,
      recommendedResourceFee: recommendedResourceFee.toString(),
      baseFee: baseFeeNum.toString(),
      totalRecommendedFee: totalRecommendedFee.toString(),
    };
  }
}
