import { useState, useRef, useEffect } from "react";
import { useWalletStore } from "../store/walletStore";
import { SimulationResult } from "../lib/api";

const ASSETS = ["XLM", "USDC", "NGN"];

export default function SendForm() {
  const { sendTransfer, simulateTransfer, fetchBalances, fetchTransactions } = useWalletStore();
  const [form, setForm] = useState({
    destinationPublicKey: "",
    amount: "",
    assetCode: "XLM",
    memo: "",
  });

  const [step, setStep] = useState<'edit' | 'preview'>('edit');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [simulation, setSimulation] = useState<SimulationResult | null>(null);
  const [countdown, setCountdown] = useState<number>(0);
  const [lastSimulationTime, setLastSimulationTime] = useState<number>(0);
  const [status, setStatus] = useState("");

  const previewHeaderRef = useRef<HTMLHeadingElement>(null);
  const amountInputRef = useRef<HTMLInputElement>(null);

  const handleSimulate = async (isAutoRefresh = false) => {
    if (!form.destinationPublicKey || !form.amount) {
      setError("Please enter a destination public key and amount.");
      return;
    }

    if (!isAutoRefresh) {
      setLoading(true);
    }
    setError(null);

    try {
      const result = await simulateTransfer({
        destinationPublicKey: form.destinationPublicKey,
        amount: form.amount,
        assetCode: form.assetCode,
      });

      if (result.status === 'blocked') {
        const primaryIssue = result.issues?.find(i => i.code) || result.issues?.[0];
        let errMsg = "Transfer simulation blocked.";
        if (primaryIssue) {
          if (primaryIssue.code === 'MISSING_DESTINATION_TRUSTLINE') {
            errMsg = `Destination account must trust ${form.assetCode} before receiving it.`;
          } else if (primaryIssue.code === 'NO_PATH') {
            errMsg = `No payment path exists to the destination for ${form.assetCode}.`;
          } else if (primaryIssue.code === 'INVALID_AMOUNT') {
            errMsg = "Please enter a valid positive transfer amount.";
          } else {
            errMsg = primaryIssue.message || errMsg;
          }
        }
        setError(errMsg);
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
      setError(err?.response?.data?.message || "Simulation failed. Please try again.");
      if (step === 'edit') {
        setSimulation(null);
      } else {
        setCountdown(0);
      }
    } finally {
      setLoading(false);
    }
  };

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
  }, [step, simulation, lastSimulationTime, loading, countdown]);

  useEffect(() => {
    if (step === 'preview' && !loading) {
      previewHeaderRef.current?.focus();
    }
  }, [step, loading]);

  const handleBackToEdit = () => {
    setStep('edit');
    setSimulation(null);
    setError(null);
    setTimeout(() => {
      amountInputRef.current?.focus();
    }, 50);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (step === 'edit') {
      handleSimulate();
    } else if (step === 'preview' && simulation && countdown > 0) {
      handleConfirm();
    }
  };

  const handleConfirm = async () => {
    setStatus("Sending...");
    try {
      await sendTransfer(form);
      setStatus("Transaction submitted!");
      setStep('edit');
      setSimulation(null);
      setForm({
        destinationPublicKey: "",
        amount: "",
        assetCode: "XLM",
        memo: "",
      });
      fetchBalances();
      fetchTransactions();
    } catch {
      setStatus("Failed to send. Please try again.");
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
      {error && (
        <div role="alert" className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-lg p-3.5 space-y-1 animate-fade-in">
          <p className="font-semibold">Unable to proceed</p>
          <p className="text-xs text-red-300/80">{error}</p>
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

      {!loading && step === 'edit' && (
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
              <label htmlFor="transfer-asset" className="block text-xs font-medium text-gray-300 mb-1">
                Asset
              </label>
              <select
                id="transfer-asset"
                name="assetCode"
                className="bg-gray-800 rounded-lg p-3 text-sm outline-none border border-gray-700/50 text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                value={form.assetCode}
                onChange={(e) => setForm({ ...form, assetCode: e.target.value })}
              >
                {ASSETS.map((a) => <option key={a}>{a}</option>)}
              </select>
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
          <button
            type="submit"
            className="w-full bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 active:scale-[0.99] transition-all text-white rounded-lg p-3 font-semibold text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 shadow-md shadow-indigo-600/20"
          >
            Preview Transfer
          </button>
        </div>
      )}

      {!loading && step === 'preview' && simulation && (
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
                className="flex-1 bg-indigo-600 hover:bg-indigo-500 active:scale-[0.99] transition-all text-white rounded-lg p-3 font-semibold text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
              >
                Refresh Quote
              </button>
            ) : (
              <button
                type="submit"
                className="flex-1 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 active:scale-[0.99] transition-all text-white rounded-lg p-3 font-semibold text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300 shadow-md shadow-emerald-600/20"
              >
                Confirm Send
              </button>
            )}
          </div>
        </div>
      )}

      {status && (
        <p id="send-form-status" className="text-xs text-center text-gray-400 pt-1" role="status" aria-live="polite">
          {status}
        </p>
      )}
    </form>
  );
}
