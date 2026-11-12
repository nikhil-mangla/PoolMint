import {
  Trip,
  Transaction,
  MemberSplit,
  SplitMethod,
  MemberLedgerSummary,
  TreasurerLedgerSummary,
  SettlementRecommendation,
  TripAccountingReport,
  AuditLog,
} from '../types/treasury';

const CURRENCY_SYMBOLS: Record<string, string> = {
  INR: '₹',
  USD: '$',
  EUR: '€',
  GBP: '£',
  AED: 'AED ',
  SGD: 'S$',
  THB: '฿',
};

export function getCurrencySymbol(currency: string = 'INR'): string {
  return CURRENCY_SYMBOLS[currency] || `${currency} `;
}

/**
 * Converts major currency decimal input (e.g., "1250.50" or 1250.5) into integer minor units (paise/cents).
 */
export function toPaise(amountMajor: string | number): number {
  const num = typeof amountMajor === 'string' ? parseFloat(amountMajor) : amountMajor;
  if (Number.isNaN(num) || !Number.isFinite(num)) return 0;
  return Math.round(num * 100);
}

/**
 * Converts integer minor units (paise) to major currency number.
 */
export function fromPaise(amountPaise: number): number {
  return Math.round(amountPaise) / 100;
}

/**
 * Formats integer minor units (paise) into localized currency display string.
 */
export function formatCurrency(amountPaise: number, currency: string = 'INR', showSign: boolean = false): string {
  const isNegative = amountPaise < 0;
  const absPaise = Math.abs(Math.round(amountPaise));
  const major = absPaise / 100;
  const hasSubunits = absPaise % 100 !== 0;

  const formattedNumber = major.toLocaleString(currency === 'INR' ? 'en-IN' : 'en-US', {
    minimumFractionDigits: hasSubunits ? 2 : 0,
    maximumFractionDigits: 2,
  });

  const symbol = getCurrencySymbol(currency);
  const sign = isNegative ? '-' : showSign && absPaise > 0 ? '+' : '';
  return `${sign}${symbol}${formattedNumber}`;
}

/**
 * Computes exact integer-safe splits across members so the sum of member shares ALWAYS equals totalAmountPaise.
 * Remainder paise are distributed 1 paisa at a time to the first included members.
 */
export function calculateExpenseSplits(
  totalAmountPaise: number,
  memberIds: string[],
  method: SplitMethod,
  customInputs?: Record<string, number>,
  excludedIds: string[] = []
): MemberSplit[] {
  if (totalAmountPaise <= 0 || memberIds.length === 0) {
    return memberIds.map((id) => ({ memberId: id, included: false, amountPaise: 0 }));
  }

  if (method === 'EQUAL' || method === 'EXCLUDE') {
    const activeIds = memberIds.filter((id) => !excludedIds.includes(id));
    if (activeIds.length === 0) {
      return memberIds.map((id) => ({ memberId: id, included: false, amountPaise: 0 }));
    }
    const baseShare = Math.floor(totalAmountPaise / activeIds.length);
    let remainder = totalAmountPaise - baseShare * activeIds.length;

    return memberIds.map((id) => {
      if (excludedIds.includes(id)) {
        return { memberId: id, included: false, amountPaise: 0 };
      }
      const extra = remainder > 0 ? 1 : 0;
      if (remainder > 0) remainder -= 1;
      return {
        memberId: id,
        included: true,
        amountPaise: baseShare + extra,
      };
    });
  }

  if (method === 'CUSTOM_AMOUNT') {
    return memberIds.map((id) => {
      const amountPaise = Math.max(0, Math.round(customInputs?.[id] || 0));
      return {
        memberId: id,
        included: amountPaise > 0,
        amountPaise,
      };
    });
  }

  if (method === 'PERCENTAGE') {
    const activeIds = memberIds.filter((id) => (customInputs?.[id] || 0) > 0);
    if (activeIds.length === 0) {
      return memberIds.map((id) => ({ memberId: id, included: false, amountPaise: 0, percentage: 0 }));
    }
    let allocated = 0;
    const rawSplits = memberIds.map((id) => {
      const pct = Math.max(0, customInputs?.[id] || 0);
      const exactPaise = Math.floor((totalAmountPaise * pct) / 100);
      allocated += exactPaise;
      return {
        memberId: id,
        included: pct > 0,
        amountPaise: exactPaise,
        percentage: pct,
      };
    });
    let remainder = totalAmountPaise - allocated;
    for (const s of rawSplits) {
      if (s.included && remainder > 0) {
        s.amountPaise += 1;
        remainder -= 1;
      }
    }
    return rawSplits;
  }

  if (method === 'SHARES') {
    const totalShares = memberIds.reduce((acc, id) => acc + Math.max(0, customInputs?.[id] || 0), 0);
    if (totalShares <= 0) {
      return memberIds.map((id) => ({ memberId: id, included: false, amountPaise: 0, shares: 0 }));
    }
    let allocated = 0;
    const rawSplits = memberIds.map((id) => {
      const sh = Math.max(0, customInputs?.[id] || 0);
      const exactPaise = Math.floor((totalAmountPaise * sh) / totalShares);
      allocated += exactPaise;
      return {
        memberId: id,
        included: sh > 0,
        amountPaise: exactPaise,
        shares: sh,
      };
    });
    let remainder = totalAmountPaise - allocated;
    for (const s of rawSplits) {
      if (s.included && remainder > 0) {
        s.amountPaise += 1;
        remainder -= 1;
      }
    }
    return rawSplits;
  }

  return memberIds.map((id) => ({ memberId: id, included: true, amountPaise: 0 }));
}

