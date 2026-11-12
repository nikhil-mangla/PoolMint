import test from 'node:test';
import assert from 'node:assert/strict';
import {
  toPaise,
  fromPaise,
  formatCurrency,
  calculateExpenseSplits,
  computeTripAccounting,
} from './accounting';
import { Trip, Transaction } from '../types/treasury';

const sampleTrip: Trip = {
  id: 'trip-test-1',
  name: 'Goa Test Trip',
  destination: 'Goa',
  startDate: '2026-11-10',
  endDate: '2026-11-15',
  currency: 'INR',
  budgetPaise: 3000000,
  description: 'Validation trip',
  treasurerMemberId: 'm1',
  status: 'ACTIVE',
  allowNegativePool: false,
  members: [
    { id: 'm1', name: 'Rahul', role: 'TREASURER', avatarColor: '#059669' },
    { id: 'm2', name: 'Aman', role: 'MEMBER', avatarColor: '#2563EB' },
    { id: 'm3', name: 'Nikhil', role: 'ADMIN', avatarColor: '#7C3AED' },
    { id: 'm4', name: 'Rohan', role: 'MEMBER', avatarColor: '#D97706' },
    { id: 'm5', name: 'Karan', role: 'MEMBER', avatarColor: '#DC2626' },
  ],
  customCategories: [],
  updatedAt: '2026-11-10T00:00:00.000Z',
  syncStatus: 'SYNCED',
};

const memberIds = sampleTrip.members.map((m) => m.id);

test('paise conversion and formatting are decimal-safe', () => {
  assert.equal(toPaise('5000'), 500000);
  assert.equal(toPaise(123.45), 12345);
  assert.equal(fromPaise(500000), 5000);
  assert.equal(formatCurrency(500000, 'INR'), '₹5,000');
});

test('expense split methods conserve exact paise without rounding drift', () => {
  const splits = calculateExpenseSplits(10000, ['m1', 'm2', 'm3'], 'EQUAL');
  const sum = splits.reduce((acc, s) => acc + s.amountPaise, 0);
  assert.equal(sum, 10000);
  assert.equal(splits[0].amountPaise, 3334);
  assert.equal(splits[1].amountPaise, 3333);
  assert.equal(splits[2].amountPaise, 3333);

  const excludedSplits = calculateExpenseSplits(300000, memberIds, 'EXCLUDE', {}, ['m4', 'm5']);
  assert.equal(excludedSplits.filter((s) => s.included).length, 3);
  assert.equal(excludedSplits[0].amountPaise, 100000);
  assert.equal(excludedSplits[3].amountPaise, 0);
});

