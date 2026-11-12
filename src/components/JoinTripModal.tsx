import React, { useState, useMemo } from 'react';
import type { Trip, Transaction, TripMember } from '../types/treasury.ts';
import { formatCurrency, computeTripAccounting } from '../utils/accounting.ts';
import {
  Users,
  Compass,
  Wallet,
  Receipt,
  Check,
  UserPlus,
  ArrowRight,
  X,
  Sparkles,
  Calendar,
} from 'lucide-react';

interface JoinTripModalProps {
  payload: {
    trip: Trip;
    transactions: Transaction[];
  };
  isExistingTrip: boolean;
  onJoin: (params: {
    trip: Trip;
    transactions: Transaction[];
    selectedMemberId: string;
  }) => Promise<void>;
  onClose: () => void;
}

export const JoinTripModal: React.FC<JoinTripModalProps> = ({
  payload,
  isExistingTrip,
  onJoin,
  onClose,
}) => {
  const { trip, transactions } = payload;
  const [selectedMemberId, setSelectedMemberId] = useState<string>(() => {
    return trip.members[0]?.id || '';
  });
  const [isAddingNewMember, setIsAddingNewMember] = useState<boolean>(false);
  const [newMemberName, setNewMemberName] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Compute report from payload to show live pool balance and expenses
  const report = useMemo(() => {
    return computeTripAccounting(trip, transactions);
  }, [trip, transactions]);

  const handleConfirm = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);

    try {
      let finalTrip = { ...trip };
      let finalMemberId = selectedMemberId;

      if (isAddingNewMember && newMemberName.trim()) {
        const newId = `mem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        const colors = [
          '#059669',
          '#2563eb',
          '#7c3aed',
          '#db2777',
          '#d97706',
          '#0891b2',
          '#4f46e5',
        ];
        const newMember: TripMember = {
          id: newId,
          tripId: trip.id,
          name: newMemberName.trim(),
          role: 'MEMBER',
          avatarColor: colors[Math.floor(Math.random() * colors.length)],
        };
        finalTrip.members = [...finalTrip.members, newMember];
        finalMemberId = newId;
      }

      await onJoin({
        trip: finalTrip,
        transactions,
        selectedMemberId: finalMemberId,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="join-trip-modal-title"
    >
      <div className="w-full max-w-lg rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-2xl space-y-5 my-8">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-emerald-100 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 flex items-center justify-center text-2xl shrink-0">
              {isExistingTrip ? '🔄' : '🎉'}
            </div>
            <div>
              <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                <Sparkles className="w-3.5 h-3.5" />
                <span>{isExistingTrip ? 'Trip Update Detected' : 'Trip Invitation'}</span>
              </div>
              <h2
                id="join-trip-modal-title"
                className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white mt-0.5"
              >
                {trip.name}
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Trip Highlights Card */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-y-1.5 gap-x-4 text-xs text-slate-600 dark:text-slate-300">
            <span className="flex items-center gap-1">
              <Compass className="w-4 h-4 text-emerald-600" />
              <strong>{trip.destination}</strong>
            </span>
            <span className="flex items-center gap-1">
              <Calendar className="w-4 h-4 text-slate-400" />
              <span>
                {trip.startDate} &rarr; {trip.endDate}
              </span>
            </span>
            <span className="font-mono px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold">
              {trip.currency}
            </span>
          </div>

          {trip.description && (
            <p className="text-xs text-slate-500 dark:text-slate-400 italic">
              &ldquo;{trip.description}&rdquo;
            </p>
          )}

          {/* Stats Bar */}
          <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-200 dark:border-slate-700/60 text-center">
            <div className="p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <div className="flex items-center justify-center gap-1 text-[11px] text-slate-500">
                <Wallet className="w-3.5 h-3.5 text-emerald-600" />
                <span>Common Pool</span>
              </div>
              <p className="text-sm font-bold font-mono text-emerald-600 dark:text-emerald-400 mt-0.5">
                {formatCurrency(report.totalPoolBalancePaise, trip.currency)}
              </p>
            </div>

            <div className="p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <div className="flex items-center justify-center gap-1 text-[11px] text-slate-500">
                <Users className="w-3.5 h-3.5 text-indigo-600" />
                <span>Members</span>
              </div>
              <p className="text-sm font-bold font-mono text-slate-900 dark:text-white mt-0.5">
                {trip.members.length}
              </p>
            </div>

            <div className="p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <div className="flex items-center justify-center gap-1 text-[11px] text-slate-500">
                <Receipt className="w-3.5 h-3.5 text-amber-600" />
                <span>Expenses</span>
              </div>
              <p className="text-sm font-bold font-mono text-slate-900 dark:text-white mt-0.5">
                {transactions.length}
              </p>
            </div>
          </div>
        </div>

        {/* Member Selector */}
        <div className="space-y-2">
          <label className="block text-xs font-semibold text-slate-800 dark:text-slate-200">
            Who are you in this trip?
          </label>
          <p className="text-[11px] text-slate-500">
            Pick your name so Pool Mint can personalize your debts, balances, and expense reports.
          </p>

          <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
            {trip.members.map((m) => {
              const isSelected = !isAddingNewMember && selectedMemberId === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    setSelectedMemberId(m.id);
                    setIsAddingNewMember(false);
                  }}
                  className={`flex items-center gap-2.5 p-2.5 rounded-xl border text-left transition-all ${
                    isSelected
                      ? 'border-emerald-500 bg-emerald-50/80 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200 ring-2 ring-emerald-500/20'
                      : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:border-slate-300'
                  }`}
                >
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                    style={{ backgroundColor: m.avatarColor || '#059669' }}
                  >
                    {m.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold truncate">{m.name}</p>
                    <span className="text-[10px] text-slate-400 capitalize">
                      {m.role === 'TREASURER' ? 'Treasurer 👑' : 'Member'}
                    </span>
                  </div>
                  {isSelected && <Check className="w-4 h-4 text-emerald-600 shrink-0" />}
                </button>
              );
            })}

            {/* Custom / Add New Member Button */}
            <button
              type="button"
              onClick={() => setIsAddingNewMember(true)}
              className={`flex items-center gap-2 p-2.5 rounded-xl border text-left transition-all ${
                isAddingNewMember
                  ? 'border-emerald-500 bg-emerald-50/80 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200 ring-2 ring-emerald-500/20'
                  : 'border-dashed border-slate-300 dark:border-slate-700 bg-transparent text-slate-600 dark:text-slate-400 hover:border-slate-400'
              }`}
            >
              <div className="w-7 h-7 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-500 shrink-0">
                <UserPlus className="w-3.5 h-3.5" />
              </div>
              <span className="text-xs font-medium">+ Add My Name</span>
            </button>
          </div>

          {/* New Member Name Input */}
          {isAddingNewMember && (
            <div className="pt-2">
              <input
                type="text"
                value={newMemberName}
                onChange={(e) => setNewMemberName(e.target.value)}
                placeholder="Enter your name (e.g. Sam)..."
                autoFocus
                className="w-full rounded-xl border border-emerald-500 bg-white dark:bg-slate-800 px-3.5 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
              />
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 py-3 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isSubmitting || (isAddingNewMember && !newMemberName.trim())}
            className="flex-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 py-3 px-4 text-xs font-semibold text-white shadow-lg shadow-emerald-600/20 flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
          >
            <span>{isExistingTrip ? 'Update & Open Trip' : 'Join & Open Trip'}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
