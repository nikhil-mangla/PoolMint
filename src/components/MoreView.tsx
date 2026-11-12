import React, { useState, useMemo, useEffect } from 'react';
import {
  Search,
  RotateCcw,
  Edit3,
  FileSpreadsheet,
  FileText,
  Download,
  Upload,
  Shield,
  Cloud,
  RefreshCw,
  LogOut,
  History,
  BarChart3,
  CheckCircle2,
  X,
  Lock,
  Database,
  AlertTriangle,
} from 'lucide-react';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  AreaChart,
  Area,
} from 'recharts';
import {
  Trip,
  Transaction,
  AuditLog,
  TripAccountingReport,
  UserRole,
  SyncStateLabel,
  SyncIndicatorColor,
  DexieTableDiagnostics,
} from '../types/treasury';
import { formatCurrency, fromPaise, toPaise } from '../utils/accounting';
import { exportTripToCSV, exportTripToPDF } from '../utils/exportReports';
import { getDexieTableDiagnostics } from '../services/indexedDb';

interface MoreViewProps {
  trip: Trip;
  allTrips: Trip[];
  transactions: Transaction[];
  auditLogs: AuditLog[];
  report: TripAccountingReport;
  currentRole: UserRole;
  onChangeRole: (role: UserRole) => void;
  onReverseTransaction: (tx: Transaction, reason: string) => Promise<void>;
  onEditTransaction: (
    tx: Transaction,
    updates: { title: string; amountPaise: number; notes: string }
  ) => Promise<void>;
  onRestoreBackup: (rawPayload: any) => Promise<{
    importedTripsCount: number;
    importedTransactionsCount: number;
    skippedDuplicatesCount: number;
  }>;
  syncStateLabel: SyncStateLabel;
  syncIndicatorColor: SyncIndicatorColor;
  lastSyncedAt: string | null;
  pendingSyncCount: number;
  cloudUserEmail: string | null;
  onSignInCloud: () => Promise<void>;
  onSignOutCloud: () => Promise<void>;
  onManualSync: () => Promise<void>;
  hasPinConfigured: boolean;
  onConfigurePin: (newPin: string | null) => Promise<void>;
  onLockNow: () => void;
}

const CHART_COLORS = [
  '#10B981',
  '#3B82F6',
  '#F59E0B',
  '#EC4899',
  '#8B5CF6',
  '#EF4444',
  '#14B8A6',
  '#6366F1',
];