test('TEST 1 to TEST 5 & TEST 10: Complete double-entry treasury accounting lifecycle', () => {
  const txs: Transaction[] = [];

  for (const m of sampleTrip.members) {
    txs.push({
      id: `contrib-${m.id}`,
      tripId: sampleTrip.id,
      type: 'CONTRIBUTION',
      title: `${m.name} Contribution`,
      amountPaise: 500000,
      currency: 'INR',
      dateTime: '2026-11-10T10:00:00.000Z',
      paymentMethod: 'UPI',
      fromMemberId: m.id,
      toMemberId: 'm1',
      notes: '',
      isReversed: false,
      createdByMemberId: 'm1',
      updatedAt: '2026-11-10T10:00:00.000Z',
      syncStatus: 'SYNCED',
    });
  }

  let report = computeTripAccounting(sampleTrip, txs);
  assert.equal(report.totalContributionsPaise, 2500000);
  assert.equal(report.totalPoolBalancePaise, 2500000);

  txs.push({
    id: 'exp-hotel',
    tripId: sampleTrip.id,
    type: 'EXPENSE',
    title: 'Hotel Expense',
    amountPaise: 300000,
    currency: 'INR',
    dateTime: '2026-11-10T12:00:00.000Z',
    paymentMethod: 'UPI',
    category: 'Hotel / Accommodation',
    paidByMemberId: 'm1',
    paymentSource: 'POOL',
    splitMethod: 'EQUAL',
    splits: calculateExpenseSplits(300000, memberIds, 'EQUAL'),
    notes: '',
    isReversed: false,
    createdByMemberId: 'm1',
    updatedAt: '2026-11-10T12:00:00.000Z',
    syncStatus: 'SYNCED',
  });

  report = computeTripAccounting(sampleTrip, txs);
  assert.equal(report.totalPoolBalancePaise, 2200000);
  assert.equal(report.totalPoolExpensesPaise, 300000);

  txs.push({
    id: 'exp-food-personal',
    tripId: sampleTrip.id,
    type: 'EXPENSE',
    title: 'Food Paid Personally by Aman',
    amountPaise: 100000,
    currency: 'INR',
    dateTime: '2026-11-10T14:00:00.000Z',
    paymentMethod: 'UPI',
    category: 'Food / Restaurants',
    paidByMemberId: 'm2',
    paymentSource: 'MEMBER_PERSONAL',
    splitMethod: 'EQUAL',
    splits: calculateExpenseSplits(100000, memberIds, 'EQUAL'),
    notes: '',
    isReversed: false,
    createdByMemberId: 'm2',
    updatedAt: '2026-11-10T14:00:00.000Z',
    syncStatus: 'SYNCED',
  });

  report = computeTripAccounting(sampleTrip, txs);
  assert.equal(report.totalPoolBalancePaise, 2200000);
  assert.equal(report.totalPersonalExpensesPaise, 100000);
  assert.equal(report.totalExpensesPaise, 400000);

  const amanSummary = report.memberSummaries.find((m) => m.memberId === 'm2')!;
  assert.equal(amanSummary.allocatedExpenseSharePaise, 80000);
  assert.equal(amanSummary.netBalancePaise, 520000);

  txs.push({
    id: 'trf-1',
    tripId: sampleTrip.id,
    type: 'TRANSFER',
    title: 'Transfer from Rahul to Aman',
    amountPaise: 200000,
    currency: 'INR',
    dateTime: '2026-11-10T16:00:00.000Z',
    paymentMethod: 'UPI',
    fromMemberId: 'm1',
    toMemberId: 'm2',
    notes: '',
    isReversed: false,
    createdByMemberId: 'm1',
    updatedAt: '2026-11-10T16:00:00.000Z',
    syncStatus: 'SYNCED',
  });

  report = computeTripAccounting(sampleTrip, txs);
  assert.equal(report.totalContributionsPaise, 2500000);
  assert.equal(report.totalExpensesPaise, 400000);
  assert.equal(report.totalTransfersPaise, 200000);

  const sumMemberNet = report.memberSummaries.reduce((acc, m) => acc + m.netBalancePaise, 0);
  assert.equal(sumMemberNet, report.totalPoolBalancePaise);
});

