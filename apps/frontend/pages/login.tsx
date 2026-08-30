import { useState } from 'react';
import { useRouter } from 'next/router';
import api, { storeSessionTokens } from '../lib/api';
import Sep10LoginButton from '../components/Sep10LoginButton';
import { useWalletStore } from '../store/walletStore';

// ---------------------------------------------------------------------------
// Email / password validation
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Login page
// ---------------------------------------------------------------------------

export default function Login() {
  const router = useRouter();
  const { setPublicKey } = useWalletStore();

  const emailErrorId    = 'auth-email-error';
  const passwordErrorId = 'auth-password-error';
  const authErrorId     = 'auth-error';

  // Email / password form state
  const [email, setEmail]             = useState('');
  const [password, setPassword]       = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [authError, setAuthError]     = useState('');
  const [isRegister, setIsRegister]   = useState(false);

  // SEP-10 tab state — 'wallet' shows the Freighter button, 'password' the classic form
  const [authTab, setAuthTab] = useState<'wallet' | 'password'>('wallet');

  // ---------------------------------------------------------------------------
  // Email / password handlers
  // ---------------------------------------------------------------------------

  const validateField = (
    field: 'email' | 'password',
    currentEmail  = email,
    currentPassword = password,
  ) => {
    const nextErrors = validateLoginForm(currentEmail, currentPassword);
    setFieldErrors((prev) => ({ ...prev, [field]: nextErrors[field] }));
    if (field === 'email') setAuthError('');
  };

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const nextErrors = validateLoginForm(email, password);
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) { setAuthError(''); return; }

    try {
      const endpoint = isRegister ? '/auth/register' : '/auth/login';
      const { data } = await api.post(endpoint, { email, password });
      storeSessionTokens(data);
      router.push('/');
    } catch {
      setAuthError('Invalid email or password.');
    }
  };

  // ---------------------------------------------------------------------------
  // SEP-10 / Freighter handler
  // ---------------------------------------------------------------------------

  const handleWalletSuccess = (stellarAccount: string, _token: string) => {
    // publicKey is already persisted to localStorage by sep10Login(); update store.
    setPublicKey(stellarAccount);
    router.push('/');
  };

  // ---------------------------------------------------------------------------
  // aria describedby helpers
  // ---------------------------------------------------------------------------

  const emailDescribedBy = [
    authError          ? authErrorId     : '',
    fieldErrors.email  ? emailErrorId    : '',
  ].filter(Boolean).join(' ') || undefined;

  const passwordDescribedBy = [
    authError            ? authErrorId      : '',
    fieldErrors.password ? passwordErrorId  : '',
  ].filter(Boolean).join(' ') || undefined;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="min-h-screen bg-gray-950 text-white flex items-center justify-center p-4"
    >
      <div className="w-full max-w-sm space-y-5">
        {/* Header */}
        <div className="text-center space-y-1">
          <h1 className="text-3xl font-bold tracking-tight">RemitX</h1>
          <p className="text-gray-400 text-sm">
            {authTab === 'wallet' ? 'Sign in with your Stellar wallet' : isRegister ? 'Create account' : 'Sign in'}
          </p>
        </div>

        {/* Tab switcher */}
        <div
          role="tablist"
          aria-label="Authentication method"
          className="grid grid-cols-2 gap-1 bg-gray-900 border border-gray-800 rounded-xl p-1"
        >
          <button
            role="tab"
            aria-selected={authTab === 'wallet'}
            aria-controls="wallet-panel"
            id="wallet-tab"
            type="button"
            onClick={() => setAuthTab('wallet')}
            className={[
              'py-2 px-3 rounded-lg text-sm font-medium transition-all focus:outline-none focus:ring-2 focus:ring-indigo-500',
              authTab === 'wallet'
                ? 'bg-indigo-600 text-white shadow'
                : 'text-gray-400 hover:text-white',
            ].join(' ')}
          >
            🔑 Wallet
          </button>
          <button
            role="tab"
            aria-selected={authTab === 'password'}
            aria-controls="password-panel"
            id="password-tab"
            type="button"
            onClick={() => { setAuthTab('password'); setAuthError(''); }}
            className={[
              'py-2 px-3 rounded-lg text-sm font-medium transition-all focus:outline-none focus:ring-2 focus:ring-indigo-500',
              authTab === 'password'
                ? 'bg-indigo-600 text-white shadow'
                : 'text-gray-400 hover:text-white',
            ].join(' ')}
          >
            ✉️ Email
          </button>
        </div>

        {/* ----------------------------------------------------------------- */}
        {/* Tab: Wallet (SEP-10)                                               */}
        {/* ----------------------------------------------------------------- */}
        {authTab === 'wallet' && (
          <section
            id="wallet-panel"
            role="tabpanel"
            aria-labelledby="wallet-tab"
            className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-4"
          >
            <div className="text-center space-y-1">
              <div
                aria-hidden="true"
                className="mx-auto w-12 h-12 rounded-full bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-2xl"
              >
                ✦
              </div>
              <p className="text-sm text-gray-300 font-medium">
                Stellar SEP-10 Authentication
              </p>
              <p className="text-xs text-gray-500 leading-relaxed">
                Prove ownership of your Stellar account by signing a challenge
                with your Freighter wallet. No password required.
              </p>
            </div>

            <Sep10LoginButton
              onSuccess={handleWalletSuccess}
              onError={() => {/* error is shown inside Sep10LoginButton */}}
            />

            {/* SEP-10 flow explanation */}
            <ol className="text-xs text-gray-500 space-y-1 list-decimal list-inside border-t border-gray-800 pt-3">
              <li>Click the button above to connect Freighter</li>
              <li>A challenge transaction is generated by the server</li>
              <li>Freighter asks you to sign the transaction</li>
              <li>Your signature is verified — no private key ever leaves your wallet</li>
            </ol>
          </section>
        )}

        {/* ----------------------------------------------------------------- */}
        {/* Tab: Email / password                                              */}
        {/* ----------------------------------------------------------------- */}
        {authTab === 'password' && (
          <section
            id="password-panel"
            role="tabpanel"
            aria-labelledby="password-tab"
          >
            <form
              id="auth-form"
              onSubmit={submitPassword}
              className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-4"
              noValidate
            >
              {/* Auth-level error */}
              <div aria-live="polite" aria-atomic="true">
                {authError && (
                  <p
                    id={authErrorId}
                    className="text-red-400 text-sm"
                    role="alert"
                    aria-live="assertive"
                  >
                    {authError}
                  </p>
                )}
              </div>

              {/* Email */}
              <div>
                <label
                  htmlFor="auth-email"
                  className="block text-sm font-medium text-gray-300 mb-1"
                >
                  Email
                </label>
                <input
                  id="auth-email"
                  name="email"
                  className="w-full bg-gray-800 border border-gray-700/50 rounded-lg p-3 text-sm outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setFieldErrors((prev) => ({ ...prev, email: undefined }));
                  }}
                  onBlur={() => validateField('email')}
                  autoComplete="email"
                  aria-describedby={emailDescribedBy}
                  aria-invalid={Boolean(fieldErrors.email)}
                  required
                />
                {fieldErrors.email && (
                  <p
                    id={emailErrorId}
                    role="alert"
                    aria-live="assertive"
                    className="mt-1 text-xs text-red-400"
                  >
                    {fieldErrors.email}
                  </p>
                )}
              </div>

              {/* Password */}
              <div>
                <label
                  htmlFor="auth-password"
                  className="block text-sm font-medium text-gray-300 mb-1"
                >
                  Password{' '}
                  <span className="text-gray-500 font-normal">(min 8 characters)</span>
                </label>
                <input
                  id="auth-password"
                  name="password"
                  className="w-full bg-gray-800 border border-gray-700/50 rounded-lg p-3 text-sm outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                  type="password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setFieldErrors((prev) => ({ ...prev, password: undefined }));
                  }}
                  onBlur={() => validateField('password')}
                  autoComplete={isRegister ? 'new-password' : 'current-password'}
                  aria-describedby={passwordDescribedBy}
                  aria-invalid={Boolean(fieldErrors.password)}
                  required
                  minLength={8}
                />
                {fieldErrors.password && (
                  <p
                    id={passwordErrorId}
                    role="alert"
                    aria-live="assertive"
                    className="mt-1 text-xs text-red-400"
                  >
                    {fieldErrors.password}
                  </p>
                )}
              </div>

              {/* Submit */}
              <button
                type="submit"
                className="w-full bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 active:scale-[0.99] transition-all rounded-lg p-3 font-semibold text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
              >
                {isRegister ? 'Register' : 'Login'}
              </button>

              {/* Toggle register/login */}
              <button
                type="button"
                className="w-full text-center text-xs text-gray-400 hover:text-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded transition-colors"
                onClick={() => setIsRegister(!isRegister)}
                aria-label={
                  isRegister
                    ? 'Switch to login form'
                    : 'Switch to registration form'
                }
              >
                {isRegister
                  ? 'Already have an account? Login'
                  : "Don't have an account? Register"}
              </button>
            </form>
          </section>
        )}
      </div>
    </main>
  );
}