/**
 * Core Double-Entry Travel Treasury Accounting Engine.
 *
 * Accounting Invariants:
 * 1. Common Pool Balance = Total Contributions - Pool Expenses - Pool Refunds - Pool Withdrawals.
 *    (Personal expenses paid by Treasurer or another member NEVER deduct from the Common Pool.)
 * 2. Member Net Position =
 *      + Contributions to Pool
 *      + Personal Expenses Paid (on behalf of the group)
 *      + Transfers Sent to other members / Treasurer
 *      + Settlements Paid
 *      - Allocated Share of Group Expenses
 *      - Transfers Received from other members / Treasurer
 *      - Settlements Received
 *      - Pool Refunds Received
 * 3. System-Wide Double-Entry Conservation Law:
 *      Sum of all Members' Net Positions === Current Remaining Pool Balance!
 *    Why? Because every rupee contributed is a credit to a member and sits in the Pool (+Pool),
 *    every Pool expense reduces the Pool (-Pool) and reduces members' net position (-Share),
 *    every Personal expense credits the payer (+Member) and debits the consumers (-Share, net 0 on Pool),
 *    and every peer/treasurer Transfer credits the sender (+From) and debits the receiver (-To, net 0 on Pool)!
 */
export function computeTripAccounting(trip: Trip, allTransactions: Transaction[]): TripAccountingReport {
  // Filter active (non-reversed, non-reversal) transactions for this trip
  // Note: When a transaction is reversed, both the original (isReversed = true) and the REVERSAL entry
  // remain visible in the chronological ledger audit trail, while cancelling each other out financially.
  const activeTransactions = allTransactions.filter(
    (tx) => tx.tripId === trip.id && !tx.isReversed && tx.type !== 'REVERSAL'
  );

  const memberMap = new Map<string, MemberLedgerSummary>();
  for (const m of trip.members) {
    memberMap.set(m.id, {
      memberId: m.id,
      memberName: m.name,
      role: m.id === trip.treasurerMemberId ? 'TREASURER' : m.role,
      avatarColor: m.avatarColor,
      contributedToPoolPaise: 0,
      personalExpensesPaidPaise: 0,
      transfersSentPaise: 0,
      transfersReceivedPaise: 0,
      settlementsPaidPaise: 0,
      settlementsReceivedPaise: 0,
      refundsReceivedPaise: 0,
      allocatedExpenseSharePaise: 0,
      totalCreditsPaise: 0,
      totalDebitsPaise: 0,
      netBalancePaise: 0,
    });
  }

  let totalContributionsPaise = 0;
  let totalPoolExpensesPaise = 0;
  let totalPersonalExpensesPaise = 0;
  let totalTransfersPaise = 0;
  let totalSettlementsPaise = 0;
  let totalRefundsPaise = 0;
  let totalPoolWithdrawalsPaise = 0;

  let poolCashDeltaPaise = 0;
  let poolDigitalDeltaPaise = 0;
  let treasurerPersonalSpentPaise = 0;
  let transactionsManagedCount = 0;

  const categoryTotals = new Map<string, number>();
  const dailySpendTotals = new Map<string, number>();

  for (const tx of activeTransactions) {
    const amt = Math.round(tx.amountPaise);
    if (amt <= 0) continue;

    if (
      tx.createdByMemberId === trip.treasurerMemberId ||
      tx.paymentSource === 'POOL' ||
      tx.type === 'CONTRIBUTION' ||
      tx.fromMemberId === trip.treasurerMemberId ||
      tx.toMemberId === trip.treasurerMemberId
    ) {
      transactionsManagedCount += 1;
    }

    switch (tx.type) {
      case 'CONTRIBUTION': {
        totalContributionsPaise += amt;
        if (tx.paymentMethod === 'CASH') {
          poolCashDeltaPaise += amt;
        } else {
          poolDigitalDeltaPaise += amt;
        }
        const contributor = tx.fromMemberId ? memberMap.get(tx.fromMemberId) : undefined;
        if (contributor) {
          contributor.contributedToPoolPaise += amt;
        }
        break;
      }

      case 'TRANSFER': {
        totalTransfersPaise += amt;
        const sender = tx.fromMemberId ? memberMap.get(tx.fromMemberId) : undefined;
        const receiver = tx.toMemberId ? memberMap.get(tx.toMemberId) : undefined;
        if (sender) {
          sender.transfersSentPaise += amt;
        }
        if (receiver) {
          receiver.transfersReceivedPaise += amt;
        }
        break;
      }

      case 'SETTLEMENT': {
        totalSettlementsPaise += amt;
        const payer = tx.fromMemberId ? memberMap.get(tx.fromMemberId) : undefined;
        const payee = tx.toMemberId ? memberMap.get(tx.toMemberId) : undefined;
        if (payer) {
          payer.settlementsPaidPaise += amt;
        }
        if (payee) {
          payee.settlementsReceivedPaise += amt;
        }
        break;
      }

      case 'REFUND': {
        // Refund from Common Pool to a member
        totalRefundsPaise += amt;
        if (tx.paymentMethod === 'CASH') {
          poolCashDeltaPaise -= amt;
        } else {
          poolDigitalDeltaPaise -= amt;
        }
        const recipient = tx.toMemberId ? memberMap.get(tx.toMemberId) : undefined;
        if (recipient) {
          recipient.refundsReceivedPaise += amt;
        }
        break;
      }

      case 'WITHDRAWAL': {
        totalPoolWithdrawalsPaise += amt;
        if (tx.paymentMethod === 'CASH') {
          poolCashDeltaPaise -= amt;
        } else {
          poolDigitalDeltaPaise -= amt;
        }
        const withdrawer = tx.toMemberId ? memberMap.get(tx.toMemberId) : undefined;
        if (withdrawer) {
          withdrawer.refundsReceivedPaise += amt;
        }
        break;
      }

      case 'EXPENSE': {
        const source = tx.paymentSource || 'POOL';
        if (source === 'POOL') {
          totalPoolExpensesPaise += amt;
          if (tx.paymentMethod === 'CASH') {
            poolCashDeltaPaise -= amt;
          } else {
            poolDigitalDeltaPaise -= amt;
          }
        } else {
          totalPersonalExpensesPaise += amt;
          const payerId =
            source === 'TREASURER_PERSONAL' ? trip.treasurerMemberId : tx.paidByMemberId || trip.treasurerMemberId;
          if (payerId === trip.treasurerMemberId) {
            treasurerPersonalSpentPaise += amt;
          }
          const payer = memberMap.get(payerId);
          if (payer) {
            payer.personalExpensesPaidPaise += amt;
          }
        }

        // Category and daily analytics
        const cat = tx.category || 'Miscellaneous';
        categoryTotals.set(cat, (categoryTotals.get(cat) || 0) + amt);
        const dateKey = (tx.dateTime || '').slice(0, 10) || 'Unknown';
        dailySpendTotals.set(dateKey, (dailySpendTotals.get(dateKey) || 0) + amt);

        // Allocate expense splits to included members
        if (tx.splits && tx.splits.length > 0) {
          for (const split of tx.splits) {
            if (split.included && split.amountPaise > 0) {
              const m = memberMap.get(split.memberId);
              if (m) {
                m.allocatedExpenseSharePaise += Math.round(split.amountPaise);
              }
            }
          }
        } else if (trip.members.length > 0) {
          const equalSplits = calculateExpenseSplits(
            amt,
            trip.members.map((m) => m.id),
            'EQUAL'
          );
          for (const split of equalSplits) {
            const m = memberMap.get(split.memberId);
            if (m) {
              m.allocatedExpenseSharePaise += split.amountPaise;
            }
          }
        }
        break;
      }
      default:
        break;
    }
  }

  const totalPoolBalancePaise =
    totalContributionsPaise - totalPoolExpensesPaise - totalRefundsPaise - totalPoolWithdrawalsPaise;
  const totalExpensesPaise = totalPoolExpensesPaise + totalPersonalExpensesPaise;
  const remainingBudgetPaise =
    trip.budgetPaise > 0 ? trip.budgetPaise - totalExpensesPaise : totalPoolBalancePaise;
  const budgetUtilizationPercent =
    trip.budgetPaise > 0
      ? Math.min(999, Math.round((totalExpensesPaise / trip.budgetPaise) * 1000) / 10)
      : totalContributionsPaise > 0
        ? Math.min(999, Math.round((totalPoolExpensesPaise / totalContributionsPaise) * 1000) / 10)
        : 0;

  // Finalize member credits, debits, and net balances
  const memberSummaries: MemberLedgerSummary[] = [];
  for (const m of memberMap.values()) {
    m.totalCreditsPaise =
      m.contributedToPoolPaise +
      m.personalExpensesPaidPaise +
      m.transfersSentPaise +
      m.settlementsPaidPaise;
    m.totalDebitsPaise =
      m.allocatedExpenseSharePaise +
      m.transfersReceivedPaise +
      m.settlementsReceivedPaise +
      m.refundsReceivedPaise;
    m.netBalancePaise = m.totalCreditsPaise - m.totalDebitsPaise;
    memberSummaries.push(m);
  }

  const treasurerMember = trip.members.find((m) => m.id === trip.treasurerMemberId) || trip.members[0];
  const treasurer: TreasurerLedgerSummary = {
    treasurerId: treasurerMember?.id || '',
    treasurerName: treasurerMember?.name || 'Treasurer',
    totalPoolCollectedPaise: totalContributionsPaise,
    totalPoolExpensesSpentPaise: totalPoolExpensesPaise,
    totalPoolRefundsPaidPaise: totalRefundsPaise,
    totalPoolWithdrawalsPaise: totalPoolWithdrawalsPaise,
    currentPoolBalancePaise: totalPoolBalancePaise,
    cashInHandPaise: poolCashDeltaPaise,
    digitalInHandPaise: poolDigitalDeltaPaise,
    treasurerPersonalSpentPaise,
    transactionsManagedCount,
  };

  // Highest spending category & day
  let highestCategory: { name: string; amountPaise: number } | null = null;
  for (const [name, amountPaise] of categoryTotals.entries()) {
    if (!highestCategory || amountPaise > highestCategory.amountPaise) {
      highestCategory = { name, amountPaise };
    }
  }

  let highestSpendDay: { date: string; amountPaise: number } | null = null;
  for (const [date, amountPaise] of dailySpendTotals.entries()) {
    if (!highestSpendDay || amountPaise > highestSpendDay.amountPaise) {
      highestSpendDay = { date, amountPaise };
    }
  }

  const activeDaysCount = Math.max(1, dailySpendTotals.size);
  const averageDailySpendPaise = Math.round(totalExpensesPaise / activeDaysCount);

  // Compute optimized settlements and pool distribution
  const { settlements, poolRefundDistribution } = computeOptimalSettlements(
    memberSummaries,
    totalPoolBalancePaise,
    treasurer.treasurerId,
    treasurer.treasurerName
  );

  return {
    tripId: trip.id,
    totalPoolBalancePaise,
    totalContributionsPaise,
    totalExpensesPaise,
    totalPoolExpensesPaise,
    totalPersonalExpensesPaise,
    totalTransfersPaise,
    totalSettlementsPaise,
    totalRefundsPaise,
    remainingBudgetPaise,
    budgetUtilizationPercent,
    averageDailySpendPaise,
    highestCategory,
    highestSpendDay,
    treasurer,
    memberSummaries,
    settlements,
    poolRefundDistribution,
  };
}

