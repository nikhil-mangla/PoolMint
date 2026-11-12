import React, { useState } from 'react';
import {
  Wallet,
  ArrowUpRight,
  ArrowDownLeft,
  ArrowLeftRight,
  ShieldCheck,
  CheckCircle2,
  Lock,
  Unlock,
  Plus,
  Send,
  Receipt,
  Check,
  X,
  UserCheck,
  Edit3,
  Trash2,
  Share2,
} from 'lucide-react';
import {
  Trip,
  Transaction,
  TripAccountingReport,
  SettlementRecommendation,
  UserRole,
} from '../types/treasury';
import { formatCurrency, fromPaise, toPaise } from '../utils/accounting';

interface DashboardViewProps {
  trip: Trip;
  transactions: Transaction[];
  report: TripAccountingReport;
  currentRole: UserRole;
  activeViewerMemberId: string;
  onChangeViewerMemberId: (memberId: string) => void;
  onQuickAdd: (mode: 'POOL' | 'TRANSFER' | 'EXPENSE', memberId?: string) => void;
  onSelectTransactionToEdit: (tx: Transaction) => void;
  onSettleDebt: (settlement: SettlementRecommendation) => Promise<void>;
  onToggleTripStatus: () => Promise<void>;
  onOpenTripSettings: () => void;
  onOpenInviteModal: () => void;
  onRequestDeleteTrip: () => void;
  onSaveTripInline: (updatedTrip: Trip) => Promise<void>;
  onAddMemberInline: (name: string) => Promise<string | null>;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  trip,
  transactions,
  report,
  currentRole,
  activeViewerMemberId,
  onChangeViewerMemberId,
  onQuickAdd,
  onSelectTransactionToEdit,
  onSettleDebt,
  onToggleTripStatus,
  onOpenTripSettings,
  onOpenInviteModal,
  onRequestDeleteTrip,
  onSaveTripInline,
  onAddMemberInline,
}) => {
  const [showClosingModal, setShowClosingModal] = useState(false);
  const [settlingIndex, setSettlingIndex] = useState<number | null>(null);

  // Inline Trip Header Editing State
  const [isEditingHeader, setIsEditingHeader] = useState(false);
  const [editTripName, setEditTripName] = useState(trip.name);
  const [editDestination, setEditDestination] = useState(trip.destination);
  const [editBudget, setEditBudget] = useState(String(fromPaise(trip.budgetPaise)));

  // Inline Member Editing & Adding State
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [editingMemberName, setEditingMemberName] = useState('');
  const [newFriendName, setNewFriendName] = useState('');

  const c = trip.currency;
  const canManage = currentRole === 'ADMIN' || currentRole === 'TREASURER';

  const activeViewerSummary =
    report.memberSummaries.find((m) => m.memberId === activeViewerMemberId) ||
    report.memberSummaries[0];

  const tripTransactions = transactions.filter(
    (tx) => tx.tripId === trip.id && !tx.isReversed && tx.type !== 'REVERSAL'
  );
  const memberNameMap = new Map(trip.members.map((m) => [m.id, m.name]));

  const poolRemainingPct =
    report.totalContributionsPaise > 0
      ? Math.max(
          0,
          Math.min(
            100,
            Math.round((report.totalPoolBalancePaise / report.totalContributionsPaise) * 100)
          )
        )
      : 0;

  const handleSettle = async (s: SettlementRecommendation, idx: number) => {
    setSettlingIndex(idx);
    try {
      await onSettleDebt(s);
    } finally {
      setSettlingIndex(null);
    }
  };

  const handleSaveInlineHeader = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTripName.trim()) return;
    await onSaveTripInline({
      ...trip,
      name: editTripName.trim(),
      destination: editDestination.trim() || trip.destination,
      budgetPaise: toPaise(editBudget),
      updatedAt: new Date().toISOString(),
      syncStatus: 'PENDING',
    });
    setIsEditingHeader(false);
  };

  const handleSaveMemberName = async (memberId: string) => {
    const trimmed = editingMemberName.trim();
    if (!trimmed) {
      setEditingMemberId(null);
      return;
    }
    const updatedMembers = trip.members.map((m) =>
      m.id === memberId ? { ...m, name: trimmed } : m
    );
    await onSaveTripInline({
      ...trip,
      members: updatedMembers,
      updatedAt: new Date().toISOString(),
      syncStatus: 'PENDING',
    });
    setEditingMemberId(null);
  };

  const handleAppointTreasurer = async (memberId: string) => {
    const updatedMembers = trip.members.map((m) => ({
      ...m,
      role:
        m.id === memberId
          ? ('TREASURER' as const)
          : m.role === 'ADMIN'
            ? ('ADMIN' as const)
            : ('MEMBER' as const),
    }));
    await onSaveTripInline({
      ...trip,
      treasurerMemberId: memberId,
      members: updatedMembers,
      updatedAt: new Date().toISOString(),
      syncStatus: 'PENDING',
    });
  };

  const handleRemoveMemberInline = async (memberId: string) => {
    if (trip.members.length <= 2) return;
    const remaining = trip.members.filter((m) => m.id !== memberId);
    const nextTreasurer =
      trip.treasurerMemberId === memberId ? remaining[0].id : trip.treasurerMemberId;
    await onSaveTripInline({
      ...trip,
      treasurerMemberId: nextTreasurer,
      members: remaining.map((m) => ({
        ...m,
        role: m.id === nextTreasurer ? ('TREASURER' as const) : m.role,
      })),
      updatedAt: new Date().toISOString(),
      syncStatus: 'PENDING',
    });
  };

  const handleAddFriendSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFriendName.trim()) return;
    await onAddMemberInline(newFriendName.trim());
    setNewFriendName('');
  };

  return (
    <div className="space-y-6 pb-8">
      {/* TRACKMYSHARE-STYLE EDITABLE TRIP HEADER + PERSONAL BALANCE + POOL WALLET HERO */}
      <section className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 sm:p-6 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="space-y-1 flex-1">
            {isEditingHeader ? (
              <form
                onSubmit={handleSaveInlineHeader}
                className="grid grid-cols-1 sm:grid-cols-4 gap-2.5 bg-slate-50 dark:bg-slate-800/70 p-3 rounded-xl border border-slate-200 dark:border-slate-700"
              >
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-0.5">
                    Trip Name
                  </label>
                  <input
                    type="text"
                    value={editTripName}
                    onChange={(e) => setEditTripName(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-sm font-bold"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-0.5">
                    Destination
                  </label>
                  <input
                    type="text"
                    value={editDestination}
                    onChange={(e) => setEditDestination(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-0.5">
                    Trip Budget ({c})
                  </label>
                  <input
                    type="number"
                    value={editBudget}
                    onChange={(e) => setEditBudget(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-sm font-mono"
                  />
                </div>
                <div className="flex items-end gap-2">
                  <button
                    type="submit"
                    className="rounded-lg bg-emerald-600 hover:bg-emerald-500 px-3.5 py-2 text-xs font-semibold text-white"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsEditingHeader(false)}
                    className="rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 text-xs font-semibold"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <span>🧳 {trip.destination}</span>
                  <span aria-hidden="true">·</span>
                  <span>{trip.members.length} travellers</span>
                  <span aria-hidden="true">·</span>
                  <span>{c}</span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {trip.startDate} to {trip.endDate}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setEditTripName(trip.name);
                      setEditDestination(trip.destination);
                      setEditBudget(String(fromPaise(trip.budgetPaise)));
                      setIsEditingHeader(true);
                    }}
                    className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold hover:underline ml-1"
                  >
                    <Edit3 className="w-3 h-3" />
                    <span>Edit Title &amp; Budget</span>
                  </button>
                  <span aria-hidden="true">·</span>
                  <button
                    type="button"
                    onClick={onRequestDeleteTrip}
                    className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400 font-semibold hover:underline"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>Delete Trip</span>
                  </button>
                </div>
                <div className="flex items-center gap-2.5 flex-wrap">
                  <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
                    {trip.name}
                  </h1>
                  <button
                    type="button"
                    onClick={onOpenInviteModal}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 dark:text-slate-200"
                  >
                    <Share2 className="w-3.5 h-3.5 text-emerald-600" />
                    <span>🔗 Invite &amp; PIN</span>
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Primary Action Buttons */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => onQuickAdd('EXPENSE')}
              disabled={trip.status === 'CLOSED'}
              className="flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-4 py-2.5 text-xs font-semibold text-white transition-colors whitespace-nowrap min-h-[42px]"
            >
              <Receipt className="w-4 h-4" />
              <span>+ Add Expense</span>
            </button>
            <button
              type="button"
              onClick={() => onQuickAdd('POOL')}
              disabled={trip.status === 'CLOSED'}
              className="flex items-center gap-1.5 rounded-xl bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 dark:hover:bg-slate-700 disabled:opacity-50 px-4 py-2.5 text-xs font-semibold text-white transition-colors whitespace-nowrap min-h-[42px]"
            >
              <Plus className="w-4 h-4 text-emerald-400" />
              <span>+ Add to Pool</span>
            </button>
            <button
              type="button"
              onClick={() => onQuickAdd('TRANSFER')}
              disabled={trip.status === 'CLOSED'}
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 px-3.5 py-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200 transition-colors whitespace-nowrap min-h-[42px]"
            >
              <Send className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <span>Transfer</span>
            </button>
            <button
              type="button"
              onClick={() => setShowClosingModal(true)}
              className="flex items-center gap-1.5 rounded-xl border border-amber-300 dark:border-amber-700/70 bg-amber-50/70 dark:bg-amber-950/30 hover:bg-amber-100/70 px-3.5 py-2.5 text-xs font-semibold text-amber-800 dark:text-amber-300 transition-colors whitespace-nowrap min-h-[42px]"
            >
              {trip.status === 'CLOSED' ? (
                <Unlock className="w-4 h-4" />
              ) : (
                <Lock className="w-4 h-4" />
              )}
              <span>{trip.status === 'CLOSED' ? 'Final Report' : 'Close Trip'}</span>
            </button>
            <button
              type="button"
              onClick={onRequestDeleteTrip}
              aria-label="Delete whole trip"
              className="flex items-center gap-1.5 rounded-xl border border-rose-200 dark:border-rose-800/70 bg-rose-50/70 dark:bg-rose-950/30 hover:bg-rose-100/80 px-3 py-2.5 text-xs font-semibold text-rose-600 dark:text-rose-400 transition-colors whitespace-nowrap min-h-[42px]"
            >
              <Trash2 className="w-4 h-4" />
              <span>Delete Trip</span>
            </button>
          </div>
        </div>

        {/* TRACKMYSHARE "WHO ARE YOU?" VIEWER BAR + PERSONAL BALANCE CARD */}
        <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 mr-1">
              Viewing as:
            </span>
            {trip.members.map((m) => {
              const isSelected = m.id === activeViewerSummary?.memberId;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => onChangeViewerMemberId(m.id)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                    isSelected
                      ? 'bg-slate-900 dark:bg-emerald-600 text-white'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200'
                  }`}
                >
                  {m.name}
                  {m.id === trip.treasurerMemberId ? ' ★' : ''}
                </button>
              );
            })}
          </div>

          {activeViewerSummary && (
            <div
              className={`rounded-xl px-4 py-2.5 border flex items-center justify-between gap-4 ${
                activeViewerSummary.netBalancePaise > 0
                  ? 'bg-emerald-50/80 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/70'
                  : activeViewerSummary.netBalancePaise < 0
                    ? 'bg-rose-50/80 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800/70'
                    : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700'
              }`}
            >
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  {activeViewerSummary.memberName}’s Balance
                </p>
                <p
                  className={`text-sm font-bold font-mono ${
                    activeViewerSummary.netBalancePaise > 0
                      ? 'text-emerald-700 dark:text-emerald-300'
                      : activeViewerSummary.netBalancePaise < 0
                        ? 'text-rose-700 dark:text-rose-300'
                        : 'text-slate-700 dark:text-slate-200'
                  }`}
                >
                  {activeViewerSummary.netBalancePaise > 0
                    ? `You get back ${formatCurrency(activeViewerSummary.netBalancePaise, c)} (Pool/Group owes you)`
                    : activeViewerSummary.netBalancePaise < 0
                      ? `You owe ${formatCurrency(Math.abs(activeViewerSummary.netBalancePaise), c)}`
                      : "You're all square 🎉"}
                </p>
              </div>
              <div className="text-right text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                <div>Pool In: {formatCurrency(activeViewerSummary.contributedToPoolPaise, c)}</div>
                <div>Share: {formatCurrency(activeViewerSummary.allocatedExpenseSharePaise, c)}</div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* LIVE GROUP POOL TREASURY WALLET ("HOW MUCH MONEY WE HAVE") + SUMMARY CARDS */}
      <section aria-label="Financial Summary Metrics" className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Prominent Common Pool Wallet Hero Card */}
        <div className="lg:col-span-5 rounded-2xl bg-slate-900 dark:bg-emerald-950/80 border border-slate-800 dark:border-emerald-800/70 p-5 text-white flex flex-col justify-between shadow-lg">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
                💰 Common Pool Money We Have Now
              </span>
              <Wallet className="w-5 h-5 text-emerald-400" />
            </div>
            <div className="mt-2 flex items-baseline justify-between gap-2">
              <p
                data-testid="metric-pool-balance"
                className="text-3xl sm:text-4xl font-bold font-mono tabular-nums tracking-tight text-white"
              >
                {formatCurrency(report.totalPoolBalancePaise, c)}
              </p>
              <span className="text-xs font-mono text-emerald-300">
                {poolRemainingPct}% of pool left
              </span>
            </div>

            {/* Pool Balance Visual Progress Bar */}
            <div className="mt-3 w-full h-2.5 rounded-full bg-slate-800 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  report.totalPoolBalancePaise < 0 ? 'bg-rose-500' : 'bg-emerald-400'
                }`}
                style={{ width: `${poolRemainingPct}%` }}
              />
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2 pt-3 border-t border-slate-800/90 text-xs">
              <div>
                <p className="text-slate-400 text-[11px]">Pool Collected</p>
                <p
                  data-testid="metric-total-contributions"
                  className="font-mono font-bold text-emerald-400 mt-0.5"
                >
                  +{formatCurrency(report.totalContributionsPaise, c)}
                </p>
              </div>
              <div>
                <p className="text-slate-400 text-[11px]">Spent from Pool</p>
                <p className="font-mono font-bold text-rose-400 mt-0.5">
                  &minus;{formatCurrency(report.totalPoolExpensesPaise, c)}
                </p>
              </div>
              <div>
                <p className="text-slate-400 text-[11px]">Held By</p>
                <p className="font-semibold text-white truncate mt-0.5">
                  {report.treasurer.treasurerName}
                </p>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-300">
            <span>
              Cash in Hand: <strong className="font-mono text-white">{formatCurrency(report.treasurer.cashInHandPaise, c)}</strong>
              {' · '}
              UPI/Bank: <strong className="font-mono text-white">{formatCurrency(report.treasurer.digitalInHandPaise, c)}</strong>
            </span>
            <button
              type="button"
              onClick={() => onQuickAdd('POOL')}
              className="text-emerald-400 hover:underline font-semibold"
            >
              + Top Up Pool &rarr;
            </button>
          </div>
        </div>

        {/* 4 Secondary Financial Metrics */}
        <div className="lg:col-span-7 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-2 gap-3.5">
          {/* Total Expenses */}
          <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 flex flex-col justify-between">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>Total Trip Expenses</span>
              <ArrowUpRight className="w-4 h-4 text-rose-600 dark:text-rose-400" />
            </div>
            <div className="mt-2">
              <p
                data-testid="metric-total-expenses"
                className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-rose-600 dark:text-rose-400"
              >
                {formatCurrency(report.totalExpensesPaise, c)}
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Pool: {formatCurrency(report.totalPoolExpensesPaise, c)} · Personal:{' '}
                {formatCurrency(report.totalPersonalExpensesPaise, c)}
              </p>
            </div>
          </div>

          {/* Remaining Budget */}
          <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 flex flex-col justify-between">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>Remaining Trip Budget</span>
              <span className="font-mono text-xs text-slate-600 dark:text-slate-300">
                {report.budgetUtilizationPercent}% used
              </span>
            </div>
            <div className="mt-2">
              <p
                data-testid="metric-remaining-budget"
                className={`text-xl sm:text-2xl font-bold font-mono tabular-nums ${
                  report.remainingBudgetPaise >= 0
                    ? 'text-slate-900 dark:text-white'
                    : 'text-rose-600 dark:text-rose-400'
                }`}
              >
                {formatCurrency(report.remainingBudgetPaise, c)}
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {trip.budgetPaise > 0
                  ? `Of ${formatCurrency(trip.budgetPaise, c)} planned budget`
                  : 'Based on active pool'}
              </p>
            </div>
          </div>

          {/* Total Transfers */}
          <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 flex flex-col justify-between">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>Peer Transfers</span>
              <ArrowLeftRight className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="mt-2">
              <p
                data-testid="metric-total-transfers"
                className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-blue-600 dark:text-blue-400"
              >
                {formatCurrency(report.totalTransfersPaise, c)}
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Direct member-to-member transfers
              </p>
            </div>
          </div>

          {/* Treasurer Desk Summary */}
          <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 flex flex-col justify-between">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>Treasurer ({report.treasurer.treasurerName})</span>
              <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="mt-2">
              <p className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                {formatCurrency(report.treasurer.currentPoolBalancePaise, c)}
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {report.treasurer.transactionsManagedCount} transactions · Out-of-pocket:{' '}
                {formatCurrency(report.treasurer.treasurerPersonalSpentPaise, c)}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* TRACKMYSHARE-STYLE 2-COLUMN WORKSPACE: LATEST EDITABLE TRANSACTIONS + SETTLE UP */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* LEFT 7 COLS: LATEST TRANSACTIONS (CLICK ANY TO EDIT / DELETE) */}
        <section
          aria-labelledby="latest-activity-heading"
          className="lg:col-span-7 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 sm:p-6"
        >
          <div className="flex items-center justify-between gap-2 pb-4 border-b border-slate-100 dark:border-slate-800">
            <div>
              <h2
                id="latest-activity-heading"
                className="text-lg font-bold text-slate-900 dark:text-white"
              >
                Latest Expenses, Pool Deposits &amp; Transfers ({tripTransactions.length})
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Click any item below to edit amount, payer, pool vs personal source, or member splits
              </p>
            </div>
            <button
              type="button"
              onClick={() => onQuickAdd('EXPENSE')}
              className="rounded-xl bg-emerald-600 hover:bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white shrink-0"
            >
              + Add New
            </button>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[420px] overflow-y-auto pr-1 mt-1">
            {tripTransactions.length === 0 ? (
              <p className="py-10 text-center text-xs text-slate-500">
                No transactions yet — tap + Add Expense or + Add to Pool to start.
              </p>
            ) : (
              tripTransactions.map((tx) => {
                const isExpense = tx.type === 'EXPENSE';
                const isContrib = tx.type === 'CONTRIBUTION';
                const payerLabel = isExpense
                  ? tx.paymentSource === 'POOL'
                    ? `💰 Common Pool (${report.treasurer.treasurerName})`
                    : `👤 ${memberNameMap.get(tx.paidByMemberId || '') || 'Member'} (Personal)`
                  : isContrib
                    ? `${memberNameMap.get(tx.fromMemberId || '') || 'Member'} → Common Pool`
                    : `${memberNameMap.get(tx.fromMemberId || '') || 'Pool'} → ${
                        memberNameMap.get(tx.toMemberId || '') || 'Member'
                      }`;

                return (
                  <div
                    key={tx.id}
                    onClick={() => onSelectTransactionToEdit(tx)}
                    className="py-3.5 px-2 -mx-2 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/60 cursor-pointer transition-colors flex items-center justify-between gap-3 group"
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <div
                        className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                          isContrib
                            ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400'
                            : isExpense
                              ? 'bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400'
                              : 'bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400'
                        }`}
                      >
                        {isContrib ? (
                          <ArrowDownLeft className="w-4 h-4" />
                        ) : isExpense ? (
                          <ArrowUpRight className="w-4 h-4" />
                        ) : (
                          <ArrowLeftRight className="w-4 h-4" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-bold text-slate-900 dark:text-white truncate">
                            {tx.title}
                          </p>
                          <span className="text-[11px] text-emerald-600 dark:text-emerald-400 opacity-80 group-hover:opacity-100 inline-flex items-center gap-0.5 font-semibold">
                            <Edit3 className="w-3 h-3" />
                            <span>Edit</span>
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                          {payerLabel} · {tx.paymentMethod} · {tx.dateTime.slice(0, 10)}
                        </p>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <p
                        className={`text-sm font-bold font-mono tabular-nums ${
                          isContrib
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : isExpense
                              ? 'text-rose-600 dark:text-rose-400'
                              : 'text-blue-600 dark:text-blue-400'
                        }`}
                      >
                        {isContrib ? '+' : isExpense ? '−' : ''}
                        {formatCurrency(tx.amountPaise, c)}
                      </p>
                      <p className="text-[11px] text-slate-400">
                        {isExpense && tx.paymentSource === 'POOL'
                          ? 'From Pool'
                          : isContrib
                            ? 'Added to Pool'
                            : tx.type}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* RIGHT 5 COLS: SETTLE UP & REFUND CALCULATOR */}
        <section
          aria-labelledby="settlement-calculator-heading"
          className="lg:col-span-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 sm:p-6 flex flex-col justify-between"
        >
          <div>
            <div className="flex items-center justify-between gap-2 pb-4 border-b border-slate-100 dark:border-slate-800">
              <div>
                <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                  TrackMyShare-Style Settle Up Plan
                </p>
                <h2
                  id="settlement-calculator-heading"
                  className="text-lg font-bold text-slate-900 dark:text-white mt-0.5"
                >
                  Settle Up &amp; Pool Refunds
                </h2>
              </div>
              <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
                {report.settlements.length} pending
              </span>
            </div>

            <div className="mt-4 space-y-2.5 max-h-80 overflow-y-auto pr-1">
              {report.settlements.length === 0 ? (
                <div className="py-8 text-center">
                  <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">
                    Everyone is 100% Settled!
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    All group expenses, contributions, and pool refunds are balanced to zero.
                  </p>
                </div>
              ) : (
                report.settlements.map((s, idx) => (
                  <div
                    key={`${s.fromMemberId}-${s.toMemberId}-${idx}`}
                    className="flex items-center justify-between gap-3 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-3"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                        {s.isPoolRefund ? (
                          <>
                            <span className="text-emerald-600 dark:text-emerald-400">
                              Common Pool
                            </span>{' '}
                            &rarr;{' '}
                            <span className="text-emerald-600 dark:text-emerald-400">
                              {s.toMemberName}
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="text-amber-600 dark:text-amber-400">
                              {s.fromMemberName}
                            </span>{' '}
                            &rarr;{' '}
                            <span className="text-emerald-600 dark:text-emerald-400">
                              {s.toMemberName}
                            </span>
                          </>
                        )}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                        {s.isPoolRefund
                          ? `Pool refund from ${s.fromMemberName}`
                          : 'Direct settlement'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2.5 shrink-0">
                      <span className="text-sm font-bold font-mono tabular-nums text-amber-600 dark:text-amber-400">
                        {formatCurrency(s.amountPaise, c)}
                      </span>
                      {canManage && (
                        <button
                          type="button"
                          disabled={settlingIndex === idx}
                          onClick={() => handleSettle(s, idx)}
                          className="flex items-center gap-1 rounded-lg bg-slate-900 dark:bg-emerald-600 hover:opacity-90 px-2.5 py-1.5 text-[11px] font-semibold text-white transition-opacity whitespace-nowrap min-h-[34px]"
                        >
                          <Check className="w-3 h-3" />
                          <span>Settle</span>
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <p className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400">
            Clicking Settle records a verified settlement or pool refund entry in the ledger.
          </p>
        </section>
      </div>

      {/* EDITABLE MEMBER SECTION (RENAME, APPOINT TREASURER, ADD FRIEND, QUICK POOL/EXPENSE) */}
      <section
        aria-labelledby="member-balances-heading"
        className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 sm:p-6"
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h2
              id="member-balances-heading"
              className="text-lg font-bold text-slate-900 dark:text-white"
            >
              Group Travellers &amp; Pool Balances ({report.memberSummaries.length} Friends — All Editable)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Rename any friend, switch the appointed Treasurer, or add money to the pool directly from any card
            </p>
          </div>

          {/* Inline Add Traveller Form */}
          <form onSubmit={handleAddFriendSubmit} className="flex items-center gap-2">
            <input
              type="text"
              value={newFriendName}
              onChange={(e) => setNewFriendName(e.target.value)}
              placeholder="+ Add traveller name..."
              className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-white"
            />
            <button
              type="submit"
              className="rounded-xl bg-slate-900 dark:bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white whitespace-nowrap"
            >
              + Add Person
            </button>
          </form>
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {report.memberSummaries.map((m) => {
            const initials = m.memberName
              .split(' ')
              .map((p) => p[0])
              .join('')
              .slice(0, 2)
              .toUpperCase();
            const isPositive = m.netBalancePaise > 0;
            const isNegative = m.netBalancePaise < 0;
            const isEditingThisMember = editingMemberId === m.memberId;

            return (
              <div
                key={m.memberId}
                className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 flex flex-col justify-between hover:border-slate-300 dark:hover:border-slate-700 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0"
                      style={{ backgroundColor: m.avatarColor || '#059669' }}
                    >
                      {initials}
                    </div>
                    <div className="min-w-0 flex-1">
                      {isEditingThisMember ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            type="text"
                            autoFocus
                            value={editingMemberName}
                            onChange={(e) => setEditingMemberName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveMemberName(m.memberId);
                            }}
                            className="w-full rounded-lg border border-emerald-500 bg-white dark:bg-slate-800 px-2 py-1 text-xs font-bold"
                          />
                          <button
                            type="button"
                            onClick={() => handleSaveMemberName(m.memberId)}
                            className="rounded-lg bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white"
                          >
                            Save
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <h3 className="text-sm font-bold text-slate-900 dark:text-white truncate">
                            {m.memberName}
                          </h3>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingMemberId(m.memberId);
                              setEditingMemberName(m.memberName);
                            }}
                            aria-label={`Rename ${m.memberName}`}
                            className="text-slate-400 hover:text-emerald-600 p-0.5"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                      <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        {m.role === 'TREASURER' ? (
                          <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                            ★ Appointed Treasurer
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleAppointTreasurer(m.memberId)}
                            className="hover:underline text-[11px] text-slate-500 hover:text-emerald-600"
                          >
                            Make Treasurer
                          </button>
                        )}
                        {trip.members.length > 2 && m.role !== 'TREASURER' && (
                          <button
                            type="button"
                            onClick={() => handleRemoveMemberInline(m.memberId)}
                            aria-label={`Remove ${m.memberName}`}
                            className="text-slate-400 hover:text-rose-500 ml-auto"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <p
                      className={`text-base font-bold font-mono tabular-nums ${
                        isPositive
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : isNegative
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      {formatCurrency(m.netBalancePaise, c, true)}
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      {isPositive
                        ? 'Gets Back / Refund'
                        : isNegative
                          ? 'Owes Group'
                          : 'Settled'}
                    </p>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">Pool Put In</p>
                    <p className="font-mono font-semibold text-emerald-600 dark:text-emerald-400 mt-0.5">
                      {formatCurrency(m.contributedToPoolPaise, c)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">Personal Paid</p>
                    <p className="font-mono font-semibold text-blue-600 dark:text-blue-400 mt-0.5">
                      {formatCurrency(m.personalExpensesPaidPaise, c)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">Expense Share</p>
                    <p className="font-mono font-semibold text-rose-600 dark:text-rose-400 mt-0.5">
                      {formatCurrency(m.allocatedExpenseSharePaise, c)}
                    </p>
                  </div>
                </div>

                {/* Quick 1-Tap Member Actions */}
                <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800/70 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => onQuickAdd('POOL', m.memberId)}
                    className="flex-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 py-1.5 px-2.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 transition-colors"
                  >
                    + Add to Pool
                  </button>
                  <button
                    type="button"
                    onClick={() => onQuickAdd('EXPENSE', m.memberId)}
                    className="flex-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 py-1.5 px-2.5 text-[11px] font-semibold text-slate-700 dark:text-slate-200 transition-colors"
                  >
                    + Paid Expense
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* TRIP CLOSING & FINAL POOL DISTRIBUTION MODAL */}
      {showClosingModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="closing-workflow-title"
        >
          <div className="w-full max-w-2xl rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-xl my-8">
            <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
              <div>
                <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
                  Trip Closing &amp; Unused Pool Refund Calculator
                </p>
                <h2
                  id="closing-workflow-title"
                  className="text-xl font-bold text-slate-900 dark:text-white mt-0.5"
                >
                  {trip.name} — Final Treasury Statement
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setShowClosingModal(false)}
                aria-label="Close final settlement modal"
                className="p-2 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-3 my-4">
              <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 p-3.5 border border-slate-200/70 dark:border-slate-700/60">
                <p className="text-xs text-slate-500 dark:text-slate-400">Total Contributions</p>
                <p className="text-lg font-bold font-mono text-emerald-600 dark:text-emerald-400 mt-1">
                  {formatCurrency(report.totalContributionsPaise, c)}
                </p>
              </div>
              <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 p-3.5 border border-slate-200/70 dark:border-slate-700/60">
                <p className="text-xs text-slate-500 dark:text-slate-400">Total Trip Expenses</p>
                <p className="text-lg font-bold font-mono text-rose-600 dark:text-rose-400 mt-1">
                  {formatCurrency(report.totalExpensesPaise, c)}
                </p>
              </div>
              <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 p-3.5 border border-slate-200/70 dark:border-slate-700/60">
                <p className="text-xs text-slate-500 dark:text-slate-400">Remaining Common Pool</p>
                <p className="text-lg font-bold font-mono text-slate-900 dark:text-white mt-1">
                  {formatCurrency(report.totalPoolBalancePaise, c)}
                </p>
              </div>
            </div>

            <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-300 mt-4 mb-2">
              Member-by-Member Final Refund / Amount Owed Breakdown
            </h3>
            <div className="divide-y divide-slate-200 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
              {report.poolRefundDistribution.map((item) => (
                <div
                  key={item.memberId}
                  className="flex items-center justify-between px-4 py-3 text-xs bg-white dark:bg-slate-900"
                >
                  <div className="flex items-center gap-2 font-semibold text-slate-900 dark:text-white">
                    <UserCheck className="w-4 h-4 text-slate-400" />
                    <span>{item.memberName}</span>
                  </div>
                  <div className="font-mono font-semibold">
                    {item.refundDuePaise > 0 ? (
                      <span className="text-emerald-600 dark:text-emerald-400">
                        Refund Due: +{formatCurrency(item.refundDuePaise, c)}
                      </span>
                    ) : item.amountOwedToPoolPaise > 0 ? (
                      <span className="text-amber-600 dark:text-amber-400">
                        Owes Group: &minus;{formatCurrency(item.amountOwedToPoolPaise, c)}
                      </span>
                    ) : (
                      <span className="text-slate-500">Settled (₹0)</span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-slate-200 dark:border-slate-800">
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Final Settlement Status:{' '}
                <strong className="text-slate-900 dark:text-white">
                  {report.settlements.length === 0
                    ? 'All Balances Settled'
                    : `${report.settlements.length} Settlement(s) Remaining`}
                </strong>
              </div>
              <div className="flex items-center gap-2.5">
                {canManage && (
                  <button
                    type="button"
                    onClick={async () => {
                      await onToggleTripStatus();
                      setShowClosingModal(false);
                    }}
                    className="rounded-xl bg-amber-600 hover:bg-amber-500 px-4 py-2.5 text-xs font-semibold text-white transition-colors"
                  >
                    {trip.status === 'CLOSED'
                      ? 'Reopen Trip for Edits'
                      : 'Lock & Close Trip'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowClosingModal(false)}
                  className="rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-2.5 text-xs font-semibold text-slate-700 dark:text-slate-300"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
