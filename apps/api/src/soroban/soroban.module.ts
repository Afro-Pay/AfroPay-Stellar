import { Module } from '@nestjs/common';
import { SorobanService } from './soroban.service';
import { SimulationService } from './simulation.service';
import { RpcClientService } from './rpc-client.service';

@Module({
  providers: [SorobanService, SimulationService, RpcClientService],
  exports: [SorobanService, SimulationService, RpcClientService],
})
export class SorobanModule {}
