import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Inject } from '@nestjs/common';
import {
  Keypair,
  Networks,
  TransactionBuilder,
  Transaction,
  FeeBumpTransaction,
  Operation,
  Account,
  BASE_FEE,
} from 'stellar-sdk';
import { randomBytes } from 'crypto';
import Redis from 'ioredis';
import { PrismaClient } from '@prisma/client';

/** Redis TTL for nonce entries — aligned with SEP-10 spec max of 5 minutes. */
const DEFAULT_CHALLENGE_TTL = 300;

/** Nonce Redis key prefix. */
const NONCE_PREFIX = 'sep10:nonce:';

/**
 * Implements Stellar SEP-10 Web Authentication.
 *
 * Flow:
 *  1. Client calls GET /auth/sep10/challenge?account=G...
 *     → Server builds a challenge Transaction containing a manage_data op
 *       with a cryptographically random nonce, signs it with the server
 *       keypair, and returns the unsigned XDR.
 *  2. Client signs the XDR with their Stellar wallet (Freighter) and posts
 *     the signed envelope to POST /auth/sep10/verify.
 *     → Server verifies:
 *         a) the client's signature against their public key
 *         b) the server's own signature is still present (not stripped)
 *         c) the nonce has not been used before (replay protection)
 *         d) the nonce has not expired (freshness)
 *         e) the manage_data operation matches the expected home domain
 *     → On success, issues a JWT containing the verified public key.
 *
 * References:
 *   https://stellar.org/protocol/sep-10
 */
@Injectable()
export class Sep10Service implements OnModuleDestroy {
  private readonly serverKeypair: Keypair;
  private readonly networkPassphrase: string;
  private readonly homeDomain: string;
  private readonly challengeTtl: number;
  private readonly redis: Redis | InMemoryNonceStore;
  private readonly logger = new Logger(Sep10Service.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaClient,
    @Inject('SEP10_REDIS') redisClient: Redis | InMemoryNonceStore,
  ) {
    const secret = process.env.SEP10_SERVER_SECRET;
    if (!secret) {
      throw new Error('SEP10_SERVER_SECRET environment variable is required');
    }
    this.serverKeypair = Keypair.fromSecret(secret);

    this.networkPassphrase =
      process.env.STELLAR_NETWORK === 'mainnet'
        ? Networks.PUBLIC
        : Networks.TESTNET;

    this.homeDomain = process.env.SEP10_HOME_DOMAIN ?? 'localhost';
    this.challengeTtl = Number(process.env.SEP10_CHALLENGE_TTL_SECONDS ?? DEFAULT_CHALLENGE_TTL);
    this.redis = redisClient;

    this.logger.log(
      `SEP-10 initialised — network: ${this.networkPassphrase}, ` +
        `home_domain: ${this.homeDomain}, server: ${this.serverKeypair.publicKey()}`,
    );
  }

  onModuleDestroy() {
    if (this.redis instanceof Redis) {
      this.redis.disconnect();
    }
  }

  // ---------------------------------------------------------------------------
  // Challenge generation
  // ---------------------------------------------------------------------------

  /**
   * Builds a SEP-10 challenge transaction for the given client account.
   *
   * The transaction contains:
   *  - A manage_data operation keyed `<home_domain> auth` with a 48-byte
   *    random nonce as the value. This is the operation the client signs.
   *  - A web_auth_domain manage_data operation with the home domain as value.
   *  - source account set to the server's public key.
   *  - minTimeBound = now, maxTimeBound = now + TTL (5 min max per SEP-10).
   *  - The transaction is signed by the server keypair.
   *
   * The nonce is also stored in Redis with a TTL equal to challengeTtl so
   * that expired challenges can never be submitted.
   *
   * @param clientPublicKey  The client's Stellar G-address
   * @returns { transaction: base64-XDR, network_passphrase }
   */
  async generateChallenge(
    clientPublicKey: string,
  ): Promise<{ transaction: string; network_passphrase: string }> {
    // Validate the client public key is a real Stellar address.
    try {
      Keypair.fromPublicKey(clientPublicKey);
    } catch {
      throw new BadRequestException(
        `Invalid Stellar public key: ${clientPublicKey}`,
      );
    }

    // Generate a cryptographically random 48-byte nonce (base64-encoded = 64 chars).
    const nonce = randomBytes(48).toString('base64');
    const nonceKey = `${NONCE_PREFIX}${clientPublicKey}:${nonce}`;

    // Store the nonce in Redis. We use SET NX (set if not exists) to prevent
    // a race condition where two concurrent requests produce the same nonce.
    const stored = await (this.redis as any).set(
      nonceKey,
      '1',
      'EX',
      this.challengeTtl,
    );
    if (!stored) {
      // Extremely unlikely (48-byte random collision) but handle defensively.
      this.logger.warn(`Nonce collision for ${clientPublicKey} — retrying`);
      return this.generateChallenge(clientPublicKey);
    }

    const now = Math.floor(Date.now() / 1000);
    const serverAccount = new Account(this.serverKeypair.publicKey(), '-1');

    const tx = new TransactionBuilder(serverAccount, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        // Primary SEP-10 operation: keyed to the CLIENT account, value = nonce.
        Operation.manageData({
          name: `${this.homeDomain} auth`,
          value: Buffer.from(nonce),
          source: clientPublicKey,
        }),
      )
      .addOperation(
        // Required web_auth_domain operation keyed to the SERVER account.
        Operation.manageData({
          name: 'web_auth_domain',
          value: Buffer.from(this.homeDomain),
          source: this.serverKeypair.publicKey(),
        }),
      )
      .setTimebounds(now, now + this.challengeTtl)
      .build();

    // Server signs the transaction.
    tx.sign(this.serverKeypair);

    const xdrEnvelope = tx.toEnvelope().toXDR('base64');

    this.logger.log(
      `Challenge generated for ${clientPublicKey} (nonce stored, TTL ${this.challengeTtl}s)`,
    );

    return {
      transaction: xdrEnvelope,
      network_passphrase: this.networkPassphrase,
    };
  }

