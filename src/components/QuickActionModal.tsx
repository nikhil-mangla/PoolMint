import React, { useState, useMemo } from 'react';
import { X, Plus, Wallet } from 'lucide-react';
import {
  Trip,
  PaymentMethod,
  PaymentSource,
  SplitMethod,
  MemberSplit,
} from '../types/treasury';
import {
  calculateExpenseSplits,
  formatCurrency,
  toPaise,
} from '../utils/accounting';

interface QuickActionModalProps {
  trip: Trip;
  poolBalancePaise: number;
  initialMode: 'EXPENSE' | 'POOL' | 'TRANSFER';
  defaultMemberId?: string;
  onClose: () => void;
  onQuickExpense: (input: {
    title: string;
    category: string;
    amountPaise: number;
    paidByMemberId: string;
    paymentSource: PaymentSource;
    paymentMethod: PaymentMethod;
    dateTime: string;
    notes: string;
    splitMethod: SplitMethod;
    splits: MemberSplit[];
  }) => Promise<void>;
  onQuickContribution: (input: {
    fromMemberId: string;
    amountPaise: number;
    paymentMethod: PaymentMethod;
    notes: string;
    dateTime: string;
  }) => Promise<void>;
  onQuickTransfer: (input: {
    fromMemberId: string;
    toMemberId: string;
    amountPaise: number;
    paymentMethod: PaymentMethod;
    notes: string;
    dateTime: string;
  }) => Promise<void>;
  onAddMemberInline?: (memberName: string) => Promise<string | null>;
}

const CATEGORY_CHIPS: { label: string; value: string; emoji: string }[] = [
  { emoji: '🍛', label: 'Food', value: 'Food & Dining' },
  { emoji: '🛺', label: 'Transport', value: 'Local Transport & Taxi' },
  { emoji: '🏨', label: 'Stay', value: 'Hotels & Stays' },
  { emoji: '🎟️', label: 'Activities', value: 'Activities & Tickets' },
  { emoji: '🛍️', label: 'Shopping', value: 'Shopping & Souvenirs' },
  { emoji: '⛽', label: 'Fuel', value: 'Fuel & Tolls' },
  { emoji: '📦', label: 'Other', value: 'Miscellaneous' },
];

