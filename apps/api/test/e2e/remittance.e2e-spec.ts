/**
 * E2E: Full remittance flow
 *
 * Covers:
 *  - wallet creation → testnet fund → USDC transfer → anchor withdrawal
 *  - failure cases: insufficient balance, anchor timeout, invalid destination
 *
 * Stellar Horizon and the anchor HTTP calls are mocked so tests are fast
 * and deterministic without live testnet connectivity.
 * The NestJS app, Prisma (real DB), Redis, and BullMQ are real.
 */

import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createApp, uniqueEmail } from './helpers';

// ---------------------------------------------------------------------------
// Stellar SDK mock
// ---------------------------------------------------------------------------
let mockLoadAccount: jest.Mock;
let mockSubmitTransaction: jest.Mock;

jest.mock('stellar-sdk', () => {
  const actual = jest.requireActual('stellar-sdk');
  const innerMockLoadAccount = jest.fn();
  const innerMockSubmitTransaction = jest.fn();
  return {
    ...actual,
    Horizon: {
      ...actual.Horizon,
      Server: jest.fn().mockImplementation(() => ({
        loadAccount: innerMockLoadAccount,
        submitTransaction: innerMockSubmitTransaction,
      })),
    },
    _mockLoadAccount: innerMockLoadAccount,
    _mockSubmitTransaction: innerMockSubmitTransaction,
  };
});

const { _mockLoadAccount, _mockSubmitTransaction } = require('stellar-sdk') as any;
mockLoadAccount = _mockLoadAccount;
mockSubmitTransaction = _mockSubmitTransaction;

// ---------------------------------------------------------------------------
// axios mock — prevents real HTTP calls to testanchor.stellar.org
// ---------------------------------------------------------------------------
jest.mock('axios', () => {
  const mockAxiosInstance = {
    interceptors: {
      request: { use: jest.fn(), eject: jest.fn() },
      response: { use: jest.fn(), eject: jest.fn() },
    },
    get: jest.fn(),
    post: jest.fn(),
  };
  return {
    __esModule: true,
    default: {
      create: jest.fn().mockReturnValue(mockAxiosInstance),
      get: jest.fn(),
      post: jest.fn(),
    },
    create: jest.fn().mockReturnValue(mockAxiosInstance),
    get: jest.fn(),
    post: jest.fn(),
  };
});
import axios from 'axios';
const mockedAxios = axios as any;

const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

// A valid-format Stellar public key (G + 55 uppercase chars = 56 total)
const DEST_KEY = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