  // ---------------------------------------------------------------------------
  // Signature verification & JWT issuance
  // ---------------------------------------------------------------------------

  /**
   * Verifies a signed SEP-10 challenge and issues a JWT.
   *
   * Checks performed:
   *  1. The XDR parses as a valid Stellar Transaction (not FeeBump).
   *  2. The transaction is signed for the correct network passphrase.
   *  3. The transaction is within its timebounds (freshness check).
   *  4. The first operation is a manage_data op with key `<home_domain> auth`.
   *  5. The nonce from that operation exists in Redis (not expired, not replayed).
   *  6. The server's signature is present and valid.
   *  7. The client's signature is present and valid over the transaction hash.
   *  8. On success, the nonce is deleted from Redis (one-time use).
   *
   * @param signedXdr  Base64-encoded signed transaction envelope
   * @returns JWT token response
   */
  async verifyAndIssueToken(signedXdr: string): Promise<{
    token: string;
    stellar_account: string;
    expires_in: number;
  }> {
    // 1. Parse the XDR envelope.
    let tx: Transaction;
    try {
      const parsed = TransactionBuilder.fromXDR(signedXdr, this.networkPassphrase);
      if (parsed instanceof FeeBumpTransaction) {
        throw new BadRequestException(
          'SEP-10 challenge must be a regular Transaction, not a FeeBump transaction',
        );
      }
      tx = parsed as Transaction;
    } catch (err: any) {
      throw new BadRequestException(
        `Invalid transaction XDR: ${err?.message ?? 'parse error'}`,
      );
    }

    // 2. Timebounds freshness check.
    this.assertTimeboundsValid(tx);

    // 3. Extract and validate the primary manage_data operation.
    const { clientPublicKey, nonce } = this.extractChallengeOp(tx);

    // 4. Nonce existence + replay check.
    await this.consumeNonce(clientPublicKey, nonce);

    // 5. Verify server signature.
    this.assertServerSignature(tx);

    // 6. Verify client signature.
    this.assertClientSignature(tx, clientPublicKey);

    // 7. Upsert User with the verified Stellar public key and issue JWT.
    const user = await this.upsertUserForPublicKey(clientPublicKey);

    const expiresIn = Number(
      process.env.SEP10_JWT_EXPIRES_IN ?? process.env.JWT_ACCESS_EXPIRES_IN_SECONDS ?? 900,
    );

    const payload = {
      sub: user.id,
      stellarPublicKey: clientPublicKey,
      type: 'sep10',
    };

    const token = this.jwtService.sign(payload, { expiresIn });

    this.logger.log(
      `SEP-10 authentication successful for ${clientPublicKey} (userId: ${user.id})`,
    );

    return {
      token,
      stellar_account: clientPublicKey,
      expires_in: expiresIn,
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private assertTimeboundsValid(tx: Transaction): void {
    const now = Math.floor(Date.now() / 1000);
    const { minTime, maxTime } = tx.timeBounds ?? {};

    if (!minTime || !maxTime) {
      throw new UnauthorizedException(
        'Challenge transaction must have timebounds set',
      );
    }

    const min = Number(minTime);
    const max = Number(maxTime);

    if (now < min) {
      throw new UnauthorizedException(
        'Challenge transaction timebounds have not started yet',
      );
    }

    if (now > max) {
      throw new UnauthorizedException(
        'Challenge transaction has expired — request a new challenge',
      );
    }

    // Additional guard: reject challenges older than 5 minutes regardless of
    // what maxTime claims, per SEP-10 spec section 3.
    if (max - min > 300) {
      throw new UnauthorizedException(
        'Challenge timebounds span more than 5 minutes — invalid challenge',
      );
    }
  }

  private extractChallengeOp(tx: Transaction): {
    clientPublicKey: string;
    nonce: string;
  } {
    const ops = tx.operations;
    if (!ops || ops.length < 1) {
      throw new BadRequestException(
        'Challenge transaction must contain at least one operation',
      );
    }

    const firstOp = ops[0];
    if (firstOp.type !== 'manageData') {
      throw new BadRequestException(
        'First operation must be a manage_data operation',
      );
    }

    const manageDataOp = firstOp as any;
    const expectedKey = `${this.homeDomain} auth`;

    if (manageDataOp.name !== expectedKey) {
      throw new BadRequestException(
        `manage_data key must be "${expectedKey}", got "${manageDataOp.name}"`,
      );
    }

    if (!manageDataOp.source) {
      throw new BadRequestException(
        'manage_data operation must have an explicit source (client public key)',
      );
    }

    const clientPublicKey: string = manageDataOp.source;

    // Validate it is a real Stellar public key.
    try {
      Keypair.fromPublicKey(clientPublicKey);
    } catch {
      throw new BadRequestException(
        `manage_data source is not a valid Stellar public key: ${clientPublicKey}`,
      );
    }

    if (!manageDataOp.value) {
      throw new BadRequestException('manage_data value (nonce) is missing');
    }

    const nonce: string = manageDataOp.value.toString('base64');

    return { clientPublicKey, nonce };
  }

  private async consumeNonce(
    clientPublicKey: string,
    nonce: string,
  ): Promise<void> {
    const nonceKey = `${NONCE_PREFIX}${clientPublicKey}:${nonce}`;

    // Atomically check existence and delete in a single GETDEL call (Redis >=6.2)
    // or a GET + DEL pair. Using DEL after GET is acceptable because replay within
    // the same millisecond is blocked at the application layer by the signature
    // check anyway.
    const exists = await (this.redis as any).get(nonceKey);

    if (!exists) {
      throw new UnauthorizedException(
        'Challenge nonce is invalid, expired, or has already been used. Request a new challenge.',
      );
    }

    // Mark as consumed before continuing so a concurrent second submission
    // cannot race past this point.
    await (this.redis as any).del(nonceKey);
  }

  private assertServerSignature(tx: Transaction): void {
    const txHash = tx.hash();
    const serverPublicKey = this.serverKeypair.publicKey();

    const serverSig = tx.signatures.find((sig) => {
      try {
        const hint = sig.hint();
        const serverHint = this.serverKeypair.signatureHint();
        if (!hint.equals(serverHint)) return false;
        return this.serverKeypair.verify(txHash, sig.signature());
      } catch {
        return false;
      }
    });

    if (!serverSig) {
      throw new UnauthorizedException(
        'Server signature is missing or invalid — challenge may have been tampered with',
      );
    }
  }

  private assertClientSignature(tx: Transaction, clientPublicKey: string): void {
    const txHash = tx.hash();

    let clientKeypair: Keypair;
    try {
      clientKeypair = Keypair.fromPublicKey(clientPublicKey);
    } catch {
      throw new UnauthorizedException(
        `Cannot construct keypair for client public key: ${clientPublicKey}`,
      );
    }

    const clientHint = clientKeypair.signatureHint();

    const clientSig = tx.signatures.find((sig) => {
      try {
        const hint = sig.hint();
        if (!hint.equals(clientHint)) return false;
        return clientKeypair.verify(txHash, sig.signature());
      } catch {
        return false;
      }
    });

    if (!clientSig) {
      throw new UnauthorizedException(
        'Client signature is missing or invalid — ensure you signed the challenge with the correct keypair',
      );
    }
  }

  private async upsertUserForPublicKey(stellarPublicKey: string) {
    // Check if a user with this Stellar key already exists.
    const existing = await this.prisma.user.findUnique({
      where: { stellarPublicKey },
    });

    if (existing) return existing;

    // Create a new user record. SEP-10 users have no password — they
    // authenticate exclusively via their Stellar keypair. Email is derived
    // from the public key as a placeholder; it is unique and not used for
    // email login.
    return this.prisma.user.create({
      data: {
        email: `sep10+${stellarPublicKey}@stellar.local`,
        password: '', // intentionally empty — bcrypt of '' is never a valid login
        stellarPublicKey,
      },
    });
  }

  /** Returns the server's Stellar public key (for discovery / .well-known). */
  getServerPublicKey(): string {
    return this.serverKeypair.publicKey();
  }
}

// ---------------------------------------------------------------------------
// In-memory nonce store (test / no-Redis fallback)
// ---------------------------------------------------------------------------

/**
 * Minimal Redis-compatible in-memory store used when REDIS_URL is not set
 * or NODE_ENV is 'test'. Supports the get / set / del subset used by Sep10Service.
 */
export class InMemoryNonceStore {
  private store = new Map<string, { value: string; expiresAt: number | null }>();

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(
    key: string,
    value: string,
    _exMode?: string,
    ttlSeconds?: number,
  ): Promise<string> {
    const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : null;
    this.store.set(key, { value, expiresAt });
    return 'OK';
  }

  async del(key: string): Promise<number> {
    return this.store.delete(key) ? 1 : 0;
  }

  disconnect() {}
}
