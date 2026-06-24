import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Keypair } from 'stellar-sdk';
import { DepositQueryDto, FxRateQueryDto, WithdrawQueryDto } from './anchor.query';

describe('Anchor query validation', () => {
  const validAccount = Keypair.random().publicKey();

  it('accepts supported deposit query params', async () => {
    const dto = plainToInstance(DepositQueryDto, {
      asset: 'USDC',
      account: validAccount,
    });

    await expect(validate(dto)).resolves.toEqual([]);
  });

  it('rejects unsupported deposit assets', async () => {
    const dto = plainToInstance(DepositQueryDto, {
      asset: 'EUR',
      account: validAccount,
    });

    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'asset')).toBe(true);
  });

  it('rejects malformed Stellar accounts and non-positive withdraw amounts', async () => {
    const dto = plainToInstance(WithdrawQueryDto, {
      asset: 'NGN',
      account: 'not-a-stellar-key',
      amount: '0',
    });

    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'account')).toBe(true);
    expect(errors.some((error) => error.property === 'amount')).toBe(true);
  });

  it('accepts supported fx rate params', async () => {
    const dto = plainToInstance(FxRateQueryDto, { from: 'USD', to: 'NGN' });
    await expect(validate(dto)).resolves.toEqual([]);
  });

  it('rejects extra query fields through the validation pipe', async () => {
    const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });

    await expect(
      pipe.transform(
        { asset: 'USDC', account: validAccount, injected: 'nope' },
        { type: 'query', metatype: DepositQueryDto } as any,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
