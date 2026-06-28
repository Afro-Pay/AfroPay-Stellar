import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsNumber, IsOptional } from 'class-validator';

export class SendDto {
  @ApiProperty({
    description: 'Sender wallet address',
    example: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890',
  })
  @IsString()
  @IsNotEmpty()
  fromWallet: string;

  @ApiProperty({
    description: 'Recipient wallet address',
    example: 'GXYZ1234567890ABCDEFGHIJKLMNOPQRSTUVW',
  })
  @IsString()
  @IsNotEmpty()
  toWallet: string;

  @ApiProperty({
    description: 'Amount to send in XLM',
    example: 25.50,
  })
  @IsNumber()
  amount: number;

  @ApiProperty({
    description: 'Transaction memo (optional)',
    example: 'Payment for services',
    required: false,
  })
  @IsString()
  @IsOptional()
  memo?: string;
}

export class TransactionResponseDto {
  @ApiProperty({
    description: 'Transaction ID',
    example: 'txn_123e4567-e89b-12d3-a456-426614174000',
  })
  id: string;

  @ApiProperty({
    description: 'Stellar transaction hash',
    example: '0x1234567890abcdef1234567890abcdef12345678',
  })
  txHash: string;

  @ApiProperty({
    description: 'Transaction type',
    enum: ['send', 'receive', 'swap'],
    example: 'send',
  })
  type: string;

  @ApiProperty({
    description: 'Transaction amount',
    example: '25.50',
  })
  amount: string;

  @ApiProperty({
    description: 'Sender address',
    example: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890',
  })
  fromAddress: string;

  @ApiProperty({
    description: 'Recipient address',
    example: 'GXYZ1234567890ABCDEFGHIJKLMNOPQRSTUVW',
  })
  toAddress: string;

  @ApiProperty({
    description: 'Transaction status',
    enum: ['pending', 'completed', 'failed'],
    example: 'completed',
  })
  status: string;

  @ApiProperty({
    description: 'Transaction timestamp',
    example: '2024-01-15T10:30:00.000Z',
  })
  createdAt: Date;
}
