import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import {
  Keypair,
  Networks,
  TransactionBuilder,
  Transaction,
  Operation,
  Account,
  BASE_FEE,
} from 'stellar-sdk';
import { Sep10Service, InMemoryNonceStore } from './sep10.service';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const TESTNET = Networks.TESTNET;
const SERVER_KEYPAIR = Keypair.random();
const CLIENT_KEYPAIR = Keypair.random();

/** Builds and returns a valid SEP-10 challenge transaction signed by the server. */
function buildChallenge(
  serverKeypair: Keypair = SERVER_KEYPAIR,
  clientPublicKey: string = CLIENT_KEYPAIR.publicKey(),
  homeDomain = 'localhost',
  nonce = Buffer.from('test-nonce-32-bytes-padded-xxxxxx'),
  options: { timeBoundsOffset?: number; maxDuration?: number } = {},
) {
  const now = Math.floor(Date.now() / 1000);
  const min = now + (options.timeBoundsOffset ?? 0);
  const max = min + (options.maxDuration ?? 299);

  const serverAccount = new Account(serverKeypair.publicKey(), '-1');
  const tx = new TransactionBuilder(serverAccount, {
    fee: BASE_FEE,
    networkPassphrase: TESTNET,
  })
    .addOperation(
      Operation.manageData({
        name: `${homeDomain} auth`,
        value: nonce,
        source: clientPublicKey,
      }),
    )
    .addOperation(
      Operation.manageData({
        name: 'web_auth_domain',
        value: Buffer.from(homeDomain),
        source: serverKeypair.publicKey(),
      }),
    )
    .setTimebounds(min, max)
    .build();

  tx.sign(serverKeypair);
  return tx;
}

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    create: jest.fn(),
  },
};

const mockJwtService = {
  sign: jest.fn().mockReturnValue('mock-jwt-token'),
};

function makeMockRedis() {
  return new InMemoryNonceStore();
}

// ---------------------------------------------------------------------------
// Service factory
// ---------------------------------------------------------------------------

