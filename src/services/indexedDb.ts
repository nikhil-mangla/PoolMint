import Dexie, { type Table } from 'dexie';
import {
  Trip,
  TripMember,
  Transaction,
  AuditLog,
  SyncQueueEntry,
  AppSettingRecord,
  DexieTableDiagnostics,
  TransactionLifecycleStatus,
} from '../types/treasury';
import { createInitialSeedData } from '../utils/accounting';

/**
 * PoolMintDexieDB — Reliable Offline-First IndexedDB Database powered by Dexie.js
 * Implements all 10 required tables with schema versioning and migrations:
 * 1. Trips
 * 2. Members
 * 3. Contributions
 * 4. Transfers
 * 5. Expenses
 * 6. Settlements
 * 7. TransactionLedger
 * 8. SyncQueue
 * 9. AuditLogs
 * 10. AppSettings
 */
export class PoolMintDexieDB extends Dexie {
  Trips!: Table<Trip, string>;
  Members!: Table<TripMember & { tripId: string }, string>;
  Contributions!: Table<Transaction, string>;
  Transfers!: Table<Transaction, string>;
  Expenses!: Table<Transaction, string>;
  Settlements!: Table<Transaction, string>;
  TransactionLedger!: Table<Transaction, string>;
  SyncQueue!: Table<SyncQueueEntry, string>;
  AuditLogs!: Table<AuditLog, string>;
  AppSettings!: Table<AppSettingRecord, string>;

  constructor() {
    super('PoolMintDexieTreasuryDB');

    // Version 1: Initial schema
    this.version(1).stores({
      Trips: 'id, status, updatedAt, syncStatus',
      Members: 'id, tripId, role',
      Contributions: 'id, tripId, fromMemberId, dateTime, syncStatus',
      Transfers: 'id, tripId, fromMemberId, toMemberId, dateTime, syncStatus',
      Expenses: 'id, tripId, category, paidByMemberId, paymentSource, dateTime, syncStatus',
      Settlements: 'id, tripId, fromMemberId, toMemberId, dateTime, syncStatus',
      TransactionLedger: 'id, tripId, type, dateTime, syncStatus, lifecycleStatus',
      SyncQueue: 'id, entityType, entityId, tripId, lifecycleStatus, updatedAt',
      AuditLogs: 'id, tripId, transactionId, timestamp, syncStatus',
      AppSettings: 'key, updatedAt',
    });

    // Version 2: Adds compound indexes and ensures lifecycleStatus on all ledger records
    this.version(2)
      .stores({
        Trips: 'id, status, updatedAt, syncStatus',
        Members: 'id, tripId, role',
        Contributions: 'id, tripId, fromMemberId, dateTime, syncStatus',
        Transfers: 'id, tripId, fromMemberId, toMemberId, dateTime, syncStatus',
        Expenses: 'id, tripId, category, paidByMemberId, paymentSource, dateTime, syncStatus',
        Settlements: 'id, tripId, fromMemberId, toMemberId, dateTime, syncStatus',
        TransactionLedger: 'id, tripId, type, dateTime, syncStatus, lifecycleStatus, [tripId+type]',
        SyncQueue: 'id, entityType, entityId, tripId, lifecycleStatus, updatedAt',
        AuditLogs: 'id, tripId, transactionId, timestamp, syncStatus',
        AppSettings: 'key, updatedAt',
      })
      .upgrade(async (tx) => {
        await tx
          .table('TransactionLedger')
          .toCollection()
          .modify((record: Transaction) => {
            if (!record.lifecycleStatus) {
              record.lifecycleStatus =
                record.syncStatus === 'SYNCED' ? 'SYNCED' : 'PENDING_SYNC';
            }
          });
      });
  }
}

export const localDb = new PoolMintDexieDB();

/**
 * Generates an RFC4122-compliant or crypto.randomUUID unique identifier for offline transactions.
 */
export function generateUniqueId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Routes a Transaction into its specialized Dexie domain table in addition to TransactionLedger.
 */
