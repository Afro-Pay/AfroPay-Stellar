/**
 * In-process mock SEP-6/24 anchor server.
 *
 * Starts a lightweight Express server that responds to the subset of SEP-6
 * endpoints that AfroPay's AnchorService calls:
 *
 *   GET /sep6/deposit  → returns a minimal deposit response
 *   GET /sep6/withdraw → returns a minimal withdrawal response
 *   GET /.well-known/stellar.toml → returns a minimal stellar.toml
 *
 * The server binds to a random free port and is started/stopped by the tests.
 * Call `MockAnchorServer.start()` in beforeAll and `MockAnchorServer.stop()`
 * in afterAll.  Set the baseUrl as ANCHOR_USDC_URL / ANCHOR_NGN_URL in the
 * NestJS app environment before the app is initialised.
 *
 * Failure simulation:
 *   server.simulateTimeout(true)  – next request hangs (ECONNABORTED-style)
 *   server.simulateError(500)     – next request returns an HTTP error
 *   server.reset()                – restore normal behaviour
 */

import * as http from 'http';
import * as net from 'net';

interface AnchorServerOptions {
  /** Fixed port; if omitted a random free port is chosen */
  port?: number;
}

type FailureMode =
  | { type: 'none' }
  | { type: 'timeout' }
  | { type: 'error'; statusCode: number; message: string };

export class MockAnchorServer {
  private server: http.Server;
  private failure: FailureMode = { type: 'none' };
  private _port = 0;

  // Counters for test assertions
  depositCallCount = 0;
  withdrawCallCount = 0;

  constructor(private options: AnchorServerOptions = {}) {
    this.server = http.createServer((req, res) => this.handleRequest(req, res));
  }

  get baseUrl(): string {
    return `http://127.0.0.1:${this._port}`;
  }

  get port(): number {
    return this._port;
  }

  /** Start the server and resolve once it is listening. */
  async start(): Promise<void> {
    const port = this.options.port ?? (await findFreePort());
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(port, '127.0.0.1', () => {
        this._port = (this.server.address() as net.AddressInfo).port;
        resolve();
      });
    });
  }

  /** Stop the server and resolve once all connections are closed. */
  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  /** Simulate a network timeout on the next (and every subsequent) request. */
  simulateTimeout(): void {
    this.failure = { type: 'timeout' };
  }

  /** Simulate an HTTP error response on the next request. */
  simulateError(statusCode = 500, message = 'Anchor internal error'): void {
    this.failure = { type: 'error', statusCode, message };
  }

  /** Restore normal (happy-path) behaviour. */
  reset(): void {
    this.failure = { type: 'none' };
    this.depositCallCount = 0;
    this.withdrawCallCount = 0;
  }

  private handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): void {
    // Failure simulation (applies to all routes)
    if (this.failure.type === 'timeout') {
      // Deliberately never respond — connection will time out
      return;
    }
    if (this.failure.type === 'error') {
      res.writeHead(this.failure.statusCode, {
        'Content-Type': 'application/json',
      });
      res.end(JSON.stringify({ error: this.failure.message }));
      return;
    }

    const url = new URL(req.url ?? '/', this.baseUrl);

    if (url.pathname === '/sep6/deposit') {
      this.depositCallCount += 1;
      this.handleDeposit(url, res);
    } else if (url.pathname === '/sep6/withdraw') {
      this.withdrawCallCount += 1;
      this.handleWithdraw(url, res);
    } else if (url.pathname === '/.well-known/stellar.toml') {
      this.handleStellarToml(res);
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  }

  // ---------------------------------------------------------------------------
  // Route handlers
  // ---------------------------------------------------------------------------

  private handleDeposit(url: URL, res: http.ServerResponse): void {
    const asset = url.searchParams.get('asset_code') ?? 'USDC';
    const account = url.searchParams.get('account') ?? '';

    const body = {
      how: 'Make a bank transfer to Account #123456',
      eta: 1800,
      fee_fixed: 1.0,
      fee_percent: 0,
      min_amount: 10,
      max_amount: 10_000,
      asset_code: asset,
      // Echo the account so AnchorService reconciliation passes
      stellar_account: account,
      extra_info: {
        message:
          'Your deposit is being processed. Expected confirmation in 30 minutes.',
      },
    };

    json(res, 200, body);
  }

  private handleWithdraw(url: URL, res: http.ServerResponse): void {
    const asset = url.searchParams.get('asset_code') ?? 'USDC';
    const amount = parseFloat(url.searchParams.get('amount') ?? '0');

    // Simulate amount-out-of-range errors for test assertions
    if (amount > 0 && amount < 10) {
      json(res, 400, {
        error: `Amount ${amount} is below minimum 10`,
        min_amount: 10,
      });
      return;
    }
    if (amount > 10_000) {
      json(res, 400, {
        error: `Amount ${amount} exceeds maximum 10000`,
        max_amount: 10_000,
      });
      return;
    }

    const body = {
      account_id: 'GANCHOR000000000000000000000000000000000000000000000000001',
      memo_type: 'text',
      memo: `withdraw-${Date.now()}`,
      fee_fixed: 0.5,
      fee_percent: 0,
      min_amount: 10,
      max_amount: 10_000,
      asset_code: asset,
      eta: 600,
      extra_info: { message: 'Send XLM to the account above with the memo.' },
    };

    json(res, 200, body);
  }

  private handleStellarToml(res: http.ServerResponse): void {
    const toml = [
      'NETWORK_PASSPHRASE="Test SDF Network ; September 2015"',
      'SIGNING_KEY="GBMOCK_ANCHOR_SIGNING_KEY_TEST_ONLY_000000000000000000001"',
      '',
      '[[CURRENCIES]]',
      'code="USDC"',
      'issuer="GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"',
      '',
      '[[CURRENCIES]]',
      'code="NGN"',
      'issuer="GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"',
    ].join('\n');

    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(toml);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(res: http.ServerResponse, status: number, body: object): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

/** Find a free TCP port by briefly binding to port 0. */
function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
    srv.once('error', reject);
  });
}

/** Singleton helper — creates and starts one mock anchor per test suite. */
let _singleton: MockAnchorServer | null = null;

export async function startMockAnchor(): Promise<MockAnchorServer> {
  if (_singleton) return _singleton;
  _singleton = new MockAnchorServer();
  await _singleton.start();
  return _singleton;
}

export async function stopMockAnchor(): Promise<void> {
  if (_singleton) {
    await _singleton.stop();
    _singleton = null;
  }
}