/**
 * Computes minimum-transaction debt settlement recommendations.
 *
 * Notice how in a group treasury with a Common Pool:
 * The sum of all members' netBalancePaise equals `totalPoolBalancePaise`.
 * - Any member with `netBalancePaise < 0` OWES money (`Math.abs(netBalancePaise)`).
 * - Any member with `netBalancePaise > 0` SHOULD RECEIVE money (`netBalancePaise`).
 * - The Common Pool itself holds `totalPoolBalancePaise` (managed by the Treasurer) which is available
 *   to refund members with positive balances!
 *
 * Strategy:
 * 1. First, match debtors (members who owe money) directly with creditors (members who are owed money
 *    beyond what the pool holds, or peer-to-peer settlements) and/or show exact pool refunds.
 * 2. Specifically:
 *    - Debtors (`netBalancePaise < 0`) pay into the Group / Creditors.
 *    - If we treat "Common Pool (Treasurer)" as a settlement source holding `totalPoolBalancePaise` (when > 0),
 *      then `Sum(Debtors) + PoolBalance === Sum(Creditors)`.
 *    - Using greedy largest-debtor to largest-creditor matching minimizes the number of transfers!
 */
export function computeOptimalSettlements(
  memberSummaries: MemberLedgerSummary[],
  totalPoolBalancePaise: number,
  treasurerId: string,
  treasurerName: string
): {
  settlements: SettlementRecommendation[];
  poolRefundDistribution: {
    memberId: string;
    memberName: string;
    refundDuePaise: number;
    amountOwedToPoolPaise: number;
  }[];
} {
  const debtors: { id: string; name: string; amount: number; isPool: boolean }[] = [];
  const creditors: { id: string; name: string; amount: number; isPool: boolean }[] = [];

  const poolRefundDistribution = memberSummaries.map((m) => ({
    memberId: m.memberId,
    memberName: m.memberName,
    refundDuePaise: m.netBalancePaise > 0 ? m.netBalancePaise : 0,
    amountOwedToPoolPaise: m.netBalancePaise < 0 ? Math.abs(m.netBalancePaise) : 0,
  }));

  for (const m of memberSummaries) {
    if (m.netBalancePaise < -1) {
      debtors.push({
        id: m.memberId,
        name: m.memberName,
        amount: Math.abs(m.netBalancePaise),
        isPool: false,
      });
    } else if (m.netBalancePaise > 1) {
      creditors.push({
        id: m.memberId,
        name: m.memberName,
        amount: m.netBalancePaise,
        isPool: false,
      });
    }
  }

  // First match peer-to-peer debtors directly to creditors (minimizes external transfers before touching pool cash)
  debtors.sort((a, b) => b.amount - a.amount);
  creditors.sort((a, b) => b.amount - a.amount);

  const settlements: SettlementRecommendation[] = [];

  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const d = debtors[i];
    const c = creditors[j];
    const settledAmt = Math.min(d.amount, c.amount);

    if (settledAmt > 0 && d.id !== c.id) {
      settlements.push({
        fromMemberId: d.id,
        fromMemberName: d.name,
        toMemberId: c.id,
        toMemberName: c.name,
        amountPaise: settledAmt,
        isPoolRefund: false,
      });
    }

    d.amount -= settledAmt;
    c.amount -= settledAmt;

    if (d.amount <= 1) i++;
    if (c.amount <= 1) j++;
  }

  // Remaining creditors are refunded directly from the Common Pool (or Remaining Debtors pay into Common Pool if pool was overdrawn)
  if (totalPoolBalancePaise > 1) {
    for (const c of creditors) {
      if (c.amount > 1) {
        settlements.push({
          fromMemberId: treasurerId,
          fromMemberName: `Common Pool (${treasurerName})`,
          toMemberId: c.id,
          toMemberName: c.name,
          amountPaise: c.amount,
          isPoolRefund: true,
        });
      }
    }
  } else if (totalPoolBalancePaise < -1) {
    for (const d of debtors) {
      if (d.amount > 1) {
        settlements.push({
          fromMemberId: d.id,
          fromMemberName: d.name,
          toMemberId: treasurerId,
          toMemberName: `Common Pool (${treasurerName})`,
          amountPaise: d.amount,
          isPoolRefund: false,
        });
      }
    }
  }

  return { settlements, poolRefundDistribution };
}

