import { jsPDF } from 'jspdf';
import { Trip, Transaction, TripAccountingReport } from '../types/treasury';
import { formatCurrency, fromPaise } from './accounting';

export function exportTripToCSV(
  trip: Trip,
  transactions: Transaction[],
  report: TripAccountingReport
) {
  const memberNameMap = new Map(trip.members.map((m) => [m.id, m.name]));
  const rows: string[][] = [
    ['PoolMint Travel Treasury Report'],
    ['Trip Name', trip.name],
    ['Destination', trip.destination],
    ['Dates', `${trip.startDate} to ${trip.endDate}`],
    ['Currency', trip.currency],
    ['Treasurer', report.treasurer.treasurerName],
    ['Total Contributions', fromPaise(report.totalContributionsPaise).toFixed(2)],
    ['Total Pool Expenses', fromPaise(report.totalPoolExpensesPaise).toFixed(2)],
    ['Total Personal Expenses', fromPaise(report.totalPersonalExpensesPaise).toFixed(2)],
    ['Remaining Pool Balance', fromPaise(report.totalPoolBalancePaise).toFixed(2)],
    [],
    ['MEMBER LEDGER SUMMARY'],
    [
      'Member',
      'Role',
      'Contributed to Pool',
      'Personal Paid',
      'Allocated Expense Share',
      'Transfers Sent',
      'Transfers Received',
      'Net Balance',
      'Status',
    ],
  ];

  for (const m of report.memberSummaries) {
    rows.push([
      m.memberName,
      m.role,
      fromPaise(m.contributedToPoolPaise).toFixed(2),
      fromPaise(m.personalExpensesPaidPaise).toFixed(2),
      fromPaise(m.allocatedExpenseSharePaise).toFixed(2),
      fromPaise(m.transfersSentPaise).toFixed(2),
      fromPaise(m.transfersReceivedPaise).toFixed(2),
      fromPaise(m.netBalancePaise).toFixed(2),
      m.netBalancePaise > 0
        ? 'SHOULD RECEIVE'
        : m.netBalancePaise < 0
          ? 'OWES GROUP'
          : 'SETTLED',
    ]);
  }

  rows.push([]);
  rows.push(['CHRONOLOGICAL TRANSACTION LEDGER']);
  rows.push([
    'Transaction ID',
    'Date & Time',
    'Type',
    'Title',
    'Category',
    'Amount',
    'Payment Method',
    'Payment Source',
    'From / Paid By',
    'To',
    'Status',
    'Notes',
  ]);

  const tripTxs = transactions.filter((t) => t.tripId === trip.id);
  for (const tx of tripTxs) {
    const actorFrom =
      (tx.fromMemberId && memberNameMap.get(tx.fromMemberId)) ||
      (tx.paidByMemberId && memberNameMap.get(tx.paidByMemberId)) ||
      '';
    const actorTo = (tx.toMemberId && memberNameMap.get(tx.toMemberId)) || '';
    rows.push([
      tx.id,
      tx.dateTime,
      tx.type,
      tx.title,
      tx.category || '-',
      fromPaise(tx.amountPaise).toFixed(2),
      tx.paymentMethod,
      tx.paymentSource || '-',
      actorFrom,
      actorTo,
      tx.isReversed ? 'REVERSED' : 'ACTIVE',
      tx.notes || '',
    ]);
  }

  const csvContent = rows
    .map((r) =>
      r.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')
    )
    .join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute(
    'download',
    `${trip.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-treasury-report.csv`
  );
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportTripToPDF(
  trip: Trip,
  transactions: Transaction[],
  report: TripAccountingReport
) {
  const doc = new jsPDF();
  const c = trip.currency;
  let y = 18;

  doc.setFontSize(16);
  doc.text(`PoolMint Treasury Report: ${trip.name}`, 14, y);
  y += 7;

  doc.setFontSize(10);
  doc.text(
    `Destination: ${trip.destination} | Dates: ${trip.startDate} to ${trip.endDate} | Status: ${trip.status}`,
    14,
    y
  );
  y += 6;
  doc.text(`Appointed Treasurer: ${report.treasurer.treasurerName}`, 14, y);
  y += 9;

  doc.setFontSize(12);
  doc.text('1. Executive Pool Summary', 14, y);
  y += 6;
  doc.setFontSize(9.5);
  doc.text(
    `Total Pool Collected: ${formatCurrency(report.totalContributionsPaise, c)}   |   Pool Expenses: ${formatCurrency(report.totalPoolExpensesPaise, c)}   |   Remaining Pool: ${formatCurrency(report.totalPoolBalancePaise, c)}`,
    14,
    y
  );
  y += 5;
  doc.text(
    `Personal Expenses Paid: ${formatCurrency(report.totalPersonalExpensesPaise, c)}   |   Total Trip Cost: ${formatCurrency(report.totalExpensesPaise, c)}   |   Transfers: ${formatCurrency(report.totalTransfersPaise, c)}`,
    14,
    y
  );
  y += 9;

  doc.setFontSize(12);
  doc.text('2. Member Net Balances', 14, y);
  y += 6;
  doc.setFontSize(9);
  for (const m of report.memberSummaries) {
    const statusLabel =
      m.netBalancePaise > 0
        ? `Receives ${formatCurrency(m.netBalancePaise, c)}`
        : m.netBalancePaise < 0
          ? `Owes ${formatCurrency(Math.abs(m.netBalancePaise), c)}`
          : 'Settled';
    doc.text(
      `${m.memberName} (${m.role}): Contributed ${formatCurrency(m.contributedToPoolPaise, c)}, Personal Paid ${formatCurrency(m.personalExpensesPaidPaise, c)}, Share ${formatCurrency(m.allocatedExpenseSharePaise, c)} -> ${statusLabel}`,
      14,
      y
    );
    y += 5;
  }

  y += 4;
  doc.setFontSize(12);
  doc.text('3. Recommended Settlements & Pool Refunds', 14, y);
  y += 6;
  doc.setFontSize(9);
  if (report.settlements.length === 0) {
    doc.text('All member balances are settled.', 14, y);
    y += 6;
  } else {
    for (const s of report.settlements) {
      doc.text(
        `• ${s.fromMemberName} pays ${s.toMemberName}: ${formatCurrency(s.amountPaise, c)}${s.isPoolRefund ? ' (Pool Refund)' : ''}`,
        14,
        y
      );
      y += 5;
    }
  }

  y += 4;
  doc.setFontSize(12);
  doc.text('4. Recent Transactions', 14, y);
  y += 6;
  doc.setFontSize(8.5);
  const tripTxs = transactions.filter((t) => t.tripId === trip.id).slice(0, 22);
  for (const tx of tripTxs) {
    if (y > 275) {
      doc.addPage();
      y = 20;
    }
    doc.text(
      `${tx.dateTime.slice(0, 10)} | [${tx.type}] ${tx.title} — ${formatCurrency(tx.amountPaise, c)} (${tx.paymentMethod})${tx.isReversed ? ' [REVERSED]' : ''}`,
      14,
      y
    );
    y += 5;
  }

  doc.save(`${trip.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-treasury-report.pdf`);
}
