import { useState } from 'react';
import { useRouter } from 'next/router';
import api, { storeSessionTokens } from '../lib/api';

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isRegister, setIsRegister] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const endpoint = isRegister ? '/auth/register' : '/auth/login';
      const { data } = await api.post(endpoint, { email, password });
      storeSessionTokens(data);
      router.push('/');
    } catch {
      setError('Authentication failed. Check your credentials.');
    }
  };

  return (
    <main className="min-h-screen bg-gray-950 text-white flex items-center justify-center p-4">
      <form onSubmit={submit} className="bg-gray-900 p-8 rounded-xl w-full max-w-sm space-y-4">
        <h1 className="text-2xl font-bold text-center">RemitX</h1>
        <p className="text-center text-gray-400">{isRegister ? 'Create account' : 'Sign in'}</p>
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <input
          className="w-full bg-gray-800 rounded-lg p-3 outline-none"
          type="email" placeholder="Email" value={email}
          onChange={(e) => setEmail(e.target.value)} required
        />
        <input
          className="w-full bg-gray-800 rounded-lg p-3 outline-none"
          type="password" placeholder="Password (min 8 chars)" value={password}
          onChange={(e) => setPassword(e.target.value)} required minLength={8}
        />
        <button className="w-full bg-indigo-600 hover:bg-indigo-700 rounded-lg p-3 font-semibold">
          {isRegister ? 'Register' : 'Login'}
        </button>
        <p
          className="text-center text-sm text-gray-400 cursor-pointer"
          onClick={() => setIsRegister(!isRegister)}
        >
          {isRegister ? 'Already have an account? Login' : "Don't have an account? Register"}
        </p>
      </form>
    </main>
  );
}
