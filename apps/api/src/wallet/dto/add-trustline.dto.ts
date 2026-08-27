import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, Matches, registerDecorator, ValidationOptions } from 'class-validator';
import { StrKey } from 'stellar-sdk';

function IsStellarPublicKey(validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      name: 'isStellarPublicKey',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          return typeof value === 'string' && StrKey.isValidEd25519PublicKey(value);
        },
        defaultMessage() {
          return 'assetIssuer must be a valid Stellar public key (G...)';
        },
      },
    });
  };
}

export class AddTrustlineDto {
  @ApiProperty({
    description: 'Asset code for the trustline',
    example: 'USDC',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Za-z0-9]{1,12}$/, {
    message: 'assetCode must be 1-12 alphanumeric characters',
  })
  assetCode: string;

  @ApiProperty({
    description: 'Issuing account public key (Stellar G-address)',
    example: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  })
  @IsString()
  @IsNotEmpty()
  @IsStellarPublicKey()
  assetIssuer: string;

  @ApiProperty({
    description: 'Optional trustline limit',
    example: '1000000',
    required: false,
  })
  @IsString()
  @IsOptional()
  limit?: string;
}