export const QuickActionModal: React.FC<QuickActionModalProps> = ({
  trip,
  poolBalancePaise,
  initialMode,
  defaultMemberId,
  onClose,
  onQuickExpense,
  onQuickContribution,
  onQuickTransfer,
  onAddMemberInline,
}) => {
  const c = trip.currency;
  const [mode, setMode] = useState<'EXPENSE' | 'POOL' | 'TRANSFER'>(initialMode);
  const [title, setTitle] = useState('');
  const [amountInput, setAmountInput] = useState('');
  const [category, setCategory] = useState<string>('Food & Dining');
  const [paymentSource, setPaymentSource] = useState<PaymentSource>('POOL');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('UPI');
  const [fromMemberId, setFromMemberId] = useState(
    defaultMemberId || trip.treasurerMemberId || trip.members[0]?.id || ''
  );
  const [toMemberId, setToMemberId] = useState(
    trip.members.find((m) => m.id !== (defaultMemberId || trip.treasurerMemberId))?.id ||
      trip.members[0]?.id ||
      ''
  );
  const [dateInput, setDateInput] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [splitMethod, setSplitMethod] = useState<SplitMethod>('EQUAL');
  const [excludedIds, setExcludedIds] = useState<string[]>([]);
  const [customSplitInputs, setCustomSplitInputs] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const m of trip.members) init[m.id] = '1';
    return init;
  });
  const [newPersonName, setNewPersonName] = useState('');
  const [error, setError] = useState('');

  const totalAmountPaise = toPaise(amountInput);
  const memberIds = useMemo(() => trip.members.map((m) => m.id), [trip.members]);

  const numericCustomInputs = useMemo(() => {
    const out: Record<string, number> = {};
    for (const m of trip.members) {
      const raw = parseFloat(customSplitInputs[m.id] || '0') || 0;
      out[m.id] = splitMethod === 'CUSTOM_AMOUNT' ? Math.round(raw * 100) : raw;
    }
    return out;
  }, [customSplitInputs, splitMethod, trip.members]);

  const effectiveSplitMethod: SplitMethod =
    splitMethod === 'EQUAL' && excludedIds.length > 0 ? 'EXCLUDE' : splitMethod;

  const previewSplits: MemberSplit[] = useMemo(
    () =>
      calculateExpenseSplits(
        totalAmountPaise,
        memberIds,
        effectiveSplitMethod,
        numericCustomInputs,
        excludedIds
      ),
    [totalAmountPaise, memberIds, effectiveSplitMethod, numericCustomInputs, excludedIds]
  );

  const toggleMemberInclusion = (memberId: string) => {
    setExcludedIds((prev) =>
      prev.includes(memberId) ? prev.filter((id) => id !== memberId) : [...prev, memberId]
    );
  };

  const handleAddPerson = async () => {
    const trimmed = newPersonName.trim();
    if (!trimmed || !onAddMemberInline) return;
    const newId = await onAddMemberInline(trimmed);
    if (newId) {
      setCustomSplitInputs((prev) => ({ ...prev, [newId]: '1' }));
      setNewPersonName('');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const paise = toPaise(amountInput);
    if (paise <= 0) {
      setError('Enter a valid amount greater than 0.');
      return;
    }

    const isoDateTime = dateInput
      ? `${dateInput}T${new Date().toISOString().slice(11, 19)}.000Z`
      : new Date().toISOString();

    if (mode === 'EXPENSE') {
      if (previewSplits.filter((s) => s.included).length === 0) {
        setError('At least one person must be included in the split.');
        return;
      }
      await onQuickExpense({
        title: title.trim() || `${category} Expense`,
        category,
        amountPaise: paise,
        paidByMemberId:
          paymentSource === 'POOL' ? trip.treasurerMemberId : fromMemberId,
        paymentSource,
        paymentMethod,
        dateTime: isoDateTime,
        notes: notes.trim(),
        splitMethod: effectiveSplitMethod,
        splits: previewSplits,
      });
    } else if (mode === 'POOL') {
      await onQuickContribution({
        fromMemberId,
        amountPaise: paise,
        paymentMethod,
        notes: notes.trim() || 'Added to Common Pool',
        dateTime: isoDateTime,
      });
    } else {
      if (fromMemberId === toMemberId) {
        setError('Sender and receiver must be different.');
        return;
      }
      await onQuickTransfer({
        fromMemberId,
        toMemberId,
        amountPaise: paise,
        paymentMethod,
        notes: notes.trim(),
        dateTime: isoDateTime,
      });
    }
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="quick-action-title"
    >
      <div className="w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 sm:p-6 shadow-2xl my-auto max-h-[92vh] overflow-y-auto">
        <div className="w-10 h-1.5 bg-slate-300 dark:bg-slate-700 rounded-full mx-auto mb-3 sm:hidden" />
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h3
              id="quick-action-title"
              className="text-lg font-bold text-slate-900 dark:text-white"
            >
              {mode === 'EXPENSE'
                ? 'Add expense'
                : mode === 'POOL'
                  ? 'Add money to Common Pool'
                  : 'Record member transfer'}
            </h3>
            <p className="text-xs text-emerald-700 dark:text-emerald-400 font-semibold flex items-center gap-1 mt-0.5">
              <Wallet className="w-3.5 h-3.5" />
              <span>Pool Money Available: {formatCurrency(poolBalancePaise, c)}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close quick entry modal"
            className="p-1.5 text-slate-400 hover:text-slate-600"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl my-3">
          {(
            [
              { id: 'EXPENSE', label: '🧾 Expense' },
              { id: 'POOL', label: '💰 Add to Pool' },
              { id: 'TRANSFER', label: '⇄ Transfer' },
            ] as const
          ).map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              className={`py-2 rounded-lg text-xs font-semibold transition-colors ${
                mode === m.id
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5">
          {/* Big TrackMyShare-Style Amount Input + Currency Box */}
          <div className="flex items-stretch gap-2">
            <input
              type="number"
              step="0.01"
              autoFocus
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              placeholder="0"
              aria-label="Amount"
              className="flex-1 rounded-xl border-2 border-emerald-500 bg-white dark:bg-slate-800 px-4 py-3 text-2xl font-mono font-bold text-slate-900 dark:text-white focus:outline-none"
            />
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-4 flex items-center justify-center text-sm font-bold text-slate-700 dark:text-slate-200">
              {c}
            </div>
          </div>

          {mode === 'EXPENSE' && (
            <>
              <div>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="What was it? e.g. Dinner in Goa"
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2.5 text-sm text-slate-900 dark:text-white"
                />
              </div>

              {/* TrackMyShare Emoji Category Chips */}
              <div className="flex flex-wrap gap-1.5">
                {CATEGORY_CHIPS.map((chip) => {
                  const active = category === chip.value;
                  return (
                    <button
                      key={chip.value}
                      type="button"
                      onClick={() => setCategory(chip.value)}
                      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold border transition-colors ${
                        active
                          ? 'bg-slate-900 dark:bg-emerald-600 text-white border-slate-900 dark:border-emerald-600'
                          : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <span>{chip.emoji}</span>
                      <span>{chip.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Paid from Pool vs Paid Personally */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setPaymentSource('POOL')}
                  className={`rounded-xl py-2.5 px-3 text-xs font-semibold border text-left transition-colors ${
                    paymentSource === 'POOL'
                      ? 'bg-emerald-600 text-white border-emerald-600'
                      : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                  }`}
                >
                  <div className="font-bold">💰 Paid from Pool</div>
                  <div className="text-[11px] opacity-90">
                    Pool has {formatCurrency(poolBalancePaise, c)}
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentSource('MEMBER_PERSONAL')}
                  className={`rounded-xl py-2.5 px-3 text-xs font-semibold border text-left transition-colors ${
                    paymentSource !== 'POOL'
                      ? 'bg-slate-900 dark:bg-blue-600 text-white border-slate-900 dark:border-blue-600'
                      : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                  }`}
                >
                  <div className="font-bold">👤 Paid Personally</div>
                  <div className="text-[11px] opacity-90">Member paid directly</div>
                </button>
              </div>

              {/* Paid By & Date Row */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                    Paid by
                  </label>
                  {paymentSource === 'POOL' ? (
                    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 px-3 py-2.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                      Common Pool ({trip.members.find((m) => m.id === trip.treasurerMemberId)?.name})
                    </div>
                  ) : (
                    <select
                      aria-label="Paid by"
                      value={fromMemberId}
                      onChange={(e) => {
                        setFromMemberId(e.target.value);
                        setPaymentSource(
                          e.target.value === trip.treasurerMemberId
                            ? 'TREASURER_PERSONAL'
                            : 'MEMBER_PERSONAL'
                        );
                      }}
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-semibold"
                    >
                      {trip.members.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} {m.id === trip.treasurerMemberId ? '(Treasurer)' : ''}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                    Date
                  </label>
                  <input
                    type="date"
                    value={dateInput}
                    onChange={(e) => setDateInput(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs"
                  />
                </div>
              </div>

              {/* Split between (Equal | Exact | % | Shares) */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                    Split between
                  </span>
                  <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden text-xs font-semibold">
                    {(
                      [
                        { id: 'EQUAL', label: 'Equal' },
                        { id: 'CUSTOM_AMOUNT', label: 'Exact' },
                        { id: 'PERCENTAGE', label: '%' },
                        { id: 'SHARES', label: 'Shares' },
                      ] as const
                    ).map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setSplitMethod(m.id)}
                        className={`px-2.5 py-1 transition-colors ${
                          splitMethod === m.id
                            ? 'bg-slate-900 dark:bg-emerald-600 text-white'
                            : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800 bg-slate-50/50 dark:bg-slate-800/40 max-h-44 overflow-y-auto">
                  {trip.members.map((m) => {
                    const splitObj = previewSplits.find((s) => s.memberId === m.id);
                    const isIncluded = !excludedIds.includes(m.id);
                    return (
                      <div
                        key={m.id}
                        className="flex items-center justify-between px-3.5 py-2 text-xs"
                      >
                        <label className="flex items-center gap-2.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={isIncluded}
                            onChange={() => toggleMemberInclusion(m.id)}
                            className="w-4 h-4 rounded accent-emerald-600"
                          />
                          <span
                            className={`font-semibold ${
                              isIncluded
                                ? 'text-slate-900 dark:text-white'
                                : 'text-slate-400 line-through'
                            }`}
                          >
                            {m.name}
                          </span>
                        </label>
                        <div className="flex items-center gap-2">
                          {(splitMethod === 'CUSTOM_AMOUNT' ||
                            splitMethod === 'PERCENTAGE' ||
                            splitMethod === 'SHARES') &&
                            isIncluded && (
                              <input
                                type="number"
                                step="any"
                                min="0"
                                value={customSplitInputs[m.id] || ''}
                                onChange={(e) =>
                                  setCustomSplitInputs((prev) => ({
                                    ...prev,
                                    [m.id]: e.target.value,
                                  }))
                                }
                                className="w-20 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-right font-mono text-xs"
                              />
                            )}
                          <span className="font-mono font-semibold text-slate-700 dark:text-slate-300 min-w-[64px] text-right">
                            {isIncluded ? formatCurrency(splitObj?.amountPaise || 0, c) : '—'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {onAddMemberInline && (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={newPersonName}
                      onChange={(e) => setNewPersonName(e.target.value)}
                      onKeyDown={async (e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          await handleAddPerson();
                        }
                      }}
                      placeholder="+ Add person to trip"
                      className="flex-1 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800/50 px-3.5 py-2 text-xs text-slate-900 dark:text-white"
                    />
                    {newPersonName.trim() && (
                      <button
                        type="button"
                        onClick={handleAddPerson}
                        className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white flex items-center gap-1"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Add</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            </>
          )}

          {(mode === 'POOL' || mode === 'TRANSFER') && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  {mode === 'POOL' ? 'Member Adding to Pool' : 'From Member (Sender)'}
                </label>
                <select
                  value={fromMemberId}
                  onChange={(e) => setFromMemberId(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2.5 text-xs font-semibold"
                >
                  {trip.members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
              {mode === 'TRANSFER' ? (
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    To Member (Receiver)
                  </label>
                  <select
                    value={toMemberId}
                    onChange={(e) => setToMemberId(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2.5 text-xs font-semibold"
                  >
                    {trip.members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Date
                  </label>
                  <input
                    type="date"
                    value={dateInput}
                    onChange={(e) => setDateInput(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs"
                  />
                </div>
              )}
            </div>
          )}

          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes (optional)"
            className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2.5 text-xs text-slate-900 dark:text-white"
          />

          {error && <p className="text-xs text-rose-600">{error}</p>}

          <button
            type="submit"
            className="w-full rounded-xl bg-emerald-600 hover:bg-emerald-500 py-3 text-sm font-semibold text-white min-h-[48px]"
          >
            {mode === 'EXPENSE'
              ? 'Add expense'
              : mode === 'POOL'
                ? 'Add money to Common Pool'
                : 'Save transfer'}
          </button>
        </form>
      </div>
    </div>
  );
};
