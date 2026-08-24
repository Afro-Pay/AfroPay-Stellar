import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  Registry,
  collectDefaultMetrics,
  Counter,
  Histogram,
  Gauge,
  register,
} from 'prom-client';

/**
 * Central Prometheus registry for the NestJS API.
 *
 * All metric names are prefixed with `afropay_` per the project convention.
 * Default Node.js runtime metrics (event-loop lag, heap, GC) are collected
 * automatically via collectDefaultMetrics().
 */
@Injectable()
export class PrometheusService implements OnModuleInit {
  readonly registry: Registry = register;

  // ---------------------------------------------------------------------------
  // HTTP request metrics
  // ---------------------------------------------------------------------------

  /** Total HTTP requests, partitioned by method, route, and status code. */
  readonly httpRequestsTotal = new Counter({
    name: 'afropay_http_requests_total',
    help: 'Total number of HTTP requests',
    labelNames: ['method', 'route', 'status_code'],
    registers: [this.registry],
  });

  /** HTTP request duration histogram, partitioned by method and route. */
  readonly httpRequestDurationSeconds = new Histogram({
    name: 'afropay_http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [this.registry],
  });

  // ---------------------------------------------------------------------------
  // BullMQ / transaction queue metrics
  // ---------------------------------------------------------------------------

  /**
   * Current depth of the BullMQ "transactions" queue.
   * Updated periodically by the PrometheusService itself via Bull introspection
   * and also available for injection into queue processors.
   */
  readonly bullQueueDepth = new Gauge({
    name: 'afropay_bull_queue_depth',
    help: 'Number of jobs currently waiting in the BullMQ transactions queue',
    labelNames: ['queue', 'status'],
    registers: [this.registry],
  });

  /** Cumulative count of jobs added to the queue. */
  readonly bullJobsAddedTotal = new Counter({
    name: 'afropay_bull_jobs_added_total',
    help: 'Total number of jobs added to BullMQ queues',
    labelNames: ['queue'],
    registers: [this.registry],
  });

  /** Cumulative count of jobs that completed successfully. */
  readonly bullJobsCompletedTotal = new Counter({
    name: 'afropay_bull_jobs_completed_total',
    help: 'Total number of BullMQ jobs completed successfully',
    labelNames: ['queue'],
    registers: [this.registry],
  });

  /** Cumulative count of jobs that failed (all retries exhausted). */
  readonly bullJobsFailedTotal = new Counter({
    name: 'afropay_bull_jobs_failed_total',
    help: 'Total number of BullMQ jobs that failed after all retries',
    labelNames: ['queue'],
    registers: [this.registry],
  });

  // ---------------------------------------------------------------------------
  // Fraud / risk scoring metrics
  // ---------------------------------------------------------------------------

  /** Count of transactions blocked by the fraud scoring service. */
  readonly fraudBlockedTotal = new Counter({
    name: 'afropay_fraud_blocked_total',
    help: 'Total number of transactions blocked by the fraud scoring service (riskScore >= 0.8)',
    labelNames: ['asset_code'],
    registers: [this.registry],
  });

  /** Count of transactions held for manual review (0.5 <= riskScore < 0.8). */
  readonly fraudReviewTotal = new Counter({
    name: 'afropay_fraud_review_total',
    help: 'Total number of transactions flagged for manual review (0.5 <= riskScore < 0.8)',
    labelNames: ['asset_code'],
    registers: [this.registry],
  });

  /** Count of fraud service call errors (service unavailable, timeout, etc.). */
  readonly fraudServiceErrorsTotal = new Counter({
    name: 'afropay_fraud_service_errors_total',
    help: 'Total number of errors calling the fraud scoring service',
    registers: [this.registry],
  });

  // ---------------------------------------------------------------------------
  // Anchor / SEP-6 metrics
  // ---------------------------------------------------------------------------

  /** Count of anchor API calls, by operation and status. */
  readonly anchorCallsTotal = new Counter({
    name: 'afropay_anchor_calls_total',
    help: 'Total number of outbound anchor SEP-6 API calls',
    labelNames: ['operation', 'asset_code', 'status'],
    registers: [this.registry],
  });

  // ---------------------------------------------------------------------------
  // Circuit breaker state
  // ---------------------------------------------------------------------------

  /**
   * Circuit breaker state per corridor (0 = closed/healthy, 1 = open/tripped).
   * Label `corridor` is a composite key: e.g. "USDC_testanchor".
   */
  readonly circuitBreakerState = new Gauge({
    name: 'afropay_circuit_breaker_open',
    help: 'Circuit breaker state: 1 = open (tripped), 0 = closed (healthy)',
    labelNames: ['corridor'],
    registers: [this.registry],
  });

  // ---------------------------------------------------------------------------
  // Stellar RPC provider metrics
  // ---------------------------------------------------------------------------

  /** Provider health by RPC kind and endpoint (1 = routable, 0 = degraded). */
  readonly rpcEndpointHealth = new Gauge({
    name: 'afropay_rpc_endpoint_health',
    help: 'Stellar RPC endpoint health, 1 when healthy and routable',
    labelNames: ['kind', 'endpoint_id', 'url'],
    registers: [this.registry],
  });

  /** Last observed RPC provider latency in milliseconds. */
  readonly rpcEndpointLatencyMs = new Gauge({
    name: 'afropay_rpc_endpoint_latency_ms',
    help: 'Last observed latency for each Stellar RPC endpoint in milliseconds',
    labelNames: ['kind', 'endpoint_id'],
    registers: [this.registry],
  });

  /** Last observed ledger height for each RPC provider. */
  readonly rpcEndpointBlockHeight = new Gauge({
    name: 'afropay_rpc_endpoint_block_height',
    help: 'Last observed ledger or block height for each Stellar RPC endpoint',
    labelNames: ['kind', 'endpoint_id'],
    registers: [this.registry],
  });

  /** Alert flag when no provider of a kind is routable. */
  readonly rpcAllEndpointsDegraded = new Gauge({
    name: 'afropay_rpc_all_endpoints_degraded',
    help: 'Set to 1 when every configured RPC endpoint of a kind is degraded',
    labelNames: ['kind'],
    registers: [this.registry],
  });

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  onModuleInit() {
    // Collect Node.js default metrics (heap, GC, event-loop lag, etc.)
    // with the afropay_ prefix.
    collectDefaultMetrics({
      register: this.registry,
      prefix: 'afropay_nodejs_',
    });
  }

  /** Returns the full Prometheus text-format exposition string. */
  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  /** Returns the Content-Type header value expected by Prometheus scrapers. */
  getContentType(): string {
    return this.registry.contentType;
  }
}
