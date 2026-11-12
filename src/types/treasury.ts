export type UserRole = 'ADMIN' | 'TREASURER' | 'MEMBER';

export type PaymentMethod = 'CASH' | 'UPI' | 'BANK_TRANSFER' | 'CARD' | 'OTHER';

export type TransactionType =
  | 'CONTRIBUTION'
  | 'TRANSFER'
  | 'EXPENSE'
  | 'SETTLEMENT'
  | 'REFUND'
  | 'WITHDRAWAL'
  | 'REVERSAL';

export type PaymentSource = 'POOL' | 'TREASURER_PERSONAL' | 'MEMBER_PERSONAL';

export type SplitMethod =
  | 'EQUAL'
  | 'CUSTOM_AMOUNT'
  | 'PERCENTAGE'
  | 'EXCLUDE'
  | 'SHARES';

export type TransactionLifecycleStatus =
  | 'LOCAL_SAVE'
  | 'PENDING_SYNC'
  | 'SYNCING'
  | 'SYNCED'
  | 'RETRY';

export type SyncStateLabel =
  | 'ONLINE'
  | 'OFFLINE'
  | 'SYNCING'
  | 'SYNC COMPLETED'
  | 'PENDING SYNC'
  | 'SYNC FAILED';

export type SyncIndicatorColor = 'GREEN' | 'ORANGE' | 'BLUE' | 'RED';

export const DEFAULT_EXPENSE_CATEGORIES = [
  'Hotel / Accommodation',
  'Food / Restaurants',
  'Transportation',
  'Fuel',
  'Flights / Trains',
  'Activities / Tickets',
  'Shopping',
  'Groceries',
  'Medical',
  'Miscellaneous',
] as const;

export interface TripMember {
  id: string;
  tripId?: string;
  name: string;
  role: UserRole;
  avatarColor: string;
  phone?: string;
}

export interface MemberSplit {
  memberId: string;
  included: boolean;
  amountPaise: number;
  percentage?: number;
  shares?: number;
}

export interface Trip {
  id: string;
  name: string;
  destination: string;
  startDate: string;
  endDate: string;
  currency: string;
  budgetPaise: number;
  description: string;
  treasurerMemberId: string;
  status: 'ACTIVE' | 'CLOSED';
  allowNegativePool: boolean;
  members: TripMember[];
  customCategories: string[];
  pin?: string;
  closedAt?: string | null;
  updatedAt: string;
  syncStatus: 'SYNCED' | 'PENDING';
  lifecycleStatus?: TransactionLifecycleStatus;
}

export interface Transaction {
  id: string;
  tripId: string;
  type: TransactionType;
  title: string;
  amountPaise: number;
  currency: string;
  dateTime: string;
  paymentMethod: PaymentMethod;
  fromMemberId?: string | null;
  toMemberId?: string | null;
  reference?: string | null;
  category?: string | null;
  paidByMemberId?: string | null;
  paymentSource?: PaymentSource | null;
  splitMethod?: SplitMethod | null;
  splits?: MemberSplit[] | null;
  receiptDataUrl?: string | null;
  notes: string;
  isReversed: boolean;
  reversalOfId?: string | null;
  reversedById?: string | null;
  createdByMemberId: string;
  updatedAt: string;
  syncStatus: 'SYNCED' | 'PENDING';
  lifecycleStatus?: TransactionLifecycleStatus;
}

export interface SyncQueueEntry {
  id: string;
  entityType: 'TRIP' | 'TRANSACTION' | 'AUDIT_LOG';
  entityId: string;
  tripId: string;
  lifecycleStatus: TransactionLifecycleStatus;
  retryCount: number;
  lastAttemptAt?: string | null;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AppSettingRecord {
  key: string;
  value: string;
  updatedAt: string;
}

export interface DexieTableDiagnostics {
  Trips: number;
  Members: number;
  Contributions: number;
  Transfers: number;
  Expenses: number;
  Settlements: number;
  TransactionLedger: number;
  SyncQueue: number;
  AuditLogs: number;
  AppSettings: number;
}

export interface AuditLog {
  id: string;
  tripId: string;
  transactionId: string;
  action: 'CREATED' | 'EDITED' | 'REVERSED' | 'TRIP_CLOSED';
  actorName: string;
  timestamp: string;
  previousValueJson?: string | null;
  newValueJson?: string | null;
  notes: string;
  syncStatus: 'SYNCED' | 'PENDING';
}

export interface MemberLedgerSummary {
  memberId: string;
  memberName: string;
  role: UserRole;
  avatarColor: string;
  contributedToPoolPaise: number;
  personalExpensesPaidPaise: number;
  transfersSentPaise: number;
  transfersReceivedPaise: number;
  settlementsPaidPaise: number;
  settlementsReceivedPaise: number;
  refundsReceivedPaise: number;
  allocatedExpenseSharePaise: number;
  totalCreditsPaise: number;
  totalDebitsPaise: number;
  netBalancePaise: number;
}

export interface TreasurerLedgerSummary {
  treasurerId: string;
  treasurerName: string;
  totalPoolCollectedPaise: number;
  totalPoolExpensesSpentPaise: number;
  totalPoolRefundsPaidPaise: number;
  totalPoolWithdrawalsPaise: number;
  currentPoolBalancePaise: number;
  cashInHandPaise: number;
  digitalInHandPaise: number;
  treasurerPersonalSpentPaise: number;
  transactionsManagedCount: number;
}

export interface SettlementRecommendation {
  fromMemberId: string;
  fromMemberName: string;
  toMemberId: string;
  toMemberName: string;
  amountPaise: number;
  isPoolRefund: boolean;
}

export interface TripAccountingReport {
  tripId: string;
  totalPoolBalancePaise: number;
  totalContributionsPaise: number;
  totalExpensesPaise: number;
  totalPoolExpensesPaise: number;
  totalPersonalExpensesPaise: number;
  totalTransfersPaise: number;
  totalSettlementsPaise: number;
  totalRefundsPaise: number;
  remainingBudgetPaise: number;
  budgetUtilizationPercent: number;
  averageDailySpendPaise: number;
  highestCategory: { name: string; amountPaise: number } | null;
  highestSpendDay: { date: string; amountPaise: number } | null;
  treasurer: TreasurerLedgerSummary;
  memberSummaries: MemberLedgerSummary[];
  settlements: SettlementRecommendation[];
  poolRefundDistribution: {
    memberId: string;
    memberName: string;
    refundDuePaise: number;
    amountOwedToPoolPaise: number;
  }[];
}