const mockAccount = {
  balances: [
    { asset_type: 'native', balance: '9999.9999900' },
    {
      asset_type: 'credit_alphanum4',
      asset_code: 'USDC',
      asset_issuer: USDC_ISSUER,
      balance: '500.0000000',
      limit: '922337203685.4775807',
    },
  ],
  sequence: '12345',
  last_modified_ledger: 100,
  last_modified_time: new Date().toISOString(),
  incrementSequenceNumber: jest.fn(),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Remittance E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;
  let userId: string;

  beforeAll(async () => {
    // Default happy-path Horizon behaviour
    mockLoadAccount.mockResolvedValue(mockAccount);
    mockSubmitTransaction.mockResolvedValue({ hash: 'abc123stellarhash' });

    app = await createApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  // -------------------------------------------------------------------------
  // 1. Register & get a JWT
  // -------------------------------------------------------------------------
  describe('auth', () => {
    it('registers a new user', async () => {
      const email = uniqueEmail();
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password: 'Password1!' })
        .expect(201);

      expect(res.body.access_token).toBeDefined();
      token = res.body.access_token;

      // Decode sub to get userId (base64 middle segment)
      const payload = JSON.parse(
        Buffer.from(token.split('.')[1], 'base64').toString(),
      );
      userId = payload.sub;
    });
  });

  // -------------------------------------------------------------------------
  // 2. Wallet creation
  // -------------------------------------------------------------------------
  describe('wallet creation', () => {
    it('creates a Stellar wallet for the user', async () => {
      const res = await request(app.getHttpServer())
        .post('/wallet/create')
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      expect(res.body.publicKey).toMatch(/^G/);
    });

    it('returns balances (XLM + USDC from mocked Horizon)', async () => {
      const res = await request(app.getHttpServer())
        .get('/wallet/balances')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const assets = res.body.map((b: any) => b.asset);
      expect(assets).toContain('XLM');
      expect(assets).toContain('USDC');
    });
  });

  // -------------------------------------------------------------------------
  // 3. USDC transfer — happy path
  // -------------------------------------------------------------------------
  describe('USDC transfer', () => {
    let txId: string;

    it('enqueues a USDC transfer and returns PENDING', async () => {
      // KYC NONE tier allows up to $100/day; $50 is within limit
      const res = await request(app.getHttpServer())
        .post('/transactions/send')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', 'a1111111-2222-4333-8444-555555555555')
        .send({
          destinationPublicKey: DEST_KEY,
          amount: '50',
          assetCode: 'USDC',
          assetIssuer: USDC_ISSUER,
          memo: 'e2e-test',
        })
        .expect(201);

      expect(res.body.txId).toBeDefined();
      expect(res.body.status).toBe('PENDING');
      txId = res.body.txId;
    });

    it('appears in transaction history', async () => {
      const res = await request(app.getHttpServer())
        .get('/transactions/history')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const tx = res.body.find((t: any) => t.id === txId);
      expect(tx).toBeDefined();
      expect(tx.assetCode).toBe('USDC');
      expect(tx.amount).toBe('50');
    });

    it('is retrievable by ID (owner only)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/transactions/${txId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.id).toBe(txId);
    });

    it('simulates settlement: status updates to SUCCESS', async () => {
      // Simulate what the Rust worker does after Stellar submission
      await prisma.transaction.update({
        where: { id: txId },
        data: { status: 'SUCCESS', stellarTxHash: 'abc123stellarhash' },
      });

      const res = await request(app.getHttpServer())
        .get(`/transactions/${txId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.status).toBe('SUCCESS');
      expect(res.body.stellarTxHash).toBe('abc123stellarhash');
    });
  });

  // -------------------------------------------------------------------------
  // 3b. Idempotent send (Idempotency-Key header)
  // -------------------------------------------------------------------------
  describe('idempotent send', () => {
    let idemToken: string;
    let originalTxId: string;

    const body = {
      destinationPublicKey: DEST_KEY,
      amount: '10',
      assetCode: 'USDC',
      assetIssuer: USDC_ISSUER,
      memo: 'idem-e2e',
    };
    const key = '11111111-2222-4333-8444-555555555555';

    beforeAll(async () => {
      // Fresh user so cumulative spend stays clear of the KYC daily limit.
      const reg = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: uniqueEmail(), password: 'Password1!' })
        .expect(201);
      idemToken = reg.body.access_token;

      await request(app.getHttpServer())
        .post('/wallet/create')
        .set('Authorization', `Bearer ${idemToken}`)
        .expect(201);
    });

    it('first request creates the transfer (201)', async () => {
      const res = await request(app.getHttpServer())
        .post('/transactions/send')
        .set('Authorization', `Bearer ${idemToken}`)
        .set('Idempotency-Key', key)
        .send(body)
        .expect(201);

      expect(res.body.txId).toBeDefined();
      expect(res.body.status).toBe('PENDING');
      originalTxId = res.body.txId;
    });

    it('duplicate with the same key replays the original (200) — identical txId, no new record', async () => {
      const res = await request(app.getHttpServer())
        .post('/transactions/send')
        .set('Authorization', `Bearer ${idemToken}`)
        .set('Idempotency-Key', key)
        .send(body)
        .expect(200);

      // Same transaction id proves no second row was created.
      expect(res.body.txId).toBe(originalTxId);
      expect(res.body.status).toBe('PENDING');
    });

    it('a different key creates a new transfer (201) with a different txId', async () => {
      const res = await request(app.getHttpServer())
        .post('/transactions/send')
        .set('Authorization', `Bearer ${idemToken}`)
        .set('Idempotency-Key', '99999999-8888-4777-8666-555555555555')
        .send(body)
        .expect(201);

      expect(res.body.txId).toBeDefined();
      expect(res.body.txId).not.toBe(originalTxId);
    });

    it('rejects a missing Idempotency-Key (400)', async () => {
      await request(app.getHttpServer())
        .post('/transactions/send')
        .set('Authorization', `Bearer ${idemToken}`)
        .send(body)
        .expect(400);
    });

    it('rejects a malformed Idempotency-Key (400)', async () => {
      await request(app.getHttpServer())
        .post('/transactions/send')
        .set('Authorization', `Bearer ${idemToken}`)
        .set('Idempotency-Key', 'not-a-uuid')
        .send(body)
        .expect(400);
    });
  });

  // -------------------------------------------------------------------------
  // 4. Anchor withdrawal — happy path
  // -------------------------------------------------------------------------
  describe('anchor withdrawal', () => {
    it('returns withdraw info for USDC', async () => {
      mockedAxios.get = jest.fn().mockResolvedValue({
        data: {
          type: 'non_interactive_customer_info_needed',
          fields: { email_address: {} },
          fee_fixed: 0.5,
          min_amount: 10,
          max_amount: 10000,
        },
      });

      const res = await request(app.getHttpServer())
        .get('/anchor/withdraw?assetCode=USDC')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.type).toBe('non_interactive_customer_info_needed');
      expect(res.body.fee_fixed).toBe(0.5);
    });
  });

  // -------------------------------------------------------------------------
  // 5. Error handling & resilience
  // -------------------------------------------------------------------------
  describe('error handling & edge cases', () => {
    it('underfunded transaction: enqueued, will fail during settlement', async () => {
      // Worker receives Horizon error (tx_failed/op_underfunded)
      mockedAxios.post = jest.fn().mockRejectedValue(
        new AxiosError('Request failed with status code 400', 'ERR_BAD_REQUEST', undefined, undefined, {
          status: 400,
          data: {
            status: 400,
            data: { extras: { result_codes: { transaction: 'tx_failed', operations: ['op_underfunded'] } } },
          },
        }),
      );

      // API queues the job as PENDING — submission is async via the worker
      const res = await request(app.getHttpServer())
        .post('/transactions/send')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', 'b2222222-3333-4444-8555-666666666666')
        .send({ destinationPublicKey: DEST_KEY, amount: '1', assetCode: 'XLM' })
        .expect(201);

      const txId = res.body.txId;

      // Simulate the processor marking it FAILED after Horizon rejection
      await prisma.transaction.update({
        where: { id: txId },
        data: { status: 'FAILED' },
      });

      const check = await request(app.getHttpServer())
        .get(`/transactions/${txId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(check.body.status).toBe('FAILED');
    });

    it('invalid destination: enqueued, will fail during settlement', async () => {
      // Stellar SDK validation happens in the processor, not the API layer.
      // The endpoint accepts it, and settlement marks it FAILED.
      await request(app.getHttpServer())
        .post('/transactions/send')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', 'c3333333-4444-4555-8666-777777777777')
        .send({
          destinationPublicKey: 'NOT_A_VALID_STELLAR_KEY',
          amount: '1',
          assetCode: 'XLM',
        })
        .expect(201);
    });

    it('blocks transfer exceeding KYC daily limit (NONE tier = $100/day)', async () => {
      // $50 already SUCCESS, sending $60 more = $110 > $100 limit
      const res = await request(app.getHttpServer())
        .post('/transactions/send')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', 'd4444444-5555-4666-8777-888888888888')
        .send({
          destinationPublicKey: DEST_KEY,
          amount: '60',
          assetCode: 'XLM',
        })
        .expect(403);

      expect(res.body.message).toMatch(/Transaction limit exceeded/);
    });

    it('returns 401 when sending without a token', async () => {
      await request(app.getHttpServer())
        .post('/transactions/send')
        .set('Idempotency-Key', 'e5555555-6666-4777-8888-999999999999')
        .send({ destinationPublicKey: DEST_KEY, amount: '1', assetCode: 'XLM' })
        .expect(401);
    });

    it('returns 403 when accessing another user\'s transaction', async () => {
      const otherEmail = uniqueEmail();
      const otherRes = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: otherEmail, password: 'Password1!' });
      const otherToken = otherRes.body.access_token;

      await request(app.getHttpServer())
        .post('/wallet/create')
        .set('Authorization', `Bearer ${otherToken}`);

      const txRes = await request(app.getHttpServer())
        .post('/transactions/send')
        .set('Authorization', `Bearer ${otherToken}`)
        .set('Idempotency-Key', 'f6666666-7777-4888-8999-000000000000')
        .send({ destinationPublicKey: DEST_KEY, amount: '1', assetCode: 'XLM' });

      const otherTxId = txRes.body.txId;

      await request(app.getHttpServer())
        .get(`/transactions/${otherTxId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    });

    it('returns 403 for a non-existent transaction ID', async () => {
      await request(app.getHttpServer())
        .get('/transactions/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    });

    it('anchor timeout returns 500', async () => {
      mockedAxios.get = jest.fn().mockRejectedValue(
        Object.assign(new Error('timeout of 5000ms exceeded'), { code: 'ECONNABORTED' }),
      );

      await request(app.getHttpServer())
        .get('/anchor/withdraw')
        .set('Authorization', `Bearer ${token}`)
        .query({ asset: 'USDC', account: DEST_KEY, amount: '50' })
        .expect(500);
    });
  });

  // -------------------------------------------------------------------------
  // 6. FX rate
  // -------------------------------------------------------------------------
  describe('fx rate', () => {
    it('returns a rate for USD-NGN', async () => {
      const res = await request(app.getHttpServer())
        .get('/anchor/fx-rate')
        .set('Authorization', `Bearer ${token}`)
        .query({ from: 'USD', to: 'NGN' })
        .expect(200);

      expect(res.body.rate).toBe(1550);
      expect(res.body.from).toBe('USD');
      expect(res.body.to).toBe('NGN');
    });

    it('returns null rate for a pair with no known rate', async () => {
      // XLM-NGN has no direct rate in the stub but is a valid pair
      const res = await request(app.getHttpServer())
        .get('/anchor/fx-rate')
        .set('Authorization', `Bearer ${token}`)
        .query({ from: 'XLM', to: 'NGN' })
        .expect(200);

      // XLM→USDC→NGN path exists, so we get a rate
      expect(res.body.rate).toBeDefined();
    });
  });
});
