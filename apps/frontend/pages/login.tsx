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
        <div id={authErrorId} role="alert" aria-live="assertive" className="min-h-5 text-sm text-red-400">
          {authError}
        </div>
        <div className="space-y-2">
          <label htmlFor={emailId} className="block text-sm font-medium text-gray-200">
            Email
          </label>
          <input
            id={emailId}
            className="w-full bg-gray-800 rounded-lg p-3 outline-none ring-1 ring-transparent transition focus:ring-indigo-500"
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setAuthError('');
            }}
            onBlur={() => validateField('email')}
            aria-invalid={Boolean(fieldErrors.email)}
            aria-describedby={fieldErrors.email ? emailErrorId : undefined}
            autoComplete="email"
          />
          <p id={emailErrorId} className="min-h-5 text-sm text-red-400">
            {fieldErrors.email}
          </p>
        </div>
        <div className="space-y-2">
          <label htmlFor={passwordId} className="block text-sm font-medium text-gray-200">
            Password
          </label>
          <input
            id={passwordId}
            className="w-full bg-gray-800 rounded-lg p-3 outline-none ring-1 ring-transparent transition focus:ring-indigo-500"
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setAuthError('');
            }}
            onBlur={() => validateField('password')}
            aria-invalid={Boolean(fieldErrors.password)}
            aria-describedby={fieldErrors.password ? passwordErrorId : undefined}
            autoComplete={isRegister ? 'new-password' : 'current-password'}
          />
          <p id={passwordErrorId} className="min-h-5 text-sm text-red-400">
            {fieldErrors.password}
          </p>
        </div>
        <button className="w-full bg-indigo-600 hover:bg-indigo-700 rounded-lg p-3 font-semibold">
          {isRegister ? 'Register' : 'Login'}
        </button>
        <p
          className="text-center text-sm text-gray-400 cursor-pointer"
          onClick={() => {
            setIsRegister(!isRegister);
            setFieldErrors({});
            setAuthError('');
          }}
        >
          {isRegister ? 'Already have an account? Login' : "Don't have an account? Register"}
        </p>
      </form>
    </main>
  );
}
