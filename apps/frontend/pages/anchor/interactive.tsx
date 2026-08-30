import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import axios from 'axios';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SessionData {
  id: string;
  kind: 'deposit' | 'withdraw';
  stellarAccount: string;
  assetCode: string;
  assetIssuer: string | null;
  amount: string | null;
  status: string;
}

interface KycFormData {
  first_name: string;
  last_name: string;
  email: string;
  id_number: string;
}

type FormStep = 'loading' | 'kyc' | 'payment' | 'submitting' | 'success' | 'error';

const PAYMENT_METHODS = [
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'mobile_money', label: 'Mobile Money' },
  { value: 'card', label: 'Debit / Credit Card' },
];

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function InteractivePage() {
  const router = useRouter();
  const { token } = router.query;

  const [step, setStep] = useState<FormStep>('loading');
  const [session, setSession] = useState<SessionData | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  // KYC form fields
  const [kycData, setKycData] = useState<KycFormData>({
    first_name: '',
    last_name: '',
    email: '',
    id_number: '',
  });
  const [kycErrors, setKycErrors] = useState<Partial<KycFormData>>({});

  // Payment form fields
  const [paymentMethod, setPaymentMethod] = useState('bank_transfer');
  const [amount, setAmount] = useState('');

  // Confirmation result
  const [confirmResult, setConfirmResult] = useState<any>(null);

  // -------------------------------------------------------------------------
  // Fetch session data on mount
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!token || typeof token !== 'string') return;

    const fetchSession = async () => {
      try {
        const { data } = await axios.get(`${API_BASE}/sep24/interactive/session`, {
          params: { token },
        });
        setSession(data);
        if (data.amount) setAmount(data.amount);
        setStep('kyc');
      } catch (err: any) {
        const msg =
          err?.response?.data?.message ??
          'Session is invalid or has expired. Please start a new transaction from your wallet.';
        setErrorMessage(msg);
        setStep('error');
      }
    };

    fetchSession();
  }, [token]);

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  const validateKyc = useCallback((): boolean => {
    const errors: Partial<KycFormData> = {};
    if (!kycData.first_name.trim()) errors.first_name = 'First name is required';
    if (!kycData.last_name.trim()) errors.last_name = 'Last name is required';
    if (!kycData.email.trim()) {
      errors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(kycData.email.trim())) {
      errors.email = 'Enter a valid email address';
    }
    if (!kycData.id_number.trim()) errors.id_number = 'ID number is required';

    setKycErrors(errors);
    return Object.keys(errors).length === 0;
  }, [kycData]);

  // -------------------------------------------------------------------------
  // Form handlers
  // -------------------------------------------------------------------------

  const handleKycChange = (field: keyof KycFormData, value: string) => {
    setKycData((prev) => ({ ...prev, [field]: value }));
    if (kycErrors[field]) {
      setKycErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  };

  const handleKycSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validateKyc()) {
      setStep('payment');
    }
  };

  const handlePaymentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || typeof token !== 'string') return;

    setStep('submitting');

    try {
      const { data } = await axios.post(`${API_BASE}/sep24/interactive/confirm`, {
        token,
        kyc_data: kycData,
        payment_method: paymentMethod,
        amount: amount || undefined,
      });

      setConfirmResult(data);
      setStep('success');

      // Notify parent wallet via postMessage (SEP-24 callback protocol)
      if (window.parent !== window) {
        window.parent.postMessage(
          {
            type: 'sep24:interactive_complete',
            transaction: {
              id: data.id,
              status: data.status,
              kind: data.kind,
              asset_code: data.assetCode,
              memo: data.memo,
              memo_type: data.memoType,
            },
          },
          '*', // Wallet origin is unknown; SEP-24 spec uses '*'
        );
      }
    } catch (err: any) {
      const msg =
        err?.response?.data?.message ?? 'Failed to submit. Please try again.';
      setErrorMessage(msg);
      setStep('error');
    }
  };

  const handleBackToKyc = () => setStep('kyc');

  // -------------------------------------------------------------------------
  // Render helpers
  // -------------------------------------------------------------------------

  const kindLabel = session?.kind === 'deposit' ? 'Deposit' : 'Withdrawal';

  return (
    <>
      <Head>
        <title>AfroPay — Interactive {session?.kind ?? ''} | SEP-24</title>
        <meta
          name="description"
          content="Complete your identity verification and payment details to proceed with your Stellar transaction."
        />
      </Head>

      <main
        id="main-content"
        className="flex min-h-screen items-center justify-center bg-gradient-to-br from-gray-950 via-gray-900 to-indigo-950 px-4 py-12"
      >
        <div className="w-full max-w-lg">
          {/* Header / Brand */}
          <div className="mb-8 text-center">
            <h1 className="text-3xl font-bold text-white tracking-tight">
              AfroPay
            </h1>
            {session && (
              <p className="mt-1 text-sm text-indigo-300">
                {kindLabel} · {session.assetCode}
              </p>
            )}
          </div>

          {/* Card */}
          <div className="rounded-2xl border border-white/10 bg-white/5 p-8 shadow-2xl backdrop-blur-lg">
            {/* ---- Loading ---- */}
            {step === 'loading' && (
              <div className="flex flex-col items-center gap-4 py-12">
                <div
                  className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent"
                  role="status"
                  aria-label="Loading session"
                />
                <p className="text-sm text-gray-400">Loading session…</p>
              </div>
            )}

            {/* ---- Error ---- */}
            {step === 'error' && (
              <div className="flex flex-col items-center gap-4 py-8" role="alert">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-500/20">
                  <svg className="h-7 w-7 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </div>
                <p className="text-center text-sm text-gray-300">{errorMessage}</p>
              </div>
            )}

            {/* ---- KYC Step ---- */}
            {step === 'kyc' && session && (
              <form onSubmit={handleKycSubmit} noValidate>
                {/* Progress */}
                <div className="mb-6 flex items-center gap-2 text-xs text-gray-400">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-500 text-[10px] font-bold text-white">
                    1
                  </span>
                  <span className="text-white font-medium">Identity</span>
                  <span className="mx-1">→</span>
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gray-700 text-[10px] font-bold text-gray-400">
                    2
                  </span>
                  <span>Payment</span>
                </div>

                <h2 className="text-lg font-semibold text-white mb-1">
                  Identity Verification
                </h2>
                <p className="text-xs text-gray-400 mb-6">
                  We need a few details to verify your identity before processing
                  your {kindLabel.toLowerCase()}.
                </p>

                {/* Account info (read-only) */}
                <div className="mb-4 rounded-lg bg-gray-800/60 px-4 py-3">
                  <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">
                    Stellar Account
                  </p>
                  <p className="truncate text-xs font-mono text-gray-300">
                    {session.stellarAccount}
                  </p>
                </div>

                {/* First Name */}
                <div className="mb-4">
                  <label htmlFor="kyc-first-name" className="mb-1 block text-xs font-medium text-gray-300">
                    First Name
                  </label>
                  <input
                    id="kyc-first-name"
                    type="text"
                    value={kycData.first_name}
                    onChange={(e) => handleKycChange('first_name', e.target.value)}
                    className={`w-full rounded-lg border bg-gray-800/80 px-4 py-2.5 text-sm text-white placeholder-gray-500 outline-none transition focus:ring-2 focus:ring-indigo-500 ${
                      kycErrors.first_name ? 'border-red-500' : 'border-white/10'
                    }`}
                    placeholder="Enter your first name"
                    aria-invalid={!!kycErrors.first_name}
                    aria-describedby={kycErrors.first_name ? 'kyc-first-name-error' : undefined}
                  />
                  {kycErrors.first_name && (
                    <p id="kyc-first-name-error" className="mt-1 text-xs text-red-400" role="alert">
                      {kycErrors.first_name}
                    </p>
                  )}
                </div>

                {/* Last Name */}
                <div className="mb-4">
                  <label htmlFor="kyc-last-name" className="mb-1 block text-xs font-medium text-gray-300">
                    Last Name
                  </label>
                  <input
                    id="kyc-last-name"
                    type="text"
                    value={kycData.last_name}
                    onChange={(e) => handleKycChange('last_name', e.target.value)}
                    className={`w-full rounded-lg border bg-gray-800/80 px-4 py-2.5 text-sm text-white placeholder-gray-500 outline-none transition focus:ring-2 focus:ring-indigo-500 ${
                      kycErrors.last_name ? 'border-red-500' : 'border-white/10'
                    }`}
                    placeholder="Enter your last name"
                    aria-invalid={!!kycErrors.last_name}
                    aria-describedby={kycErrors.last_name ? 'kyc-last-name-error' : undefined}
                  />
                  {kycErrors.last_name && (
                    <p id="kyc-last-name-error" className="mt-1 text-xs text-red-400" role="alert">
                      {kycErrors.last_name}
                    </p>
                  )}
                </div>

                {/* Email */}
                <div className="mb-4">
                  <label htmlFor="kyc-email" className="mb-1 block text-xs font-medium text-gray-300">
                    Email Address
                  </label>
                  <input
                    id="kyc-email"
                    type="email"
                    value={kycData.email}
                    onChange={(e) => handleKycChange('email', e.target.value)}
                    className={`w-full rounded-lg border bg-gray-800/80 px-4 py-2.5 text-sm text-white placeholder-gray-500 outline-none transition focus:ring-2 focus:ring-indigo-500 ${
                      kycErrors.email ? 'border-red-500' : 'border-white/10'
                    }`}
                    placeholder="you@example.com"
                    aria-invalid={!!kycErrors.email}
                    aria-describedby={kycErrors.email ? 'kyc-email-error' : undefined}
                  />
                  {kycErrors.email && (
                    <p id="kyc-email-error" className="mt-1 text-xs text-red-400" role="alert">
                      {kycErrors.email}
                    </p>
                  )}
                </div>

                {/* ID Number */}
                <div className="mb-6">
                  <label htmlFor="kyc-id-number" className="mb-1 block text-xs font-medium text-gray-300">
                    ID / Passport Number
                  </label>
                  <input
                    id="kyc-id-number"
                    type="text"
                    value={kycData.id_number}
                    onChange={(e) => handleKycChange('id_number', e.target.value)}
                    className={`w-full rounded-lg border bg-gray-800/80 px-4 py-2.5 text-sm text-white placeholder-gray-500 outline-none transition focus:ring-2 focus:ring-indigo-500 ${
                      kycErrors.id_number ? 'border-red-500' : 'border-white/10'
                    }`}
                    placeholder="Enter your ID number"
                    aria-invalid={!!kycErrors.id_number}
                    aria-describedby={kycErrors.id_number ? 'kyc-id-number-error' : undefined}
                  />
                  {kycErrors.id_number && (
                    <p id="kyc-id-number-error" className="mt-1 text-xs text-red-400" role="alert">
                      {kycErrors.id_number}
                    </p>
                  )}
                </div>

                <button
                  type="submit"
                  id="kyc-continue-btn"
                  className="w-full rounded-lg bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-2 focus:ring-offset-gray-900"
                >
                  Continue to Payment
                </button>
              </form>
            )}

            {/* ---- Payment Step ---- */}
            {step === 'payment' && session && (
              <form onSubmit={handlePaymentSubmit} noValidate>
                {/* Progress */}
                <div className="mb-6 flex items-center gap-2 text-xs text-gray-400">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-green-500 text-[10px] font-bold text-white">
                    ✓
                  </span>
                  <span className="text-green-400 font-medium">Identity</span>
                  <span className="mx-1">→</span>
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-500 text-[10px] font-bold text-white">
                    2
                  </span>
                  <span className="text-white font-medium">Payment</span>
                </div>

                <h2 className="text-lg font-semibold text-white mb-1">
                  Payment Details
                </h2>
                <p className="text-xs text-gray-400 mb-6">
                  Choose how you would like to {session.kind === 'deposit' ? 'fund your deposit' : 'receive your withdrawal'}.
                </p>

                {/* Payment method */}
                <div className="mb-4">
                  <label htmlFor="payment-method" className="mb-1 block text-xs font-medium text-gray-300">
                    Payment Method
                  </label>
                  <select
                    id="payment-method"
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-gray-800/80 px-4 py-2.5 text-sm text-white outline-none transition focus:ring-2 focus:ring-indigo-500"
                  >
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Amount */}
                <div className="mb-6">
                  <label htmlFor="payment-amount" className="mb-1 block text-xs font-medium text-gray-300">
                    Amount ({session.assetCode})
                  </label>
                  <input
                    id="payment-amount"
                    type="text"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-gray-800/80 px-4 py-2.5 text-sm text-white placeholder-gray-500 outline-none transition focus:ring-2 focus:ring-indigo-500"
                    placeholder={`Enter amount in ${session.assetCode}`}
                  />
                </div>

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={handleBackToKyc}
                    className="rounded-lg border border-white/10 bg-transparent px-4 py-3 text-sm font-medium text-gray-300 transition hover:bg-white/5 focus:outline-none focus:ring-2 focus:ring-gray-500"
                  >
                    Back
                  </button>
                  <button
                    type="submit"
                    id="payment-confirm-btn"
                    className="flex-1 rounded-lg bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-2 focus:ring-offset-gray-900"
                  >
                    Confirm {kindLabel}
                  </button>
                </div>
              </form>
            )}

            {/* ---- Submitting ---- */}
            {step === 'submitting' && (
              <div className="flex flex-col items-center gap-4 py-12">
                <div
                  className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent"
                  role="status"
                  aria-label="Submitting"
                />
                <p className="text-sm text-gray-400">Submitting your details…</p>
              </div>
            )}

            {/* ---- Success ---- */}
            {step === 'success' && confirmResult && (
              <div className="flex flex-col items-center gap-4 py-6">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-500/20">
                  <svg className="h-7 w-7 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>

                <h2 className="text-lg font-semibold text-white">
                  {kindLabel} Initiated
                </h2>

                <p className="text-center text-sm text-gray-400">
                  {confirmResult.message}
                </p>

                {/* Transaction details */}
                <div className="mt-2 w-full space-y-2 rounded-lg bg-gray-800/60 px-4 py-3 text-xs">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Transaction ID</span>
                    <span className="font-mono text-gray-300 truncate max-w-[200px]">{confirmResult.id}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Status</span>
                    <span className="font-medium text-yellow-400">{confirmResult.status}</span>
                  </div>
                  {confirmResult.memo && (
                    <div className="flex justify-between">
                      <span className="text-gray-500">Memo</span>
                      <span className="font-mono text-gray-300">{confirmResult.memo}</span>
                    </div>
                  )}
                  {confirmResult.amount && (
                    <div className="flex justify-between">
                      <span className="text-gray-500">Amount</span>
                      <span className="text-gray-300">
                        {confirmResult.amount} {confirmResult.assetCode}
                      </span>
                    </div>
                  )}
                </div>

                <p className="mt-4 text-center text-[11px] text-gray-500">
                  You may now close this window. Your wallet has been notified.
                </p>
              </div>
            )}
          </div>

          {/* Footer */}
          <p className="mt-6 text-center text-[10px] text-gray-600">
            Powered by AfroPay · Stellar SEP-24 Interactive Flow
          </p>
        </div>
      </main>
    </>
  );
}
