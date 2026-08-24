import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

/** Stellar public key (ed25519, G…, 56 chars). */
const STELLAR_PUBLIC_KEY = /^G[0-9A-Z]{55}$/;

export class ComplianceFreezeDto {
  @ApiProperty({
    description: 'Stellar public key of the account whose trustline should be frozen',
    example: 'GABC…',
  })
  @IsString()
  @Matches(STELLAR_PUBLIC_KEY)
  targetAccount: string;

  @ApiProperty({ description: 'Asset code to freeze (e.g. USDC, NGN)', example: 'USDC' })
  @IsString()
  @IsNotEmpty()
  assetCode: string;

  @ApiPropertyOptional({
    description: 'Asset issuer public key (required for non-native assets)',
    example: 'GISSUER…',
  })
  @IsOptional()
  @IsString()
  assetIssuer?: string;

  @ApiPropertyOptional({ description: 'Justification for the freeze (recorded in the audit trail)' })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class ComplianceClawbackDto extends ComplianceFreezeDto {
  @ApiProperty({
    description: 'Amount to claw back from the target account (decimal string, max 7 dp)',
    example: '1250.50',
  })
  @IsString()
  @IsNotEmpty()
  amount: string;
}

export class ComplianceRejectDto {
  @ApiPropertyOptional({ description: 'Reason for rejecting the compliance action' })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class ComplianceResultDto {
  @ApiProperty({ description: 'Stellar transaction hash returned by Horizon' })
  @IsString()
  @IsNotEmpty()
  txHash: string;

  @ApiProperty({ description: 'On-chain execution outcome', enum: ['SUCCESS', 'FAILURE'] })
  @IsEnum(['SUCCESS', 'FAILURE'])
  outcome: 'SUCCESS' | 'FAILURE';
}

export class ComplianceListQueryDto {
  @ApiPropertyOptional({
    description: 'Filter by action status',
    enum: ['PENDING_APPROVAL', 'APPROVED', 'EXECUTING', 'EXECUTED', 'FAILED', 'REJECTED'],
  })
  @IsOptional()
  @IsEnum(['PENDING_APPROVAL', 'APPROVED', 'EXECUTING', 'EXECUTED', 'FAILED', 'REJECTED'])
  status?: string;

  @ApiPropertyOptional({ description: 'Records per page (max 100)', default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ description: 'Pagination offset', default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
