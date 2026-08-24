import { IsString, IsOptional, IsObject } from 'class-validator';

export class SimulateTransactionDto {
  @IsOptional()
  @IsString()
  transactionXdr?: string;

  @IsOptional()
  @IsString()
  sender?: string;

  @IsOptional()
  @IsString()
  contractId?: string;

  @IsOptional()
  @IsString()
  method?: string;

  @IsOptional()
  @IsObject()
  params?: Record<string, any>;
}