test('PHASE 8: Financial Integrity Test (₹25,000 Pool -> ₹8,000 Online -> ₹4,500 Offline + Wealth Conservation on Transfers)', () => {
  const txs: Transaction[] = [];

  // 1. Five members (Rahul, Aman, Nikhil, Rohan, Karan) each contribute ₹5,000 -> Initial Pool = ₹25,000
  for (const m of sampleTrip.members) {
    txs.push({
      id: `p8-contrib-${m.id}`,
      tripId: sampleTrip.id,
      type: 'CONTRIBUTION',
      title: `${m.name} Contribution`,
      amountPaise: toPaise(5000),
      currency: 'INR',
      dateTime: '2026-11-10T09:00:00.000Z',
      paymentMethod: 'UPI',
      fromMemberId: m.id,
      toMemberId: 'm1',
      notes: '',
      isReversed: false,
      createdByMemberId: 'm1',
      updatedAt: '2026-11-10T09:00:00.000Z',
      syncStatus: 'SYNCED',
    });
  }

  // 2. Online Pool Expenses: Hotel ₹8,000, Food ₹3,000, Fuel ₹2,000, Activities ₹4,000 (Total ₹17,000)
  const onlineExpenses = [
    { id: 'p8-e1', title: 'Hotel', amount: 8000, category: 'Hotel / Accommodation' },
    { id: 'p8-e2', title: 'Food', amount: 3000, category: 'Food / Restaurants' },
    { id: 'p8-e3', title: 'Fuel', amount: 2000, category: 'Fuel' },
    { id: 'p8-e4', title: 'Activities', amount: 4000, category: 'Activities / Tickets' },
  ];
  for (const e of onlineExpenses) {
    const paise = toPaise(e.amount);
    txs.push({
      id: e.id,
      tripId: sampleTrip.id,
      type: 'EXPENSE',
      title: e.title,
      amountPaise: paise,
      currency: 'INR',
      dateTime: '2026-11-11T12:00:00.000Z',
      paymentMethod: 'UPI',
      category: e.category,
      paidByMemberId: 'm1',
      paymentSource: 'POOL',
      splitMethod: 'EQUAL',
      splits: calculateExpenseSplits(paise, memberIds, 'EQUAL'),
      notes: '',
      isReversed: false,
      createdByMemberId: 'm1',
      updatedAt: '2026-11-11T12:00:00.000Z',
      syncStatus: 'SYNCED',
    });
  }

  let report = computeTripAccounting(sampleTrip, txs);
  // Expected remaining pool after online expenses = ₹8,000 (800,000 paise)
  assert.equal(report.totalPoolBalancePaise, toPaise(8000));
  assert.equal(formatCurrency(report.totalPoolBalancePaise, 'INR'), '₹8,000');

  // 3. Disconnect internet and record: Shopping ₹1,000, Dinner ₹2,000, Transport ₹500 (Total ₹3,500)
  const offlineExpenses = [
    { id: 'p8-off-1', title: 'Shopping', amount: 1000, category: 'Shopping' },
    { id: 'p8-off-2', title: 'Dinner', amount: 2000, category: 'Food / Restaurants' },
    { id: 'p8-off-3', title: 'Transport', amount: 500, category: 'Transportation' },
  ];
  for (const e of offlineExpenses) {
    const paise = toPaise(e.amount);
    txs.push({
      id: e.id,
      tripId: sampleTrip.id,
      type: 'EXPENSE',
      title: e.title,
      amountPaise: paise,
      currency: 'INR',
      dateTime: '2026-11-12T15:00:00.000Z',
      paymentMethod: 'CASH',
      category: e.category,
      paidByMemberId: 'm1',
      paymentSource: 'POOL',
      splitMethod: 'EQUAL',
      splits: calculateExpenseSplits(paise, memberIds, 'EQUAL'),
      notes: 'Recorded offline',
      isReversed: false,
      createdByMemberId: 'm1',
      updatedAt: '2026-11-12T15:00:00.000Z',
      syncStatus: 'PENDING',
      lifecycleStatus: 'PENDING_SYNC',
    });
  }

  report = computeTripAccounting(sampleTrip, txs);
  // Expected remaining pool after offline expenses = ₹4,500 (450,000 paise)
  assert.equal(report.totalPoolBalancePaise, toPaise(4500));
  assert.equal(formatCurrency(report.totalPoolBalancePaise, 'INR'), '₹4,500');

  // 4. Verify that transfers between members do NOT increase or decrease total group wealth
  const groupWealthBeforeTransfers = report.memberSummaries.reduce(
    (sum, m) => sum + m.netBalancePaise,
    0
  );
  assert.equal(groupWealthBeforeTransfers, toPaise(4500));

  txs.push(
    {
      id: 'p8-trf-1',
      tripId: sampleTrip.id,
      type: 'TRANSFER',
      title: 'Rahul transfers to Aman',
      amountPaise: toPaise(1200),
      currency: 'INR',
      dateTime: '2026-11-12T16:00:00.000Z',
      paymentMethod: 'UPI',
      fromMemberId: 'm1',
      toMemberId: 'm2',
      notes: '',
      isReversed: false,
      createdByMemberId: 'm1',
      updatedAt: '2026-11-12T16:00:00.000Z',
      syncStatus: 'PENDING',
    },
    {
      id: 'p8-trf-2',
      tripId: sampleTrip.id,
      type: 'TRANSFER',
      title: 'Nikhil transfers to Rohan',
      amountPaise: toPaise(800),
      currency: 'INR',
      dateTime: '2026-11-12T16:05:00.000Z',
      paymentMethod: 'CASH',
      fromMemberId: 'm3',
      toMemberId: 'm4',
      notes: '',
      isReversed: false,
      createdByMemberId: 'm3',
      updatedAt: '2026-11-12T16:05:00.000Z',
      syncStatus: 'PENDING',
    }
  );

  const reportAfterTransfers = computeTripAccounting(sampleTrip, txs);
  const groupWealthAfterTransfers = reportAfterTransfers.memberSummaries.reduce(
    (sum, m) => sum + m.netBalancePaise,
    0
  );

  assert.equal(reportAfterTransfers.totalPoolBalancePaise, toPaise(4500));
  assert.equal(groupWealthAfterTransfers, groupWealthBeforeTransfers);
});
