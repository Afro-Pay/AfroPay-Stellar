import { useState, useRef, useEffect, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useWalletStore } from "../store/walletStore";
import { SimulationResult } from "../lib/api";
import AssetPicker from "./AssetPicker";
import { queueOfflineDraft } from "../lib/syncEngine";
import { getPendingCount } from "../lib/offlineQueue";

export default function SendForm() {
  const queryClient = useQueryClient();
  const { sendTransfer, simulateTransfer, sendError, isLoadingSend, clearError } = useWalletStore();
  const [form, setForm] = useState({
    destinationPublicKey: "",
    amount: "",
    assetCode: "XLM",
    assetIssuer: undefined as string | undefined,
    memo: "",
  });

  const [step, setStep] = useState<'edit' | 'preview'>('edit');
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [simulation, setSimulation] = useState<SimulationResult | null>(null);
  const [countdown, setCountdown] = useState<number>(0);
  const [lastSimulationTime, setLastSimulationTime] = useState<number>(0);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [addressConfirmation, setAddressConfirmation] = useState('');

  // A malicious clipboard-hijacking extension can silently swap a copied
  // Stellar address for its own. Requiring the user to actively retype the
  // last 4 characters of whatever currently sits in the destination field
  // forces a deliberate look at the real value about to be submitted.
  const destinationSuffix = form.destinationPublicKey.trim().slice(-4).toUpperCase();
  const isAddressConfirmed =
    destinationSuffix.length === 4 &&
    addressConfirmation.trim().toUpperCase() === destinationSuffix;

  // Re-arm the confirmation whenever the destination actually changes, but
  // not on every keystroke of an unrelated field and not on the periodic
  // quote auto-refresh (same address, just a fresher rate).
  useEffect(() => {
    setAddressConfirmation('');
  }, [form.destinationPublicKey]);

  const previewHeaderRef = useRef<HTMLHeadingElement>(null);
  const amountInputRef = useRef<HTMLInputElement>(null);

  const handleSimulate = useCallback(async (isAutoRefresh = false) => {
    if (!form.destinationPublicKey || !form.amount) {
      setFormError("Please enter a destination public key and amount.");
      return;
    }

    if (!isAutoRefresh) {
      setLoading(true);
    }
    setFormError(null);
    clearError('send');
    try {
      const result = await simulateTransfer({
        destinationPublicKey: form.destinationPublicKey,
        amount: form.amount,
        assetCode: form.assetCode,
        assetIssuer: form.assetIssuer,
      });

      if (result.status === 'blocked') {
        const primaryIssue = result.issues?.find(i => i.code) || result.issues?.[0];
        let errMsg = "Transfer simulation blocked.";
        if (primaryIssue) {
          if (primaryIssue.code === 'MISSING_DESTINATION_TRUSTLINE') {
            const issuerSuffix = form.assetIssuer ? ` from ${form.assetIssuer.slice(0, 6)}…` : '';
            errMsg = `Destination account must trust ${form.assetCode}${issuerSuffix} before receiving it.`;
          } else if (primaryIssue.code === 'NO_PATH') {
            errMsg = `No payment path exists to the destination for ${form.assetCode}.`;
          } else if (primaryIssue.code === 'INVALID_AMOUNT') {
            errMsg = "Please enter a valid positive transfer amount.";
          } else {
            errMsg = primaryIssue.message || errMsg;
          }
        }
        setFormError(errMsg);
        if (step === 'edit') {
          setSimulation(null);
        } else {
          setCountdown(0);
        }
      } else {
        setSimulation(result);
        setLastSimulationTime(Date.now());

        const expiresAtStr = result.rateExpiresAt;
        const expiresAt = expiresAtStr ? new Date(expiresAtStr).getTime() : Date.now() + 15000;
        const seconds = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
        setCountdown(seconds);

        setStep('preview');
      }
    } catch (err: any) {
      setFormError(err?.response?.data?.message || "Simulation failed. Please try again.");
      if (step === 'edit') {
        setSimulation(null);
      } else {
        setCountdown(0);
      }
    } finally {
      setLoading(false);
    }
  }, [form, step, simulateTransfer, clearError]);

  useEffect(() => {
    if (step !== 'preview' || !simulation || loading || countdown <= 0) return;

    const interval = setInterval(() => {
      const expiresAtStr = simulation.rateExpiresAt;
      const expiresAt = expiresAtStr ? new Date(expiresAtStr).getTime() : (lastSimulationTime + 15000);
      const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));

      setCountdown(remaining);

      if (remaining <= 0) {
        clearInterval(interval);
        handleSimulate(true);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [step, simulation, lastSimulationTime, loading, countdown, handleSimulate]);

  useEffect(() => {
    if (step === 'preview' && !loading) {
      previewHeaderRef.current?.focus();
    }
  }, [step, loading]);

  useEffect(() => {
    if (!statusMessage) return;
    const timer = setTimeout(() => {
      setStatusMessage(null);
    }, 5000);
    return () => clearTimeout(timer);
  }, [statusMessage]);

  const handleBackToEdit = () => {
    setStep('edit');
    setSimulation(null);
    setFormError(null);
    setStatusMessage(null);
    clearError('send');
    setTimeout(() => {
      amountInputRef.current?.focus();
    }, 50);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isOffline) return; // Offline uses the dedicated "Queue Transfer Offline" button.
    if (step === 'edit') {
      handleSimulate();
    } else if (step === 'preview' && simulation && countdown > 0 && isAddressConfirmed) {
      handleConfirm();
    }
  };

  const handleConfirm = async () => {
    if (isSubmitting) return;

    setIsSubmitting(true);
    setFormError(null);
    clearError('send');

    try {
      // If offline, queue the draft locally for later delivery.
      if (!navigator.onLine) {
        await queueOfflineDraft({
          destinationPublicKey: form.destinationPublicKey,
          amount: form.amount,
          assetCode: form.assetCode,
          assetIssuer: form.assetIssuer,
          memo: form.memo,
        });
        setStep('edit');
        setSimulation(null);
        setStatusMessage('Transfer saved offline. It will be sent when you reconnect.');
        setForm({
          destinationPublicKey: "",
          amount: "",
          assetCode: "XLM",
          assetIssuer: undefined,
          memo: "",
        });
        getPendingCount().then(setOfflineCount);
        return;
      }

      await sendTransfer(form);
      setStep('edit');
      setSimulation(null);
      setStatusMessage('Transfer submitted successfully.');
      setForm({
        destinationPublicKey: "",
        amount: "",
        assetCode: "XLM",
        assetIssuer: undefined,
        memo: "",
      });
      queryClient.invalidateQueries({ queryKey: ['balances'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
    } catch {
      // The store captures the send error; no local status string is needed.
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderPath = (path: string[]) => {
    return (
      <div className="flex items-center gap-1 flex-wrap">
        {path.map((asset, idx) => (
          <span key={idx} className="flex items-center text-xs font-semibold">
            <span className="bg-gray-800 text-gray-200 border border-gray-700 px-2.5 py-1 rounded-lg">
              {asset}
            </span>
            {idx < path.length - 1 && (
              <span className="text-gray-500 mx-1">➔</span>
            )}
          </span>
        ))}
      </div>
    );
  };

  return (
    <form onSubmit={handleSubmit} className="bg-gray-900 rounded-xl p-5 space-y-4 border border-gray-800 shadow-xl" aria-describedby="send-form-status">
      {(formError || sendError) && (
        <div role="alert" className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-lg p-3.5 space-y-1 animate-fade-in">
          <p className="font-semibold">{sendError ? 'Unable to submit transfer' : 'Unable to proceed'}</p>
          <p className="text-xs text-red-300/80">{sendError ?? formError}</p>
        </div>
      )}

      {isOffline && !sendError && !formError && (
        <div className="flex items-center gap-2.5 bg-amber-500/10 border border-amber-500/25 text-amber-300 text-sm rounded-lg px-3.5 py-3" role="status">
          <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a12 12 0 0 1 18 0M7 9a8 8 0 0 1 10 0M11 13a4 4 0 0 1 2 0m-2 7h.01" />
          </svg>
          <span className="text-xs">
            You are offline. Transfers will be saved to the queue{offlineCount > 0 ? ` (${offlineCount} already queued)` : ''} and sent when the connection is restored.
          </span>
        </div>
      )}

      {statusMessage && !sendError && (
        <div role="status" className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm rounded-lg p-3.5 animate-fade-in">
          <p className="text-sm font-medium">{statusMessage}</p>
        </div>
      )}

      {loading && (
        <div className="animate-pulse space-y-4 py-4" aria-live="polite" aria-busy="true">
          <div className="h-4 bg-gray-800 rounded w-1/3"></div>
          <div className="space-y-3">
            <div className="h-12 bg-gray-800 rounded-lg"></div>
            <div className="h-12 bg-gray-800 rounded-lg w-5/6"></div>
            <div className="h-12 bg-gray-800 rounded-lg w-4/5"></div>
          </div>
          <p className="text-xs text-center text-gray-500">Estimating destination amounts & fees...</p>
        </div>
      )}

      {!loading && isLoadingSend && (
        <div className="rounded-lg border border-indigo-500/20 bg-indigo-500/10 p-3 text-sm text-indigo-300" aria-live="polite">
          Submitting transfer...
        </div>
      )}

      {!loading && !isLoadingSend && step === 'edit' && (
        <div className="space-y-3">
          <div>
            <label htmlFor="destination-public-key" className="block text-xs font-medium text-gray-300 mb-1">
              Destination public key
            </label>
            <input
              id="destination-public-key"
              name="destinationPublicKey"
              className="w-full bg-gray-800 rounded-lg p-3 text-sm outline-none border border-gray-700/50 text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
              placeholder="G..."
              value={form.destinationPublicKey}
              onChange={(e) => setForm({ ...form, destinationPublicKey: e.target.value })}
              autoComplete="off"
              required
            />
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label htmlFor="transfer-amount" className="block text-xs font-medium text-gray-300 mb-1">
                Amount
              </label>
              <input
                id="transfer-amount"
                name="amount"
                ref={amountInputRef}
                className="w-full bg-gray-800 rounded-lg p-3 text-sm outline-none border border-gray-700/50 text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                placeholder="0.00"
                type="number"
                step="0.0000001"
                min="0"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                required
              />
            </div>
            <div>
              <AssetPicker
                label="Asset"
                value={form.assetCode}
                disabled={loading || isLoadingSend}
                onChange={(asset) =>
                  setForm({
                    ...form,
                    assetCode: asset.code,
                    assetIssuer: asset.issuer,
                  })
                }
              />
            </div>
          </div>
          <div>
            <label htmlFor="transfer-memo" className="block text-xs font-medium text-gray-300 mb-1">
              Memo <span className="text-gray-500">(optional)</span>
            </label>
            <input
              id="transfer-memo"
              name="memo"
              className="w-full bg-gray-800 rounded-lg p-3 text-sm outline-none border border-gray-700/50 text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
              placeholder="Invoice or note"
              value={form.memo}
              onChange={(e) => setForm({ ...form, memo: e.target.value })}
            />
          </div>
          {isOffline ? (
            <button
              type="button"
              onClick={async () => {
                if (!form.destinationPublicKey || !form.amount) {
                  setFormError("Please enter a destination public key and amount.");
                  return;
                }
                setFormError(null);
                clearError('send');
                setIsSubmitting(true);
                try {
                  await queueOfflineDraft({
                    destinationPublicKey: form.destinationPublicKey,
                    amount: form.amount,
                    assetCode: form.assetCode,
                    assetIssuer: form.assetIssuer,
                    memo: form.memo,
                  });
                  setStatusMessage('Transfer saved offline. It will be sent when you reconnect.');
                  setForm({
                    destinationPublicKey: "",
                    amount: "",
                    assetCode: "XLM",
                    assetIssuer: undefined,
                    memo: "",
                  });
                  getPendingCount().then(setOfflineCount);
                } catch {
                  setFormError('Failed to save the transfer offline. Please try again.');
                } finally {
                  setIsSubmitting(false);
                }
              }}
              disabled={isSubmitting}
              className="w-full bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 active:scale-[0.99] transition-all text-white rounded-lg p-3 font-semibold text-sm focus:outline-none focus:ring-2 focus:ring-amber-300 shadow-md shadow-amber-600/20 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? 'Saving offline...' : 'Queue Transfer Offline'}
            </button>
          ) : (
            <button
              type="submit"
              className="w-full bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 active:scale-[0.99] transition-all text-white rounded-lg p-3 font-semibold text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 shadow-md shadow-indigo-600/20"
            >
              Preview Transfer
            </button>
          )}
        </div>
      )}

      {!loading && !isLoadingSend && step === 'preview' && simulation && (
        <div className="space-y-4">
          <div className="border-b border-gray-800 pb-3 flex justify-between items-center">
            <h2
              id="preview-heading"
              ref={previewHeaderRef}
              tabIndex={-1}
              className="text-sm font-semibold text-gray-200 outline-none"
            >
              Review Transfer Details
            </h2>
            <div className={`text-xs font-semibold px-2.5 py-0.5 rounded-full border transition-colors ${
              countdown <= 0
                ? 'bg-red-500/10 text-red-400 border-red-500/20'
                : countdown <= 3
                ? 'bg-amber-500/10 text-amber-400 border-amber-500/20 animate-pulse'
                : 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20'
            }`}>
              {countdown <= 0 ? 'Quote expired' : `Quote expires in ${countdown}s`}
            </div>
          </div>

          <div className="space-y-3 bg-gray-800/40 border border-gray-800 rounded-xl p-4 text-sm">
            <div className="flex justify-between items-baseline border-b border-gray-800/50 pb-2">
              <span className="text-gray-400 text-xs">Destination</span>
              <span className="font-mono text-xs text-gray-200" title={form.destinationPublicKey}>
                {form.destinationPublicKey.slice(0, 4)}…{form.destinationPublicKey.slice(-4)}
              </span>
            </div>

            <div className="flex justify-between items-baseline border-b border-gray-800/50 pb-2">
              <span className="text-gray-400 text-xs">Sending Amount</span>
              <span className="font-medium text-white">{form.amount} {form.assetCode}</span>
            </div>

            <div className="flex justify-between items-baseline border-b border-gray-800/50 pb-2">
              <span className="text-gray-400 text-xs">Estimated Destination</span>
              <span className="font-semibold text-emerald-400 text-base">
                {simulation.estimatedDestinationAmount} {form.assetCode}
              </span>
            </div>

            <div className="flex justify-between items-baseline border-b border-gray-800/50 pb-2">
              <span className="text-gray-400 text-xs">Fee</span>
              <span className="font-medium text-gray-200">
                {simulation.path.length > 1 ? 'Included in FX rate above' : 'No fee — same-asset transfer'}
              </span>
            </div>

            <div className="flex justify-between items-baseline border-b border-gray-800/50 pb-2">
              <span className="text-gray-400 text-xs">Minimum Destination</span>
              <span className="font-medium text-gray-200">
                {simulation.minimumDestinationAmount} {form.assetCode}
              </span>
            </div>

            {simulation.effectiveRate && (
              <div className="flex justify-between items-baseline border-b border-gray-800/50 pb-2">
                <span className="text-gray-400 text-xs">FX Effective Rate</span>
                <span className="font-medium text-gray-200">
                  1 {form.assetCode} = {simulation.effectiveRate.toFixed(4)} {form.assetCode}
                </span>
              </div>
            )}

            {simulation.path && simulation.path.length > 0 && (
              <div className="space-y-1.5 pt-1">
                <span className="text-gray-400 text-xs block">Execution Path</span>
                {renderPath(simulation.path)}
              </div>
            )}
          </div>

          {countdown > 0 && (
            <div>
              <label htmlFor="destination-confirm" className="block text-xs font-medium text-gray-300 mb-1">
                Confirm destination — type the last 4 characters
              </label>
              <input
                id="destination-confirm"
                name="destinationConfirm"
                className="w-full bg-gray-800 rounded-lg p-3 text-sm font-mono uppercase tracking-widest outline-none border border-gray-700/50 text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                placeholder={destinationSuffix || '····'}
                maxLength={4}
                value={addressConfirmation}
                onChange={(e) => setAddressConfirmation(e.target.value)}
                autoComplete="off"
                aria-describedby="destination-confirm-hint"
              />
              <p id="destination-confirm-hint" className="text-xs text-gray-500 mt-1">
                Destination ends in <span className="font-mono text-gray-300">{destinationSuffix}</span>. Retyping it
                guards against a clipboard extension silently swapping the address you pasted.
              </p>
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleBackToEdit}
              className="flex-1 bg-gray-800 hover:bg-gray-700/80 active:scale-[0.99] transition-all text-gray-300 border border-gray-700/50 rounded-lg p-3 font-semibold text-sm focus:outline-none focus:ring-2 focus:ring-gray-600"
            >
              Modify
            </button>
            {countdown <= 0 ? (
              <button
                type="button"
                onClick={() => handleSimulate(false)}
                disabled={isSubmitting}
                className="flex-1 bg-indigo-600 hover:bg-indigo-500 active:scale-[0.99] transition-all text-white rounded-lg p-3 font-semibold text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Refresh Quote
              </button>
            ) : (
              <button
                type="submit"
                disabled={isSubmitting || isLoadingSend || !isAddressConfirmed}
                aria-busy={isSubmitting || isLoadingSend}
                className="flex-1 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 active:scale-[0.99] transition-all text-white rounded-lg p-3 font-semibold text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300 shadow-md shadow-emerald-600/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isSubmitting || isLoadingSend ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span>Processing...</span>
                  </>
                ) : (
                  'Confirm Send'
                )}
              </button>
            )}
          </div>
          {countdown > 0 && !isAddressConfirmed && (
            <p className="text-xs text-amber-400/90 text-center -mt-1">
              Type the last 4 characters of the destination address above to enable sending.
            </p>
          )}
        </div>
      )}

      {!loading && !isLoadingSend && (
        <p id="send-form-status" className="text-xs text-center text-gray-400 pt-1" role="status" aria-live="polite" aria-atomic="true">
          {statusMessage ?? 'Review the quote and confirm when ready.'}
        </p>
      )}
    </form>
  );
}

