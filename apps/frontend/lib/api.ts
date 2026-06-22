import axios from 'axios';
import { env } from './env';

const api = axios.create({ baseURL: env.NEXT_PUBLIC_API_URL });

api.interceptors.request.use((config) => {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export default api;