export const MoreView: React.FC<MoreViewProps> = ({
  trip,
  allTrips,
  transactions,
  auditLogs,
  report,
  currentRole,
  onChangeRole,
  onReverseTransaction,
  onEditTransaction,
  onRestoreBackup,
  syncStateLabel,
  syncIndicatorColor,
  lastSyncedAt,
  pendingSyncCount,
  cloudUserEmail,
  onSignInCloud,
  onSignOutCloud,
  onManualSync,
  hasPinConfigured,
  onConfigurePin,
  onLockNow,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'LEDGER' | 'ANALYTICS' | 'SECURITY'>('LEDGER');
  const [ledgerFilter, setLedgerFilter] = useState<
    'ALL' | 'POOL' | 'TRANSFERS' | 'EXPENSES' | 'SETTLEMENTS' | 'CONTRIBUTIONS' | 'REFUNDS'
  >('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [showAuditLog, setShowAuditLog] = useState(false);

  // Edit Transaction Modal State
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editNotes, setEditNotes] = useState('');

  // PIN & Backup State
  const [pinInput, setPinInput] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [dexieCounts, setDexieCounts] = useState<DexieTableDiagnostics | null>(null);

  useEffect(() => {
    getDexieTableDiagnostics().then(setDexieCounts).catch(() => {});
  }, [allTrips, transactions, auditLogs, activeSubTab]);

  const c = trip.currency;
  const canManage = currentRole === 'ADMIN' || currentRole === 'TREASURER';
  const memberNameMap = useMemo(
    () => new Map(trip.members.map((m) => [m.id, m.name])),
    [trip.members]
  );

  const tripTransactions = useMemo(
    () => transactions.filter((tx) => tx.tripId === trip.id),
    [transactions, trip.id]
  );

  const filteredTransactions = useMemo(() => {
    return tripTransactions.filter((tx) => {
      if (ledgerFilter === 'POOL') {
        if (
          tx.type !== 'CONTRIBUTION' &&
          tx.type !== 'REFUND' &&
          !(tx.type === 'EXPENSE' && tx.paymentSource === 'POOL')
        ) {
          return false;
        }
      } else if (ledgerFilter === 'TRANSFERS' && tx.type !== 'TRANSFER') {
        return false;
      } else if (ledgerFilter === 'EXPENSES' && tx.type !== 'EXPENSE') {
        return false;
      } else if (ledgerFilter === 'SETTLEMENTS' && tx.type !== 'SETTLEMENT') {
        return false;
      } else if (ledgerFilter === 'CONTRIBUTIONS' && tx.type !== 'CONTRIBUTION') {
        return false;
      } else if (ledgerFilter === 'REFUNDS' && tx.type !== 'REFUND') {
        return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const involvedName =
          (tx.fromMemberId && memberNameMap.get(tx.fromMemberId)) ||
          (tx.paidByMemberId && memberNameMap.get(tx.paidByMemberId)) ||
          (tx.toMemberId && memberNameMap.get(tx.toMemberId)) ||
          '';
        const match =
          tx.title.toLowerCase().includes(q) ||
          (tx.notes || '').toLowerCase().includes(q) ||
          (tx.category || '').toLowerCase().includes(q) ||
          involvedName.toLowerCase().includes(q) ||
          tx.type.toLowerCase().includes(q);
        if (!match) return false;
      }

      return true;
    });
  }, [tripTransactions, ledgerFilter, searchQuery, memberNameMap]);

  const categoryChartData = useMemo(() => {
    const map = new Map<string, number>();
    for (const tx of tripTransactions) {
      if (tx.type === 'EXPENSE' && !tx.isReversed) {
        const cat = tx.category || 'Miscellaneous';
        map.set(cat, (map.get(cat) || 0) + tx.amountPaise);
      }
    }
    return Array.from(map.entries())
      .map(([name, paise]) => ({
        name,
        amount: fromPaise(paise),
        paise,
      }))
      .sort((a, b) => b.amount - a.amount);
  }, [tripTransactions]);

  const memberBarData = useMemo(() => {
    return report.memberSummaries.map((m) => ({
      name: m.memberName,
      Contributed: fromPaise(m.contributedToPoolPaise),
      ExpenseShare: fromPaise(m.allocatedExpenseSharePaise),
      PersonalPaid: fromPaise(m.personalExpensesPaidPaise),
    }));
  }, [report.memberSummaries]);

  const dailyAndPoolTimeline = useMemo(() => {
    const chronological = [...tripTransactions]
      .filter((tx) => !tx.isReversed && tx.type !== 'REVERSAL')
      .sort((a, b) => a.dateTime.localeCompare(b.dateTime));

    let runningPoolPaise = 0;
    const byDate = new Map<string, { date: string; spend: number; poolBalance: number }>();

    for (const tx of chronological) {
      const dateKey = tx.dateTime.slice(0, 10);
      if (tx.type === 'CONTRIBUTION') {
        runningPoolPaise += tx.amountPaise;
      } else if (tx.type === 'EXPENSE' && tx.paymentSource === 'POOL') {
        runningPoolPaise -= tx.amountPaise;
      } else if (tx.type === 'REFUND' || tx.type === 'WITHDRAWAL') {
        runningPoolPaise -= tx.amountPaise;
      }

      const existing = byDate.get(dateKey) || {
        date: dateKey,
        spend: 0,
        poolBalance: fromPaise(runningPoolPaise),
      };
      if (tx.type === 'EXPENSE') {
        existing.spend = Math.round((existing.spend + fromPaise(tx.amountPaise)) * 100) / 100;
      }
      existing.poolBalance = fromPaise(runningPoolPaise);
      byDate.set(dateKey, existing);
    }

    return Array.from(byDate.values());
  }, [tripTransactions]);

  const handleOpenEdit = (tx: Transaction) => {
    setEditingTx(tx);
    setEditTitle(tx.title);
    setEditAmount(String(fromPaise(tx.amountPaise)));
    setEditNotes(tx.notes || '');
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTx) return;
    const paise = toPaise(editAmount);
    if (!editTitle.trim() || paise <= 0) return;
    await onEditTransaction(editingTx, {
      title: editTitle.trim(),
      amountPaise: paise,
      notes: editNotes.trim(),
    });
    setEditingTx(null);
  };

  const handleExportBackupJSON = () => {
    setErrorMessage('');
    const backup = {
      schemaVersion: 2,
      application: 'PoolMint Travel Expense & Group Treasury PWA',
      exportedAt: new Date().toISOString(),
      trips: allTrips,
      transactions,
      auditLogs,
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `poolmint-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setStatusMessage(
      `Backup exported (${allTrips.length} trips, ${transactions.length} transactions with unique UUIDs & timestamps).`
    );
  };

  const handleImportBackupJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMessage('');
    setStatusMessage('');
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const result = await onRestoreBackup(parsed);
        setStatusMessage(
          `Backup validated & restored! Imported ${result.importedTripsCount} new trip(s) and ${result.importedTransactionsCount} new transaction(s). Prevented ${result.skippedDuplicatesCount} duplicate record(s).`
        );
      } catch (err: any) {
        setErrorMessage(err.message || 'Invalid backup JSON file.');
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="space-y-6 pb-8">
      {/* Sub-Navigation Segmented Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3">
        <div className="flex items-center gap-1.5 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveSubTab('LEDGER')}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap min-h-[38px] ${
              activeSubTab === 'LEDGER'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
            }`}
          >
            <History className="w-4 h-4" />
            <span>Transaction Ledger &amp; Audit</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab('ANALYTICS')}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap min-h-[38px] ${
              activeSubTab === 'ANALYTICS'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
            }`}
          >
            <BarChart3 className="w-4 h-4" />
            <span>Analytics &amp; Exports</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab('SECURITY')}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap min-h-[38px] ${
              activeSubTab === 'SECURITY'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
            }`}
          >
            <Shield className="w-4 h-4" />
            <span>Backup, Sync &amp; Settings</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => exportTripToCSV(trip, transactions, report)}
            className="flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 transition-colors whitespace-nowrap min-h-[38px]"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
            <span>Download CSV</span>
          </button>
          <button
            type="button"
            onClick={() => exportTripToPDF(trip, transactions, report)}
            className="flex items-center gap-1.5 rounded-xl bg-slate-900 dark:bg-emerald-600 hover:opacity-90 px-3 py-2 text-xs font-semibold text-white transition-opacity whitespace-nowrap min-h-[38px]"
          >
            <FileText className="w-4 h-4" />
            <span>Download PDF</span>
          </button>
        </div>
      </div>

      {/* TAB 1: CHRONOLOGICAL TRANSACTION LEDGER & AUDIT LOG */}
      {activeSubTab === 'LEDGER' && (
        <section className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 sm:p-6 space-y-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 pb-4 border-b border-slate-100 dark:border-slate-800">
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                Chronological Transaction Ledger ({filteredTransactions.length})
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Stored in Dexie.js IndexedDB (`TransactionLedger`) with UUIDs and reversal-only audit protection.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative flex-1 sm:w-64">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="search"
                  aria-label="Search transactions"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search title, member, notes..."
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 pl-9 pr-3 py-2 text-xs text-slate-900 dark:text-white min-h-[38px]"
                />
              </div>
              <button
                type="button"
                onClick={() => setShowAuditLog(!showAuditLog)}
                className="rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap min-h-[38px]"
              >
                {showAuditLog ? 'View Ledger' : `Audit Log (${auditLogs.filter((l) => l.tripId === trip.id).length})`}
              </button>
            </div>
          </div>

          {!showAuditLog && (
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  { id: 'ALL', label: 'All' },
                  { id: 'POOL', label: 'Pool' },
                  { id: 'TRANSFERS', label: 'Transfers' },
                  { id: 'EXPENSES', label: 'Expenses' },
                  { id: 'SETTLEMENTS', label: 'Settlements' },
                  { id: 'CONTRIBUTIONS', label: 'Contributions' },
                  { id: 'REFUNDS', label: 'Refunds' },
                ] as const
              ).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setLedgerFilter(f.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                    ledgerFilter === f.id
                      ? 'bg-slate-900 dark:bg-emerald-600 text-white'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}

          {showAuditLog ? (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {auditLogs
                .filter((l) => l.tripId === trip.id)
                .map((log) => (
                  <div key={log.id} className="py-3 text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-900 dark:text-white">
                        {log.action} · by {log.actorName}
                      </span>
                      <span className="font-mono text-slate-400">
                        {log.timestamp.slice(0, 19).replace('T', ' ')}
                      </span>
                    </div>
                    <p className="text-slate-600 dark:text-slate-400">{log.notes}</p>
                    {log.previousValueJson && (
                      <p className="font-mono text-[11px] text-rose-600 dark:text-rose-400">
                        Before: {log.previousValueJson}
                      </p>
                    )}
                    {log.newValueJson && (
                      <p className="font-mono text-[11px] text-emerald-600 dark:text-emerald-400">
                        After: {log.newValueJson}
                      </p>
                    )}
                  </div>
                ))}
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredTransactions.length === 0 ? (
                <p className="py-10 text-center text-xs text-slate-500">
                  No transactions match the current filter.
                </p>
              ) : (
                filteredTransactions.map((tx) => {
                  const involvedPerson =
                    (tx.fromMemberId && memberNameMap.get(tx.fromMemberId)) ||
                    (tx.paidByMemberId && memberNameMap.get(tx.paidByMemberId)) ||
                    (tx.toMemberId && memberNameMap.get(tx.toMemberId)) ||
                    'Group';
                  const lifecycle =
                    tx.lifecycleStatus || (tx.syncStatus === 'SYNCED' ? 'SYNCED' : 'PENDING_SYNC');

                  return (
                    <div
                      key={tx.id}
                      className={`py-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 ${
                        tx.isReversed || tx.type === 'REVERSAL' ? 'opacity-60' : ''
                      }`}
                    >
                      <div className="space-y-0.5 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={`text-sm font-bold text-slate-900 dark:text-white truncate ${
                              tx.isReversed ? 'line-through' : ''
                            }`}
                          >
                            {tx.title}
                          </span>
                          <span className="text-[11px] font-mono text-slate-500">
                            · {tx.type}
                            {tx.isReversed ? ' (REVERSED)' : ''}
                            {' · '}
                            {lifecycle}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          Person: <strong>{involvedPerson}</strong> · Method: {tx.paymentMethod} ·{' '}
                          {tx.dateTime.slice(0, 16).replace('T', ' ')} · ID: {tx.id.slice(0, 14)}
                          {tx.notes ? ` · ${tx.notes}` : ''}
                        </p>
                      </div>

                      <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                        <span
                          className={`text-sm font-bold font-mono tabular-nums ${
                            tx.type === 'CONTRIBUTION'
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : tx.type === 'EXPENSE'
                                ? 'text-rose-600 dark:text-rose-400'
                                : 'text-blue-600 dark:text-blue-400'
                          }`}
                        >
                          {tx.type === 'CONTRIBUTION' ? '+' : tx.type === 'EXPENSE' ? '-' : ''}
                          {formatCurrency(tx.amountPaise, c)}
                        </span>

                        {canManage && !tx.isReversed && tx.type !== 'REVERSAL' && (
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleOpenEdit(tx)}
                              aria-label={`Edit ${tx.title}`}
                              className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                onReverseTransaction(tx, 'Reversed via Ledger Undo action')
                              }
                              aria-label={`Reverse ${tx.title}`}
                              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-rose-200 dark:border-rose-800/70 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              <span>Reverse</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </section>
      )}

      {/* TAB 2: ANALYTICS & VISUAL REPORTS */}
      {activeSubTab === 'ANALYTICS' && (
        <div className="space-y-6">
          <section className="grid grid-cols-2 lg:grid-cols-5 gap-3.5">
            <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4">
              <p className="text-xs text-slate-500">Total Trip Cost</p>
              <p className="text-lg font-bold font-mono text-rose-600 dark:text-rose-400 mt-1">
                {formatCurrency(report.totalExpensesPaise, c)}
              </p>
            </div>
            <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4">
              <p className="text-xs text-slate-500">Average Daily Spending</p>
              <p className="text-lg font-bold font-mono text-slate-900 dark:text-white mt-1">
                {formatCurrency(report.averageDailySpendPaise, c)}
              </p>
            </div>
            <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4">
              <p className="text-xs text-slate-500">Highest Spending Category</p>
              <p className="text-sm font-bold text-slate-900 dark:text-white mt-1 truncate">
                {report.highestCategory ? report.highestCategory.name : 'None'}
              </p>
              <p className="text-xs font-mono text-slate-500">
                {report.highestCategory ? formatCurrency(report.highestCategory.amountPaise, c) : '-'}
              </p>
            </div>
            <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4">
              <p className="text-xs text-slate-500">Highest Spending Day</p>
              <p className="text-sm font-bold font-mono text-slate-900 dark:text-white mt-1">
                {report.highestSpendDay ? report.highestSpendDay.date : 'None'}
              </p>
              <p className="text-xs font-mono text-slate-500">
                {report.highestSpendDay ? formatCurrency(report.highestSpendDay.amountPaise, c) : '-'}
              </p>
            </div>
            <div className="col-span-2 lg:col-span-1 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4">
              <p className="text-xs text-slate-500">Remaining Pool Balance</p>
              <p className="text-lg font-bold font-mono text-emerald-600 dark:text-emerald-400 mt-1">
                {formatCurrency(report.totalPoolBalancePaise, c)}
              </p>
            </div>
          </section>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <section className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Expense Distribution by Category
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center mt-4">
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={categoryChartData}
                        dataKey="amount"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={42}
                        outerRadius={76}
                      >
                        {categoryChartData.map((_entry, index) => (
                          <Cell
                            key={`cell-${index}`}
                            fill={CHART_COLORS[index % CHART_COLORS.length]}
                          />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-2">
                  {categoryChartData.map((item, idx) => {
                    const pct =
                      report.totalExpensesPaise > 0
                        ? Math.round((item.paise / report.totalExpensesPaise) * 100)
                        : 0;
                    return (
                      <div
                        key={item.name}
                        className="flex items-center justify-between text-xs gap-2"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="w-3 h-3 rounded-xs shrink-0"
                            style={{
                              backgroundColor: CHART_COLORS[idx % CHART_COLORS.length],
                            }}
                          />
                          <span className="text-slate-700 dark:text-slate-300 truncate">
                            {item.name}
                          </span>
                        </div>
                        <span className="font-mono font-semibold text-slate-900 dark:text-white shrink-0">
                          {formatCurrency(item.paise, c)} ({pct}%)
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>

            <section className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Contributions by Member vs. Member-Wise Expense Share
              </h3>
              <div className="h-56 mt-4">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={memberBarData}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Bar dataKey="Contributed" fill="#10B981" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="ExpenseShare" fill="#EF4444" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section className="lg:col-span-2 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Daily Spending Trend &amp; Pool Balance Over Time
                </h3>
                <span className="text-xs font-mono text-slate-500">
                  Budget Utilization: {report.budgetUtilizationPercent}% of{' '}
                  {formatCurrency(trip.budgetPaise, c)}
                </span>
              </div>
              <div className="w-full h-2.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden mb-5">
                <div
                  className="h-full rounded-full bg-emerald-500"
                  style={{ width: `${Math.min(100, report.budgetUtilizationPercent)}%` }}
                />
              </div>
              <div className="h-60">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={dailyAndPoolTimeline}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                    <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Area
                      type="monotone"
                      dataKey="poolBalance"
                      name="Pool Balance"
                      stroke="#10B981"
                      fill="#10B981"
                      fillOpacity={0.18}
                    />
                    <Area
                      type="monotone"
                      dataKey="spend"
                      name="Daily Spend"
                      stroke="#EF4444"
                      fill="#EF4444"
                      fillOpacity={0.18}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </section>
          </div>
        </div>
      )}

      {/* TAB 3: BACKUP & RESTORE, SYNC ENGINE, DEXIE DIAGNOSTICS & ROLES */}
      {activeSubTab === 'SECURITY' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Backup & Recovery Card (Prominent in Settings) */}
          <section
            aria-labelledby="backup-restore-heading"
            className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 sm:p-6 space-y-4"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <Download className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                <h2
                  id="backup-restore-heading"
                  className="text-lg font-bold text-slate-900 dark:text-white"
                >
                  Backup &amp; Restore
                </h2>
              </div>
              <span className="text-xs font-mono text-slate-500">JSON &amp; CSV</span>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              Export all trip data as JSON or transaction history as CSV. Imported backups are validated before writing and checked by UUID to prevent duplicate transactions.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <button
                type="button"
                onClick={handleExportBackupJSON}
                className="flex items-center justify-center gap-1.5 rounded-xl bg-slate-900 dark:bg-emerald-600 px-3.5 py-2.5 text-xs font-semibold text-white hover:opacity-90 min-h-[44px]"
              >
                <Download className="w-4 h-4" />
                <span>Export JSON Backup</span>
              </button>

              <button
                type="button"
                onClick={() => exportTripToCSV(trip, transactions, report)}
                className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 px-3.5 py-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 min-h-[44px]"
              >
                <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                <span>Export History CSV</span>
              </button>

              <label className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 px-3.5 py-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 cursor-pointer min-h-[44px]">
                <Upload className="w-4 h-4 text-blue-600" />
                <span>Import JSON Backup</span>
                <input
                  type="file"
                  accept="application/json"
                  onChange={handleImportBackupJSON}
                  className="hidden"
                />
              </label>
            </div>

            {/* Mandatory iOS Storage Disclosure Notice */}
            <div className="rounded-xl bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-800/60 p-3.5 text-xs text-amber-900 dark:text-amber-200 space-y-1">
              <div className="flex items-center gap-1.5 font-semibold">
                <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <span>Important iPhone &amp; Browser Local Storage Notice</span>
              </div>
              <p className="text-[11px] leading-relaxed">
                Local browser storage is not permanent archival storage. Clearing Safari website data, resetting device storage, or uninstalling the Home Screen PWA can remove locally stored records if they have not been exported to a backup file or synchronized to the cloud database.
              </p>
            </div>

            {statusMessage && (
              <p
                role="status"
                className="text-xs font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5"
              >
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{statusMessage}</span>
              </p>
            )}
            {errorMessage && (
              <p role="alert" className="text-xs font-medium text-rose-600 dark:text-rose-400">
                {errorMessage}
              </p>
            )}
          </section>

          {/* Offline Synchronization Engine & Cloud SQL Status */}
          <section className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <Cloud className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                  Offline Synchronization Engine
                </h2>
              </div>
              <span
                className={`text-xs font-mono font-bold ${
                  syncIndicatorColor === 'GREEN'
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : syncIndicatorColor === 'ORANGE'
                      ? 'text-amber-600 dark:text-amber-400'
                      : syncIndicatorColor === 'BLUE'
                        ? 'text-blue-600 dark:text-blue-400'
                        : 'text-rose-600 dark:text-rose-400'
                }`}
              >
                {syncIndicatorColor}: {syncStateLabel}
              </span>
            </div>

            <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 p-4 border border-slate-200/80 dark:border-slate-700/60 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Lifecycle Pipeline:</span>
                <span className="font-mono text-[11px] text-slate-700 dark:text-slate-300">
                  LOCAL_SAVE &rarr; PENDING_SYNC &rarr; SYNCING &rarr; SYNCED
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Pending Sync Queue:</span>
                <strong className="font-mono text-slate-900 dark:text-white">
                  {pendingSyncCount} transaction(s)
                </strong>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Last Successful Sync:</span>
                <strong className="font-mono text-slate-900 dark:text-white">
                  {lastSyncedAt ? lastSyncedAt.slice(0, 19).replace('T', ' ') : 'Never'}
                </strong>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Cloud SQL Account:</span>
                <strong className="text-slate-900 dark:text-white">
                  {cloudUserEmail || 'Local Dexie.js Mode (No login required)'}
                </strong>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={onManualSync}
                className="flex items-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 px-4 py-2.5 text-xs font-semibold text-white transition-colors min-h-[44px]"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Sync Now</span>
              </button>

              {!cloudUserEmail ? (
                <button
                  type="button"
                  onClick={onSignInCloud}
                  className="flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 px-4 py-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200 transition-colors min-h-[44px]"
                >
                  <span>Connect Google Account for Multi-Device Cloud SQL</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onSignOutCloud}
                  className="flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2.5 text-xs font-semibold text-slate-600 dark:text-slate-300 min-h-[44px]"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Disconnect Cloud</span>
                </button>
              )}
            </div>
          </section>

          {/* Dexie.js 10-Table Local Database Inspector */}
          <section className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 sm:p-6 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <Database className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                  Dexie.js IndexedDB Local Tables (10 Stores)
                </h2>
              </div>
              <span className="text-xs font-mono text-emerald-600 dark:text-emerald-400">
                Schema v2 Active
              </span>
            </div>

            {dexieCounts && (
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
                {(Object.entries(dexieCounts) as [keyof DexieTableDiagnostics, number][]).map(
                  ([tableName, count]) => (
                    <div
                      key={tableName}
                      className="rounded-xl bg-slate-50 dark:bg-slate-800/60 p-2.5 border border-slate-200/70 dark:border-slate-700/60"
                    >
                      <p className="text-[11px] text-slate-500 truncate">{tableName}</p>
                      <p className="text-sm font-bold font-mono text-slate-900 dark:text-white mt-0.5">
                        {count}
                      </p>
                    </div>
                  )
                )}
              </div>
            )}
          </section>

          {/* Role Permissions & Optional PIN Lock */}
          <section className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 sm:p-6 space-y-4">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Role Permissions &amp; Optional PIN Lock
              </h2>
              <div className="grid grid-cols-3 gap-2 mt-2.5">
                {(['ADMIN', 'TREASURER', 'MEMBER'] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => onChangeRole(r)}
                    className={`rounded-xl py-2.5 px-3 text-xs font-semibold border transition-colors min-h-[42px] ${
                      currentRole === r
                        ? 'bg-slate-900 dark:bg-emerald-600 text-white border-slate-900 dark:border-emerald-600'
                        : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  4-Digit App Access PIN (SHA-256)
                </span>
                {hasPinConfigured && (
                  <button
                    type="button"
                    onClick={onLockNow}
                    className="flex items-center gap-1 text-xs font-semibold text-amber-600 dark:text-amber-400"
                  >
                    <Lock className="w-3.5 h-3.5" />
                    <span>Lock Now</span>
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="password"
                  maxLength={4}
                  value={pinInput}
                  onChange={(e) => setPinInput(e.target.value.replace(/\D/g, ''))}
                  placeholder="4-digit PIN"
                  className="w-36 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-mono min-h-[40px]"
                />
                <button
                  type="button"
                  onClick={async () => {
                    if (pinInput.length === 4) {
                      await onConfigurePin(pinInput);
                      setPinInput('');
                      setStatusMessage('4-digit PIN lock saved (SHA-256 hashed).');
                    }
                  }}
                  className="rounded-xl bg-slate-900 dark:bg-slate-700 px-3.5 py-2 text-xs font-semibold text-white min-h-[40px]"
                >
                  Set PIN
                </button>
                {hasPinConfigured && (
                  <button
                    type="button"
                    onClick={async () => {
                      await onConfigurePin(null);
                      setStatusMessage('PIN lock removed.');
                    }}
                    className="rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs text-slate-600 dark:text-slate-300 min-h-[40px]"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          </section>
        </div>
      )}

      {/* EDIT TRANSACTION MODAL */}
      {editingTx && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-tx-title"
        >
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 id="edit-tx-title" className="text-base font-bold text-slate-900 dark:text-white">
                Edit Ledger Entry (Audit Logged)
              </h3>
              <button
                type="button"
                onClick={() => setEditingTx(null)}
                aria-label="Close edit modal"
                className="p-1 text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveEdit} className="mt-4 space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Title
                </label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Amount ({trip.currency})
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={editAmount}
                  onChange={(e) => setEditAmount(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono font-bold text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Notes
                </label>
                <input
                  type="text"
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingTx(null)}
                  className="rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-2 text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
