import React, { useState, useMemo } from 'react';
import { X, Trash2, RotateCcw, Check, Plus, Wallet } from 'lucide-react';
import {
  Trip,
  Transaction,
  PaymentMethod,
  PaymentSource,
  SplitMethod,
  MemberSplit,
  DEFAULT_EXPENSE_CATEGORIES,
} from '../types/treasury';
import {
  calculateExpenseSplits,
  formatCurrency,
  fromPaise,
  toPaise,
} from '../utils/accounting';

interface EditTransactionModalProps {
  trip: Trip;
  transaction: Transaction;
  poolBalancePaise: number;
  onClose: () => void;
  onSaveTransaction: (updatedTx: Transaction) => Promise<void>;
  onDeleteTransaction: (tx: Transaction) => Promise<void>;
  onReverseTransaction: (tx: Transaction, reason: string) => Promise<void>;
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

export const EditTransactionModal: React.FC<EditTransactionModalProps> = ({
  trip,
  transaction,
  poolBalancePaise,
  onClose,
  onSaveTransaction,
  onDeleteTransaction,
  onReverseTransaction,
  onAddMemberInline,
}) => {
  const c = trip.currency;
  const [title, setTitle] = useState(transaction.title);
  const [amountInput, setAmountInput] = useState(
    String(fromPaise(transaction.amountPaise))
  );
  const [dateInput, setDateInput] = useState(
    transaction.dateTime ? transaction.dateTime.slice(0, 10) : new Date().toISOString().slice(0, 10)
  );
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(
    transaction.paymentMethod || 'UPI'
  );
  const [notes, setNotes] = useState(transaction.notes || '');
  const [reference, setReference] = useState(transaction.reference || '');

  // Expense-specific fields
  const [category, setCategory] = useState<string>(
    transaction.category || DEFAULT_EXPENSE_CATEGORIES[1]
  );
  const [paymentSource, setPaymentSource] = useState<PaymentSource>(
    transaction.paymentSource || 'POOL'
  );
  const [paidByMemberId, setPaidByMemberId] = useState<string>(
    transaction.paidByMemberId || trip.treasurerMemberId
  );
  const [splitMethod, setSplitMethod] = useState<SplitMethod>(
    transaction.splitMethod || 'EQUAL'
  );
  const [excludedIds, setExcludedIds] = useState<string[]>(() => {
    if (!transaction.splits) return [];
    return transaction.splits.filter((s) => !s.included).map((s) => s.memberId);
  });
  const [customSplitInputs, setCustomSplitInputs] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const m of trip.members) {
      const existingSplit = transaction.splits?.find((s) => s.memberId === m.id);
      if (transaction.splitMethod === 'CUSTOM_AMOUNT' && existingSplit) {
        init[m.id] = String(fromPaise(existingSplit.amountPaise));
      } else if (transaction.splitMethod === 'PERCENTAGE' && existingSplit?.percentage) {
        init[m.id] = String(existingSplit.percentage);
      } else if (transaction.splitMethod === 'SHARES' && existingSplit?.shares) {
        init[m.id] = String(existingSplit.shares);
      } else {
        init[m.id] = '1';
      }
    }
    return init;
  });

  // Contribution / Transfer member fields
  const [fromMemberId, setFromMemberId] = useState<string>(
    transaction.fromMemberId || trip.members[0]?.id || ''
  );
  const [toMemberId, setToMemberId] = useState<string>(
    transaction.toMemberId || trip.treasurerMemberId || trip.members[0]?.id || ''
  );

  const [newPersonName, setNewPersonName] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

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

  const handleAddPersonKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      await handleAddPerson();
    }
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

    if (totalAmountPaise <= 0) {
      setError('Please enter a valid amount greater than 0.');
      return;
    }

    const updatedDateTime = dateInput
      ? `${dateInput}T${transaction.dateTime.slice(11, 19) || '12:00:00'}.000Z`
      : transaction.dateTime;

    setSaving(true);
    try {
      if (transaction.type === 'EXPENSE') {
        if (previewSplits.filter((s) => s.included).length === 0) {
          setError('At least one person must be included in the split.');
          setSaving(false);
          return;
        }
        const effectivePaidBy =
          paymentSource === 'POOL' || paymentSource === 'TREASURER_PERSONAL'
            ? trip.treasurerMemberId
            : paidByMemberId;

        const updated: Transaction = {
          ...transaction,
          title: title.trim() || `${category} Expense`,
          amountPaise: totalAmountPaise,
          category,
          paymentSource,
          paidByMemberId: effectivePaidBy,
          paymentMethod,
          dateTime: updatedDateTime,
          splitMethod: effectiveSplitMethod,
          splits: previewSplits,
          notes: notes.trim(),
          updatedAt: new Date().toISOString(),
          syncStatus: 'PENDING',
          lifecycleStatus: 'PENDING_SYNC',
        };
        await onSaveTransaction(updated);
      } else if (transaction.type === 'CONTRIBUTION') {
        const memberName =
          trip.members.find((m) => m.id === fromMemberId)?.name || 'Member';
        const updated: Transaction = {
          ...transaction,
          title: title.trim() || `${memberName}'s Pool Contribution`,
          amountPaise: totalAmountPaise,
          fromMemberId,
          toMemberId: trip.treasurerMemberId,
          paymentMethod,
          dateTime: updatedDateTime,
          reference: reference.trim() || null,
          notes: notes.trim(),
          updatedAt: new Date().toISOString(),
          syncStatus: 'PENDING',
          lifecycleStatus: 'PENDING_SYNC',
        };
        await onSaveTransaction(updated);
      } else {
        if (fromMemberId === toMemberId) {
          setError('Sender and receiver must be different people.');
          setSaving(false);
          return;
        }
        const fromName =
          trip.members.find((m) => m.id === fromMemberId)?.name || 'Sender';
        const toName =
          trip.members.find((m) => m.id === toMemberId)?.name || 'Receiver';
        const updated: Transaction = {
          ...transaction,
          title: title.trim() || `Transfer: ${fromName} → ${toName}`,
          amountPaise: totalAmountPaise,
          fromMemberId,
          toMemberId,
          paymentMethod,
          dateTime: updatedDateTime,
          reference: reference.trim() || null,
          notes: notes.trim(),
          updatedAt: new Date().toISOString(),
          syncStatus: 'PENDING',
          lifecycleStatus: 'PENDING_SYNC',
        };
        await onSaveTransaction(updated);
      }
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to update transaction.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-tx-modal-title"
    >
      <div className="w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 sm:p-6 shadow-2xl my-auto max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h2
              id="edit-tx-modal-title"
              className="text-lg font-bold text-slate-900 dark:text-white"
            >
              Edit {transaction.type === 'EXPENSE' ? 'Expense' : transaction.type === 'CONTRIBUTION' ? 'Pool Contribution' : 'Transfer / Settlement'}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1 mt-0.5">
              <Wallet className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>Common Pool Available: {formatCurrency(poolBalancePaise, c)}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close edit modal"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {/* Big TrackMyShare-Style Amount Input + Currency Box */}
          <div className="flex items-stretch gap-2">
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              placeholder="0"
              aria-label="Transaction amount"
              className="flex-1 rounded-xl border-2 border-emerald-500/80 dark:border-emerald-500 bg-white dark:bg-slate-800 px-4 py-3 text-2xl font-bold font-mono text-slate-900 dark:text-white focus:outline-none"
            />
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-4 flex items-center justify-center text-sm font-bold text-slate-700 dark:text-slate-200">
              {c}
            </div>
          </div>

          {/* What was it / Title */}
          <div>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={
                transaction.type === 'EXPENSE'
                  ? 'What was it? e.g. Dinner in Goa'
                  : 'Transaction title'
              }
              aria-label="Transaction title"
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2.5 text-sm text-slate-900 dark:text-white"
            />
          </div>

          {transaction.type === 'EXPENSE' && (
            <>
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

              {/* Payment Source: Common Pool vs Personal */}
              <div>
                <span className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">
                  Paid From (Pool vs Personal Money)
                </span>
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
                    <div className="font-bold">💰 Common Pool</div>
                    <div className="text-[11px] opacity-90">
                      Shared group wallet ({formatCurrency(poolBalancePaise, c)})
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
                    <div className="text-[11px] opacity-90">
                      Member paid out-of-pocket
                    </div>
                  </button>
                </div>
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
                      aria-label="Paid by member"
                      value={paidByMemberId}
                      onChange={(e) => {
                        setPaidByMemberId(e.target.value);
                        setPaymentSource(
                          e.target.value === trip.treasurerMemberId
                            ? 'TREASURER_PERSONAL'
                            : 'MEMBER_PERSONAL'
                        );
                      }}
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2.5 text-xs font-semibold text-slate-900 dark:text-white"
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
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              {/* TrackMyShare Split Between Section */}
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
                          splitMethod === m.id || (m.id === 'EQUAL' && splitMethod === 'EXCLUDE')
                            ? 'bg-slate-900 dark:bg-emerald-600 text-white'
                            : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800 bg-slate-50/50 dark:bg-slate-800/40">
                  {trip.members.map((m) => {
                    const splitObj = previewSplits.find((s) => s.memberId === m.id);
                    const isIncluded = !excludedIds.includes(m.id);
                    return (
                      <div
                        key={m.id}
                        className="flex items-center justify-between px-3.5 py-2.5 text-xs"
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
                          <span className="font-mono font-semibold text-slate-700 dark:text-slate-300 min-w-[68px] text-right">
                            {isIncluded ? formatCurrency(splitObj?.amountPaise || 0, c) : '—'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* TrackMyShare "+ Add person to trip" inline box */}
                {onAddMemberInline && (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={newPersonName}
                      onChange={(e) => setNewPersonName(e.target.value)}
                      onKeyDown={handleAddPersonKeyDown}
                      placeholder="+ Add person to trip (press Enter)"
                      className="flex-1 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800/60 px-3.5 py-2 text-xs text-slate-900 dark:text-white"
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

          {transaction.type === 'CONTRIBUTION' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  Member Contributing to Pool
                </label>
                <select
                  value={fromMemberId}
                  onChange={(e) => setFromMemberId(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2.5 text-xs font-semibold text-slate-900 dark:text-white"
                >
                  {trip.members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} {m.id === trip.treasurerMemberId ? '(Treasurer)' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  Date
                </label>
                <input
                  type="date"
                  value={dateInput}
                  onChange={(e) => setDateInput(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-white"
                />
              </div>
            </div>
          )}

          {transaction.type !== 'EXPENSE' && transaction.type !== 'CONTRIBUTION' && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  From (Sender)
                </label>
                <select
                  value={fromMemberId}
                  onChange={(e) => setFromMemberId(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2.5 text-xs font-semibold text-slate-900 dark:text-white"
                >
                  {trip.members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  To (Receiver)
                </label>
                <select
                  value={toMemberId}
                  onChange={(e) => setToMemberId(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2.5 text-xs font-semibold text-slate-900 dark:text-white"
                >
                  {trip.members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  Date
                </label>
                <input
                  type="date"
                  value={dateInput}
                  onChange={(e) => setDateInput(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-white"
                />
              </div>
            </div>
          )}

          {/* Payment Method & Notes */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                Payment Method
              </label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-white"
              >
                <option value="UPI">UPI</option>
                <option value="CASH">Cash</option>
                <option value="CARD">Card</option>
                <option value="BANK_TRANSFER">Bank Transfer</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                Notes (optional)
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Notes or bill reference..."
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-white"
              />
            </div>
          </div>

          {error && <p className="text-xs font-medium text-rose-600">{error}</p>}

          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={async () => {
                  await onDeleteTransaction(transaction);
                  onClose();
                }}
                className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 dark:border-rose-800/70 px-3 py-2 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete</span>
              </button>
              {!transaction.isReversed && transaction.type !== 'REVERSAL' && (
                <button
                  type="button"
                  onClick={async () => {
                    await onReverseTransaction(transaction, 'Reversed via Transaction Editor');
                    onClose();
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-amber-200 dark:border-amber-800/70 px-3 py-2 text-xs font-semibold text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reverse</span>
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-2.5 text-xs font-semibold text-slate-700 dark:text-slate-300"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 px-5 py-2.5 text-xs font-semibold text-white"
              >
                <Check className="w-4 h-4" />
                <span>{saving ? 'Saving...' : 'Save Changes'}</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
