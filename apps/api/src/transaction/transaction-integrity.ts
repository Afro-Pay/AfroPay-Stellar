import { UnprocessableEntityException } from '@nestjs/common';

function canonicalAmount(value: string): string {
  const match = value.trim().match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) throw new UnprocessableEntityException('Transaction amount integrity check failed');

  const whole = match[1].replace(/^0+(?=\d)/, '');
  const fraction = (match[2] ?? '').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

/**
 * Binds the value approved by simulation/validation to the record that will be
 * scored and submitted. Any intervening mutation fails closed with HTTP 422.
 */
export function assertTransactionAmountIntegrity(
  approvedAmount: string,
  persistedAmount: string,
): void {
  if (canonicalAmount(approvedAmount) !== canonicalAmount(persistedAmount)) {
    throw new UnprocessableEntityException('Transaction amount changed before submission');
  }
}
