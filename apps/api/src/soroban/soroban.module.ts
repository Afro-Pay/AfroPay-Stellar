import { Module } from '@nestjs/common';
import { SorobanService } from './soroban.service';
import { SimulationService } from './simulation.service';
import { RpcClientService } from './rpc-client.service';
import { RpcHealthController } from './rpc-health.controller';

@Module({
  providers: [SorobanService, SimulationService, RpcClientService],
  controllers: [RpcHealthController],
  exports: [SorobanService, SimulationService, RpcClientService],
})
export class SorobanModule {}
