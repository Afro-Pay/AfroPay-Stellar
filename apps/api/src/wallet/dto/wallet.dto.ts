import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class ImportWalletDto {
  @ApiProperty({
    description: 'Wallet private key (secret seed)',
    example: 'SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  })
  @IsString()
  @IsNotEmpty()
  privateKey: string;

  @ApiProperty({
    description: 'Wallet name (optional)',
    example: 'My Main Wallet',
    required: false,
  })
  @IsString()
  @IsOptional()
  name?: string;
}

export class WalletResponseDto {
  @ApiProperty({
    description: 'Wallet ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  id: string;

  @ApiProperty({
    description: 'Wallet public address',
    example: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890',
  })
  publicAddress: string;

  @ApiProperty({
    description: 'Wallet name',
    example: 'My Main Wallet',
    required: false,
  })
  name?: string;

  @ApiProperty({
    description: 'Wallet balance in XLM',
    example: '100.50',
  })
  balance: string;

  @ApiProperty({
    description: 'Wallet creation date',
    example: '2024-01-15T10:30:00.000Z',
  })
  createdAt: Date;
}