async function makeSep10Service(
  redisOverride?: InMemoryNonceStore,
): Promise<Sep10Service> {
  process.env.SEP10_SERVER_SECRET = SERVER_KEYPAIR.secret();
  process.env.STELLAR_NETWORK = 'testnet';
  process.env.SEP10_HOME_DOMAIN = 'localhost';

  const redis = redisOverride ?? makeMockRedis();

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      Sep10Service,
      { provide: JwtService, useValue: mockJwtService },
      { provide: 'PRISMA_CLIENT', useValue: mockPrisma },
      { provide: 'SEP10_REDIS', useValue: redis },
    ],
  })
    .overrideProvider('PRISMA_CLIENT')
    .useValue(mockPrisma)
    .compile();

  // Sep10Service uses PrismaClient directly, not a token — inject via prototype.
  const service = module.get<Sep10Service>(Sep10Service);
  (service as any).prisma = mockPrisma;

  return service;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Sep10Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // generateChallenge
  // =========================================================================
  describe('generateChallenge', () => {
    it('returns a base64 XDR and the testnet passphrase', async () => {
      const service = await makeSep10Service();
      const { transaction, network_passphrase } =
        await service.generateChallenge(CLIENT_KEYPAIR.publicKey());

      expect(typeof transaction).toBe('string');
      expect(transaction.length).toBeGreaterThan(50);
      expect(network_passphrase).toBe(TESTNET);
    });

    it('challenge XDR is a valid Transaction signed by the server', async () => {
      const service = await makeSep10Service();
      const { transaction } = await service.generateChallenge(
        CLIENT_KEYPAIR.publicKey(),
      );

      const tx = TransactionBuilder.fromXDR(
        transaction,
        TESTNET,
      ) as Transaction;

      expect(tx.operations).toHaveLength(2);
      expect(tx.operations[0].type).toBe('manageData');
      expect((tx.operations[0] as any).name).toBe('localhost auth');
      expect((tx.operations[0] as any).source).toBe(CLIENT_KEYPAIR.publicKey());

      // Server signature must be present
      const txHash = tx.hash();
      const serverSig = tx.signatures.find((sig) => {
        try {
          return SERVER_KEYPAIR.verify(txHash, sig.signature());
        } catch { return false; }
      });
      expect(serverSig).toBeDefined();
    });

    it('rejects an invalid public key', async () => {
      const service = await makeSep10Service();
      await expect(
        service.generateChallenge('NOT_A_VALID_KEY'),
      ).rejects.toThrow(BadRequestException);
    });

    it('stores the nonce in Redis with the correct TTL prefix', async () => {
      const redis = makeMockRedis();
      const setSpy = jest.spyOn(redis, 'set');

      const service = await makeSep10Service(redis);
      await service.generateChallenge(CLIENT_KEYPAIR.publicKey());

      expect(setSpy).toHaveBeenCalledWith(
        expect.stringContaining('sep10:nonce:'),
        '1',
        'EX',
        expect.any(Number),
      );
    });
  });

  // =========================================================================
  // verifyAndIssueToken — happy path
  // =========================================================================
  describe('verifyAndIssueToken — valid challenge', () => {
    it('issues a JWT when the client signature is valid', async () => {
      const redis = makeMockRedis();
      const service = await makeSep10Service(redis);

      // Generate a real challenge to get the nonce stored in Redis.
      const { transaction: challengeXdr } = await service.generateChallenge(
        CLIENT_KEYPAIR.publicKey(),
      );

      // Client signs the challenge.
      const tx = TransactionBuilder.fromXDR(challengeXdr, TESTNET) as Transaction;
      tx.sign(CLIENT_KEYPAIR);
      const signedXdr = tx.toEnvelope().toXDR('base64');

      // Mock the Prisma user upsert.
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 'user-123',
        stellarPublicKey: CLIENT_KEYPAIR.publicKey(),
        email: `sep10+${CLIENT_KEYPAIR.publicKey()}@stellar.local`,
      });

      const result = await service.verifyAndIssueToken(signedXdr);

      expect(result.token).toBe('mock-jwt-token');
      expect(result.stellar_account).toBe(CLIENT_KEYPAIR.publicKey());
      expect(result.expires_in).toBeGreaterThan(0);
    });

    it('returns the existing user when public key is already registered', async () => {
      const redis = makeMockRedis();
      const service = await makeSep10Service(redis);

      const { transaction: challengeXdr } = await service.generateChallenge(
        CLIENT_KEYPAIR.publicKey(),
      );

      const tx = TransactionBuilder.fromXDR(challengeXdr, TESTNET) as Transaction;
      tx.sign(CLIENT_KEYPAIR);
      const signedXdr = tx.toEnvelope().toXDR('base64');

      const existingUser = {
        id: 'existing-user-456',
        stellarPublicKey: CLIENT_KEYPAIR.publicKey(),
        email: `sep10+${CLIENT_KEYPAIR.publicKey()}@stellar.local`,
      };
      mockPrisma.user.findUnique.mockResolvedValue(existingUser);

      const result = await service.verifyAndIssueToken(signedXdr);

      expect(mockPrisma.user.create).not.toHaveBeenCalled();
      expect(result.stellar_account).toBe(CLIENT_KEYPAIR.publicKey());
    });
  });

  // =========================================================================
  // verifyAndIssueToken — error branches
  // =========================================================================
  describe('verifyAndIssueToken — invalid challenges', () => {
    it('rejects malformed XDR', async () => {
      const service = await makeSep10Service();
      await expect(
        service.verifyAndIssueToken('this-is-not-valid-xdr'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an expired challenge (maxTime in the past)', async () => {
      const redis = makeMockRedis();
      const service = await makeSep10Service(redis);

      // Build a challenge with timebounds in the past.
      const tx = buildChallenge(SERVER_KEYPAIR, CLIENT_KEYPAIR.publicKey(), 'localhost',
        Buffer.from('nonce-value-32bytes-padding-xxxxx'), { timeBoundsOffset: -600 });

      tx.sign(CLIENT_KEYPAIR);
      const signedXdr = tx.toEnvelope().toXDR('base64');

      await expect(
        service.verifyAndIssueToken(signedXdr),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects when manage_data key does not match home domain', async () => {
      const redis = makeMockRedis();
      const service = await makeSep10Service(redis);

      const serverAccount = new Account(SERVER_KEYPAIR.publicKey(), '-1');
      const now = Math.floor(Date.now() / 1000);
      const tx = new TransactionBuilder(serverAccount, {
        fee: BASE_FEE,
        networkPassphrase: TESTNET,
      })
        .addOperation(
          Operation.manageData({
            name: 'wrong_domain auth',   // wrong key
            value: Buffer.from('nonce'),
            source: CLIENT_KEYPAIR.publicKey(),
          }),
        )
        .setTimebounds(now, now + 299)
        .build();

      tx.sign(SERVER_KEYPAIR);
      tx.sign(CLIENT_KEYPAIR);
      const signedXdr = tx.toEnvelope().toXDR('base64');

      await expect(
        service.verifyAndIssueToken(signedXdr),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects replay attack — same nonce submitted twice', async () => {
      const redis = makeMockRedis();
      const service = await makeSep10Service(redis);

      const { transaction: challengeXdr } = await service.generateChallenge(
        CLIENT_KEYPAIR.publicKey(),
      );

      const tx = TransactionBuilder.fromXDR(challengeXdr, TESTNET) as Transaction;
      tx.sign(CLIENT_KEYPAIR);
      const signedXdr = tx.toEnvelope().toXDR('base64');

      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-123',
        stellarPublicKey: CLIENT_KEYPAIR.publicKey(),
      });

      // First submission succeeds.
      await service.verifyAndIssueToken(signedXdr);

      // Second submission with the same XDR must be rejected.
      await expect(
        service.verifyAndIssueToken(signedXdr),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects when the client signature is missing', async () => {
      const redis = makeMockRedis();
      const service = await makeSep10Service(redis);

      const { transaction: challengeXdr } = await service.generateChallenge(
        CLIENT_KEYPAIR.publicKey(),
      );

      // Do NOT sign with the client keypair — submit server-only signed XDR.
      await expect(
        service.verifyAndIssueToken(challengeXdr),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects when the server signature has been stripped', async () => {
      const redis = makeMockRedis();
      const service = await makeSep10Service(redis);

      const { transaction: challengeXdr } = await service.generateChallenge(
        CLIENT_KEYPAIR.publicKey(),
      );

      // Load the transaction and strip all signatures, then re-sign only with client.
      const tx = TransactionBuilder.fromXDR(challengeXdr, TESTNET) as Transaction;
      (tx as any).signatures = [];   // strip server sig
      tx.sign(CLIENT_KEYPAIR);
      const tamperedXdr = tx.toEnvelope().toXDR('base64');

      await expect(
        service.verifyAndIssueToken(tamperedXdr),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a nonce that was never issued by this server', async () => {
      const service = await makeSep10Service();

      // Build a challenge manually without going through generateChallenge
      // so nothing is stored in Redis.
      const tx = buildChallenge();
      tx.sign(CLIENT_KEYPAIR);
      const xdr = tx.toEnvelope().toXDR('base64');

      await expect(service.verifyAndIssueToken(xdr)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a challenge whose timebounds span more than 5 minutes', async () => {
      const redis = makeMockRedis();
      const service = await makeSep10Service(redis);

      const tx = buildChallenge(SERVER_KEYPAIR, CLIENT_KEYPAIR.publicKey(), 'localhost',
        Buffer.from('nonce-value-32bytes-padding-xxxxx'), { maxDuration: 600 }); // 10 min

      tx.sign(CLIENT_KEYPAIR);
      const xdr = tx.toEnvelope().toXDR('base64');

      await expect(service.verifyAndIssueToken(xdr)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  // =========================================================================
  // getServerPublicKey
  // =========================================================================
  describe('getServerPublicKey', () => {
    it('returns the server public key matching the configured secret', async () => {
      const service = await makeSep10Service();
      expect(service.getServerPublicKey()).toBe(SERVER_KEYPAIR.publicKey());
    });
  });
});
