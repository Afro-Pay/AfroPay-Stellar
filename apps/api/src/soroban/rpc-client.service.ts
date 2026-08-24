import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { Horizon, SorobanRpc } from 'stellar-sdk';
import { PrometheusService } from '../metrics/prometheus.service';

export type RpcEndpointKind = 'soroban' | 'horizon';
export type RpcHealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'rate_limited';

export interface RpcEndpointConfig {
  id: string;
  url: string;
  kind: RpcEndpointKind;
  weight: number;
}

export interface RpcEndpointState extends RpcEndpointConfig {
  status: RpcHealthStatus;
  latencyMs: number | null;
  blockHeight: number | null;
  lastCheckedAt: Date | null;
  lastError: string | null;
  consecutiveFailures: number;
  rateLimitedUntil: Date | null;
  routingBalance: number;
}

interface RankedEndpoint {
  endpoint: RpcEndpointState;
  score: number;
}

@Injectable()
export class RpcClientService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RpcClientService.name);
  private readonly http: AxiosInstance;
  private readonly endpoints = new Map<string, RpcEndpointState>();
  private readonly maxBlockLag: number;
  private readonly healthIntervalMs: number;
  private readonly requestTimeoutMs: number;
  private readonly rateLimitCooldownMs: number;
  private monitor?: NodeJS.Timeout;

  constructor(private readonly prometheus?: PrometheusService) {
    this.maxBlockLag = this.readNumber('RPC_MAX_BLOCK_LAG', 3);
    this.healthIntervalMs = this.readNumber('RPC_HEALTH_INTERVAL_MS', 10_000);
    this.requestTimeoutMs = this.readNumber('RPC_REQUEST_TIMEOUT_MS', 5_000);
    this.rateLimitCooldownMs = this.readNumber('RPC_RATE_LIMIT_COOLDOWN_MS', 60_000);
    this.http = axios.create({ timeout: this.requestTimeoutMs });

    for (const endpoint of this.loadEndpointConfig()) {
      this.endpoints.set(endpoint.id, {
        ...endpoint,
        status: 'degraded',
        latencyMs: null,
        blockHeight: null,
        lastCheckedAt: null,
        lastError: null,
        consecutiveFailures: 0,
        rateLimitedUntil: null,
        routingBalance: 0,
      });
    }
  }

  onModuleInit() {
    void this.refreshHealth();
    this.monitor = setInterval(() => void this.refreshHealth(), this.healthIntervalMs);
    this.monitor.unref?.();
  }

  onModuleDestroy() {
    if (this.monitor) {
      clearInterval(this.monitor);
    }
  }

  getSnapshot(kind?: RpcEndpointKind): RpcEndpointState[] {
    return [...this.endpoints.values()]
      .filter((endpoint) => !kind || endpoint.kind === kind)
      .map((endpoint) => ({ ...endpoint }));
  }

  async refreshHealth(): Promise<void> {
    await Promise.all([...this.endpoints.values()].map((endpoint) => this.pollEndpoint(endpoint)));
    this.emitMetrics();
    this.alertIfAllDegraded('soroban');
    this.alertIfAllDegraded('horizon');
  }

  async withSorobanServer<T>(
    operation: (server: SorobanRpc.Server, endpoint: RpcEndpointState) => Promise<T>,
  ): Promise<T> {
    return this.withEndpoint('soroban', async (endpoint) => {
      const server = new SorobanRpc.Server(endpoint.url, { allowHttp: true });
      return operation(server, endpoint);
    });
  }

  async withHorizonServer<T>(
    operation: (server: Horizon.Server, endpoint: RpcEndpointState) => Promise<T>,
  ): Promise<T> {
    return this.withEndpoint('horizon', async (endpoint) => {
      const server = new Horizon.Server(endpoint.url, { allowHttp: true });
      return operation(server, endpoint);
    });
  }

  async requestHorizon<T>(path: string): Promise<T> {
    return this.withEndpoint('horizon', async (endpoint) => {
      const url = `${endpoint.url.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
      const response = await this.http.get<T>(url);
      return response.data;
    });
  }

  private async withEndpoint<T>(
    kind: RpcEndpointKind,
    operation: (endpoint: RpcEndpointState) => Promise<T>,
  ): Promise<T> {
    const candidates = this.rankHealthy(kind);
    if (candidates.length === 0) {
      this.alertIfAllDegraded(kind);
      throw new Error(`No healthy ${kind} RPC endpoints are available`);
    }

    const errors: string[] = [];
    for (const { endpoint } of candidates) {
      const started = Date.now();
      try {
        const result = await operation(endpoint);
        this.markSuccess(endpoint, Date.now() - started);
        return result;
      } catch (error) {
        const status = this.extractStatus(error);
        this.markFailure(endpoint, error, status);
        this.prometheus?.rpcFailoversTotal?.labels(kind, endpoint.id).inc();
        errors.push(`${endpoint.id}: ${this.errorMessage(error)}`);
      }
    }

    this.alertIfAllDegraded(kind);
    throw new Error(`All ${kind} RPC endpoints failed: ${errors.join('; ')}`);
  }

  private rankHealthy(kind: RpcEndpointKind): RankedEndpoint[] {
    const highestBlock = this.highestBlock(kind);
    const ranked = [...this.endpoints.values()]
      .filter((endpoint) => endpoint.kind === kind)
      .filter((endpoint) => this.isRoutable(endpoint, highestBlock))
      .map((endpoint) => ({
        endpoint,
        score: this.effectiveWeight(endpoint),
      }));

    if (ranked.length <= 1) {
      return ranked;
    }

    const totalScore = ranked.reduce((sum, candidate) => sum + candidate.score, 0);
    for (const candidate of ranked) {
      candidate.endpoint.routingBalance += candidate.score;
    }

    const selected = ranked.reduce((best, candidate) =>
      candidate.endpoint.routingBalance > best.endpoint.routingBalance ? candidate : best,
    );
    selected.endpoint.routingBalance -= totalScore;

    return ranked.sort((a, b) => {
      if (a.endpoint.id === selected.endpoint.id) {
        return -1;
      }
      if (b.endpoint.id === selected.endpoint.id) {
        return 1;
      }
      return b.score - a.score;
    });
  }

  private isRoutable(endpoint: RpcEndpointState, highestBlock: number | null): boolean {
    if (endpoint.status === 'unhealthy' || endpoint.status === 'rate_limited') {
      return false;
    }
    if (endpoint.rateLimitedUntil && endpoint.rateLimitedUntil.getTime() > Date.now()) {
      return false;
    }
    if (highestBlock !== null && endpoint.blockHeight !== null) {
      return highestBlock - endpoint.blockHeight <= this.maxBlockLag;
    }
    return endpoint.status === 'healthy' || endpoint.status === 'degraded';
  }

  private effectiveWeight(endpoint: RpcEndpointState): number {
    const latency = Math.max(endpoint.latencyMs ?? 1_000, 1);
    return endpoint.weight * (1_000 / latency);
  }

  private async pollEndpoint(endpoint: RpcEndpointState): Promise<void> {
    const started = Date.now();
    try {
      const blockHeight =
        endpoint.kind === 'soroban'
          ? await this.fetchSorobanLedger(endpoint.url)
          : await this.fetchHorizonLedger(endpoint.url);

      endpoint.blockHeight = blockHeight;
      this.markSuccess(endpoint, Date.now() - started);
    } catch (error) {
      this.markFailure(endpoint, error, this.extractStatus(error));
    }
  }

  private async fetchSorobanLedger(url: string): Promise<number> {
    const response = await this.http.post(url, {
      jsonrpc: '2.0',
      id: 'afropay-health',
      method: 'getLatestLedger',
    });

    const sequence =
      response.data?.result?.sequence ??
      response.data?.result?.ledger ??
      response.data?.result?.latestLedger;
    if (typeof sequence !== 'number') {
      throw new Error('Soroban RPC health response missing latest ledger sequence');
    }
    return sequence;
  }

  private async fetchHorizonLedger(url: string): Promise<number> {
    const response = await this.http.get(url.replace(/\/$/, ''));
    const sequence = response.data?.history_latest_ledger ?? response.data?.core_latest_ledger;
    if (typeof sequence !== 'number') {
      throw new Error('Horizon health response missing latest ledger sequence');
    }
    return sequence;
  }

  private markSuccess(endpoint: RpcEndpointState, latencyMs: number) {
    endpoint.latencyMs = latencyMs;
    endpoint.lastCheckedAt = new Date();
    endpoint.lastError = null;
    endpoint.consecutiveFailures = 0;
    endpoint.rateLimitedUntil = null;
    endpoint.status = 'healthy';
  }

  private markFailure(endpoint: RpcEndpointState, error: unknown, status?: number) {
    endpoint.lastCheckedAt = new Date();
    endpoint.lastError = this.errorMessage(error);
    endpoint.consecutiveFailures += 1;
    if (status === 429) {
      endpoint.status = 'rate_limited';
      endpoint.rateLimitedUntil = new Date(Date.now() + this.rateLimitCooldownMs);
    } else {
      endpoint.status = endpoint.consecutiveFailures >= 2 ? 'unhealthy' : 'degraded';
    }
    this.logger.warn(
      `RPC endpoint ${endpoint.id} marked ${endpoint.status}: ${endpoint.lastError}`,
    );
  }

  private emitMetrics() {
    if (!this.prometheus) {
      return;
    }
    for (const endpoint of this.endpoints.values()) {
      this.prometheus.rpcEndpointHealth
        ?.labels(endpoint.kind, endpoint.id, endpoint.url)
        .set(endpoint.status === 'healthy' ? 1 : 0);
      this.prometheus.rpcEndpointLatencyMs
        ?.labels(endpoint.kind, endpoint.id)
        .set(endpoint.latencyMs ?? 0);
      this.prometheus.rpcEndpointBlockHeight
        ?.labels(endpoint.kind, endpoint.id)
        .set(endpoint.blockHeight ?? 0);
    }
  }

  private alertIfAllDegraded(kind: RpcEndpointKind) {
    const endpoints = [...this.endpoints.values()].filter((endpoint) => endpoint.kind === kind);
    if (endpoints.length === 0) {
      return;
    }
    const highestBlock = this.highestBlock(kind);
    if (endpoints.every((endpoint) => !this.isRoutable(endpoint, highestBlock))) {
      this.logger.error(`All ${kind} RPC endpoints are degraded or unavailable`);
      this.prometheus?.rpcAllEndpointsDegraded?.labels(kind).set(1);
    } else {
      this.prometheus?.rpcAllEndpointsDegraded?.labels(kind).set(0);
    }
  }

  private highestBlock(kind: RpcEndpointKind): number | null {
    const heights = [...this.endpoints.values()]
      .filter((endpoint) => endpoint.kind === kind)
      .map((endpoint) => endpoint.blockHeight)
      .filter((height): height is number => typeof height === 'number');
    return heights.length ? Math.max(...heights) : null;
  }

  private loadEndpointConfig(): RpcEndpointConfig[] {
    return [
      ...this.parseEndpointList('SOROBAN_RPC_URLS', 'SOROBAN_RPC_URL', 'soroban'),
      ...this.parseEndpointList('STELLAR_HORIZON_URLS', 'STELLAR_HORIZON_URL', 'horizon'),
    ];
  }

  private parseEndpointList(
    listEnv: string,
    fallbackEnv: string,
    kind: RpcEndpointKind,
  ): RpcEndpointConfig[] {
    const fallback =
      kind === 'soroban'
        ? 'https://soroban-testnet.stellar.org'
        : 'https://horizon-testnet.stellar.org';
    const raw = process.env[listEnv] || process.env[fallbackEnv] || fallback;
    return raw
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry, index) => {
        const [url, weight] = entry.split('|').map((part) => part.trim());
        return {
          id: `${kind}-${index + 1}`,
          url,
          kind,
          weight: weight ? Math.max(Number(weight), 1) : 1,
        };
      });
  }

  private extractStatus(error: any): number | undefined {
    return error?.response?.status;
  }

  private errorMessage(error: any): string {
    return error?.message || String(error);
  }

  private readNumber(name: string, fallback: number): number {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }
}
