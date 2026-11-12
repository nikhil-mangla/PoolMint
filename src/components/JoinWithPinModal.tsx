import React, { useState } from 'react';
import { KeyRound, ArrowRight, X, Sparkles, Link, Check, AlertCircle } from 'lucide-react';
import { decodeTripSharePayload } from '../utils/shareTrip.ts';
import type { Trip, Transaction } from '../types/treasury.ts';

interface JoinWithPinModalProps {
  onJoinFromPayload: (payload: { trip: Trip; transactions: Transaction[]; pin?: string }) => void;
  onJoinLocalTripByPin: (pin: string) => boolean;
  onClose: () => void;
}

export const JoinWithPinModal: React.FC<JoinWithPinModalProps> = ({
  onJoinFromPayload,
  onJoinLocalTripByPin,
  onClose,
}) => {
  const [pinOrLinkInput, setPinOrLinkInput] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const raw = pinOrLinkInput.trim();
    if (!raw) return;

    setErrorMessage('');
    setIsLoading(true);

    try {
      // 1. Check if user pasted a full URL or text with ?d= or #join=
      let extractedData: string | null = null;
      let extractedPin: string | null = null;

      // Extract PIN from text if formatted like "PIN: 1234"
      const pinMatch = raw.match(/(?:PIN|pin|code|Code)[:\s]+(\d{4})/i);
      if (pinMatch) {
        extractedPin = pinMatch[1];
      }

      // Extract d= or join= parameter
      const dMatch = raw.match(/[?&]d=([^&\s#]+)/);
      if (dMatch) {
        extractedData = decodeURIComponent(dMatch[1]);
      } else {
        const joinMatch = raw.match(/[#&?](?:join|data)=([^&\s]+)/);
        if (joinMatch) {
          extractedData = joinMatch[1];
        }
      }

      if (extractedData) {
        const decoded = await decodeTripSharePayload(extractedData);
        if (decoded) {
          onJoinFromPayload({
            trip: decoded.trip,
            transactions: decoded.transactions,
            pin: extractedPin || decoded.trip.pin,
          });
          onClose();
          return;
        }
      }

      // 2. If it's a 4-digit PIN:
      const cleanPin = raw.replace(/\D/g, '');
      if (cleanPin.length === 4) {
        const found = onJoinLocalTripByPin(cleanPin);
        if (found) {
          onClose();
          return;
        } else {
          setErrorMessage(
            'Trip with PIN ' +
              cleanPin +
              ' is not yet on this device. Please paste the full invite link from WhatsApp to load it the first time.'
          );
          return;
        }
      }

      setErrorMessage('Could not find a valid trip link or 4-digit PIN. Please paste the entire WhatsApp invite link.');
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to process invite link.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="join-pin-title"
    >
      <div className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-2xl space-y-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-emerald-100 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <h2 id="join-pin-title" className="text-lg font-bold text-slate-900 dark:text-white">
                Join Trip with PIN / Link
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Enter your 4-digit trip PIN or paste your invite link
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Trip PIN or Invite Link:
            </label>
            <input
              type="text"
              value={pinOrLinkInput}
              onChange={(e) => {
                setPinOrLinkInput(e.target.value);
                setErrorMessage('');
              }}
              placeholder="e.g. 4821 or paste WhatsApp link..."
              autoFocus
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
            />
          </div>

          {errorMessage && (
            <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 text-xs text-rose-700 dark:text-rose-300 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-500" />
              <span>{errorMessage}</span>
            </div>
          )}

          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 text-[11px] text-slate-500 space-y-1">
            <p className="font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
              Tip for first-time friends:
            </p>
            <p>
              Paste the entire invite link from WhatsApp here. Once loaded, you can switch back to this trip anytime using just the 4-digit PIN!
            </p>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 py-2.5 text-xs font-semibold text-slate-700 dark:text-slate-300"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading || !pinOrLinkInput.trim()}
              className="flex-1 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 py-2.5 px-4 text-xs font-semibold text-white flex items-center justify-center gap-1.5 shadow-md shadow-emerald-600/20"
            >
              <span>{isLoading ? 'Loading...' : 'Join Trip'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
