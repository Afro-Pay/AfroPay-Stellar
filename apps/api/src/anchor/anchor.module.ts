import { Module } from '@nestjs/common';
import { AnchorService } from './anchor.service';
import { AnchorController } from './anchor.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  providers: [AnchorService],
  controllers: [AnchorController],
})
export class AnchorModule {}
