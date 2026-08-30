import { JobOptions } from 'bull';

export const TRANSACTION_QUEUE_NAME = 'transactions';
export const TRANSACTION_DLQ_QUEUE_NAME = 'transaction-dlq';
export const TRANSACTION_DLQ_JOB_NAME = 'failed-transaction';
export const TRANSACTION_MAX_ATTEMPTS = 3;
export const TRANSACTION_BACKOFF_DELAY_MS = 2_000;

export const TRANSACTION_QUEUE_OPTIONS: JobOptions = {
  attempts: TRANSACTION_MAX_ATTEMPTS,
  backoff: {
    type: 'exponential',
    delay: TRANSACTION_BACKOFF_DELAY_MS,
  },
};
