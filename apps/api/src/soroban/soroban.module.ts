import { Module } from '@nestjs/common';
import { SorobanService } from './soroban.service';
import { SimulationService } from './simulation.service';
import { RpcClientService } from './rpc-client.service';
import { RpcHealthController } from './rpc-health.controller';
import { DexService } from './dex.service';

@Module({
  providers: [SorobanService, SimulationService, RpcClientService, DexService],
  controllers: [RpcHealthController],
  exports: [SorobanService, SimulationService, RpcClientService, DexService],
})
export class SorobanModule {}
