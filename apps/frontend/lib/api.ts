import axios from 'axios';
import { env } from './env';

export interface SimulationRequest {
  destinationPublicKey: string;
  amount: string;
  assetCode: string;
  assetIssuer?: string;
}

export interface SimulationResult {
  status: 'ok' | 'blocked';
  path: string[];
  sourceAmount: string;
  estimatedDestinationAmount: string | null;
  minimumDestinationAmount: string | null;
  effectiveRate: number | null;
  rateExpiresAt: string | null;
  issues: Array<{ code: string; message: string }>;
}

const baseURL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const api = axios.create({ baseURL });
const authApi = axios.create({ baseURL });

interface TokenPair {
  access_token?: string;
  refresh_token?: string;
}

export function storeSessionTokens(tokens: TokenPair): void {
  if (typeof window === 'undefined') return;
  if (tokens.access_token) localStorage.setItem('token', tokens.access_token);
  if (tokens.refresh_token) localStorage.setItem('refresh_token', tokens.refresh_token);
}

function clearSessionTokens(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('token');
  localStorage.removeItem('refresh_token');
}

api.interceptors.request.use((config) => {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    const code = error.response?.data?.code;
    const refreshToken =
      typeof window !== 'undefined' ? localStorage.getItem('refresh_token') : null;

    if (
      error.response?.status === 401 &&
      code === 'AUTH_TOKEN_EXPIRED' &&
      refreshToken &&
      !originalRequest?._retry
    ) {
      originalRequest._retry = true;
      try {
        const { data } = await authApi.post('/auth/refresh', {
          refresh_token: refreshToken,
        });
        storeSessionTokens(data);
        originalRequest.headers = originalRequest.headers ?? {};
        originalRequest.headers.Authorization = `Bearer ${data.access_token}`;
        return api(originalRequest);
      } catch {
        clearSessionTokens();
      }
    }

    return Promise.reject(error);
  },
);

// ---------------------------------------------------------------------------
// Anchor (SEP-6) helpers
// ---------------------------------------------------------------------------

/** SEP-6 deposit response from GET /anchor/deposit */
export interface DepositInfo {
  how?: string;
  id?: string;
  eta?: number;
  min_amount?: number;
  max_amount?: number;
  fee_fixed?: number;
  fee_percent?: number;
  extra_info?: Record<string, unknown>;
  instructions?: Record<string, unknown>;
  stellar_account?: string;
  account?: string;
  account_id?: string;
  /** Present on non_interactive_customer_info_needed variant */
  type?: string;
  fields?: Record<string, unknown>;
}

/** SEP-6 withdraw response from GET /anchor/withdraw */
export interface WithdrawInfo {
  id?: string;
  eta?: number;
  min_amount?: number;
  max_amount?: number;
  fee_fixed?: number;
  fee_percent?: number;
  extra_info?: Record<string, unknown>;
  account_id?: string;
  memo?: string;
  memo_type?: string;
  /** Present on non_interactive_customer_info_needed variant */
  type?: string;
  fields?: Record<string, unknown>;
}

/**
 * GET /anchor/deposit?assetCode=USDC&account=G...
 * JWT is attached automatically by the axios interceptor.
 */
export async function getDepositInfo(
  assetCode: string,
  account: string,
): Promise<DepositInfo> {
  const { data } = await api.get<DepositInfo>('/anchor/deposit', {
    params: { assetCode, account },
  });
  return data;
}

/**
 * GET /anchor/withdraw?assetCode=USDC&account=G...&amount=100
 * JWT is attached automatically by the axios interceptor.
 */
export async function getWithdrawInfo(
  assetCode: string,
  account: string,
  amount: string,
): Promise<WithdrawInfo> {
  const { data } = await api.get<WithdrawInfo>('/anchor/withdraw', {
    params: { assetCode, account, amount },
  });
  return data;
}

export default api;
