import { db } from './index.ts';
import { users, trips, transactions, auditLogs } from './schema.ts';
import { eq } from 'drizzle-orm';

export async function getOrCreateUser(uid: string, email: string) {
  try {
    const result = await db
      .insert(users)
      .values({
        uid,
        email,
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: {
          email,
        },
      })
      .returning();

    return result[0];
  } catch (error) {
    console.error('Database user upsert failed:', error);
    throw new Error('Failed to synchronize user account with database.', { cause: error });
  }
}

export async function getUserCloudData(uid: string) {
  try {
    const userTrips = await db.select().from(trips).where(eq(trips.userUid, uid));
    const userTransactions = await db.select().from(transactions).where(eq(transactions.userUid, uid));
    const userAuditLogs = await db.select().from(auditLogs).where(eq(auditLogs.userUid, uid));
    return {
      trips: userTrips,
      transactions: userTransactions,
      auditLogs: userAuditLogs,
    };
  } catch (error) {
    console.error('Database query failed in getUserCloudData:', error);
    throw new Error('Failed to load cloud treasury data. Please try again.', { cause: error });
  }
}

export interface SyncTripInput {
  id: string;
  name: string;
  destination: string;
  startDate: string;
  endDate: string;
  currency: string;
  budgetPaise: number;
  description: string;
  treasurerMemberId: string;
  status: string;
  allowNegativePool: boolean;
  membersJson: string;
  customCategoriesJson: string;
  closedAt: string | null;
  updatedAt: string;
}

export interface SyncTransactionInput {
  id: string;
  tripId: string;
  type: string;
  title: string;
  amountPaise: number;
  currency: string;
  dateTime: string;
  paymentMethod: string;
  fromMemberId: string | null;
  toMemberId: string | null;
  reference: string | null;
  category: string | null;
  paidByMemberId: string | null;
  paymentSource: string | null;
  splitMethod: string | null;
  splitsJson: string | null;
  receiptDataUrl: string | null;
  notes: string;
  isReversed: boolean;
  reversalOfId: string | null;
  reversedById: string | null;
  createdByMemberId: string;
  updatedAt: string;
}

export interface SyncAuditLogInput {
  id: string;
  tripId: string;
  transactionId: string;
  action: string;
  actorName: string;
  timestamp: string;
  previousValueJson: string | null;
  newValueJson: string | null;
  notes: string;
}

export async function syncUserCloudData(
  uid: string,
  incomingTrips: SyncTripInput[],
  incomingTransactions: SyncTransactionInput[],
  incomingAuditLogs: SyncAuditLogInput[]
) {
  try {
    // 1. Idempotent upsert of trips
    for (const t of incomingTrips) {
      await db
        .insert(trips)
        .values({
          id: t.id,
          userUid: uid,
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
          membersJson: t.membersJson,
          customCategoriesJson: t.customCategoriesJson,
          closedAt: t.closedAt,
          updatedAt: t.updatedAt,
        })
        .onConflictDoUpdate({
          target: trips.id,
          set: {
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
            membersJson: t.membersJson,
            customCategoriesJson: t.customCategoriesJson,
            closedAt: t.closedAt,
            updatedAt: t.updatedAt,
          },
        });
    }

    // 2. Idempotent upsert of transactions (prevents duplicate syncs)
    for (const tx of incomingTransactions) {
      await db
        .insert(transactions)
        .values({
          id: tx.id,
          tripId: tx.tripId,
          userUid: uid,
          type: tx.type,
          title: tx.title,
          amountPaise: tx.amountPaise,
          currency: tx.currency,
          dateTime: tx.dateTime,
          paymentMethod: tx.paymentMethod,
          fromMemberId: tx.fromMemberId,
          toMemberId: tx.toMemberId,
          reference: tx.reference,
          category: tx.category,
          paidByMemberId: tx.paidByMemberId,
          paymentSource: tx.paymentSource,
          splitMethod: tx.splitMethod,
          splitsJson: tx.splitsJson,
          receiptDataUrl: tx.receiptDataUrl,
          notes: tx.notes,
          isReversed: tx.isReversed,
          reversalOfId: tx.reversalOfId,
          reversedById: tx.reversedById,
          createdByMemberId: tx.createdByMemberId,
          updatedAt: tx.updatedAt,
        })
        .onConflictDoUpdate({
          target: transactions.id,
          set: {
            title: tx.title,
            amountPaise: tx.amountPaise,
            dateTime: tx.dateTime,
            paymentMethod: tx.paymentMethod,
            notes: tx.notes,
            isReversed: tx.isReversed,
            reversedById: tx.reversedById,
            updatedAt: tx.updatedAt,
          },
        });
    }

    // 3. Idempotent upsert of audit logs
    for (const log of incomingAuditLogs) {
      await db
        .insert(auditLogs)
        .values({
          id: log.id,
          tripId: log.tripId,
          userUid: uid,
          transactionId: log.transactionId,
          action: log.action,
          actorName: log.actorName,
          timestamp: log.timestamp,
          previousValueJson: log.previousValueJson,
          newValueJson: log.newValueJson,
          notes: log.notes,
        })
        .onConflictDoNothing({
          target: auditLogs.id,
        });
    }

    return await getUserCloudData(uid);
  } catch (error) {
    console.error('Database sync failed:', error);
    throw new Error('Failed to synchronize transactions with Cloud SQL.', { cause: error });
  }
}
