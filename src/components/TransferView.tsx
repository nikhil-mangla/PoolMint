import React, { useState } from 'react';
import { ArrowLeftRight, Send, CheckCircle2, Edit3 } from 'lucide-react';
import { Trip, Transaction, PaymentMethod } from '../types/treasury';
import { formatCurrency, toPaise } from '../utils/accounting';

interface TransferViewProps {
  trip: Trip;
  transactions: Transaction[];
  onAddTransfer: (input: {
    fromMemberId: string;
    toMemberId: string;
    amountPaise: number;
    paymentMethod: PaymentMethod;
    reference: string;
    notes: string;
    dateTime: string;
  }) => Promise<void>;
  onSelectTransactionToEdit?: (tx: Transaction) => void;
}

export const TransferView: React.FC<TransferViewProps> = ({
  trip,
  transactions,
  onAddTransfer,
  onSelectTransactionToEdit,
}) => {
  const [fromMemberId, setFromMemberId] = useState(trip.treasurerMemberId || trip.members[0]?.id || '');
  const [toMemberId, setToMemberId] = useState(
    trip.members.find((m) => m.id !== trip.treasurerMemberId)?.id || trip.members[0]?.id || ''
  );
  const [amountInput, setAmountInput] = useState('2000');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('UPI');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [dateTimeInput, setDateTimeInput] = useState(() => new Date().toISOString().slice(0, 16));
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const c = trip.currency;
  const memberNameMap = new Map(trip.members.map((m) => [m.id, m.name]));
  const transferHistory = transactions.filter(
    (tx) =>
      tx.tripId === trip.id &&
      (tx.type === 'TRANSFER' || tx.type === 'SETTLEMENT' || tx.type === 'REFUND') &&
      !tx.isReversed
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    if (!fromMemberId || !toMemberId) {
      setError('Please select both sender and receiver.');
      return;
    }
    if (fromMemberId === toMemberId) {
      setError('Sender and receiver must be different group members.');
      return;
    }

    const paise = toPaise(amountInput);
    if (paise <= 0) {
      setError('Please enter a valid positive transfer amount.');
      return;
    }

    setSubmitting(true);
    try {
      await onAddTransfer({
        fromMemberId,
        toMemberId,
        amountPaise: paise,
        paymentMethod,
        reference: reference.trim(),
        notes:
          notes.trim() ||
          `Direct transfer from ${memberNameMap.get(fromMemberId)} to ${memberNameMap.get(toMemberId)}`,
        dateTime: dateTimeInput ? new Date(dateTimeInput).toISOString() : new Date().toISOString(),
      });
      setSuccessMsg(
        `Recorded ${formatCurrency(paise, c)} transfer from ${memberNameMap.get(
          fromMemberId
        )} to ${memberNameMap.get(toMemberId)}.`
      );
      setReference('');
      setNotes('');
    } catch (err: any) {
      setError(err.message || 'Failed to record transfer.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 pb-8">
      <section className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 sm:p-6">
        <p className="text-xs font-medium text-blue-600 dark:text-blue-400">
          Module B · Peer &amp; Treasurer Money Transfers
        </p>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
          Direct Member Transfers
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-2xl">
          Track money moving between group members (e.g., Treasurer advances ₹2,000 to Aman, or Rohan returns ₹500). Transfers update individual net balances without double-counting as new pool contributions or trip expenses.
        </p>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <section
          aria-labelledby="record-transfer-heading"
          className="lg:col-span-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 sm:p-6"
        >
          <h2
            id="record-transfer-heading"
            className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2"
          >
            <Send className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <span>Record Money Transfer</span>
          </h2>

          <form onSubmit={handleSubmit} className="mt-4 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="transfer-from-select"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  From Person (Sender)
                </label>
                <select
                  id="transfer-from-select"
                  value={fromMemberId}
                  onChange={(e) => setFromMemberId(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2.5 text-sm text-slate-900 dark:text-white min-h-[44px]"
                >
                  {trip.members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} {m.id === trip.treasurerMemberId ? '(Treasurer)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="transfer-to-select"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  To Person (Receiver)
                </label>
                <select
                  id="transfer-to-select"
                  value={toMemberId}
                  onChange={(e) => setToMemberId(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2.5 text-sm text-slate-900 dark:text-white min-h-[44px]"
                >
                  {trip.members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} {m.id === trip.treasurerMemberId ? '(Treasurer)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label
                htmlFor="transfer-amount-input"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
              >
                Transfer Amount ({trip.currency})
              </label>
              <input
                id="transfer-amount-input"
                type="number"
                step="0.01"
                min="1"
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2.5 text-base font-mono font-bold text-slate-900 dark:text-white min-h-[44px]"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="transfer-method-select"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  Payment Method
                </label>
                <select
                  id="transfer-method-select"
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2.5 text-sm text-slate-900 dark:text-white min-h-[44px]"
                >
                  <option value="UPI">UPI</option>
                  <option value="CASH">Cash</option>
                  <option value="BANK_TRANSFER">Bank Transfer</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="transfer-datetime-input"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  Date &amp; Time
                </label>
                <input
                  id="transfer-datetime-input"
                  type="datetime-local"
                  value={dateTimeInput}
                  onChange={(e) => setDateTimeInput(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2.5 text-xs text-slate-900 dark:text-white min-h-[44px]"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="transfer-ref-input"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
              >
                Transaction Reference (Optional)
              </label>
              <input
                id="transfer-ref-input"
                type="text"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="e.g., UTR / UPI Ref #419022"
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-sm text-slate-900 dark:text-white min-h-[42px]"
              />
            </div>

            <div>
              <label
                htmlFor="transfer-notes-input"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
              >
                Notes
              </label>
              <input
                id="transfer-notes-input"
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g., Cash handed for scooter rental deposit"
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-sm text-slate-900 dark:text-white min-h-[42px]"
              />
            </div>

            {error && (
              <p role="alert" className="text-xs font-medium text-rose-600 dark:text-rose-400">
                {error}
              </p>
            )}
            {successMsg && (
              <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{successMsg}</span>
              </p>
            )}

            <button
              type="submit"
              disabled={submitting || trip.status === 'CLOSED'}
              className="w-full rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 py-3 text-sm font-semibold text-white transition-colors min-h-[48px]"
            >
              {submitting ? 'Recording Transfer...' : 'Record Transfer'}
            </button>
          </form>
        </section>

        <section className="lg:col-span-7 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 sm:p-6">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                Complete Transfer &amp; Settlement History ({transferHistory.length})
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Includes peer transfers, settlements, and pool refunds
              </p>
            </div>
            <ArrowLeftRight className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800 mt-2">
            {transferHistory.length === 0 ? (
              <p className="py-10 text-center text-xs text-slate-500">
                No transfers recorded yet for this trip.
              </p>
            ) : (
              transferHistory.map((tx) => {
                const senderName =
                  (tx.fromMemberId && memberNameMap.get(tx.fromMemberId)) || 'Common Pool';
                const receiverName =
                  (tx.toMemberId && memberNameMap.get(tx.toMemberId)) || 'Member';
                return (
                  <div
                    key={tx.id}
                    onClick={() => onSelectTransactionToEdit?.(tx)}
                    className="py-3.5 px-2 -mx-2 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/60 cursor-pointer flex items-center justify-between gap-4 group"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-full bg-blue-50 dark:bg-blue-950/60 flex items-center justify-center text-blue-600 dark:text-blue-400 shrink-0">
                        <ArrowLeftRight className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                            {senderName} &rarr; {receiverName}
                          </p>
                          <span className="text-[11px] text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-0.5 font-semibold">
                            <Edit3 className="w-3 h-3" />
                            <span>Edit</span>
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                          {tx.type} · {tx.paymentMethod} · {tx.dateTime.slice(0, 10)}
                          {tx.reference ? ` · Ref: ${tx.reference}` : ''}
                          {tx.notes ? ` · ${tx.notes}` : ''}
                        </p>
                      </div>
                    </div>
                    <span className="text-sm font-bold font-mono tabular-nums text-blue-600 dark:text-blue-400 shrink-0">
                      {formatCurrency(tx.amountPaise, c)}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>
    </div>
  );
};
