import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';

export interface FraudScoreRequest {
  tx_id: string;
  user_id: string;
  /** Numeric amount — the Python service expects a float. */
  amount: number;
  asset_code: string;
  destination: string;
  source_country?: string;
  destination_country?: string;
}

export interface FraudScoreResponse {
  tx_id: string;
  /** 0.0 (safe) → 1.0 (high risk) */
  risk_score: number;
  flagged: boolean;
  reasons: string[];
}

@Injectable()
export class FraudService {
  private readonly http: AxiosInstance;
  private readonly logger = new Logger(FraudService.name);

  constructor() {
    const baseURL = process.env.FRAUD_SERVICE_URL ?? 'http://localhost:8000';
    this.http = axios.create({
      baseURL,
      timeout: 5_000,
    });
  }

  /**
   * Call the Python analytics service to obtain a risk score for a transaction.
   *
   * Throws if the HTTP request fails so the caller can decide how to handle
   * a service outage (fail-open vs fail-closed). The processor catches this
   * and defaults to fail-closed (FAILED status) to avoid bypassing fraud checks.
   */
  async score(payload: FraudScoreRequest): Promise<FraudScoreResponse> {
    this.logger.log(`Requesting fraud score for transaction ${payload.tx_id}`);
    const { data } = await this.http.post<FraudScoreResponse>('/fraud/score', payload);
    this.logger.log(
      `Fraud score for ${payload.tx_id}: riskScore=${data.risk_score} flagged=${data.flagged}`,
    );
    return data;
  }
}