/**
 * Generates deterministic initial seed data for "Goa Trip 2026" and "Manali Winter Expedition"
 * so the application immediately renders rich, verifiable financial records on first launch.
 */
export function createInitialSeedData(): {
  trips: Trip[];
  transactions: Transaction[];
  auditLogs: AuditLog[];
} {
  const tripId1 = 'trip-goa-2026';
  const now = '2026-11-12T08:00:00.000Z';

  const members1 = [
    { id: 'mem-rahul', name: 'Rahul', role: 'TREASURER' as const, avatarColor: '#059669', phone: '+91 98201 11200' },
    { id: 'mem-aman', name: 'Aman', role: 'MEMBER' as const, avatarColor: '#2563EB', phone: '+91 98201 22300' },
    { id: 'mem-nikhil', name: 'Nikhil', role: 'ADMIN' as const, avatarColor: '#7C3AED', phone: '+91 98201 33400' },
    { id: 'mem-rohan', name: 'Rohan', role: 'MEMBER' as const, avatarColor: '#D97706', phone: '+91 98201 44500' },
    { id: 'mem-karan', name: 'Karan', role: 'MEMBER' as const, avatarColor: '#DC2626', phone: '+91 98201 55600' },
  ];

  const goaTrip: Trip = {
    id: tripId1,
    name: 'Goa Trip 2026',
    destination: 'North Goa & Palolem, India',
    startDate: '2026-11-10',
    endDate: '2026-11-15',
    currency: 'INR',
    budgetPaise: 3000000, // ₹30,000 budget
    description: 'Annual 5-friend coastal getaway — beach villas, scooter rentals, water sports & seafood dinners.',
    treasurerMemberId: 'mem-rahul',
    status: 'ACTIVE',
    allowNegativePool: false,
    members: members1,
    customCategories: ['Water Sports', 'Beach Shacks'],
    closedAt: null,
    updatedAt: now,
    syncStatus: 'SYNCED',
  };

  const memberIds1 = members1.map((m) => m.id);

  // Contributions: 5 members contribute ₹5,000 each = ₹25,000 total pool
  const contributions: Transaction[] = members1.map((m, idx) => ({
    id: `tx-goa-contrib-${idx + 1}`,
    tripId: tripId1,
    type: 'CONTRIBUTION',
    title: `${m.name}'s Pool Contribution`,
    amountPaise: 500000, // ₹5,000
    currency: 'INR',
    dateTime: `2026-11-10T09:${10 + idx * 5}:00.000Z`,
    paymentMethod: idx % 2 === 0 ? 'UPI' : 'CASH',
    fromMemberId: m.id,
    toMemberId: 'mem-rahul',
    reference: `UPI-GOA-00${idx + 1}`,
    notes: 'Initial common pool deposit of ₹5,000',
    isReversed: false,
    createdByMemberId: 'mem-rahul',
    updatedAt: now,
    syncStatus: 'SYNCED',
  }));

  // Expenses matching the prompt example:
  // Hotel: ₹8,000 (Pool), Food: ₹3,000 (Pool), Fuel: ₹2,000 (Pool), Activities: ₹4,000 (Pool) -> Total Pool Spent = ₹17,000, Remaining Pool = ₹8,000
  // Plus a personal expense paid by Aman (₹1,000 Midnight Cafe snacks) and a Transfer (₹500 from Rahul to Rohan)
  const expensesAndTransfers: Transaction[] = [
    {
      id: 'tx-goa-exp-hotel',
      tripId: tripId1,
      type: 'EXPENSE',
      title: 'Casa Vagator Boutique Villa (3 Nights)',
      amountPaise: 800000, // ₹8,000
      currency: 'INR',
      dateTime: '2026-11-10T14:30:00.000Z',
      paymentMethod: 'UPI',
      category: 'Hotel / Accommodation',
      paidByMemberId: 'mem-rahul',
      paymentSource: 'POOL',
      splitMethod: 'EQUAL',
      splits: calculateExpenseSplits(800000, memberIds1, 'EQUAL'),
      notes: 'Paid from Common Pool via UPI at check-in',
      isReversed: false,
      createdByMemberId: 'mem-rahul',
      updatedAt: now,
      syncStatus: 'SYNCED',
    },
    {
      id: 'tx-goa-exp-food',
      tripId: tripId1,
      type: 'EXPENSE',
      title: 'Thalassa Beachfront Seafood Dinner',
      amountPaise: 300000, // ₹3,000
      currency: 'INR',
      dateTime: '2026-11-11T21:15:00.000Z',
      paymentMethod: 'UPI',
      category: 'Food / Restaurants',
      paidByMemberId: 'mem-rahul',
      paymentSource: 'POOL',
      splitMethod: 'EQUAL',
      splits: calculateExpenseSplits(300000, memberIds1, 'EQUAL'),
      notes: 'Dinner for all 5 members — ₹600 equal share each',
      isReversed: false,
      createdByMemberId: 'mem-rahul',
      updatedAt: now,
      syncStatus: 'SYNCED',
    },
    {
      id: 'tx-goa-exp-fuel',
      tripId: tripId1,
      type: 'EXPENSE',
      title: 'Scooter & Thar Fuel Refill',
      amountPaise: 200000, // ₹2,000
      currency: 'INR',
      dateTime: '2026-11-11T11:00:00.000Z',
      paymentMethod: 'CASH',
      category: 'Fuel',
      paidByMemberId: 'mem-rahul',
      paymentSource: 'POOL',
      splitMethod: 'EQUAL',
      splits: calculateExpenseSplits(200000, memberIds1, 'EQUAL'),
      notes: 'Full tank petrol at Anjuna fuel station',
      isReversed: false,
      createdByMemberId: 'mem-rahul',
      updatedAt: now,
      syncStatus: 'SYNCED',
    },
    {
      id: 'tx-goa-exp-activities',
      tripId: tripId1,
      type: 'EXPENSE',
      title: 'Grande Island Scuba & Jet Ski Pass',
      amountPaise: 400000, // ₹4,000
      currency: 'INR',
      dateTime: '2026-11-12T10:30:00.000Z',
      paymentMethod: 'UPI',
      category: 'Activities / Tickets',
      paidByMemberId: 'mem-rahul',
      paymentSource: 'POOL',
      splitMethod: 'EQUAL',
      splits: calculateExpenseSplits(400000, memberIds1, 'EQUAL'),
      notes: 'Group adventure package booked by Treasurer',
      isReversed: false,
      createdByMemberId: 'mem-rahul',
      updatedAt: now,
      syncStatus: 'SYNCED',
    },
    {
      id: 'tx-goa-exp-personal-aman',
      tripId: tripId1,
      type: 'EXPENSE',
      title: 'Artjuna Morning Coffee & Croissants',
      amountPaise: 100000, // ₹1,000
      currency: 'INR',
      dateTime: '2026-11-12T08:45:00.000Z',
      paymentMethod: 'UPI',
      category: 'Food / Restaurants',
      paidByMemberId: 'mem-aman',
      paymentSource: 'MEMBER_PERSONAL',
      splitMethod: 'EQUAL',
      splits: calculateExpenseSplits(100000, memberIds1, 'EQUAL'),
      notes: 'Paid personally by Aman while Rahul was parking',
      isReversed: false,
      createdByMemberId: 'mem-aman',
      updatedAt: now,
      syncStatus: 'SYNCED',
    },
    {
      id: 'tx-goa-transfer-1',
      tripId: tripId1,
      type: 'TRANSFER',
      title: 'Reimbursement Advance to Aman',
      amountPaise: 50000, // ₹500
      currency: 'INR',
      dateTime: '2026-11-12T12:15:00.000Z',
      paymentMethod: 'UPI',
      fromMemberId: 'mem-rohan',
      toMemberId: 'mem-aman',
      reference: 'UPI-TRF-9981',
      notes: 'Rohan transferred ₹500 to Aman directly',
      isReversed: false,
      createdByMemberId: 'mem-rahul',
      updatedAt: now,
      syncStatus: 'SYNCED',
    },
  ];

  // Second Trip: Manali Winter Expedition
  const tripId2 = 'trip-manali-2026';
  const members2 = [
    { id: 'mem-m-nikhil', name: 'Nikhil', role: 'TREASURER' as const, avatarColor: '#059669' },
    { id: 'mem-m-rahul', name: 'Rahul', role: 'MEMBER' as const, avatarColor: '#2563EB' },
    { id: 'mem-m-aman', name: 'Aman', role: 'MEMBER' as const, avatarColor: '#D97706' },
  ];

  const manaliTrip: Trip = {
    id: tripId2,
    name: 'Manali Winter Expedition',
    destination: 'Old Manali & Solang Valley',
    startDate: '2026-12-18',
    endDate: '2026-12-23',
    currency: 'INR',
    budgetPaise: 2400000,
    description: 'Snowboarding, mountain lodges, and Solang Valley cable car trip.',
    treasurerMemberId: 'mem-m-nikhil',
    status: 'ACTIVE',
    allowNegativePool: false,
    members: members2,
    customCategories: ['Ski Gear'],
    closedAt: null,
    updatedAt: now,
    syncStatus: 'SYNCED',
  };

  const manaliTransactions: Transaction[] = [
    {
      id: 'tx-manali-c1',
      tripId: tripId2,
      type: 'CONTRIBUTION',
      title: 'Nikhil Pool Deposit',
      amountPaise: 600000,
      currency: 'INR',
      dateTime: '2026-12-18T09:00:00.000Z',
      paymentMethod: 'UPI',
      fromMemberId: 'mem-m-nikhil',
      toMemberId: 'mem-m-nikhil',
      notes: 'Initial mountain pool contribution',
      isReversed: false,
      createdByMemberId: 'mem-m-nikhil',
      updatedAt: now,
      syncStatus: 'SYNCED',
    },
    {
      id: 'tx-manali-c2',
      tripId: tripId2,
      type: 'CONTRIBUTION',
      title: 'Rahul Pool Deposit',
      amountPaise: 600000,
      currency: 'INR',
      dateTime: '2026-12-18T09:10:00.000Z',
      paymentMethod: 'UPI',
      fromMemberId: 'mem-m-rahul',
      toMemberId: 'mem-m-nikhil',
      notes: 'Initial mountain pool contribution',
      isReversed: false,
      createdByMemberId: 'mem-m-nikhil',
      updatedAt: now,
      syncStatus: 'SYNCED',
    },
    {
      id: 'tx-manali-c3',
      tripId: tripId2,
      type: 'CONTRIBUTION',
      title: 'Aman Pool Deposit',
      amountPaise: 600000,
      currency: 'INR',
      dateTime: '2026-12-18T09:20:00.000Z',
      paymentMethod: 'CASH',
      fromMemberId: 'mem-m-aman',
      toMemberId: 'mem-m-nikhil',
      notes: 'Initial mountain pool contribution',
      isReversed: false,
      createdByMemberId: 'mem-m-nikhil',
      updatedAt: now,
      syncStatus: 'SYNCED',
    },
    {
      id: 'tx-manali-e1',
      tripId: tripId2,
      type: 'EXPENSE',
      title: 'Riverside Pine Chalet Booking',
      amountPaise: 750000,
      currency: 'INR',
      dateTime: '2026-12-18T15:00:00.000Z',
      paymentMethod: 'BANK_TRANSFER',
      category: 'Hotel / Accommodation',
      paidByMemberId: 'mem-m-nikhil',
      paymentSource: 'POOL',
      splitMethod: 'EQUAL',
      splits: calculateExpenseSplits(
        750000,
        members2.map((m) => m.id),
        'EQUAL'
      ),
      notes: 'Paid from Common Pool',
      isReversed: false,
      createdByMemberId: 'mem-m-nikhil',
      updatedAt: now,
      syncStatus: 'SYNCED',
    },
  ];

  const allSeedTransactions = [...contributions, ...expensesAndTransfers, ...manaliTransactions];

  const auditLogs: AuditLog[] = allSeedTransactions.map((tx) => ({
    id: `audit-seed-${tx.id}`,
    tripId: tx.tripId,
    transactionId: tx.id,
    action: 'CREATED',
    actorName: 'Rahul (Treasurer)',
    timestamp: tx.dateTime,
    previousValueJson: null,
    newValueJson: JSON.stringify({
      title: tx.title,
      amountPaise: tx.amountPaise,
      type: tx.type,
    }),
    notes: 'Seeded ledger record',
    syncStatus: 'SYNCED',
  }));

  return {
    trips: [goaTrip, manaliTrip],
    transactions: allSeedTransactions,
    auditLogs,
  };
}
