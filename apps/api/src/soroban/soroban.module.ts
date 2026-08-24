import { Module } from '@nestjs/common';
import { SorobanService } from './soroban.service';
import { SimulationService } from './simulation.service';

@Module({
  providers: [SorobanService, SimulationService],
  exports: [SorobanService, SimulationService],
})
export class SorobanModule {}
