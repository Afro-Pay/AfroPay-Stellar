import { Injectable, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Job, JobOptions, Queue } from 'bull';
import { Logger } from 'nestjs-pino';
import {
  TRANSACTION_DLQ_JOB_NAME,
  TRANSACTION_DLQ_QUEUE_NAME,
  TRANSACTION_MAX_ATTEMPTS,
  TRANSACTION_QUEUE_NAME,
  TRANSACTION_QUEUE_OPTIONS,
} from './transaction-retry.config';

export interface TransactionDlqPayload {
  originalQueue: string;
  originalJobId: string;
  originalJobName: string;
  payload: unknown;
  errorMessage: string;
  stacktrace: string[];
  attemptsMade: number;
  maxAttempts: number;
  failedAt: string;
  replayedAt?: string;
  replayJobId?: string;
}

export interface DlqListOptions {
  page?: number;
  limit?: number;
}

@Injectable()
export class TransactionDlqService implements OnModuleInit, OnModuleDestroy {
  private readonly failedListener = (job: Job, error: Error) => {
    void this.routeFailedJobToDlq(job, error).catch((dlqError) => {
      this.logger.error({
        event: 'transaction_dlq_routing_failed',
        originalJobId: job?.id?.toString(),
        error: (dlqError as Error).message,
      });
    });
  };

  constructor(
    @InjectQueue(TRANSACTION_QUEUE_NAME) private readonly transactionQueue: Queue,
    @InjectQueue(TRANSACTION_DLQ_QUEUE_NAME) private readonly dlqQueue: Queue,
    private readonly logger: Logger,
  ) {}

  onModuleInit() {
    this.transactionQueue.on('failed', this.failedListener);
  }

  onModuleDestroy() {
    this.transactionQueue.off('failed', this.failedListener);
  }

  async routeFailedJobToDlq(job: Job, error: Error): Promise<boolean> {
    const maxAttempts = Number(job.opts?.attempts ?? TRANSACTION_MAX_ATTEMPTS);
    if (maxAttempts > 0 && job.attemptsMade < maxAttempts) {
      return false;
    }

    const payload: TransactionDlqPayload = {
      originalQueue: TRANSACTION_QUEUE_NAME,
      originalJobId: job.id?.toString() ?? 'unknown',
      originalJobName: job.name,
      payload: job.data,
      errorMessage: job.failedReason || error.message,
      stacktrace: job.stacktrace?.length ? job.stacktrace : error.stack ? [error.stack] : [],
      attemptsMade: job.attemptsMade,
      maxAttempts,
      failedAt: new Date().toISOString(),
    };

    await this.dlqQueue.add(TRANSACTION_DLQ_JOB_NAME, payload, {
      jobId: this.dlqJobId(job),
      removeOnComplete: false,
      removeOnFail: false,
    });

    this.logger.error({
      event: 'transaction_dlq_enqueued',
      originalJobId: payload.originalJobId,
      originalJobName: payload.originalJobName,
      attemptsMade: payload.attemptsMade,
      maxAttempts: payload.maxAttempts,
      error: payload.errorMessage,
    });

    return true;
  }

  async list(options: DlqListOptions = {}) {
    const page = Math.max(1, Number(options.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(options.limit) || 25));
    const start = (page - 1) * limit;
    const end = start + limit - 1;
    const states = ['waiting', 'delayed', 'failed', 'paused'] as const;

    const [jobs, counts] = await Promise.all([
      this.dlqQueue.getJobs([...states], start, end, false),
      this.dlqQueue.getJobCounts(),
    ]);

    const data = await Promise.all(
      jobs.map(async (job) => ({
        jobId: job.id?.toString(),
        state: await job.getState(),
        ...job.data,
      })),
    );

    return {
      data,
      page,
      limit,
      total: Object.values(counts).reduce((sum, count) => sum + count, 0),
    };
  }

  async replay(jobId: string) {
    const dlqJob = await this.dlqQueue.getJob(jobId);
    if (!dlqJob) {
      throw new NotFoundException(`DLQ job ${jobId} not found`);
    }

    const payload = dlqJob.data as TransactionDlqPayload;
    const options: JobOptions = {
      ...TRANSACTION_QUEUE_OPTIONS,
      jobId: `replay:${jobId}:${Date.now()}`,
    };
    const replayJob = await this.transactionQueue.add(
      payload.originalJobName || 'process',
      payload.payload,
      options,
    );

    await dlqJob.update({
      ...payload,
      replayedAt: new Date().toISOString(),
      replayJobId: replayJob.id?.toString(),
    });

    this.logger.warn({
      event: 'transaction_dlq_replayed',
      dlqJobId: jobId,
      replayJobId: replayJob.id?.toString(),
    });

    return {
      dlqJobId: jobId,
      replayJobId: replayJob.id?.toString(),
      status: 'requeued',
    };
  }

  private dlqJobId(job: Job): string {
    return `${TRANSACTION_DLQ_JOB_NAME}:${job.id?.toString() ?? 'unknown'}:${job.attemptsMade}`;
  }
}
