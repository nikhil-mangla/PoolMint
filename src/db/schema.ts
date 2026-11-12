import { relations } from 'drizzle-orm';
import { boolean, integer, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';

// Users table using Firebase Auth UID
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

// Trips table for persisting travel treasury trips
export const trips = pgTable('trips', {
  id: text('id').primaryKey(), // Client-generated UUID for offline-first sync
  userUid: text('user_uid')
    .references(() => users.uid)
    .notNull(),
  name: text('name').notNull(),
  destination: text('destination').notNull(),
  startDate: text('start_date').notNull(),
  endDate: text('end_date').notNull(),
  currency: text('currency').notNull().default('INR'),
  budgetPaise: integer('budget_paise').notNull().default(0),
  description: text('description').notNull().default(''),
  treasurerMemberId: text('treasurer_member_id').notNull(),
  status: text('status').notNull().default('ACTIVE'), // ACTIVE | CLOSED
  allowNegativePool: boolean('allow_negative_pool').notNull().default(false),
  membersJson: text('members_json').notNull(), // JSON array of TripMember
  customCategoriesJson: text('custom_categories_json').notNull().default('[]'),
  closedAt: text('closed_at'),
  updatedAt: text('updated_at').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

// Double-entry ledger transactions table
export const transactions = pgTable('transactions', {
  id: text('id').primaryKey(), // Client-generated UUID for idempotent deduplication
  tripId: text('trip_id')
    .references(() => trips.id)
    .notNull(),
  userUid: text('user_uid')
    .references(() => users.uid)
    .notNull(),
  type: text('type').notNull(), // CONTRIBUTION | TRANSFER | EXPENSE | SETTLEMENT | REFUND | WITHDRAWAL | REVERSAL
  title: text('title').notNull(),
  amountPaise: integer('amount_paise').notNull(),
  currency: text('currency').notNull().default('INR'),
  dateTime: text('date_time').notNull(),
  paymentMethod: text('payment_method').notNull(), // CASH | UPI | BANK_TRANSFER | CARD | OTHER
  fromMemberId: text('from_member_id'),
  toMemberId: text('to_member_id'),
  reference: text('reference'),
  category: text('category'),
  paidByMemberId: text('paid_by_member_id'),
  paymentSource: text('payment_source'), // POOL | TREASURER_PERSONAL | MEMBER_PERSONAL
  splitMethod: text('split_method'), // EQUAL | CUSTOM_AMOUNT | PERCENTAGE | EXCLUDE | SHARES
  splitsJson: text('splits_json'), // JSON array of MemberSplit
  receiptDataUrl: text('receipt_data_url'),
  notes: text('notes').notNull().default(''),
  isReversed: boolean('is_reversed').notNull().default(false),
  reversalOfId: text('reversal_of_id'),
  reversedById: text('reversed_by_id'),
  createdByMemberId: text('created_by_member_id').notNull(),
  updatedAt: text('updated_at').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

// Immutable financial audit logs table
export const auditLogs = pgTable('audit_logs', {
  id: text('id').primaryKey(),
  tripId: text('trip_id')
    .references(() => trips.id)
    .notNull(),
  userUid: text('user_uid')
    .references(() => users.uid)
    .notNull(),
  transactionId: text('transaction_id').notNull(),
  action: text('action').notNull(), // CREATED | EDITED | REVERSED | TRIP_CLOSED
  actorName: text('actor_name').notNull(),
  timestamp: text('timestamp').notNull(),
  previousValueJson: text('previous_value_json'),
  newValueJson: text('new_value_json'),
  notes: text('notes').notNull().default(''),
});

export const usersRelations = relations(users, ({ many }) => ({
  trips: many(trips),
  transactions: many(transactions),
  auditLogs: many(auditLogs),
}));

export const tripsRelations = relations(trips, ({ one, many }) => ({
  owner: one(users, {
    fields: [trips.userUid],
    references: [users.uid],
  }),
  transactions: many(transactions),
  auditLogs: many(auditLogs),
}));

export const transactionsRelations = relations(transactions, ({ one }) => ({
  trip: one(trips, {
    fields: [transactions.tripId],
    references: [trips.id],
  }),
  owner: one(users, {
    fields: [transactions.userUid],
    references: [users.uid],
  }),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  trip: one(trips, {
    fields: [auditLogs.tripId],
    references: [trips.id],
  }),
  owner: one(users, {
    fields: [auditLogs.userUid],
    references: [users.uid],
  }),
}));