async function syncDomainTableForTransaction(tx: Transaction): Promise<void> {
  switch (tx.type) {
    case 'CONTRIBUTION':
      await localDb.Contributions.put(tx);
      break;
    case 'TRANSFER':
      await localDb.Transfers.put(tx);
      break;
    case 'EXPENSE':
      await localDb.Expenses.put(tx);
      break;
    case 'SETTLEMENT':
    case 'REFUND':
    case 'WITHDRAWAL':
      await localDb.Settlements.put(tx);
      break;
    default:
      break;
  }
}

/**
 * Syncs a trip's members into the dedicated Members table.
 */
async function syncMembersTableForTrip(trip: Trip): Promise<void> {
  const existing = await localDb.Members.where('tripId').equals(trip.id).toArray();
  const currentIds = new Set(trip.members.map((m) => `${trip.id}::${m.id}`));
  for (const old of existing) {
    if (!currentIds.has(old.id)) {
      await localDb.Members.delete(old.id);
    }
  }
  for (const m of trip.members) {
    await localDb.Members.put({
      ...m,
      id: `${trip.id}::${m.id}`,
      tripId: trip.id,
    });
  }
}

export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
      const isPersisted = await navigator.storage.persisted();
      if (isPersisted) return true;
      return await navigator.storage.persist();
    }
  } catch {
    // Safari / private browsing fallback
  }
  return false;
}

export async function getAppSetting(key: string): Promise<string | null> {
  try {
    const rec = await localDb.AppSettings.get(key);
    return rec ? rec.value : null;
  } catch {
    return null;
  }
}

