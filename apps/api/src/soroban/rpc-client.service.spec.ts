import axios from 'axios';
import { RpcClientService } from './rpc-client.service';

jest.mock('axios');

describe('RpcClientService', () => {
  const originalEnv = process.env;
  let http: { get: jest.Mock; post: jest.Mock };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-24T12:00:00.000Z'));
    process.env = {
      ...originalEnv,
      SOROBAN_RPC_URLS: 'http://primary-rpc.test|1,http://backup-rpc.test|1',
      STELLAR_HORIZON_URLS: 'http://horizon-a.test|1,http://horizon-b.test|1',
      RPC_MAX_BLOCK_LAG: '3',
      RPC_HEALTH_INTERVAL_MS: '10000',
      RPC_RATE_LIMIT_COOLDOWN_MS: '60000',
    };
    http = {
      get: jest.fn(),
      post: jest.fn(),
    };
    (axios.create as jest.Mock).mockReturnValue(http);
  });

  afterEach(() => {
    jest.useRealTimers();
    process.env = originalEnv;
    jest.clearAllMocks();
  });

  it('retries a Soroban request on the next healthy node when the first node fails', async () => {
    const service = new RpcClientService();
    http.post
      .mockResolvedValueOnce({ data: { result: { sequence: 500 } } })
      .mockResolvedValueOnce({ data: { result: { sequence: 500 } } });

    await service.refreshHealth();

    const visited: string[] = [];
    const result = await (service as any).withEndpoint('soroban', async (endpoint) => {
      visited.push(endpoint.id);
      if (endpoint.id === 'soroban-1') {
        throw new Error('primary offline');
      }
      return 'submitted';
    });

    expect(result).toBe('submitted');
    expect(visited).toEqual(['soroban-1', 'soroban-2']);
    expect(service.getSnapshot('soroban')[0].status).toBe('degraded');
  });

  it('excludes Soroban endpoints lagging more than the configured block threshold', async () => {
    const service = new RpcClientService();
    http.post
      .mockResolvedValueOnce({ data: { result: { sequence: 1_000 } } })
      .mockResolvedValueOnce({ data: { result: { sequence: 996 } } });

    await service.refreshHealth();

    const visited: string[] = [];
    const result = await (service as any).withEndpoint('soroban', async (endpoint) => {
      visited.push(endpoint.id);
      return endpoint.id;
    });

    expect(result).toBe('soroban-1');
    expect(visited).toEqual(['soroban-1']);
  });

  it('marks HTTP 429 responses as rate limited and routes to another Horizon endpoint', async () => {
    const service = new RpcClientService();
    http.get
      .mockResolvedValueOnce({ data: { history_latest_ledger: 700 } })
      .mockResolvedValueOnce({ data: { history_latest_ledger: 700 } });

    await service.refreshHealth();

    const rateLimitError: any = new Error('too many requests');
    rateLimitError.response = { status: 429 };

    const result = await (service as any).withEndpoint('horizon', async (endpoint) => {
      if (endpoint.id === 'horizon-1') {
        throw rateLimitError;
      }
      return endpoint.url;
    });

    const snapshot = service.getSnapshot('horizon');
    expect(result).toBe('http://horizon-b.test');
    expect(snapshot[0].status).toBe('rate_limited');
    expect(snapshot[0].rateLimitedUntil?.toISOString()).toBe('2026-08-24T12:01:00.000Z');
  });
});
