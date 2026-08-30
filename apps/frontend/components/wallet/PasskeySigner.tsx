import { useCallback, useMemo, useState } from 'react';

export interface PasskeyRequest {
  challenge: string;
  rpId: string;
  allowCredentials?: Array<{ id: string; type: 'public-key'; transports?: string[] }>;
}

export interface PasskeySignerProps {
  onSuccess?: (result: { credentialId: string; publicKey?: string }) => void;
  onError?: (message: string) => void;
  label?: string;
  disabled?: boolean;
}

export function PasskeySigner({
  onSuccess,
  onError,
  label = 'Use biometric passkey',
  disabled = false,
}: PasskeySignerProps) {
  const [isSigning, setIsSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const available = useMemo(() => {
    return typeof window !== 'undefined' && !!(window.PublicKeyCredential && navigator.credentials);
  }, []);

  const sign = useCallback(async (request: PasskeyRequest) => {
    if (!available || disabled) {
      const message = 'WebAuthn/passkeys are not available in this browser.';
      setError(message);
      onError?.(message);
      return;
    }

    setIsSigning(true);
    setError(null);

    try {
      const challenge = Uint8Array.from(atob(request.challenge.replace(/-/g, '+').replace(/_/g, '/')), (char) => char.charCodeAt(0));
      const publicKeyCredential = await navigator.credentials.get({
        publicKey: {
          challenge,
          rpId: request.rpId,
          allowCredentials: request.allowCredentials ?? [],
          userVerification: 'preferred',
          timeout: 60_000,
        },
      } as CredentialRequestOptions);

      if (!publicKeyCredential || !('rawId' in publicKeyCredential)) {
        throw new Error('No passkey response was returned by the browser.');
      }

      const response = publicKeyCredential as PublicKeyCredential;
      const credentialId = btoa(String.fromCharCode(...new Uint8Array(response.rawId)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');

      onSuccess?.({ credentialId, publicKey: undefined });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Biometric signing failed.';
      setError(message);
      onError?.(message);
    } finally {
      setIsSigning(false);
    }
  }, [available, disabled, onError, onSuccess]);

  if (!available) {
    return null;
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => {
          const challenge = 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcY';
          void sign({ challenge, rpId: 'localhost' });
        }}
        disabled={disabled || isSigning}
        className="w-full rounded-lg border border-indigo-500/60 bg-indigo-500/10 px-3 py-2 text-sm font-medium text-indigo-100 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSigning ? 'Waiting for biometric…' : label}
      </button>
      {error && <p className="text-xs text-red-300">{error}</p>}
    </div>
  );
}

export default PasskeySigner;
