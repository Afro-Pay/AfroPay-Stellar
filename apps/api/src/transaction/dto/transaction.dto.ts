import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { HISTORY_DEFAULT_LIMIT, HISTORY_MAX_LIMIT } from '../transaction.service';

export class SendDto {
  @ApiProperty({
    description: "Recipient's Stellar public key",
    example: 'GXYZ1234567890ABCDEFGHIJKLMNOPQRSTUVW',
  })
  @IsString()
  @IsNotEmpty()
  destinationPublicKey: string;

  @ApiProperty({
    description: 'Amount to send as a decimal string',
    example: '25.50',
  })
  @IsString()
  @IsNotEmpty()
  amount: string;

  @ApiProperty({
    description: 'Asset code (e.g. XLM, USDC, NGN)',
    example: 'XLM',
  })
  @IsString()
  @IsNotEmpty()
  assetCode: string;

  @ApiProperty({
    description: 'Asset issuer public key (required for non-native assets)',
    example: 'GISSUER...',
    required: false,
  })
  @IsString()
  @IsOptional()
  assetIssuer?: string;

  @ApiProperty({
    description: 'Optional text memo for the transaction',
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

/**
 * Query parameters for GET /transactions/history
 */
export class GetHistoryQueryDto {
  @ApiPropertyOptional({
    description: `Number of records per page. Maximum ${HISTORY_MAX_LIMIT}.`,
    example: 25,
    default: HISTORY_DEFAULT_LIMIT,
    minimum: 1,
    maximum: HISTORY_MAX_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(HISTORY_MAX_LIMIT)
  limit?: number;

  @ApiPropertyOptional({
    description:
      'Cursor from the previous page response (the id of the last returned transaction). ' +
      'Omit on the first request.',
    example: 'clx1abc2d3ef456789',
  })
  @IsOptional()
  @IsString()
  cursor?: string;
}

/**
 * Paginated response shape for GET /transactions/history
 */
export class PaginatedHistoryDto {
  @ApiProperty({ description: 'Array of transaction records for this page.' })
  data: TransactionResponseDto[];

  @ApiProperty({
    description:
      'Cursor to pass as ?cursor= on the next request. Null when no further pages exist.',
    example: 'clx1abc2d3ef456789',
    nullable: true,
  })
  nextCursor: string | null;

  @ApiProperty({
    description: 'Total number of transactions for this user across all pages.',
    example: 120,
  })
  total: number;
}

export class GetTransactionsQueryDto {
  @ApiPropertyOptional({
    description: 'Page number for pagination',
    example: 1,
    minimum: 1,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({
    description: `Number of records per page. Maximum ${HISTORY_MAX_LIMIT}.`,
    example: HISTORY_DEFAULT_LIMIT,
    default: HISTORY_DEFAULT_LIMIT,
    minimum: 1,
    maximum: HISTORY_MAX_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(HISTORY_MAX_LIMIT)
  limit = HISTORY_DEFAULT_LIMIT;

  @ApiPropertyOptional({
    description: 'Filter by transaction status',
    enum: ['PENDING', 'RETRYING', 'SUCCESS', 'FAILED', 'PENDING_REVIEW'],
    example: 'SUCCESS',
  })
  @IsOptional()
  @IsEnum(['PENDING', 'RETRYING', 'SUCCESS', 'FAILED', 'PENDING_REVIEW'])
  status?: string;

  @ApiPropertyOptional({
    description: 'Filter by asset code',
    example: 'XLM',
  })
  @IsOptional()
  @IsString()
  assetCode?: string;

  @ApiPropertyOptional({
    description: 'Start date filter (ISO 8601 format)',
    example: '2024-01-01T00:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    description: 'End date filter (ISO 8601 format)',
    example: '2024-12-31T23:59:59.999Z',
  })
  @IsOptional()
  @IsDateString()
  to?: string;
}

export class PaginatedTransactionsDto {
  @ApiProperty({
    description: 'Array of transaction records',
    type: [TransactionResponseDto],
  })
  data: TransactionResponseDto[];

  @ApiProperty({
    description: 'Total number of transactions',
    example: 150,
  })
  total: number;

  @ApiProperty({
    description: 'Current page number',
    example: 1,
  })
  page: number;

  @ApiProperty({
    description: 'Number of records per page',
    example: 25,
  })
  limit: number;
}
