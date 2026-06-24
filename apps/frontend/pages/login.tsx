import { useId, useState } from 'react';
import { useRouter } from 'next/router';
import api, { storeSessionTokens } from '../lib/api';

type FieldErrors = {
  email?: string;
  password?: string;
};

function validateLoginForm(email: string, password: string): FieldErrors {
  const nextErrors: FieldErrors = {};
  const trimmedEmail = email.trim();

  if (!trimmedEmail) {
    nextErrors.email = 'Email is required.';
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
    nextErrors.email = 'Enter a valid email address.';
  }

  if (!password) {
    nextErrors.password = 'Password is required.';
  }

  return nextErrors;
}

export default function Login() {
  const router = useRouter();
  const emailId = useId();
  const passwordId = useId();
  const emailErrorId = useId();
  const passwordErrorId = useId();
  const authErrorId = useId();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [authError, setAuthError] = useState('');
  const [isRegister, setIsRegister] = useState(false);

  const validateField = (field: 'email' | 'password', currentEmail = email, currentPassword = password) => {
    const nextErrors = validateLoginForm(currentEmail, currentPassword);
    setFieldErrors((previous) => ({ ...previous, [field]: nextErrors[field] }));
    if (field === 'email') {
      setAuthError('');
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const nextErrors = validateLoginForm(email, password);
    setFieldErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      setAuthError('');
      return;
    }

    try {
      const endpoint = isRegister ? '/auth/register' : '/auth/login';
      const { data } = await api.post(endpoint, { email, password });
      storeSessionTokens(data);
      router.push('/');
    } catch {
      setAuthError('Invalid email or password.');
    }
  };

  return (
    <main className="min-h-screen bg-gray-950 text-white flex items-center justify-center p-4">
      <form onSubmit={submit} className="bg-gray-900 p-8 rounded-xl w-full max-w-sm space-y-4">
        <h1 className="text-2xl font-bold text-center">RemitX</h1>
        <p className="text-center text-gray-400">{isRegister ? 'Create account' : 'Sign in'}</p>
        {error && (
          <p id="auth-error" className="text-red-400 text-sm" role="alert">
            {error}
          </p>
        )}
        <div>
          <label htmlFor="auth-email" className="block text-sm font-medium text-gray-300 mb-1">
            Email
          </label>
          <input
            id="auth-email"
            name="email"
            className="w-full bg-gray-800 rounded-lg p-3 outline-none focus:ring-2 focus:ring-indigo-500"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            aria-describedby={error ? 'auth-error' : undefined}
            required
          />
        </div>
        <div>
          <label htmlFor="auth-password" className="block text-sm font-medium text-gray-300 mb-1">
            Password <span className="text-gray-500">(minimum 8 characters)</span>
          </label>
          <input
            id="auth-password"
            name="password"
            className="w-full bg-gray-800 rounded-lg p-3 outline-none focus:ring-2 focus:ring-indigo-500"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={isRegister ? 'new-password' : 'current-password'}
            aria-describedby={error ? 'auth-error' : undefined}
            required
            minLength={8}
          />
        </div>
        <button className="w-full bg-indigo-600 hover:bg-indigo-700 rounded-lg p-3 font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-300">
          {isRegister ? 'Register' : 'Login'}
        </button>
        <button
          type="button"
          className="w-full text-center text-sm text-gray-400 hover:text-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded"
          onClick={() => setIsRegister(!isRegister)}
        >
          {isRegister ? 'Already have an account? Login' : "Don't have an account? Register"}
        </button>
      </form>
    </main>
  );
}
