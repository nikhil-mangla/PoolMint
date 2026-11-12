import React, { useState } from 'react';
import { Wallet, PlusCircle, CheckCircle2, ArrowDownLeft, Edit3 } from 'lucide-react';
import {
  Trip,
  Transaction,
  TripAccountingReport,
  PaymentMethod,
  UserRole,
} from '../types/treasury';
import { formatCurrency, toPaise } from '../utils/accounting';

interface PoolViewProps {
  trip: Trip;
  transactions: Transaction[];
  report: TripAccountingReport;
  currentRole: UserRole;
  onAddContribution: (input: {
    fromMemberId: string;
    amountPaise: number;
    paymentMethod: PaymentMethod;
    reference: string;
    notes: string;
    dateTime: string;
  }) => Promise<void>;
  onSelectTransactionToEdit?: (tx: Transaction) => void;
}

export const PoolView: React.FC<PoolViewProps> = ({
  trip,
  transactions,
  report,
  currentRole,
  onAddContribution,
  onSelectTransactionToEdit,
}) => {
  const [selectedMemberId, setSelectedMemberId] = useState(trip.members[0]?.id || '');
  const [amountInput, setAmountInput] = useState('5000');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('UPI');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const c = trip.currency;
  const poolContributions = transactions.filter(
    (tx) => tx.tripId === trip.id && tx.type === 'CONTRIBUTION' && !tx.isReversed
  );
  const memberNameMap = new Map(trip.members.map((m) => [m.id, m.name]));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    const paise = toPaise(amountInput);
    if (!selectedMemberId) {
      setError('Please select the member who contributed.');
      return;
    }
    if (paise <= 0) {
      setError('Please enter a valid positive contribution amount.');
      return;
    }

    setSubmitting(true);
    try {
      await onAddContribution({
        fromMemberId: selectedMemberId,
        amountPaise: paise,
        paymentMethod,
        reference: reference.trim(),
        notes: notes.trim() || 'Common pool contribution',
        dateTime: new Date().toISOString(),
      });
      const memberName = memberNameMap.get(selectedMemberId) || 'Member';
      setSuccessMsg(`Added ${formatCurrency(paise, c)} contribution from ${memberName} to Pool.`);
      setReference('');
      setNotes('');
    } catch (err: any) {
      setError(err.message || 'Failed to record contribution.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleBatchCollectEqual = async (eachRupees: number) => {
    if (trip.status === 'CLOSED') return;
    setError('');
    setSubmitting(true);
    try {
      const paise = Math.round(eachRupees * 100);
      for (const m of trip.members) {
        await onAddContribution({
          fromMemberId: m.id,
          amountPaise: paise,
          paymentMethod: 'UPI',
          reference: '',
          notes: `Equal batch pool call (${formatCurrency(paise, c)} each)`,
          dateTime: new Date().toISOString(),
        });
      }
      setSuccessMsg(
        `Collected ${formatCurrency(paise, c)} from all ${trip.members.length} members (+${formatCurrency(
          paise * trip.members.length,
          c
        )} to Pool).`
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 pb-8">
      {/* Pool Header Banner */}
      <section className="rounded-2xl bg-slate-900 dark:bg-slate-900 border border-slate-800 p-5 sm:p-6 text-white">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <p className="text-xs text-emerald-400 font-medium">
              Module A · Shared Travel Treasury Pool (How Much Money We Have)
            </p>
            <h1 className="text-2xl sm:text-3xl font-bold mt-1 font-mono">
              Available Pool Money: {formatCurrency(report.totalPoolBalancePaise, c)}
            </h1>
            <p className="text-xs text-slate-300 mt-1">
              Total Collected: {formatCurrency(report.totalContributionsPaise, c)} · Spent from Pool:{' '}
              {formatCurrency(report.totalPoolExpensesPaise, c)} · Managed by{' '}
              {report.treasurer.treasurerName}
            </p>
          </div>

          {trip.status === 'ACTIVE' && (currentRole === 'ADMIN' || currentRole === 'TREASURER') && (
            <button
              type="button"
              disabled={submitting}
              onClick={() => handleBatchCollectEqual(5000)}
              className="rounded-xl bg-emerald-600 hover:bg-emerald-500 px-4 py-2.5 text-xs font-semibold text-white transition-colors whitespace-nowrap shrink-0 min-h-[44px]"
            >
              Quick Collect ₹5,000 × All {trip.members.length} Friends
            </button>
          )}
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Add Money to Common Pool Form */}
        <section
          aria-labelledby="add-pool-heading"
          className="lg:col-span-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 sm:p-6"
        >
          <h2
            id="add-pool-heading"
            className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2"
          >
            <PlusCircle className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            <span>Add Money to Common Pool</span>
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Supports partial, recurring, and multi-tranche contributions per member.
          </p>

          <form onSubmit={handleSubmit} className="mt-4 space-y-4">
            <div>
              <label
                htmlFor="pool-member-select"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
              >
                Who Contributed?
              </label>
              <select
                id="pool-member-select"
                value={selectedMemberId}
                onChange={(e) => setSelectedMemberId(e.target.value)}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2.5 text-sm text-slate-900 dark:text-white min-h-[44px]"
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
                htmlFor="pool-amount-input"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
              >
                Contribution Amount ({trip.currency})
              </label>
              <input
                id="pool-amount-input"
                type="number"
                step="0.01"
                min="1"
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                placeholder="5000"
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2.5 text-base font-mono font-bold text-slate-900 dark:text-white min-h-[44px]"
              />
              <div className="flex items-center gap-2 mt-2">
                {[1000, 2000, 5000, 10000].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setAmountInput(String(preset))}
                    className="rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1 text-xs font-mono text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    +{formatCurrency(preset * 100, c)}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <span className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Payment Method
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {(
                  [
                    { id: 'CASH', label: 'Cash' },
                    { id: 'UPI', label: 'UPI' },
                    { id: 'BANK_TRANSFER', label: 'Bank Transfer' },
                    { id: 'OTHER', label: 'Other' },
                  ] as const
                ).map((pm) => (
                  <button
                    key={pm.id}
                    type="button"
                    onClick={() => setPaymentMethod(pm.id)}
                    className={`rounded-xl py-2 px-3 text-xs font-semibold border transition-colors min-h-[40px] whitespace-nowrap ${
                      paymentMethod === pm.id
                        ? 'bg-slate-900 dark:bg-emerald-600 text-white border-slate-900 dark:border-emerald-600'
                        : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    {pm.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label
                htmlFor="pool-notes-input"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
              >
                Optional Notes / Reference
              </label>
              <input
                id="pool-notes-input"
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g., 1st tranche pool contribution via GPay"
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2.5 text-sm text-slate-900 dark:text-white min-h-[44px]"
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
              className="w-full rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 py-3 text-sm font-semibold text-white transition-colors min-h-[48px]"
            >
              {submitting ? 'Recording Contribution...' : 'Record Pool Contribution'}
            </button>
          </form>
        </section>

        {/* Member Contribution Breakdown & History */}
        <div className="lg:col-span-7 space-y-6">
          <section className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 sm:p-6">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                  Member Contribution Breakdown
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Total Pool Collected: {formatCurrency(report.totalContributionsPaise, c)} · Remaining Pool: {formatCurrency(report.totalPoolBalancePaise, c)}
                </p>
              </div>
              <Wallet className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            </div>

            <div className="mt-4 space-y-3.5">
              {report.memberSummaries.map((m) => {
                const shareOfPoolPct =
                  report.totalContributionsPaise > 0
                    ? Math.round((m.contributedToPoolPaise / report.totalContributionsPaise) * 100)
                    : 0;
                return (
                  <div key={m.memberId} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-900 dark:text-white">
                        {m.memberName}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                          {formatCurrency(m.contributedToPoolPaise, c)} ({shareOfPoolPct}%)
                        </span>
                        <button
                          type="button"
                          onClick={() => setSelectedMemberId(m.memberId)}
                          className="rounded-md bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100"
                        >
                          + Select
                        </button>
                      </div>
                    </div>
                    <div className="w-full h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-emerald-500 transition-all duration-300"
                        style={{ width: `${Math.min(100, shareOfPoolPct)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 sm:p-6">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Pool Deposit Ledger ({poolContributions.length})
              </h2>
              <span className="text-xs text-slate-500">Click any deposit to edit or delete</span>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-80 overflow-y-auto">
              {poolContributions.length === 0 ? (
                <p className="py-6 text-center text-xs text-slate-500">
                  No pool contributions recorded yet.
                </p>
              ) : (
                poolContributions.map((tx) => (
                  <div
                    key={tx.id}
                    onClick={() => onSelectTransactionToEdit?.(tx)}
                    className="py-3 px-2 -mx-2 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/60 cursor-pointer flex items-center justify-between gap-3 group"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-full bg-emerald-50 dark:bg-emerald-950/60 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
                        <ArrowDownLeft className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                            {tx.fromMemberId ? memberNameMap.get(tx.fromMemberId) : tx.title}
                          </p>
                          <span className="text-[11px] text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-0.5 font-semibold">
                            <Edit3 className="w-3 h-3" />
                            <span>Edit</span>
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                          {tx.paymentMethod} · {tx.dateTime.slice(0, 10)} · {tx.notes}
                        </p>
                      </div>
                    </div>
                    <span className="text-sm font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400 shrink-0">
                      +{formatCurrency(tx.amountPaise, c)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
