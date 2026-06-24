import axios from 'axios';
import { env } from './env';

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

export default api;
