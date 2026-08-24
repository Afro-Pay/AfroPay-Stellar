import { Injectable, BadRequestException } from '@nestjs/common';
import {
  ComplianceProofDto,
  verifyCompliance,
  COMPLIANCE_LIMITS,
} from './zkp-verify';

/**
 * Read-only auditor interface for privacy-preserving compliance (issue #271).
 *
 * Auditors query the configured AML thresholds and submit a serialized ZK proof
 * for verification.  Verification is side-effect free and reveals nothing about
 * the underlying transaction amount or parties — the proof transcript contains
 * only a Pedersen commitment, the public limit, and the range-proof data.
 */
@Injectable()
export class ComplianceService {
  /**
   * Verify a zero-knowledge compliance proof against a public commitment.
   * Throws 400 on malformed input; returns `{ valid: boolean }` otherwise.
   */
  verifyComplianceProof(
    commitment: string,
    maxLimit: number,
    proof: ComplianceProofDto,
  ): { valid: boolean; commitment: string; maxLimit: number } {
    if (!commitment || !Number.isInteger(maxLimit) || maxLimit <= 0) {
      throw new BadRequestException('commitment and a positive integer max_limit are required');
    }
    let valid: boolean;
    try {
      valid = verifyCompliance(commitment, BigInt(maxLimit), proof);
    } catch {
      throw new BadRequestException('malformed compliance proof');
    }
    return { valid, commitment, maxLimit };
  }

  /**
   * Return the configured AML compliance thresholds (read-only).  Amounts are
   * expressed in minor units (e.g. USD cents).
   */
  getComplianceLimits() {
    return { ...COMPLIANCE_LIMITS };
  }
}
