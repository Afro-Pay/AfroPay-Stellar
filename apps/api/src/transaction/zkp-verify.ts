/**
 * Zero-knowledge compliance proof verification (issue #271).
 *
 * Pure, dependency-free TypeScript mirror of the Python reference verifier in
 * `services/python-analytics/app/zkp_compliance.py`.  It re-implements the
 * Pedersen commitment + CDS 1-of-2 OR-proof range check using Node's BigInt so
 * the NestJS auditor interface can verify a proof independently of the Python
 * prover service (no network hop, no secret material).
 *
 * The wire format is the JSON produced by `ComplianceProof.to_dict()`.
 */
import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Group parameters — RFC 3526 "group 14" (2048-bit MODP, safe prime).
// ---------------------------------------------------------------------------
const P = BigInt(
  '0xFFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD1' +
    '29024E088A67CC74020BBEA63B139B22514A08798E3404DD' +
    'EF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245' +
    'E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED' +
    'EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC' +
    '2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F83' +
    '655D23DCA3AD961C62F356208552BB9ED529077096966D670' +
    'C354E4ABC9804F1746C08CA18217C32905E462E36CE3BE39E' +
    '772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9DE2BC' +
    'BF6955817183995497CEA956AE515D2261898FA051015728E5' +
    'A8AACAA68FFFFFFFFFFFFFFFF',
);
const Q = (P - 1n) / 2n;
const G = 4n;
const H_EXP = BigInt(
  '0x' +
    createHash('sha256')
      .update('AfroPay-ZKP-Pedersen-H-nothing-up-my-sleeve-v1')
      .digest('hex'),
);
const H = modPow(G, H_EXP, P);

export interface BitProofDto {
  t0: string;
  t1: string;
  c0: string;
  c1: string;
  s0: string;
  s1: string;
}

export interface RangeProofDto {
  bit_commitments: string[];
  bit_proofs: BitProofDto[];
}

export interface ComplianceProofDto {
  commitment: string;
  max_limit: string;
  k: number;
  amount_range: RangeProofDto;
  upper_range: RangeProofDto;
}

/** Modular exponentiation via square-and-multiply (BigInt has no modPow). */
export function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  if (mod === 1n) return 0n;
  let result = 1n;
  base %= mod;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * base) % mod;
    base = (base * base) % mod;
    e >>= 1n;
  }
  return result;
}

/** Modular inverse via the extended Euclidean algorithm. */
export function modInverse(a: bigint, mod: bigint): bigint {
  a = ((a % mod) + mod) % mod;
  let oldR = a;
  let r = mod;
  let oldS = 1n;
  let s = 0n;
  while (r !== 0n) {
    const q = oldR / r;
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
  }
  return ((oldS % mod) + mod) % mod;
}

/** Minimal big-endian byte encoding (matches Python `int.to_bytes(..., "big")`). */
function intBytes(value: bigint): Buffer {
  if (value === 0n) return Buffer.from([0]);
  let hex = value.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  return Buffer.from(hex, 'hex');
}

/** Fiat–Shamir: SHA-256 of a domain-separated transcript, reduced mod q. */
function hashToScalar(parts: Buffer[]): bigint {
  const h = createHash('sha256');
  h.update(Buffer.from('AfroPay-ZKP-Compliance-v1', 'utf8'));
  for (const part of parts) {
    const len = Buffer.alloc(8);
    len.writeBigUInt64BE(BigInt(part.length));
    h.update(len);
    h.update(part);
  }
  return BigInt('0x' + h.digest('hex')) % Q;
}

function parseHex(value: string): bigint {
  return BigInt(value.startsWith('0x') ? value : '0x' + value);
}

function verifyBit(commitmentB: bigint, bp: BitProofDto, ctx: Buffer): boolean {
  const c = hashToScalar([
    ctx,
    intBytes(commitmentB),
    intBytes(parseHex(bp.t0)),
    intBytes(parseHex(bp.t1)),
  ]);
  if ((parseHex(bp.c0) + parseHex(bp.c1)) % Q !== c) return false;
  // Statement 0: commitmentB == H^s0 (bit 0).
  const lhs0 = modPow(H, parseHex(bp.s0), P);
  const rhs0 = (parseHex(bp.t0) * modPow(commitmentB, parseHex(bp.c0), P)) % P;
  if (lhs0 !== rhs0) return false;
  // Statement 1: commitmentB / G == H^s1 (bit 1).
  const x1 = (commitmentB * modInverse(G, P)) % P;
  const lhs1 = modPow(H, parseHex(bp.s1), P);
  const rhs1 = (parseHex(bp.t1) * modPow(x1, parseHex(bp.c1), P)) % P;
  if (lhs1 !== rhs1) return false;
  return true;
}

function verifyLtPow2(
  commitmentC: bigint,
  rp: RangeProofDto,
  k: number,
  baseCtx: string,
): boolean {
  if (rp.bit_commitments.length !== k || rp.bit_proofs.length !== k) return false;
  let reconstructed = 1n;
  for (let i = 0; i < k; i++) {
    const ctx = Buffer.concat([Buffer.from(baseCtx, 'utf8'), intBytes(BigInt(i))]);
    const cI = parseHex(rp.bit_commitments[i]);
    if (!verifyBit(cI, rp.bit_proofs[i], ctx)) return false;
    reconstructed = (reconstructed * modPow(cI, 1n << BigInt(i), P)) % P;
  }
  return reconstructed === commitmentC % P;
}

/**
 * Verify a compliance proof against a public commitment and limit.
 * Returns true iff the proof is valid (amount in [0, max_limit]) for the
 * given commitment without ever seeing the amount itself.
 */
export function verifyCompliance(
  commitmentHex: string,
  maxLimit: bigint,
  proof: ComplianceProofDto,
): boolean {
  if (BigInt(proof.max_limit) !== maxLimit) return false;
  if (proof.k !== maxLimit.toString(2).length) return false;

  const C = parseHex(commitmentHex);
  if (parseHex(proof.commitment) !== C) return false;

  // amount < 2^k
  if (!verifyLtPow2(C, proof.amount_range, proof.k, 'amount')) return false;

  // amount <= max_limit : C_u = C * G^(2^k - 1 - max_limit), prove C_u < 2^k.
  const cU = (C * modPow(G, (1n << BigInt(proof.k)) - 1n - maxLimit, P)) % P;
  if (!verifyLtPow2(cU, proof.upper_range, proof.k, 'upper')) return false;

  return true;
}

/** AML compliance thresholds (minor units), mirroring the Python service. */
export const COMPLIANCE_LIMITS = {
  individualTransferLimitMinorUnits: 200_000, // $2,000.00
  dailyVolumeLimitMinorUnits: 1_000_000, // $10,000.00
} as const;
