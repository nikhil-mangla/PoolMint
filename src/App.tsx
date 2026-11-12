import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import {
  Home,
  Wallet,
  ArrowLeftRight,
  Receipt,
  MoreHorizontal,
  Plus,
  Sun,
  Moon,
  Wifi,
  WifiOff,
  RefreshCw,
  Compass,
  Lock,
  AlertCircle,
  Share2,
  Copy,
  Check,
  X,
  Trash2,
  KeyRound,
} from 'lucide-react';
import { signInWithPopup, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { auth, googleAuthProvider } from './lib/firebase';
import {
  Trip,
  Transaction,
  AuditLog,
  UserRole,
  SyncStateLabel,
  SyncIndicatorColor,
  SettlementRecommendation,
  PaymentMethod,
  PaymentSource,
  SplitMethod,
  MemberSplit,
} from './types/treasury';
import {
  computeTripAccounting,
  calculateExpenseSplits,
  formatCurrency,
} from './utils/accounting';
import {
  initializeLocalDatabase,
  saveTripLocal,
  deleteTripLocal,
  clearTripTransactionsLocal,
  saveTransactionLocal,
  deleteTransactionLocal,
  markAllSyncedLocal,
  mergeCloudAndLocalData,
  validateAndRestoreBackupToIndexedDB,
  generateUniqueId,
  updateSyncLifecycleStatusLocal,
  importSharedTripData,
} from './services/indexedDb';
import {
  generateTripShareUrl,
  parseJoinPayloadFromLocation,
  getOrCreateTripPin,
} from './utils/shareTrip';
import {
  subscribeToTripLive,
  broadcastTripEvent,
  type LiveSyncEvent,
} from './services/liveTripSync';
import { DashboardView } from './components/DashboardView';
import { PoolView } from './components/PoolView';
import { TransferView } from './components/TransferView';
import { ExpensesView } from './components/ExpensesView';
import { MoreView } from './components/MoreView';
import { TripModal } from './components/TripModal';
import { QuickActionModal } from './components/QuickActionModal';
import { EditTransactionModal } from './components/EditTransactionModal';
import { PWAInstallButton } from './components/PWAInstallButton';
import { JoinTripModal } from './components/JoinTripModal';
import { JoinWithPinModal } from './components/JoinWithPinModal';

type NavTab = 'HOME' | 'POOL' | 'TRANSFER' | 'EXPENSES' | 'MORE';

const AVATAR_COLORS = [
  '#059669',
  '#2563EB',
  '#7C3AED',
  '#D97706',
  '#DC2626',
  '#0891B2',
  '#4F46E5',
  '#DB2777',
];

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export default function App() {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [activeTripId, setActiveTripId] = useState<string>('');
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [activeTab, setActiveTab] = useState<NavTab>('HOME');
  const [currentRole, setCurrentRole] = useState<UserRole>('TREASURER');
  const [activeViewerMemberId, setActiveViewerMemberId] = useState<string>('mem-1');
  const [darkMode, setDarkMode] = useState<boolean>(false);

  // Offline / Online & Synchronization Engine State
  const [browserOnline, setBrowserOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [simulatedOffline, setSimulatedOffline] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem('poolmint_simulated_offline') === '1';
    } catch {
      return false;
    }
  });
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [justSynced, setJustSynced] = useState<boolean>(false);
  const [cloudUser, setCloudUser] = useState<User | null>(null);
  const retryAttemptRef = useRef<number>(0);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Modals
  const [tripModalState, setTripModalState] = useState<{
    open: boolean;
    editingTrip: Trip | null;
  }>({ open: false, editingTrip: null });
  const [quickActionState, setQuickActionState] = useState<{
    open: boolean;
    mode: 'EXPENSE' | 'POOL' | 'TRANSFER';
    defaultMemberId?: string;
  }>({ open: false, mode: 'EXPENSE' });
  const [editingTransactionModalTx, setEditingTransactionModalTx] =
    useState<Transaction | null>(null);
  const [inviteModalOpen, setInviteModalOpen] = useState<boolean>(false);
  const [shareUrl, setShareUrl] = useState<string>('');
  const [isGeneratingShareUrl, setIsGeneratingShareUrl] = useState<boolean>(false);
  const [pendingJoinPayload, setPendingJoinPayload] = useState<{
    trip: Trip;
    transactions: Transaction[];
  } | null>(null);
  const [isExistingTripJoin, setIsExistingTripJoin] = useState<boolean>(false);
  const [statusToast, setStatusToast] = useState<{ message: string; type: 'SUCCESS' | 'INFO' } | null>(null);
  const [deleteTripConfirmOpen, setDeleteTripConfirmOpen] = useState<boolean>(false);
  const [copiedLink, setCopiedLink] = useState<boolean>(false);
  const [copiedPin, setCopiedPin] = useState<boolean>(false);
  const [joinWithPinModalOpen, setJoinWithPinModalOpen] = useState<boolean>(false);
  const [isLiveSyncConnected, setIsLiveSyncConnected] = useState<boolean>(false);

  // Auto-dismiss status toast after 4 seconds
  useEffect(() => {
    if (statusToast) {
      const timer = setTimeout(() => setStatusToast(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [statusToast]);

  // PIN Lock State
  const [pinHash, setPinHash] = useState<string | null>(() =>
    localStorage.getItem('poolmint_pin_sha256')
  );
  const [isLocked, setIsLocked] = useState<boolean>(false);
  const [unlockAttempt, setUnlockAttempt] = useState<string>('');
  const [unlockError, setUnlockError] = useState<string>('');

  const isEffectiveOnline = browserOnline && !simulatedOffline;

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [darkMode]);

  // Load initial Dexie IndexedDB data immediately without waiting for network
  useEffect(() => {
    initializeLocalDatabase()
      .then(async (data) => {
        setTrips(data.trips);
        setTransactions(data.transactions);
        setAuditLogs(data.auditLogs);
        setLastSyncedAt(data.lastSyncedAt);

        // Check if there is an incoming join payload in the URL (#join=... or ?join=...)
        const joinPayload = await parseJoinPayloadFromLocation();
        if (joinPayload) {
          setPendingJoinPayload(joinPayload);
          const existing = data.trips.some((t) => t.id === joinPayload.trip.id);
          setIsExistingTripJoin(existing);
          if (existing) {
            setActiveTripId(joinPayload.trip.id);
          } else if (data.trips.length > 0) {
            setActiveTripId(data.trips[0].id);
          }
        } else {
          // Check for URL query param ?trip=<id>
          if (typeof window !== 'undefined') {
            const urlParams = new URLSearchParams(window.location.search);
            const tripParam = urlParams.get('trip');
            if (tripParam && data.trips.some((t) => t.id === tripParam)) {
              setActiveTripId(tripParam);
              const matched = data.trips.find((t) => t.id === tripParam);
              if (matched) {
                setActiveViewerMemberId(matched.treasurerMemberId || matched.members[0]?.id || 'mem-1');
              }
            } else if (tripParam && !data.trips.some((t) => t.id === tripParam)) {
              setStatusToast({
                message: '⚠️ Trip not found on this device. Ask your friend for an updated invite link.',
                type: 'INFO',
              });
              if (data.trips.length > 0) {
                setActiveTripId(data.trips[0].id);
                setActiveViewerMemberId(data.trips[0].treasurerMemberId || data.trips[0].members[0]?.id || 'mem-1');
              }
            } else if (data.trips.length > 0) {
              setActiveTripId(data.trips[0].id);
              setActiveViewerMemberId(data.trips[0].treasurerMemberId || data.trips[0].members[0]?.id || 'mem-1');
            }
          }
        }
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCloudUser(user);
    });
    return () => unsubscribe();
  }, []);

  const pendingSyncCount = useMemo(() => {
    const tCount = trips.filter((t) => t.syncStatus === 'PENDING').length;
    const txCount = transactions.filter((tx) => tx.syncStatus === 'PENDING').length;
    return tCount + txCount;
  }, [trips, transactions]);

  // Phase 5 Synchronization Indicator State & Color
  const { syncStateLabel, syncIndicatorColor } = useMemo((): {
    syncStateLabel: SyncStateLabel;
    syncIndicatorColor: SyncIndicatorColor;
  } => {
    if (!isEffectiveOnline) {
      return { syncStateLabel: 'OFFLINE', syncIndicatorColor: 'ORANGE' };
    }
    if (isSyncing) {
      return { syncStateLabel: 'SYNCING', syncIndicatorColor: 'BLUE' };
    }
    if (syncError) {
      return { syncStateLabel: 'SYNC FAILED', syncIndicatorColor: 'RED' };
    }
    if (pendingSyncCount > 0) {
      return { syncStateLabel: 'PENDING SYNC', syncIndicatorColor: 'ORANGE' };
    }
    if (justSynced) {
      return { syncStateLabel: 'SYNC COMPLETED', syncIndicatorColor: 'GREEN' };
    }
    return { syncStateLabel: 'ONLINE', syncIndicatorColor: 'GREEN' };
  }, [isEffectiveOnline, isSyncing, syncError, pendingSyncCount, justSynced]);

  /**
   * Phase 4: Offline Synchronization Engine with Exponential Backoff Retry
   * Lifecycle: LOCAL_SAVE -> PENDING_SYNC -> SYNCING -> SYNCED (or RETRY on failure)
   */
  const synchronizeWithBackend = useCallback(async () => {
    if (!isEffectiveOnline || isSyncing) return;
    setIsSyncing(true);
    setSyncError(null);

    try {
      await updateSyncLifecycleStatusLocal('SYNCING');

      const healthRes = await fetch('/api/health', { cache: 'no-store' });
      if (!healthRes.ok) {
        throw new Error('Server health check returned non-200 status');
      }

      if (cloudUser) {
        const token = await cloudUser.getIdToken();
        const payload = {
          trips: trips.map((t) => ({
            id: t.id,
            name: t.name,
            destination: t.destination,
            startDate: t.startDate,
            endDate: t.endDate,
            currency: t.currency,
            budgetPaise: t.budgetPaise,
            description: t.description,
            treasurerMemberId: t.treasurerMemberId,
            status: t.status,
            allowNegativePool: t.allowNegativePool,
            membersJson: JSON.stringify(t.members),
            customCategoriesJson: JSON.stringify(t.customCategories || []),
            closedAt: t.closedAt || null,
            updatedAt: t.updatedAt,
          })),
          transactions: transactions.map((tx) => ({
            id: tx.id,
            tripId: tx.tripId,
            type: tx.type,
            title: tx.title,
            amountPaise: tx.amountPaise,
            currency: tx.currency,
            dateTime: tx.dateTime,
            paymentMethod: tx.paymentMethod,
            fromMemberId: tx.fromMemberId || null,
            toMemberId: tx.toMemberId || null,
            reference: tx.reference || null,
            category: tx.category || null,
            paidByMemberId: tx.paidByMemberId || null,
            paymentSource: tx.paymentSource || null,
            splitMethod: tx.splitMethod || null,
            splitsJson: tx.splits ? JSON.stringify(tx.splits) : null,
            receiptDataUrl: tx.receiptDataUrl || null,
            notes: tx.notes || '',
            isReversed: tx.isReversed,
            reversalOfId: tx.reversalOfId || null,
            reversedById: tx.reversedById || null,
            createdByMemberId: tx.createdByMemberId,
            updatedAt: tx.updatedAt,
          })),
          auditLogs: auditLogs.map((l) => ({
            id: l.id,
            tripId: l.tripId,
            transactionId: l.transactionId,
            action: l.action,
            actorName: l.actorName,
            timestamp: l.timestamp,
            previousValueJson: l.previousValueJson || null,
            newValueJson: l.newValueJson || null,
            notes: l.notes || '',
          })),
        };

        const syncRes = await fetch('/api/cloud/sync', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        });

        if (!syncRes.ok) {
          throw new Error('Cloud SQL synchronization failed');
        }

        const body = await syncRes.json();
        const merged = await mergeCloudAndLocalData(
          trips,
          transactions,
          auditLogs,
          body.data
        );
        setTrips(merged.trips);
        setTransactions(merged.transactions);
        setAuditLogs(merged.auditLogs);
        setLastSyncedAt(merged.lastSyncedAt);
      } else {
        const marked = await markAllSyncedLocal(trips, transactions, auditLogs);
        setTrips(marked.trips);
        setTransactions(marked.transactions);
        setAuditLogs(marked.auditLogs);
        setLastSyncedAt(marked.lastSyncedAt);
      }

      retryAttemptRef.current = 0;
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
      setJustSynced(true);
      setTimeout(() => setJustSynced(false), 4000);
    } catch (err: any) {
      await updateSyncLifecycleStatusLocal('RETRY', err?.message);
      setSyncError(err?.message || 'Synchronization failed');
      setTransactions((prev) =>
        prev.map((tx) =>
          tx.syncStatus === 'PENDING' ? { ...tx, lifecycleStatus: 'RETRY' } : tx
        )
      );

      if (retryAttemptRef.current < 4) {
        const backoffMs = Math.min(30000, 1000 * Math.pow(2, retryAttemptRef.current));
        retryAttemptRef.current += 1;
        retryTimeoutRef.current = setTimeout(() => {
          synchronizeWithBackend();
        }, backoffMs);
      }
    } finally {
      setIsSyncing(false);
    }
  }, [isEffectiveOnline, isSyncing, cloudUser, trips, transactions, auditLogs]);

  // Listen to online/offline + iOS Safari foreground resume (visibilitychange & focus)
  useEffect(() => {
    const handleOnline = () => {
      setBrowserOnline(true);
      retryAttemptRef.current = 0;
    };
    const handleOffline = () => setBrowserOnline(false);
    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible' && navigator.onLine && !simulatedOffline) {
        setBrowserOnline(true);
        if (pendingSyncCount > 0) {
          synchronizeWithBackend();
        }
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
    };
  }, [simulatedOffline, pendingSyncCount, synchronizeWithBackend]);

  useEffect(() => {
    if (isEffectiveOnline && pendingSyncCount > 0 && !isSyncing && !syncError) {
      const timer = setTimeout(() => {
        synchronizeWithBackend();
      }, 600);
      return () => clearTimeout(timer);
    }
  }, [isEffectiveOnline, pendingSyncCount, isSyncing, syncError, synchronizeWithBackend]);

  const activeTrip = useMemo(
    () => trips.find((t) => t.id === activeTripId) || trips[0],
    [trips, activeTripId]
  );

  const report = useMemo(() => {
    if (!activeTrip) return null;
    return computeTripAccounting(activeTrip, transactions);
  }, [activeTrip, transactions]);

  // Generate live compressed share URL whenever invite modal opens or active trip changes
  const activeTripPin = useMemo(
    () => (activeTrip ? getOrCreateTripPin(activeTrip) : '4821'),
    [activeTrip]
  );

  useEffect(() => {
    if (inviteModalOpen && activeTrip) {
      setIsGeneratingShareUrl(true);
      generateTripShareUrl(activeTrip, transactions)
        .then((res) => setShareUrl(res.url))
        .catch((err) => {
          console.error('Failed to generate share URL:', err);
          const origin = typeof window !== 'undefined' ? window.location.origin : 'https://poolmint.app';
          setShareUrl(`${origin}/?trip=${encodeURIComponent(activeTrip.id)}&pin=${activeTripPin}`);
        })
        .finally(() => setIsGeneratingShareUrl(false));
    }
  }, [inviteModalOpen, activeTrip, transactions, activeTripPin]);

  // Real-Time Live Sync Engine: Connects all friends on this trip over SSE
  useEffect(() => {
    if (!activeTrip?.id) return;

    const unsubscribe = subscribeToTripLive(
      activeTrip.id,
      async (event: LiveSyncEvent) => {
        if (event.type === 'TRANSACTION_SAVED' && event.tx) {
          const incomingTx = event.tx;
          await saveTransactionLocal(incomingTx);
          setTransactions((prev) => {
            const idx = prev.findIndex((item) => item.id === incomingTx.id);
            if (idx >= 0) {
              const copy = [...prev];
              copy[idx] = incomingTx;
              return copy;
            }
            return [incomingTx, ...prev];
          });

          const isContrib = incomingTx.type === 'CONTRIBUTION';
          const title = isContrib
            ? `Pool deposit ${formatCurrency(incomingTx.amountPaise, incomingTx.currency)}`
            : `Expense "${incomingTx.title}" (${formatCurrency(incomingTx.amountPaise, incomingTx.currency)})`;
          setStatusToast({
            message: `⚡ Live Update: ${title} synced!`,
            type: 'SUCCESS',
          });
        } else if (event.type === 'TRANSACTION_DELETED' && event.txId) {
          await deleteTransactionLocal(event.txId);
          setTransactions((prev) => prev.filter((item) => item.id !== event.txId));
          setStatusToast({
            message: `⚡ Live Update: Transaction removed by group`,
            type: 'INFO',
          });
        } else if (event.type === 'TRIP_UPDATED' && event.trip) {
          await saveTripLocal(event.trip);
          setTrips((prev) => prev.map((t) => (t.id === event.trip!.id ? event.trip! : t)));
          setStatusToast({
            message: `⚡ Live Update: Trip details updated!`,
            type: 'SUCCESS',
          });
        } else if (event.type === 'REQUEST_SYNC') {
          // A friend just joined or requested sync, reply with current snapshot
          const tripTxs = transactions.filter((tx) => tx.tripId === activeTrip.id);
          broadcastTripEvent(activeTrip.id, {
            type: 'SYNC_SNAPSHOT',
            trip: activeTrip,
            transactions: tripTxs,
          });
        } else if (event.type === 'SYNC_SNAPSHOT' && event.trip && event.transactions) {
          const res = await importSharedTripData(event.trip, event.transactions);
          setTrips(res.trips);
          setTransactions(res.transactions);
          if (res.importedTxCount > 0 || res.updatedTxCount > 0) {
            setStatusToast({
              message: `⚡ Live Update: Synced ${res.importedTxCount} new transaction(s)!`,
              type: 'SUCCESS',
            });
          }
        }
      },
      (connected) => {
        setIsLiveSyncConnected(connected);
      }
    );

    // Initial broadcast of snapshot so any listening friend gets our current data (e.g. ₹4000 contribution!)
    const currentTripTxs = transactions.filter((tx) => tx.tripId === activeTrip.id);
    if (currentTripTxs.length > 0) {
      broadcastTripEvent(activeTrip.id, {
        type: 'SYNC_SNAPSHOT',
        trip: activeTrip,
        transactions: currentTripTxs,
      });
    }

    return () => unsubscribe();
  }, [activeTrip?.id]);

  const appendTransaction = async (tx: Transaction, auditNote: string) => {
    const actorName =
      activeTrip?.members.find((m) => m.id === activeTrip.treasurerMemberId)?.name ||
      currentRole;
    const log: AuditLog = {
      id: generateUniqueId('audit'),
      tripId: tx.tripId,
      transactionId: tx.id,
      action: 'CREATED',
      actorName: `${actorName} (${currentRole})`,
      timestamp: new Date().toISOString(),
      previousValueJson: null,
      newValueJson: JSON.stringify({
        title: tx.title,
        amountPaise: tx.amountPaise,
        type: tx.type,
      }),
      notes: auditNote,
      syncStatus: 'PENDING',
    };

    const preparedTx: Transaction = {
      ...tx,
      syncStatus: 'PENDING',
      lifecycleStatus: 'PENDING_SYNC',
    };

    await saveTransactionLocal(preparedTx, log);
    setTransactions((prev) => [preparedTx, ...prev]);
    setAuditLogs((prev) => [log, ...prev]);
    setSyncError(null);

    // Live Broadcast to all friends connected to this trip
    if (activeTrip?.id) {
      broadcastTripEvent(activeTrip.id, {
        type: 'TRANSACTION_SAVED',
        tx: preparedTx,
      });
    }
  };

  const handleAddContribution = async (input: {
    fromMemberId: string;
    amountPaise: number;
    paymentMethod: PaymentMethod;
    reference: string;
    notes: string;
    dateTime: string;
  }) => {
    if (!activeTrip) return;
    const memberName =
      activeTrip.members.find((m) => m.id === input.fromMemberId)?.name || 'Member';
    const tx: Transaction = {
      id: generateUniqueId('tx-contrib'),
      tripId: activeTrip.id,
      type: 'CONTRIBUTION',
      title: `${memberName}'s Pool Contribution`,
      amountPaise: input.amountPaise,
      currency: activeTrip.currency,
      dateTime: input.dateTime,
      paymentMethod: input.paymentMethod,
      fromMemberId: input.fromMemberId,
      toMemberId: activeTrip.treasurerMemberId,
      reference: input.reference || null,
      notes: input.notes,
      isReversed: false,
      createdByMemberId: activeTrip.treasurerMemberId,
      updatedAt: new Date().toISOString(),
      syncStatus: 'PENDING',
      lifecycleStatus: 'LOCAL_SAVE',
    };
    await appendTransaction(
      tx,
      `Added ${formatCurrency(input.amountPaise, activeTrip.currency)} pool contribution from ${memberName}`
    );
  };

  const handleAddTransfer = async (input: {
    fromMemberId: string;
    toMemberId: string;
    amountPaise: number;
    paymentMethod: PaymentMethod;
    reference: string;
    notes: string;
    dateTime: string;
  }) => {
    if (!activeTrip) return;
    const fromName =
      activeTrip.members.find((m) => m.id === input.fromMemberId)?.name || 'Sender';
    const toName =
      activeTrip.members.find((m) => m.id === input.toMemberId)?.name || 'Receiver';
    const tx: Transaction = {
      id: generateUniqueId('tx-trf'),
      tripId: activeTrip.id,
      type: 'TRANSFER',
      title: `Transfer: ${fromName} → ${toName}`,
      amountPaise: input.amountPaise,
      currency: activeTrip.currency,
      dateTime: input.dateTime,
      paymentMethod: input.paymentMethod,
      fromMemberId: input.fromMemberId,
      toMemberId: input.toMemberId,
      reference: input.reference || null,
      notes: input.notes,
      isReversed: false,
      createdByMemberId: activeTrip.treasurerMemberId,
      updatedAt: new Date().toISOString(),
      syncStatus: 'PENDING',
      lifecycleStatus: 'LOCAL_SAVE',
    };
    await appendTransaction(
      tx,
      `Recorded transfer of ${formatCurrency(input.amountPaise, activeTrip.currency)} from ${fromName} to ${toName}`
    );
  };

  const handleAddExpense = async (input: {
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
  }) => {
    if (!activeTrip) return;
    const tx: Transaction = {
      id: generateUniqueId('tx-exp'),
      tripId: activeTrip.id,
      type: 'EXPENSE',
      title: input.title,
      amountPaise: input.amountPaise,
      currency: activeTrip.currency,
      dateTime: input.dateTime,
      paymentMethod: input.paymentMethod,
      category: input.category,
      paidByMemberId: input.paidByMemberId,
      paymentSource: input.paymentSource,
      splitMethod: input.splitMethod,
      splits: input.splits,
      receiptDataUrl: input.receiptDataUrl || null,
      notes: input.notes,
      isReversed: false,
      createdByMemberId: input.paidByMemberId,
      updatedAt: new Date().toISOString(),
      syncStatus: 'PENDING',
      lifecycleStatus: 'LOCAL_SAVE',
    };
    await appendTransaction(
      tx,
      `Recorded expense "${input.title}" (${formatCurrency(input.amountPaise, activeTrip.currency)})`
    );
  };

  const handleSettleDebt = async (settlement: SettlementRecommendation) => {
    if (!activeTrip) return;
    const now = new Date().toISOString();
    const tx: Transaction = {
      id: generateUniqueId('tx-settle'),
      tripId: activeTrip.id,
      type: settlement.isPoolRefund ? 'REFUND' : 'SETTLEMENT',
      title: settlement.isPoolRefund
        ? `Pool Refund to ${settlement.toMemberName}`
        : `Settlement: ${settlement.fromMemberName} → ${settlement.toMemberName}`,
      amountPaise: settlement.amountPaise,
      currency: activeTrip.currency,
      dateTime: now,
      paymentMethod: 'UPI',
      fromMemberId: settlement.fromMemberId,
      toMemberId: settlement.toMemberId,
      notes: settlement.isPoolRefund
        ? 'Unused pool balance refunded by Treasurer'
        : 'Debt settled via Settlement Calculator',
      isReversed: false,
      createdByMemberId: activeTrip.treasurerMemberId,
      updatedAt: now,
      syncStatus: 'PENDING',
      lifecycleStatus: 'LOCAL_SAVE',
    };
    await appendTransaction(tx, `Marked settlement completed: ${tx.title}`);
  };

  const handleReverseTransaction = async (originalTx: Transaction, reason: string) => {
    if (!activeTrip) return;
    const now = new Date().toISOString();
    const reversalId = generateUniqueId('tx-rev');

    const updatedOriginal: Transaction = {
      ...originalTx,
      isReversed: true,
      reversedById: reversalId,
      updatedAt: now,
      syncStatus: 'PENDING',
      lifecycleStatus: 'PENDING_SYNC',
    };

    const reversalEntry: Transaction = {
      id: reversalId,
      tripId: originalTx.tripId,
      type: 'REVERSAL',
      title: `REVERSAL OF: ${originalTx.title}`,
      amountPaise: originalTx.amountPaise,
      currency: originalTx.currency,
      dateTime: now,
      paymentMethod: originalTx.paymentMethod,
      fromMemberId: originalTx.toMemberId,
      toMemberId: originalTx.fromMemberId,
      notes: reason,
      isReversed: false,
      reversalOfId: originalTx.id,
      createdByMemberId: activeTrip.treasurerMemberId,
      updatedAt: now,
      syncStatus: 'PENDING',
      lifecycleStatus: 'PENDING_SYNC',
    };

    const auditLog: AuditLog = {
      id: generateUniqueId('audit-rev'),
      tripId: originalTx.tripId,
      transactionId: originalTx.id,
      action: 'REVERSED',
      actorName: `${currentRole}`,
      timestamp: now,
      previousValueJson: JSON.stringify({
        title: originalTx.title,
        amountPaise: originalTx.amountPaise,
        isReversed: false,
      }),
      newValueJson: JSON.stringify({
        reversedById: reversalId,
        isReversed: true,
      }),
      notes: reason,
      syncStatus: 'PENDING',
    };

    await saveTransactionLocal(updatedOriginal, auditLog);
    await saveTransactionLocal(reversalEntry);

    setTransactions((prev) => [
      reversalEntry,
      ...prev.map((item) => (item.id === originalTx.id ? updatedOriginal : item)),
    ]);
    setAuditLogs((prev) => [auditLog, ...prev]);

    if (activeTrip?.id) {
      broadcastTripEvent(activeTrip.id, {
        type: 'TRANSACTION_SAVED',
        tx: updatedOriginal,
      });
      broadcastTripEvent(activeTrip.id, {
        type: 'TRANSACTION_SAVED',
        tx: reversalEntry,
      });
    }
  };

  const handleUpdateFullTransaction = async (updatedTx: Transaction) => {
    if (!activeTrip) return;
    const now = new Date().toISOString();
    const existing = transactions.find((t) => t.id === updatedTx.id);
    const log: AuditLog = {
      id: generateUniqueId('audit-edit'),
      tripId: updatedTx.tripId,
      transactionId: updatedTx.id,
      action: 'EDITED',
      actorName: `${currentRole}`,
      timestamp: now,
      previousValueJson: existing
        ? JSON.stringify({
            title: existing.title,
            amountPaise: existing.amountPaise,
            paymentSource: existing.paymentSource,
          })
        : null,
      newValueJson: JSON.stringify({
        title: updatedTx.title,
        amountPaise: updatedTx.amountPaise,
        paymentSource: updatedTx.paymentSource,
      }),
      notes: `Edited transaction "${updatedTx.title}"`,
      syncStatus: 'PENDING',
    };

    await saveTransactionLocal(updatedTx, log);
    setTransactions((prev) =>
      prev.map((item) => (item.id === updatedTx.id ? updatedTx : item))
    );
    setAuditLogs((prev) => [log, ...prev]);

    if (activeTrip?.id) {
      broadcastTripEvent(activeTrip.id, {
        type: 'TRANSACTION_SAVED',
        tx: updatedTx,
      });
    }
  };

  const handleDeleteTransaction = async (tx: Transaction) => {
    const now = new Date().toISOString();
    const log: AuditLog = {
      id: generateUniqueId('audit-del'),
      tripId: tx.tripId,
      transactionId: tx.id,
      action: 'REVERSED',
      actorName: `${currentRole}`,
      timestamp: now,
      previousValueJson: JSON.stringify({
        title: tx.title,
        amountPaise: tx.amountPaise,
      }),
      newValueJson: null,
      notes: `Deleted transaction "${tx.title}"`,
      syncStatus: 'PENDING',
    };
    await deleteTransactionLocal(tx.id, log);
    setTransactions((prev) => prev.filter((item) => item.id !== tx.id));
    setAuditLogs((prev) => [log, ...prev]);

    if (activeTrip?.id) {
      broadcastTripEvent(activeTrip.id, {
        type: 'TRANSACTION_DELETED',
        txId: tx.id,
      });
    }
  };

  const handleEditTransaction = async (
    tx: Transaction,
    updates: { title: string; amountPaise: number; notes: string }
  ) => {
    if (!activeTrip) return;
    const now = new Date().toISOString();
    const newSplits =
      tx.type === 'EXPENSE'
        ? calculateExpenseSplits(
            updates.amountPaise,
            activeTrip.members.map((m) => m.id),
            'EQUAL'
          )
        : tx.splits;

    const updatedTx: Transaction = {
      ...tx,
      title: updates.title,
      amountPaise: updates.amountPaise,
      notes: updates.notes,
      splits: newSplits,
      updatedAt: now,
      syncStatus: 'PENDING',
      lifecycleStatus: 'PENDING_SYNC',
    };

    await handleUpdateFullTransaction(updatedTx);
  };

  const handleSaveTrip = async (tripObj: Trip) => {
    await saveTripLocal(tripObj);
    setTrips((prev) => {
      const exists = prev.some((t) => t.id === tripObj.id);
      if (exists) {
        return prev.map((t) => (t.id === tripObj.id ? tripObj : t));
      }
      return [tripObj, ...prev];
    });
    setActiveTripId(tripObj.id);

    broadcastTripEvent(tripObj.id, {
      type: 'TRIP_UPDATED',
      trip: tripObj,
    });
  };

  const handleJoinTripFromPayload = async ({
    trip,
    transactions: incomingTxs,
    selectedMemberId,
  }: {
    trip: Trip;
    transactions: Transaction[];
    selectedMemberId: string;
  }) => {
    const result = await importSharedTripData(trip, incomingTxs);
    setTrips(result.trips);
    setTransactions(result.transactions);
    setActiveTripId(trip.id);
    setActiveViewerMemberId(selectedMemberId);
    setPendingJoinPayload(null);

    // Clean URL without reloading the page
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', window.location.pathname);
    }

    setStatusToast({
      message: result.isNewTrip
        ? `🎉 Joined "${trip.name}"! Loaded ${result.importedTxCount} transactions.`
        : `🔄 Updated "${trip.name}"! Synced ${result.importedTxCount} new transactions.`,
      type: 'SUCCESS',
    });
  };

  const handleJoinLocalTripByPin = (pinToFind: string): boolean => {
    const matched = trips.find((t) => t.pin === pinToFind || getOrCreateTripPin(t) === pinToFind);
    if (matched) {
      setActiveTripId(matched.id);
      setActiveViewerMemberId(matched.treasurerMemberId || matched.members[0]?.id || 'mem-1');
      setStatusToast({
        message: `Switched to "${matched.name}" (PIN: ${pinToFind})!`,
        type: 'SUCCESS',
      });
      return true;
    }
    return false;
  };

  const handleManualBroadcast = async () => {
    if (!activeTrip) return;
    const currentTxs = transactions.filter((tx) => tx.tripId === activeTrip.id);
    await broadcastTripEvent(activeTrip.id, {
      type: 'SYNC_SNAPSHOT',
      trip: activeTrip,
      transactions: currentTxs,
    });
    setStatusToast({
      message: `⚡ Live Synced ${currentTxs.length} transactions to all friends!`,
      type: 'SUCCESS',
    });
  };

  const handleAddMemberInline = async (memberName: string): Promise<string | null> => {
    if (!activeTrip) return null;
    const trimmed = memberName.trim();
    if (!trimmed) return null;
    const newId = `mem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const nextColor = AVATAR_COLORS[activeTrip.members.length % AVATAR_COLORS.length];
    const updatedTrip: Trip = {
      ...activeTrip,
      members: [
        ...activeTrip.members,
        { id: newId, name: trimmed, role: 'MEMBER', avatarColor: nextColor },
      ],
      updatedAt: new Date().toISOString(),
      syncStatus: 'PENDING',
    };
    await handleSaveTrip(updatedTrip);
    return newId;
  };

  const handleDeleteTrip = async (tripId: string) => {
    await deleteTripLocal(tripId);
    const remaining = trips.filter((t) => t.id !== tripId);
    setTrips(remaining);
    setTransactions((prev) => prev.filter((tx) => tx.tripId !== tripId));
    setAuditLogs((prev) => prev.filter((log) => log.tripId !== tripId));
    setDeleteTripConfirmOpen(false);
    if (remaining.length > 0) {
      const nextTrip = remaining[0];
      setActiveTripId(nextTrip.id);
      setActiveViewerMemberId(
        nextTrip.treasurerMemberId || nextTrip.members[0]?.id || 'mem-1'
      );
    } else {
      setActiveTripId('');
    }
  };

  const handleClearTripTransactions = async (tripId: string) => {
    await clearTripTransactionsLocal(tripId);
    setTransactions((prev) => prev.filter((tx) => tx.tripId !== tripId));
    setAuditLogs((prev) => prev.filter((log) => log.tripId !== tripId));
    setDeleteTripConfirmOpen(false);
  };

  const handleRestoreSampleTrip = async () => {
    const seeded = await initializeLocalDatabase(true);
    setTrips(seeded.trips);
    setTransactions(seeded.transactions);
    setAuditLogs(seeded.auditLogs);
    setLastSyncedAt(seeded.lastSyncedAt);
    if (seeded.trips[0]) {
      setActiveTripId(seeded.trips[0].id);
      setActiveViewerMemberId(
        seeded.trips[0].treasurerMemberId || seeded.trips[0].members[0]?.id || 'mem-1'
      );
    }
  };

  const handleToggleTripStatus = async () => {
    if (!activeTrip) return;
    const nextStatus = activeTrip.status === 'CLOSED' ? 'ACTIVE' : 'CLOSED';
    const updated: Trip = {
      ...activeTrip,
      status: nextStatus,
      closedAt: nextStatus === 'CLOSED' ? new Date().toISOString() : null,
      updatedAt: new Date().toISOString(),
      syncStatus: 'PENDING',
    };
    await handleSaveTrip(updated);
  };

  const handleConfigurePin = async (newPin: string | null) => {
    if (!newPin) {
      localStorage.removeItem('poolmint_pin_sha256');
      setPinHash(null);
      setIsLocked(false);
    } else {
      const hashed = await sha256Hex(newPin);
      localStorage.setItem('poolmint_pin_sha256', hashed);
      setPinHash(hashed);
    }
  };

  const handleUnlockPin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pinHash) {
      setIsLocked(false);
      return;
    }
    const candidate = await sha256Hex(unlockAttempt);
    if (candidate === pinHash) {
      setIsLocked(false);
      setUnlockAttempt('');
      setUnlockError('');
    } else {
      setUnlockError('Incorrect 4-digit PIN.');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-300 text-sm">
        Loading Pool Mint Travel Treasury...
      </div>
    );
  }

  if (!activeTrip || !report) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white p-6">
        <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 text-center space-y-4 shadow-lg">
          <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto">
            <Wallet className="w-6 h-6" />
          </div>
          <h1 className="text-xl font-bold">No Active Trips</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            Your previous trip was deleted. Create a new group trip with a shared Common Pool Wallet, or load the sample Goa trip to explore.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-2.5 pt-2">
            <button
              type="button"
              onClick={() => setTripModalState({ open: true, editingTrip: null })}
              className="w-full sm:w-auto rounded-xl bg-emerald-600 hover:bg-emerald-500 px-5 py-2.5 text-xs font-semibold text-white"
            >
              + Create New Trip
            </button>
            <button
              type="button"
              onClick={handleRestoreSampleTrip}
              className="w-full sm:w-auto rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-2.5 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              Load Sample Goa Trip
            </button>
          </div>
        </div>

        {tripModalState.open && (
          <TripModal
            existingTrip={null}
            onClose={() => setTripModalState({ open: false, editingTrip: null })}
            onSaveTrip={handleSaveTrip}
          />
        )}
      </div>
    );
  }

  if (isLocked && pinHash) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-white p-4">
        <form
          onSubmit={handleUnlockPin}
          className="w-full max-w-sm rounded-2xl bg-slate-900 border border-slate-800 p-6 space-y-4 text-center"
        >
          <Lock className="w-10 h-10 text-emerald-400 mx-auto" />
          <h1 className="text-xl font-bold">Pool Mint PIN Locked</h1>
          <p className="text-xs text-slate-400">
            Enter your 4-digit security PIN to access group treasury records.
          </p>
          <input
            type="password"
            maxLength={4}
            autoFocus
            value={unlockAttempt}
            onChange={(e) => setUnlockAttempt(e.target.value.replace(/\D/g, ''))}
            placeholder="••••"
            className="w-36 mx-auto block text-center tracking-widest text-xl font-mono rounded-xl border border-slate-700 bg-slate-800 py-2.5 text-white"
          />
          {unlockError && <p className="text-xs text-rose-400">{unlockError}</p>}
          <button
            type="submit"
            className="w-full rounded-xl bg-emerald-600 hover:bg-emerald-500 py-2.5 text-xs font-semibold text-white"
          >
            Unlock Wallet
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col relative">
      {/* GLOBAL TOAST BANNER */}
      {statusToast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-slate-900/95 dark:bg-emerald-950/95 text-white border border-emerald-500/50 shadow-2xl backdrop-blur-md text-xs font-semibold animate-in fade-in slide-in-from-top duration-200">
          <span>{statusToast.message}</span>
        </div>
      )}
      {/* TOP BAR CONTRACT: 3-Zone Header with iOS Safe Area Top Padding */}
      <header className="sticky top-0 z-30 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 px-4 sm:px-6 pt-safe min-h-[56px] flex items-center justify-between gap-4">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab('HOME');
          }}
          className="text-lg font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0"
        >
          Pool Mint
        </a>

        {/* Zone 2: Desktop Navigation Links (single-line) */}
        <nav
          aria-label="Primary Navigation"
          className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600 dark:text-slate-300"
        >
          {(
            [
              { id: 'HOME', label: 'Home & Balances' },
              { id: 'POOL', label: 'Pool Money' },
              { id: 'EXPENSES', label: 'Expenses' },
              { id: 'TRANSFER', label: 'Transfers' },
              { id: 'MORE', label: 'Activity & Settings' },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === item.id
                  ? 'text-emerald-600 dark:text-emerald-400 font-semibold underline underline-offset-8 decoration-2'
                  : 'hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>

        {/* Zone 3: Primary Action */}
        <div className="flex items-center gap-2 shrink-0">
          <PWAInstallButton />
          <button
            type="button"
            onClick={() => setJoinWithPinModalOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 transition-colors whitespace-nowrap shrink-0 min-h-[38px]"
            title="Join a trip using a 4-digit PIN or invite link"
          >
            <KeyRound className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            <span>Join with PIN</span>
          </button>
          <button
            type="button"
            onClick={() =>
              setTripModalState({ open: true, editingTrip: null })
            }
            className="rounded-lg bg-slate-900 dark:bg-emerald-600 hover:opacity-90 px-3.5 py-2 text-xs font-semibold text-white transition-opacity whitespace-nowrap shrink-0 min-h-[38px]"
          >
            New Trip
          </button>
        </div>
      </header>

      {/* PHASE 5: OFFLINE BANNER WHEN DISCONNECTED */}
      {!isEffectiveOnline && (
        <div
          role="status"
          data-testid="offline-banner"
          className="bg-amber-500/95 text-slate-950 px-4 py-2 text-xs font-semibold text-center flex items-center justify-center gap-2"
        >
          <WifiOff className="w-4 h-4 shrink-0" />
          <span>
            You are offline. Your transactions are being saved securely on this device and will synchronize when internet returns.
          </span>
        </div>
      )}

      {/* WORKSPACE UTILITY, LIVE POOL MONEY INDICATOR & SYNCHRONIZATION STATUS BAR */}
      <div className="bg-slate-100/80 dark:bg-slate-900/50 border-b border-slate-200/80 dark:border-slate-800/80 px-4 sm:px-6 py-2">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2 text-xs">
          {/* Active Trip Switcher + Always-Visible Pool Balance Pill */}
          <div className="flex flex-wrap items-center gap-2">
            <Compass className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <label htmlFor="trip-switcher-select" className="sr-only">
              Select Active Trip
            </label>
            <select
              id="trip-switcher-select"
              value={activeTrip.id}
              onChange={(e) => {
                setActiveTripId(e.target.value);
                const found = trips.find((t) => t.id === e.target.value);
                if (found?.members[0]) {
                  setActiveViewerMemberId(found.treasurerMemberId || found.members[0].id);
                }
              }}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 font-semibold text-slate-900 dark:text-white"
            >
              {trips.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.currency})
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() =>
                setTripModalState({ open: true, editingTrip: activeTrip })
              }
              className="text-slate-600 dark:text-slate-300 hover:underline px-1.5 py-1 whitespace-nowrap font-medium"
            >
              Edit Trip &amp; Members
            </button>

            <button
              type="button"
              onClick={() => setDeleteTripConfirmOpen(true)}
              className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400 hover:underline px-1.5 py-1 whitespace-nowrap font-semibold"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete Trip</span>
            </button>

            {/* Always-Visible Common Pool Balance Pill ("Shows how much money we have") */}
            <button
              type="button"
              onClick={() => setActiveTab('POOL')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600/10 dark:bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-1 font-mono font-bold text-emerald-800 dark:text-emerald-300 hover:bg-emerald-600/20 transition-colors"
            >
              <Wallet className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>
                Pool We Have: {formatCurrency(report.totalPoolBalancePaise, activeTrip.currency)}
              </span>
            </button>
          </div>

          {/* Phase 5 Synchronization Indicator (GREEN / ORANGE / BLUE / RED) */}
          <div className="flex flex-wrap items-center gap-2.5">
            <div
              data-testid="sync-status-indicator"
              className={`flex items-center gap-1.5 font-mono font-semibold ${
                syncIndicatorColor === 'GREEN'
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : syncIndicatorColor === 'ORANGE'
                    ? 'text-amber-700 dark:text-amber-400'
                    : syncIndicatorColor === 'BLUE'
                      ? 'text-blue-700 dark:text-blue-400'
                      : 'text-rose-700 dark:text-rose-400'
              }`}
            >
              {syncIndicatorColor === 'RED' ? (
                <AlertCircle className="w-3.5 h-3.5" />
              ) : isEffectiveOnline ? (
                <Wifi className="w-3.5 h-3.5" />
              ) : (
                <WifiOff className="w-3.5 h-3.5" />
              )}
              <span>{syncStateLabel}</span>
              <span>· {pendingSyncCount} pending</span>
            </div>

            <button
              type="button"
              onClick={synchronizeWithBackend}
              disabled={!isEffectiveOnline || isSyncing}
              className="flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
            >
              <RefreshCw className={`w-3 h-3 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>Sync Now</span>
            </button>

            <button
              type="button"
              onClick={() =>
                setSimulatedOffline((prev) => {
                  const next = !prev;
                  try {
                    sessionStorage.setItem('poolmint_simulated_offline', next ? '1' : '0');
                  } catch {
                    // ignore storage error
                  }
                  return next;
                })
              }
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 whitespace-nowrap"
            >
              {simulatedOffline ? 'Reconnect Online' : 'Simulate Offline'}
            </button>

            <button
              type="button"
              onClick={() => setDarkMode((prev) => !prev)}
              aria-label={darkMode ? 'Switch to light theme' : 'Switch to dark theme'}
              className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50"
            >
              {darkMode ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
      </div>

      {/* MAIN CONTENT VIEWPORT */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 pt-5 pb-24 md:pb-12">
        {activeTab === 'HOME' && (
          <DashboardView
            trip={activeTrip}
            transactions={transactions}
            report={report}
            currentRole={currentRole}
            activeViewerMemberId={activeViewerMemberId}
            onChangeViewerMemberId={setActiveViewerMemberId}
            onQuickAdd={(mode, memberId) =>
              setQuickActionState({
                open: true,
                mode,
                defaultMemberId: memberId,
              })
            }
            onSelectTransactionToEdit={(tx) => setEditingTransactionModalTx(tx)}
            onSettleDebt={handleSettleDebt}
            onToggleTripStatus={handleToggleTripStatus}
            onOpenTripSettings={() =>
              setTripModalState({ open: true, editingTrip: activeTrip })
            }
            onOpenInviteModal={() => setInviteModalOpen(true)}
            onManualLiveSync={handleManualBroadcast}
            onRequestDeleteTrip={() => setDeleteTripConfirmOpen(true)}
            onSaveTripInline={handleSaveTrip}
            onAddMemberInline={handleAddMemberInline}
          />
        )}

        {activeTab === 'POOL' && (
          <PoolView
            trip={activeTrip}
            transactions={transactions}
            report={report}
            currentRole={currentRole}
            onAddContribution={handleAddContribution}
            onSelectTransactionToEdit={(tx) => setEditingTransactionModalTx(tx)}
          />
        )}

        {activeTab === 'TRANSFER' && (
          <TransferView
            trip={activeTrip}
            transactions={transactions}
            onAddTransfer={handleAddTransfer}
            onSelectTransactionToEdit={(tx) => setEditingTransactionModalTx(tx)}
          />
        )}

        {activeTab === 'EXPENSES' && (
          <ExpensesView
            trip={activeTrip}
            transactions={transactions}
            report={report}
            onAddExpense={handleAddExpense}
            onSelectTransactionToEdit={(tx) => setEditingTransactionModalTx(tx)}
          />
        )}

        {activeTab === 'MORE' && (
          <MoreView
            trip={activeTrip}
            allTrips={trips}
            transactions={transactions}
            auditLogs={auditLogs}
            report={report}
            currentRole={currentRole}
            onChangeRole={setCurrentRole}
            onReverseTransaction={handleReverseTransaction}
            onEditTransaction={handleEditTransaction}
            onRestoreBackup={async (rawPayload) => {
              const restored = await validateAndRestoreBackupToIndexedDB(rawPayload);
              setTrips(restored.trips);
              setTransactions(restored.transactions);
              setAuditLogs(restored.auditLogs);
              if (restored.trips[0]) setActiveTripId(restored.trips[0].id);
              return {
                importedTripsCount: restored.importedTripsCount,
                importedTransactionsCount: restored.importedTransactionsCount,
                skippedDuplicatesCount: restored.skippedDuplicatesCount,
              };
            }}
            syncStateLabel={syncStateLabel}
            syncIndicatorColor={syncIndicatorColor}
            lastSyncedAt={lastSyncedAt}
            pendingSyncCount={pendingSyncCount}
            cloudUserEmail={cloudUser?.email || null}
            onSignInCloud={async () => {
              await signInWithPopup(auth, googleAuthProvider);
              await synchronizeWithBackend();
            }}
            onSignOutCloud={async () => {
              await signOut(auth);
            }}
            onManualSync={synchronizeWithBackend}
            hasPinConfigured={Boolean(pinHash)}
            onConfigurePin={handleConfigurePin}
            onLockNow={() => setIsLocked(true)}
          />
        )}
      </main>

      {/* FLOATING QUICK '+' TRANSACTION BUTTON */}
      {activeTrip.status === 'ACTIVE' && (
        <button
          type="button"
          onClick={() => setQuickActionState({ open: true, mode: 'EXPENSE' })}
          aria-label="Quick add transaction"
          className="fixed right-4 bottom-20 md:bottom-6 z-40 w-14 h-14 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white shadow-xl flex items-center justify-center transition-transform active:scale-95"
        >
          <Plus className="w-7 h-7" />
        </button>
      )}

      {/* MOBILE BOTTOM NAVIGATION WITH iOS SAFE AREA INSET */}
      <nav
        aria-label="Mobile Bottom Navigation"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 grid grid-cols-5 items-center h-16 pb-safe"
      >
        {(
          [
            { id: 'HOME', label: 'Home', Icon: Home },
            { id: 'POOL', label: 'Pool', Icon: Wallet },
            { id: 'EXPENSES', label: 'Expenses', Icon: Receipt },
            { id: 'TRANSFER', label: 'Transfer', Icon: ArrowLeftRight },
            { id: 'MORE', label: 'Activity', Icon: MoreHorizontal },
          ] as const
        ).map(({ id, label, Icon }) => {
          const isActive = activeTab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className={`flex flex-col items-center justify-center h-full min-h-[44px] transition-colors ${
                isActive
                  ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="text-[10px] mt-1 tracking-tight whitespace-nowrap">
                {label}
              </span>
            </button>
          );
        })}
      </nav>

      {/* CREATE / EDIT TRIP MODAL */}
      {tripModalState.open && (
        <TripModal
          existingTrip={tripModalState.editingTrip}
          onClose={() => setTripModalState({ open: false, editingTrip: null })}
          onSaveTrip={handleSaveTrip}
          onDeleteTrip={handleDeleteTrip}
        />
      )}

      {/* DELETE WHOLE TRIP CONFIRMATION MODAL */}
      {deleteTripConfirmOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-trip-modal-title"
        >
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-2xl space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
                  <Trash2 className="w-5 h-5" />
                </div>
                <div>
                  <h2
                    id="delete-trip-modal-title"
                    className="text-lg font-bold text-slate-900 dark:text-white"
                  >
                    Delete “{activeTrip.name}”?
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {activeTrip.destination} · {activeTrip.members.length} travellers
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDeleteTripConfirmOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="rounded-xl bg-rose-50/70 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/60 p-3.5 text-xs text-rose-900 dark:text-rose-200 space-y-1">
              <p className="font-semibold">
                This trip has {transactions.filter((tx) => tx.tripId === activeTrip.id).length} recorded transactions and a Common Pool balance of {formatCurrency(report.totalPoolBalancePaise, activeTrip.currency)}.
              </p>
              <p className="text-[11px] text-rose-700 dark:text-rose-300">
                Choose whether to delete the entire trip or only clear its transactions while keeping the trip and members.
              </p>
            </div>

            <div className="space-y-2 pt-1">
              <button
                type="button"
                onClick={() => handleDeleteTrip(activeTrip.id)}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-rose-600 hover:bg-rose-500 py-3 px-4 text-xs font-bold text-white shadow-sm transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                <span>Yes, Delete Whole Trip Permanently</span>
              </button>

              <button
                type="button"
                onClick={() => handleClearTripTransactions(activeTrip.id)}
                className="w-full rounded-xl border border-amber-300 dark:border-amber-700/70 bg-amber-50/70 dark:bg-amber-950/30 hover:bg-amber-100/70 py-2.5 px-4 text-xs font-semibold text-amber-900 dark:text-amber-300 transition-colors"
              >
                Clear All Transactions Only (Reset Pool to {formatCurrency(0, activeTrip.currency)})
              </button>

              <button
                type="button"
                onClick={() => setDeleteTripConfirmOpen(false)}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 py-2.5 px-4 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TRACKMYSHARE-STYLE EXPRESS ADD MODAL */}
      {quickActionState.open && (
        <QuickActionModal
          trip={activeTrip}
          poolBalancePaise={report.totalPoolBalancePaise}
          initialMode={quickActionState.mode}
          defaultMemberId={quickActionState.defaultMemberId}
          onClose={() => setQuickActionState({ open: false, mode: 'EXPENSE' })}
          onQuickExpense={handleAddExpense}
          onQuickContribution={async (input) => {
            await handleAddContribution({
              ...input,
              reference: '',
            });
          }}
          onQuickTransfer={async (input) => {
            await handleAddTransfer({
              ...input,
              reference: '',
            });
          }}
          onAddMemberInline={handleAddMemberInline}
        />
      )}

      {/* FULL TRANSACTION EDITOR MODAL (CLICK ANY ITEM TO EDIT / DELETE / REVERSE) */}
      {editingTransactionModalTx && (
        <EditTransactionModal
          trip={activeTrip}
          transaction={editingTransactionModalTx}
          poolBalancePaise={report.totalPoolBalancePaise}
          onClose={() => setEditingTransactionModalTx(null)}
          onSaveTransaction={handleUpdateFullTransaction}
          onDeleteTransaction={handleDeleteTransaction}
          onReverseTransaction={handleReverseTransaction}
          onAddMemberInline={handleAddMemberInline}
        />
      )}

      {/* JOIN TRIP INVITATION MODAL */}
      {pendingJoinPayload && (
        <JoinTripModal
          payload={pendingJoinPayload}
          isExistingTrip={isExistingTripJoin}
          onJoin={handleJoinTripFromPayload}
          onClose={() => setPendingJoinPayload(null)}
        />
      )}

      {/* TRACKMYSHARE-STYLE SHARE TRIP LINK & PIN MODAL */}
      {inviteModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="invite-modal-title"
        >
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-2xl space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-2xl">🎉</span>
                <h2
                  id="invite-modal-title"
                  className="text-xl font-bold text-slate-900 dark:text-white mt-1"
                >
                  Share “{activeTrip.name}” with friends
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Share this 4-digit PIN and invite link with your friends. When they open it, your trip, members, and current expenses will load on their phone instantly!
                </p>
              </div>
              <button
                type="button"
                onClick={() => setInviteModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* 🔑 TRIP ACCESS PIN CARD */}
            <div className="rounded-2xl border-2 border-emerald-500/50 bg-emerald-50/70 dark:bg-emerald-950/40 p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-xs">
                    <KeyRound className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-1.5">
                      <span>Trip Access PIN</span>
                      <span className="px-1.5 py-0.2 rounded bg-emerald-600 text-white text-[10px] font-semibold">Active</span>
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Share this 4-digit PIN with your friends
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(activeTripPin);
                    setCopiedPin(true);
                    setTimeout(() => setCopiedPin(false), 2000);
                    setStatusToast({ message: `🔑 PIN ${activeTripPin} copied!`, type: 'SUCCESS' });
                  }}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-xs transition-colors"
                >
                  {copiedPin ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedPin ? 'Copied' : 'Copy PIN'}</span>
                </button>
              </div>

              {/* 4 Digit Boxes */}
              <div className="flex items-center justify-center gap-3 py-1.5">
                {activeTripPin.split('').map((digit, idx) => (
                  <div
                    key={idx}
                    className="w-12 h-14 rounded-2xl bg-white dark:bg-slate-900 border-2 border-emerald-500/60 shadow-md flex items-center justify-center text-2xl font-black font-mono text-emerald-700 dark:text-emerald-300 ring-2 ring-emerald-500/10"
                  >
                    {digit}
                  </div>
                ))}
              </div>
            </div>

            {/* Link Box */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3 flex items-center justify-between gap-2">
              <span className="text-xs font-mono text-slate-700 dark:text-slate-200 truncate">
                {isGeneratingShareUrl ? 'Generating live invite link...' : (shareUrl || 'Generating...')}
              </span>
              <button
                type="button"
                disabled={isGeneratingShareUrl || !shareUrl}
                onClick={() => {
                  if (!shareUrl) return;
                  navigator.clipboard?.writeText(shareUrl);
                  setCopiedLink(true);
                  setTimeout(() => setCopiedLink(false), 2500);
                  setStatusToast({ message: '🔗 Invite link copied to clipboard!', type: 'SUCCESS' });
                }}
                className="rounded-lg bg-slate-900 dark:bg-emerald-600 hover:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white shrink-0 flex items-center gap-1 disabled:opacity-50"
              >
                {copiedLink ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedLink ? 'Copied' : 'Copy'}</span>
              </button>
            </div>

            {/* Common Pool Highlight */}
            <div className="rounded-xl border border-amber-200 dark:border-amber-800/60 bg-amber-50/70 dark:bg-amber-950/30 p-3.5 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-amber-900 dark:text-amber-300">
                  Common Pool Balance Summary
                </p>
                <p className="text-lg font-bold font-mono text-slate-900 dark:text-white mt-0.5">
                  {formatCurrency(report.totalPoolBalancePaise, activeTrip.currency)} available
                </p>
                <p className="text-[11px] text-slate-500">
                  Collected: {formatCurrency(report.totalContributionsPaise, activeTrip.currency)} · Spent: {formatCurrency(report.totalExpensesPaise, activeTrip.currency)}
                </p>
              </div>
              <Share2 className="w-5 h-5 text-amber-600" />
            </div>

            {/* Info Badge */}
            <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60 text-[11px] text-emerald-800 dark:text-emerald-300 space-y-1">
              <p className="font-semibold flex items-center gap-1">
                <span>💡</span> Live Trip Snapshot Included
              </p>
              <p className="text-emerald-700/90 dark:text-emerald-400/90 leading-relaxed">
                Opening this link on a friend&apos;s phone will automatically import {activeTrip.members.length} members and {transactions.filter((t) => t.tripId === activeTrip.id).length} recorded transactions directly into their local wallet — no account or login needed.
              </p>
            </div>

            {/* Action Buttons */}
            <div className="grid grid-cols-2 gap-2.5 pt-2">
              <button
                type="button"
                disabled={isGeneratingShareUrl || !shareUrl}
                onClick={async () => {
                  if (!shareUrl) return;
                  const memberList = activeTrip.members.map((m) => m.name).join(', ');
                  const inviteText = `🧳 Join our trip "${activeTrip.name}" (${activeTrip.destination})!\n🔑 Access PIN: ${activeTripPin}\n👥 Members: ${memberList}\n💰 Common Pool Available: ${formatCurrency(report.totalPoolBalancePaise, activeTrip.currency)}\n🔗 Link: ${shareUrl}`;

                  if (typeof navigator !== 'undefined' && navigator.share) {
                    try {
                      await navigator.share({
                        title: `Join ${activeTrip.name} (PIN: ${activeTripPin}) on Pool Mint`,
                        text: inviteText,
                        url: shareUrl,
                      });
                      return;
                    } catch (err: any) {
                      if (err.name === 'AbortError') return;
                    }
                  }

                  // Fallback to clipboard
                  navigator.clipboard?.writeText(inviteText);
                  setCopiedLink(true);
                  setTimeout(() => setCopiedLink(false), 2500);
                  setStatusToast({ message: `💬 Invite with PIN ${activeTripPin} copied!`, type: 'SUCCESS' });
                }}
                className="rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 py-2.5 px-3 text-xs font-semibold text-white flex items-center justify-center gap-1.5 shadow-md transition-colors"
              >
                <Share2 className="w-3.5 h-3.5" />
                <span>Share via Apps</span>
              </button>
              <button
                type="button"
                onClick={() => setInviteModalOpen(false)}
                className="rounded-xl border border-slate-200 dark:border-slate-700 py-2.5 px-3 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* JOIN WITH PIN / LINK MODAL */}
      {joinWithPinModalOpen && (
        <JoinWithPinModal
          onJoinFromPayload={(payload) => {
            setPendingJoinPayload(payload);
            const existing = trips.some((t) => t.id === payload.trip.id);
            setIsExistingTripJoin(existing);
          }}
          onJoinLocalTripByPin={handleJoinLocalTripByPin}
          onClose={() => setJoinWithPinModalOpen(false)}
        />
      )}
    </div>
  );
}
