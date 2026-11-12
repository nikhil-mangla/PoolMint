import React, { useState, useMemo } from 'react';
import {
  Receipt,
  CheckCircle2,
  Camera,
  AlertTriangle,
  ArrowUpRight,
  Edit3,
} from 'lucide-react';
import {
  Trip,
  Transaction,
  TripAccountingReport,
  PaymentMethod,
  PaymentSource,
  SplitMethod,
  MemberSplit,
  DEFAULT_EXPENSE_CATEGORIES,
} from '../types/treasury';
import {
  calculateExpenseSplits,
  formatCurrency,
  toPaise,
} from '../utils/accounting';

interface ExpensesViewProps {
  trip: Trip;
  transactions: Transaction[];
  report: TripAccountingReport;
  onAddExpense: (input: {
    title: string;
    category: string;
    amountPaise: number;
    paidByMemberId: string;
    paymentSource: PaymentSource;
    paymentMethod: PaymentMethod;
    dateTime: string;
    notes: string;
    receiptDataUrl?: string | null;
    splitMethod: SplitMethod;
    splits: MemberSplit[];
    authorizeOverdraft?: boolean;
  }) => Promise<void>;
  onSelectTransactionToEdit?: (tx: Transaction) => void;
}

export const ExpensesView: React.FC<ExpensesViewProps> = ({
  trip,
  transactions,
  report,
  onAddExpense,
  onSelectTransactionToEdit,
}) => {
  const allCategories = useMemo(
    () => [...DEFAULT_EXPENSE_CATEGORIES, ...(trip.customCategories || [])],
    [trip.customCategories]
  );

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<string>(allCategories[0]);
  const [amountInput, setAmountInput] = useState('');
  const [paymentSource, setPaymentSource] = useState<PaymentSource>('POOL');
  const [paidByMemberId, setPaidByMemberId] = useState(trip.treasurerMemberId);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('UPI');
  const [splitMethod, setSplitMethod] = useState<SplitMethod>('EQUAL');
  const [excludedIds, setExcludedIds] = useState<string[]>([]);
  const [customSplitInputs, setCustomSplitInputs] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const m of trip.members) init[m.id] = '1';
    return init;
  });
  const [notes, setNotes] = useState('');
  const [receiptDataUrl, setReceiptDataUrl] = useState<string | null>(null);
  const [authorizeOverdraft, setAuthorizeOverdraft] = useState(trip.allowNegativePool);
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const c = trip.currency;
  const totalAmountPaise = toPaise(amountInput);
  const memberIds = useMemo(() => trip.members.map((m) => m.id), [trip.members]);
  const memberNameMap = useMemo(
    () => new Map(trip.members.map((m) => [m.id, m.name])),
    [trip.members]
  );

  const numericCustomInputs = useMemo(() => {
    const out: Record<string, number> = {};
    for (const m of trip.members) {
      const raw = parseFloat(customSplitInputs[m.id] || '0') || 0;
      out[m.id] = splitMethod === 'CUSTOM_AMOUNT' ? Math.round(raw * 100) : raw;
    }
    return out;
  }, [customSplitInputs, splitMethod, trip.members]);

  const previewSplits = useMemo(
    () =>
      calculateExpenseSplits(
        totalAmountPaise,
        memberIds,
        splitMethod,
        numericCustomInputs,
        excludedIds
      ),
    [totalAmountPaise, memberIds, splitMethod, numericCustomInputs, excludedIds]
  );

  const allocatedSumPaise = previewSplits.reduce((acc, s) => acc + s.amountPaise, 0);
  const isOverdrawingPool =
    paymentSource === 'POOL' && totalAmountPaise > report.totalPoolBalancePaise;

  const handleReceiptUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setReceiptDataUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const toggleExcludedMember = (id: string) => {
    setExcludedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    if (!title.trim()) {
      setError('Please enter an expense title (e.g., Dinner at Beach Shack).');
      return;
    }
    if (totalAmountPaise <= 0) {
      setError('Please enter a valid positive expense amount.');
      return;
    }
    if (splitMethod === 'CUSTOM_AMOUNT' && allocatedSumPaise !== totalAmountPaise) {
      setError(
        `Custom member amounts sum to ${formatCurrency(
          allocatedSumPaise,
          c
        )}, which must equal total expense ${formatCurrency(totalAmountPaise, c)}.`
      );
      return;
    }
    if (splitMethod === 'PERCENTAGE') {
      const pctSum = Object.values(numericCustomInputs).reduce((a, b) => a + b, 0);
      if (Math.abs(pctSum - 100) > 0.5) {
        setError(`Member percentages sum to ${pctSum}%, which must equal 100%.`);
        return;
      }
    }
    if (previewSplits.filter((s) => s.included).length === 0) {
      setError('At least one group member must be included in the expense.');
      return;
    }
    if (isOverdrawingPool && !authorizeOverdraft && !trip.allowNegativePool) {
      setError(
        `Expense (${formatCurrency(
          totalAmountPaise,
          c
        )}) exceeds Remaining Pool (${formatCurrency(
          report.totalPoolBalancePaise,
          c
        )}). Check "Authorize Pool Overdraft" or switch Payment Source to Personal Money.`
      );
      return;
    }

    setSubmitting(true);
    try {
      const effectivePaidBy =
        paymentSource === 'POOL' || paymentSource === 'TREASURER_PERSONAL'
          ? trip.treasurerMemberId
          : paidByMemberId;

      await onAddExpense({
        title: title.trim(),
        category,
        amountPaise: totalAmountPaise,
        paidByMemberId: effectivePaidBy,
        paymentSource,
        paymentMethod,
        dateTime: new Date().toISOString(),
        notes: notes.trim(),
        receiptDataUrl,
        splitMethod,
        splits: previewSplits,
        authorizeOverdraft,
      });

      setSuccessMsg(
        `Recorded "${title.trim()}" (${formatCurrency(totalAmountPaise, c)}) paid via ${
          paymentSource === 'POOL' ? 'Common Pool' : 'Personal Money'
        }.`
      );
      setTitle('');
      setAmountInput('');
      setNotes('');
      setReceiptDataUrl(null);
    } catch (err: any) {
      setError(err.message || 'Failed to record expense.');
    } finally {
      setSubmitting(false);
    }
  };

  const expenseTransactions = transactions.filter(
    (tx) =>
      tx.tripId === trip.id &&
      tx.type === 'EXPENSE' &&
      !tx.isReversed &&
      (categoryFilter === 'ALL' || tx.category === categoryFilter)
  );

  return (
    <div className="space-y-6 pb-8">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* EXPENSE RECORDING FORM */}
        <section
          aria-labelledby="record-expense-heading"
          className="lg:col-span-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 sm:p-6"
        >
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
            <div>
              <p className="text-xs font-medium text-rose-600 dark:text-rose-400">
                Module C · Group Expense &amp; Split Calculator
              </p>
              <h1
                id="record-expense-heading"
                className="text-xl font-bold text-slate-900 dark:text-white mt-0.5 flex items-center gap-2"
              >
                <Receipt className="w-5 h-5 text-rose-600 dark:text-rose-400" />
                <span>Record Trip Expense</span>
              </h1>
            </div>
            <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
              Pool: {formatCurrency(report.totalPoolBalancePaise, c)}
            </span>
          </div>

          <form onSubmit={handleSubmit} className="mt-4 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="expense-title-input"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
                  Expense Title
                </label>
                <input
                  id="expense-title-input"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g., Dinner at Fisherman's Wharf"
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2.5 text-sm text-slate-900 dark:text-white min-h-[44px]"
                />
              </div>

              <div>
                <label
                  htmlFor="expense-amount-input"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
                  Amount ({trip.currency})
                </label>
                <input
                  id="expense-amount-input"
                  type="number"
                  step="0.01"
                  min="1"
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value)}
                  placeholder="3000"
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2.5 text-base font-mono font-bold text-slate-900 dark:text-white min-h-[44px]"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="expense-category-select"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
                  Category
                </label>
                <select
                  id="expense-category-select"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2.5 text-sm text-slate-900 dark:text-white min-h-[44px]"
                >
                  {allCategories.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="expense-method-select"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
                  Payment Method
                </label>
                <select
                  id="expense-method-select"
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2.5 text-sm text-slate-900 dark:text-white min-h-[44px]"
                >
                  <option value="UPI">UPI</option>
                  <option value="CASH">Cash</option>
                  <option value="CARD">Card</option>
                  <option value="BANK_TRANSFER">Bank Transfer</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>
            </div>

            {/* Payment Source Selector */}
            <div>
              <span className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Payment Source (Double-Entry Ledger Source)
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {(
                  [
                    { id: 'POOL', label: 'Common Pool' },
                    { id: 'TREASURER_PERSONAL', label: 'Treasurer Personal' },
                    { id: 'MEMBER_PERSONAL', label: 'Member Personal' },
                  ] as const
                ).map((ps) => (
                  <button
                    key={ps.id}
                    type="button"
                    onClick={() => {
                      setPaymentSource(ps.id);
                      if (ps.id === 'MEMBER_PERSONAL') {
                        const nonTreasurer = trip.members.find(
                          (m) => m.id !== trip.treasurerMemberId
                        );
                        if (nonTreasurer) setPaidByMemberId(nonTreasurer.id);
                      }
                    }}
                    className={`rounded-xl py-2.5 px-3 text-xs font-semibold border transition-colors min-h-[42px] whitespace-nowrap ${
                      paymentSource === ps.id
                        ? 'bg-slate-900 dark:bg-emerald-600 text-white border-slate-900 dark:border-emerald-600'
                        : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    {ps.label}
                  </button>
                ))}
              </div>
            </div>

            {paymentSource === 'MEMBER_PERSONAL' && (
              <div>
                <label
                  htmlFor="expense-paidby-select"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
                  Which Member Paid Personally?
                </label>
                <select
                  id="expense-paidby-select"
                  value={paidByMemberId}
                  onChange={(e) => setPaidByMemberId(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2.5 text-sm text-slate-900 dark:text-white min-h-[44px]"
                >
                  {trip.members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {isOverdrawingPool && (
              <div className="rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/70 p-3 text-xs text-amber-800 dark:text-amber-200 space-y-2">
                <div className="flex items-center gap-2 font-semibold">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>
                    Pool Balance Alert: Expense exceeds available pool ({formatCurrency(report.totalPoolBalancePaise, c)}).
                  </span>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={authorizeOverdraft}
                    onChange={(e) => setAuthorizeOverdraft(e.target.checked)}
                    className="rounded border-amber-400"
                  />
                  <span>Authorize Pool Overdraft for this transaction</span>
                </label>
              </div>
            )}

            {/* 5 Splitting Options */}
            <div>
              <span className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Expense Splitting Method
              </span>
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    { id: 'EQUAL', label: '1. Equal Split' },
                    { id: 'CUSTOM_AMOUNT', label: '2. Custom Amount' },
                    { id: 'PERCENTAGE', label: '3. Percentage (%)' },
                    { id: 'EXCLUDE', label: '4. Exclude Members' },
                    { id: 'SHARES', label: '5. Custom Shares' },
                  ] as const
                ).map((sm) => (
                  <button
                    key={sm.id}
                    type="button"
                    onClick={() => setSplitMethod(sm.id)}
                    className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold border transition-colors whitespace-nowrap ${
                      splitMethod === sm.id
                        ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 border-slate-900 dark:border-white'
                        : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    {sm.label}
                  </button>
                ))}
              </div>

              <div className="mt-3 rounded-xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800">
                {trip.members.map((m) => {
                  const splitObj = previewSplits.find((s) => s.memberId === m.id);
                  const isIncluded = splitObj?.included ?? true;
                  return (
                    <div
                      key={m.id}
                      className="flex items-center justify-between px-3.5 py-2.5 text-xs gap-2"
                    >
                      <div className="flex items-center gap-2.5">
                        {splitMethod === 'EXCLUDE' && (
                          <input
                            type="checkbox"
                            checked={!excludedIds.includes(m.id)}
                            onChange={() => toggleExcludedMember(m.id)}
                            aria-label={`Include ${m.name}`}
                            className="w-4 h-4 rounded"
                          />
                        )}
                        <span
                          className={`font-medium ${
                            isIncluded
                              ? 'text-slate-900 dark:text-white'
                              : 'text-slate-400 line-through'
                          }`}
                        >
                          {m.name}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        {(splitMethod === 'CUSTOM_AMOUNT' ||
                          splitMethod === 'PERCENTAGE' ||
                          splitMethod === 'SHARES') && (
                          <input
                            type="number"
                            step="any"
                            min="0"
                            aria-label={`${m.name} split input`}
                            value={customSplitInputs[m.id] || ''}
                            onChange={(e) =>
                              setCustomSplitInputs((prev) => ({
                                ...prev,
                                [m.id]: e.target.value,
                              }))
                            }
                            className="w-20 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-right font-mono text-xs"
                          />
                        )}
                        <span className="font-mono font-semibold text-slate-700 dark:text-slate-300 min-w-[72px] text-right">
                          {formatCurrency(splitObj?.amountPaise || 0, c)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="expense-notes-input"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
                  Description / Notes
                </label>
                <input
                  id="expense-notes-input"
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional bill details"
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-white min-h-[42px]"
                />
              </div>

              <div>
                <label
                  htmlFor="expense-receipt-input"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
                  Receipt / Photo Attachment
                </label>
                <label
                  htmlFor="expense-receipt-input"
                  className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800 min-h-[42px]"
                >
                  <Camera className="w-4 h-4 text-slate-400" />
                  <span>{receiptDataUrl ? 'Receipt Attached ✓' : 'Attach Bill Photo'}</span>
                  <input
                    id="expense-receipt-input"
                    type="file"
                    accept="image/*"
                    onChange={handleReceiptUpload}
                    className="hidden"
                  />
                </label>
              </div>
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
              className="w-full rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 py-3 text-sm font-semibold text-white transition-colors min-h-[48px]"
            >
              {submitting ? 'Saving Expense...' : 'Save Expense & Allocate Shares'}
            </button>
          </form>
        </section>

        {/* EXPENSE FEED & BREAKDOWN */}
        <section className="lg:col-span-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4 border-b border-slate-100 dark:border-slate-800">
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                Recorded Trip Expenses ({expenseTransactions.length})
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Total Spent: {formatCurrency(report.totalExpensesPaise, c)}
              </p>
            </div>

            <select
              aria-label="Filter expenses by category"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-700 dark:text-slate-200 min-h-[38px]"
            >
              <option value="ALL">All Categories</option>
              {allCategories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800 mt-2 max-h-[620px] overflow-y-auto pr-1">
            {expenseTransactions.length === 0 ? (
              <p className="py-12 text-center text-xs text-slate-500">
                No expenses recorded in this category yet.
              </p>
            ) : (
              expenseTransactions.map((tx) => {
                const payerName =
                  tx.paymentSource === 'POOL'
                    ? `Common Pool (${report.treasurer.treasurerName})`
                    : `${memberNameMap.get(tx.paidByMemberId || '') || 'Member'} (Personal)`;
                const includedCount =
                  tx.splits?.filter((s) => s.included).length || trip.members.length;
                const sampleShare =
                  tx.splits?.find((s) => s.included)?.amountPaise ||
                  Math.round(tx.amountPaise / Math.max(1, includedCount));

                return (
                  <div
                    key={tx.id}
                    onClick={() => onSelectTransactionToEdit?.(tx)}
                    className="py-4 px-2 -mx-2 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/60 cursor-pointer space-y-2 group"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-full bg-rose-50 dark:bg-rose-950/60 flex items-center justify-center text-rose-600 dark:text-rose-400 shrink-0 mt-0.5">
                          <ArrowUpRight className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="text-sm font-bold text-slate-900 dark:text-white truncate">
                              {tx.title}
                            </h3>
                            <span className="text-[11px] text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-0.5 font-semibold">
                              <Edit3 className="w-3 h-3" />
                              <span>Edit</span>
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {tx.category} · Paid by {payerName} · {tx.paymentMethod}
                          </p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                            Split ({tx.splitMethod || 'EQUAL'}) across {includedCount} members (~
                            {formatCurrency(sampleShare, c)} each)
                            {tx.notes ? ` · ${tx.notes}` : ''}
                          </p>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-bold font-mono tabular-nums text-rose-600 dark:text-rose-400">
                          &minus;{formatCurrency(tx.amountPaise, c)}
                        </p>
                        <p className="text-[11px] text-slate-400">{tx.dateTime.slice(0, 10)}</p>
                      </div>
                    </div>

                    {tx.receiptDataUrl && (
                      <div className="pl-12">
                        <img
                          src={tx.receiptDataUrl}
                          alt={`Receipt for ${tx.title}`}
                          referrerPolicy="no-referrer"
                          className="h-16 w-auto rounded-lg border border-slate-200 dark:border-slate-700 object-cover"
                        />
                      </div>
                    )}
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