export async function setAppSetting(key: string, value: string): Promise<void> {
  try {
    await localDb.AppSettings.put({
      key,
      value,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Failed to persist AppSetting:', err);
  }
}

export async function getDexieTableDiagnostics(): Promise<DexieTableDiagnostics> {
  const [
    Trips,
    Members,
    Contributions,
    Transfers,
    Expenses,
    Settlements,
    TransactionLedger,
    SyncQueue,
    AuditLogs,
    AppSettings,
  ] = await Promise.all([
    localDb.Trips.count(),
    localDb.Members.count(),
    localDb.Contributions.count(),
    localDb.Transfers.count(),
    localDb.Expenses.count(),
    localDb.Settlements.count(),
    localDb.TransactionLedger.count(),
    localDb.SyncQueue.count(),
    localDb.AuditLogs.count(),
    localDb.AppSettings.count(),
  ]);

  return {
    Trips,
    Members,
    Contributions,
    Transfers,
    Expenses,
    Settlements,
    TransactionLedger,
    SyncQueue,
    AuditLogs,
    AppSettings,
  };
}

export async function initializeLocalDatabase(forceSeed = false): Promise<{
  trips: Trip[];
  transactions: Transaction[];
  auditLogs: AuditLog[];
  lastSyncedAt: string | null;
}> {
  await requestPersistentStorage();

  const existingTrips = await localDb.Trips.toArray();
  const hasInitializedSeed = await getAppSetting('hasInitializedSeed');

  if (!forceSeed && (existingTrips.length > 0 || hasInitializedSeed === 'true')) {
    const transactions = await localDb.TransactionLedger.toArray();
    const auditLogs = await localDb.AuditLogs.toArray();
    const lastSyncedAt = await getAppSetting('lastSyncedAt');
    return {
      trips: existingTrips.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      transactions: transactions.sort((a, b) => b.dateTime.localeCompare(a.dateTime)),
      auditLogs: auditLogs.sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
      lastSyncedAt,
    };
  }

  // First launch (or explicit sample reload): Seed all 10 Dexie tables atomically
  const seed = createInitialSeedData();
  const nowIso = new Date().toISOString();

  await localDb.transaction(
    'rw',
    [
      localDb.Trips,
      localDb.Members,
      localDb.Contributions,
      localDb.Transfers,
      localDb.Expenses,
      localDb.Settlements,
      localDb.TransactionLedger,
      localDb.AuditLogs,
      localDb.AppSettings,
    ],
    async () => {
      for (const trip of seed.trips) {
        const seededTrip: Trip = { ...trip, lifecycleStatus: 'SYNCED' };
        await localDb.Trips.put(seededTrip);
        await syncMembersTableForTrip(seededTrip);
      }
      for (const tx of seed.transactions) {
        const seededTx: Transaction = { ...tx, lifecycleStatus: 'SYNCED' };
        await localDb.TransactionLedger.put(seededTx);
        await syncDomainTableForTransaction(seededTx);
      }
      for (const log of seed.auditLogs) {
        await localDb.AuditLogs.put(log);
      }
      await localDb.AppSettings.put({
        key: 'lastSyncedAt',
        value: nowIso,
        updatedAt: nowIso,
      });
      await localDb.AppSettings.put({
        key: 'hasInitializedSeed',
        value: 'true',
        updatedAt: nowIso,
      });
    }
  );

  return {
    ...seed,
    lastSyncedAt: nowIso,
  };
}

export async function saveTripLocal(trip: Trip): Promise<void> {
  const now = new Date().toISOString();
  await localDb.transaction(
    'rw',
    [localDb.Trips, localDb.Members, localDb.SyncQueue, localDb.AppSettings],
    async () => {
      const toStore: Trip = {
        ...trip,
        lifecycleStatus: trip.syncStatus === 'SYNCED' ? 'SYNCED' : 'PENDING_SYNC',
      };
      await localDb.Trips.put(toStore);
      await syncMembersTableForTrip(toStore);
      await localDb.AppSettings.put({
        key: 'hasInitializedSeed',
        value: 'true',
        updatedAt: now,
      });

      if (toStore.syncStatus === 'PENDING') {
        await localDb.SyncQueue.put({
          id: `sq-trip-${trip.id}`,
          entityType: 'TRIP',
          entityId: trip.id,
          tripId: trip.id,
          lifecycleStatus: 'PENDING_SYNC',
          retryCount: 0,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
  );
}

export async function deleteTripLocal(tripId: string): Promise<void> {
  const now = new Date().toISOString();
  await localDb.transaction(
    'rw',
    [
      localDb.Trips,
      localDb.Members,
      localDb.Contributions,
      localDb.Transfers,
      localDb.Expenses,
      localDb.Settlements,
      localDb.TransactionLedger,
      localDb.SyncQueue,
      localDb.AuditLogs,
      localDb.AppSettings,
    ],
    async () => {
      await localDb.Trips.delete(tripId);
      await localDb.Members.where('tripId').equals(tripId).delete();
      await localDb.Contributions.where('tripId').equals(tripId).delete();
      await localDb.Transfers.where('tripId').equals(tripId).delete();
      await localDb.Expenses.where('tripId').equals(tripId).delete();
      await localDb.Settlements.where('tripId').equals(tripId).delete();
      await localDb.TransactionLedger.where('tripId').equals(tripId).delete();
      await localDb.SyncQueue.where('tripId').equals(tripId).delete();
      await localDb.AuditLogs.where('tripId').equals(tripId).delete();
      await localDb.AppSettings.put({
        key: 'hasInitializedSeed',
        value: 'true',
        updatedAt: now,
      });
    }
  );
}

export async function clearTripTransactionsLocal(tripId: string): Promise<void> {
  await localDb.transaction(
    'rw',
    [
      localDb.Contributions,
      localDb.Transfers,
      localDb.Expenses,
      localDb.Settlements,
      localDb.TransactionLedger,
      localDb.SyncQueue,
      localDb.AuditLogs,
    ],
    async () => {
      await localDb.Contributions.where('tripId').equals(tripId).delete();
      await localDb.Transfers.where('tripId').equals(tripId).delete();
      await localDb.Expenses.where('tripId').equals(tripId).delete();
      await localDb.Settlements.where('tripId').equals(tripId).delete();
      await localDb.TransactionLedger.where('tripId').equals(tripId).delete();
      await localDb.SyncQueue
        .where('tripId')
        .equals(tripId)
        .filter((item) => item.entityType === 'TRANSACTION')
        .delete();
      await localDb.AuditLogs.where('tripId').equals(tripId).delete();
    }
  );
}

/**
 * Writes a transaction atomically to Dexie IndexedDB following the lifecycle:
 * LOCAL_SAVE -> PENDING_SYNC -> SYNCING -> SYNCED (or RETRY on failure).
 */
export async function saveTransactionLocal(
  tx: Transaction,
  auditLog?: AuditLog
): Promise<void> {
  const now = new Date().toISOString();
  await localDb.transaction(
    'rw',
    [
      localDb.TransactionLedger,
      localDb.Contributions,
      localDb.Transfers,
      localDb.Expenses,
      localDb.Settlements,
      localDb.SyncQueue,
      localDb.AuditLogs,
    ],
    async () => {
      // Step 1: LOCAL_SAVE -> PENDING_SYNC
      const preparedTx: Transaction = {
        ...tx,
        lifecycleStatus: tx.syncStatus === 'SYNCED' ? 'SYNCED' : 'PENDING_SYNC',
      };
      await localDb.TransactionLedger.put(preparedTx);
      await syncDomainTableForTransaction(preparedTx);

      if (preparedTx.syncStatus === 'PENDING') {
        await localDb.SyncQueue.put({
          id: `sq-tx-${preparedTx.id}`,
          entityType: 'TRANSACTION',
          entityId: preparedTx.id,
          tripId: preparedTx.tripId,
          lifecycleStatus: 'PENDING_SYNC',
          retryCount: 0,
          createdAt: now,
          updatedAt: now,
        });
      }

      if (auditLog) {
        await localDb.AuditLogs.put(auditLog);
      }
    }
  );
}

export async function deleteTransactionLocal(
  txId: string,
  auditLog?: AuditLog
): Promise<void> {
  await localDb.transaction(
    'rw',
    [
      localDb.TransactionLedger,
      localDb.Contributions,
      localDb.Transfers,
      localDb.Expenses,
      localDb.Settlements,
      localDb.SyncQueue,
      localDb.AuditLogs,
    ],
    async () => {
      await localDb.TransactionLedger.delete(txId);
      await localDb.Contributions.delete(txId);
      await localDb.Transfers.delete(txId);
      await localDb.Expenses.delete(txId);
      await localDb.Settlements.delete(txId);
      await localDb.SyncQueue.delete(`sq-tx-${txId}`);
      if (auditLog) {
        await localDb.AuditLogs.put(auditLog);
      }
    }
  );
}

export async function updateSyncLifecycleStatusLocal(
  status: TransactionLifecycleStatus,
  errorMessage?: string
): Promise<void> {
  const now = new Date().toISOString();
  await localDb.SyncQueue.toCollection().modify((entry: SyncQueueEntry) => {
    entry.lifecycleStatus = status;
    entry.lastAttemptAt = now;
    entry.updatedAt = now;
    if (status === 'RETRY') {
      entry.retryCount = (entry.retryCount || 0) + 1;
      entry.errorMessage = errorMessage || 'Network synchronization failed';
    }
  });
}

export async function markAllSyncedLocal(
  trips: Trip[],
  transactions: Transaction[],
  auditLogs: AuditLog[]
): Promise<{
  trips: Trip[];
  transactions: Transaction[];
  auditLogs: AuditLog[];
  lastSyncedAt: string;
}> {
  const now = new Date().toISOString();
  const updatedTrips = trips.map((t) => ({
    ...t,
    syncStatus: 'SYNCED' as const,
    lifecycleStatus: 'SYNCED' as const,
  }));
  const updatedTransactions = transactions.map((tx) => ({
    ...tx,
    syncStatus: 'SYNCED' as const,
    lifecycleStatus: 'SYNCED' as const,
  }));
  const updatedAuditLogs = auditLogs.map((l) => ({
    ...l,
    syncStatus: 'SYNCED' as const,
  }));

  await localDb.transaction(
    'rw',
    [
      localDb.Trips,
      localDb.TransactionLedger,
      localDb.Contributions,
      localDb.Transfers,
      localDb.Expenses,
      localDb.Settlements,
      localDb.SyncQueue,
      localDb.AuditLogs,
      localDb.AppSettings,
    ],
    async () => {
      for (const t of updatedTrips) await localDb.Trips.put(t);
      for (const tx of updatedTransactions) {
        await localDb.TransactionLedger.put(tx);
        await syncDomainTableForTransaction(tx);
      }
      for (const l of updatedAuditLogs) await localDb.AuditLogs.put(l);
      await localDb.SyncQueue.clear();
      await localDb.AppSettings.put({
        key: 'lastSyncedAt',
        value: now,
        updatedAt: now,
      });
    }
  );

  return {
    trips: updatedTrips,
    transactions: updatedTransactions,
    auditLogs: updatedAuditLogs,
    lastSyncedAt: now,
  };
}

/**
 * Merges cloud state with local Dexie IndexedDB state using deterministic timestamp & UUID conflict resolution.
 * Never overwrites or loses local financial transactions silently.
 */
export async function mergeCloudAndLocalData(
  localTrips: Trip[],
  localTxs: Transaction[],
  localLogs: AuditLog[],
  cloudData: {
    trips: any[];
    transactions: any[];
    auditLogs: any[];
  }
): Promise<{
  trips: Trip[];
  transactions: Transaction[];
  auditLogs: AuditLog[];
  conflictsResolved: number;
  lastSyncedAt: string;
}> {
  let conflictsResolved = 0;
  const now = new Date().toISOString();

  const tripMap = new Map<string, Trip>();
  for (const lt of localTrips) {
    tripMap.set(lt.id, { ...lt, syncStatus: 'SYNCED', lifecycleStatus: 'SYNCED' });
  }

  for (const ct of cloudData.trips || []) {
    const parsedCloudTrip: Trip = {
      id: ct.id,
      name: ct.name,
      destination: ct.destination,
      startDate: ct.startDate,
      endDate: ct.endDate,
      currency: ct.currency || 'INR',
      budgetPaise: Number(ct.budgetPaise || 0),
      description: ct.description || '',
      treasurerMemberId: ct.treasurerMemberId,
      status: ct.status === 'CLOSED' ? 'CLOSED' : 'ACTIVE',
      allowNegativePool: Boolean(ct.allowNegativePool),
      members: JSON.parse(ct.membersJson || '[]'),
      customCategories: JSON.parse(ct.customCategoriesJson || '[]'),
      closedAt: ct.closedAt || null,
      updatedAt: ct.updatedAt,
      syncStatus: 'SYNCED',
      lifecycleStatus: 'SYNCED',
    };

    const existing = tripMap.get(parsedCloudTrip.id);
    if (!existing) {
      tripMap.set(parsedCloudTrip.id, parsedCloudTrip);
    } else if (parsedCloudTrip.updatedAt > existing.updatedAt) {
      conflictsResolved += 1;
      tripMap.set(parsedCloudTrip.id, parsedCloudTrip);
    }
  }

  const txMap = new Map<string, Transaction>();
  for (const ltx of localTxs) {
    txMap.set(ltx.id, { ...ltx, syncStatus: 'SYNCED', lifecycleStatus: 'SYNCED' });
  }

  for (const ctx of cloudData.transactions || []) {
    const parsedCloudTx: Transaction = {
      id: ctx.id,
      tripId: ctx.tripId,
      type: ctx.type,
      title: ctx.title,
      amountPaise: Number(ctx.amountPaise),
      currency: ctx.currency || 'INR',
      dateTime: ctx.dateTime,
      paymentMethod: ctx.paymentMethod,
      fromMemberId: ctx.fromMemberId,
      toMemberId: ctx.toMemberId,
      reference: ctx.reference,
      category: ctx.category,
      paidByMemberId: ctx.paidByMemberId,
      paymentSource: ctx.paymentSource,
      splitMethod: ctx.splitMethod,
      splits: ctx.splitsJson ? JSON.parse(ctx.splitsJson) : null,
      receiptDataUrl: ctx.receiptDataUrl,
      notes: ctx.notes || '',
      isReversed: Boolean(ctx.isReversed),
      reversalOfId: ctx.reversalOfId,
      reversedById: ctx.reversedById,
      createdByMemberId: ctx.createdByMemberId,
      updatedAt: ctx.updatedAt,
      syncStatus: 'SYNCED',
      lifecycleStatus: 'SYNCED',
    };

    const existing = txMap.get(parsedCloudTx.id);
    if (!existing) {
      txMap.set(parsedCloudTx.id, parsedCloudTx);
    } else if (parsedCloudTx.updatedAt > existing.updatedAt) {
      conflictsResolved += 1;
      txMap.set(parsedCloudTx.id, parsedCloudTx);
    }
  }

  const logMap = new Map<string, AuditLog>();
  for (const llog of localLogs) {
    logMap.set(llog.id, { ...llog, syncStatus: 'SYNCED' });
  }

  for (const clog of cloudData.auditLogs || []) {
    if (!logMap.has(clog.id)) {
      logMap.set(clog.id, {
        id: clog.id,
        tripId: clog.tripId,
        transactionId: clog.transactionId,
        action: clog.action,
        actorName: clog.actorName,
        timestamp: clog.timestamp,
        previousValueJson: clog.previousValueJson,
        newValueJson: clog.newValueJson,
        notes: clog.notes || '',
        syncStatus: 'SYNCED',
      });
    }
  }

  const mergedTrips = Array.from(tripMap.values()).sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt)
  );
  const mergedTxs = Array.from(txMap.values()).sort((a, b) =>
    b.dateTime.localeCompare(a.dateTime)
  );
  const mergedLogs = Array.from(logMap.values()).sort((a, b) =>
    b.timestamp.localeCompare(a.timestamp)
  );

  for (const t of mergedTrips) {
    await localDb.Trips.put(t);
    await syncMembersTableForTrip(t);
  }
  for (const tx of mergedTxs) {
    await localDb.TransactionLedger.put(tx);
    await syncDomainTableForTransaction(tx);
  }
  for (const l of mergedLogs) {
    await localDb.AuditLogs.put(l);
  }
  await localDb.SyncQueue.clear();
  await setAppSetting('lastSyncedAt', now);

  return {
    trips: mergedTrips,
    transactions: mergedTxs,
    auditLogs: mergedLogs,
    conflictsResolved,
    lastSyncedAt: now,
  };
}

/**
 * Validates and imports a backup JSON file into Dexie IndexedDB while preventing duplicate imports.
 */
export async function validateAndRestoreBackupToIndexedDB(rawPayload: any): Promise<{
  trips: Trip[];
  transactions: Transaction[];
  auditLogs: AuditLog[];
  importedTripsCount: number;
  importedTransactionsCount: number;
  skippedDuplicatesCount: number;
}> {
  if (!rawPayload || typeof rawPayload !== 'object') {
    throw new Error('Backup validation failed: File is not a valid JSON object.');
  }
  if (!Array.isArray(rawPayload.trips) || !Array.isArray(rawPayload.transactions)) {
    throw new Error('Backup validation failed: Missing required "trips" or "transactions" arrays.');
  }

  for (const t of rawPayload.trips) {
    if (!t.id || !t.name || !Array.isArray(t.members)) {
      throw new Error('Backup validation failed: One or more trips are missing id, name, or members.');
    }
  }
  for (const tx of rawPayload.transactions) {
    if (!tx.id || !tx.tripId || !tx.type || typeof tx.amountPaise !== 'number' || !tx.dateTime) {
      throw new Error(
        'Backup validation failed: One or more transactions are missing id, tripId, type, amountPaise, or dateTime.'
      );
    }
  }

  const existingTripIds = new Set((await localDb.Trips.toArray()).map((t) => t.id));
  const existingTxIds = new Set((await localDb.TransactionLedger.toArray()).map((tx) => tx.id));
  const existingLogIds = new Set((await localDb.AuditLogs.toArray()).map((l) => l.id));

  let importedTripsCount = 0;
  let importedTransactionsCount = 0;
  let skippedDuplicatesCount = 0;

  for (const t of rawPayload.trips as Trip[]) {
    if (existingTripIds.has(t.id)) {
      skippedDuplicatesCount += 1;
    } else {
      importedTripsCount += 1;
      const tripToSave: Trip = { ...t, syncStatus: 'PENDING', lifecycleStatus: 'PENDING_SYNC' };
      await saveTripLocal(tripToSave);
      existingTripIds.add(t.id);
    }
  }

  for (const tx of rawPayload.transactions as Transaction[]) {
    if (existingTxIds.has(tx.id)) {
      skippedDuplicatesCount += 1;
    } else {
      importedTransactionsCount += 1;
      await saveTransactionLocal({
        ...tx,
        syncStatus: 'PENDING',
        lifecycleStatus: 'PENDING_SYNC',
      });
      existingTxIds.add(tx.id);
    }
  }

  for (const l of (rawPayload.auditLogs || []) as AuditLog[]) {
    if (!existingLogIds.has(l.id)) {
      await localDb.AuditLogs.put({ ...l, syncStatus: 'PENDING' });
      existingLogIds.add(l.id);
    }
  }

  const initialized = await initializeLocalDatabase();
  return {
    trips: initialized.trips,
    transactions: initialized.transactions,
    auditLogs: initialized.auditLogs,
    importedTripsCount,
    importedTransactionsCount,
    skippedDuplicatesCount,
  };
}

/**
 * Imports a shared trip payload into local IndexedDB and merges its transactions.
 */
export async function importSharedTripData(
  trip: Trip,
  transactions: Transaction[]
): Promise<{
  trips: Trip[];
  transactions: Transaction[];
  isNewTrip: boolean;
  importedTxCount: number;
  updatedTxCount: number;
}> {
  const existingTrips = await localDb.Trips.toArray();
  const existingTrip = existingTrips.find((t) => t.id === trip.id);
  const isNewTrip = !existingTrip;

  // Save / Update Trip and its members
  const tripToSave: Trip = {
    ...trip,
    syncStatus: 'SYNCED',
    lifecycleStatus: 'SYNCED',
  };
  await saveTripLocal(tripToSave);

  // Existing transactions for this trip
  const existingTxs = await localDb.TransactionLedger.where('tripId').equals(trip.id).toArray();
  const existingTxMap = new Map(existingTxs.map((tx) => [tx.id, tx]));
  const incomingTxIds = new Set(transactions.map((tx) => tx.id));

  let importedTxCount = 0;
  let updatedTxCount = 0;

  for (const tx of transactions) {
    const existing = existingTxMap.get(tx.id);
    if (!existing) {
      importedTxCount += 1;
      await saveTransactionLocal({
        ...tx,
        syncStatus: 'SYNCED',
        lifecycleStatus: 'SYNCED',
      });
    } else {
      const hasChanged =
        existing.amountPaise !== tx.amountPaise ||
        existing.title !== tx.title ||
        existing.type !== tx.type ||
        existing.isReversed !== tx.isReversed ||
        existing.notes !== tx.notes ||
        existing.fromMemberId !== tx.fromMemberId ||
        existing.paidByMemberId !== tx.paidByMemberId ||
        existing.paymentMethod !== tx.paymentMethod ||
        existing.dateTime !== tx.dateTime ||
        existing.updatedAt !== tx.updatedAt;

      const isNewerOrEqual =
        !existing.updatedAt || !tx.updatedAt || tx.updatedAt >= existing.updatedAt;

      if (hasChanged && isNewerOrEqual) {
        updatedTxCount += 1;
        await saveTransactionLocal({
          ...tx,
          syncStatus: 'SYNCED',
          lifecycleStatus: 'SYNCED',
        });
      }
    }
  }

  // If incoming payload has transactions and any existing SYNCED transaction is absent from the snapshot, remove it
  if (transactions.length > 0) {
    for (const existing of existingTxs) {
      if (existing.syncStatus === 'SYNCED' && !incomingTxIds.has(existing.id)) {
        await deleteTransactionLocal(existing.id);
      }
    }
  }

  // Load freshly updated data from IndexedDB
  const allTrips = await localDb.Trips.toArray();
  const allTransactions = await localDb.TransactionLedger.toArray();

  return {
    trips: allTrips.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    transactions: allTransactions.sort((a, b) => b.dateTime.localeCompare(a.dateTime)),
    isNewTrip,
    importedTxCount,
    updatedTxCount,
  };
}
