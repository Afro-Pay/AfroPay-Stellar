import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class AnchorDto {
  @ApiProperty({
    description: 'Anchor name',
    example: 'Stellar Anchor',
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    description: 'Anchor domain',
    example: 'https://anchor.example.com',
  })
  @IsString()
  @IsNotEmpty()
  domain: string;

  @ApiProperty({
    description: 'Anchor public key',
    example: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890',
    required: false,
  })
  @IsString()
  @IsOptional()
  publicKey?: string;
}
