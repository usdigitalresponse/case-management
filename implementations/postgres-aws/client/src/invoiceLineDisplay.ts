import type { PortalInvoiceLine } from './api/client';
import { formatDate } from './formatDateTime';
import { formatMoney } from './formatMoney';

// Supplier-stated values, else the linked time entry's, as in exports.
export function lineDate(line: PortalInvoiceLine): string {
  return formatDate(line.serviceDate ?? line.sourceActivityOn);
}

export function lineHours(line: PortalInvoiceLine): string {
  return line.quantity ?? line.sourceDurationHours ?? '—';
}

export function lineDescription(line: PortalInvoiceLine): string {
  return line.description ?? line.sourceDescription ?? 'No description';
}

export function lineTimekeeper(line: PortalInvoiceLine): string {
  return line.timekeeperDisplayName ?? line.timekeeperLabel ?? '—';
}

const LINE_TYPE_LABELS: Record<string, string> = { time: 'Time', expense: 'Expense' };

export function lineType(line: PortalInvoiceLine): string {
  return LINE_TYPE_LABELS[line.lineTypeCode ?? ''] ?? 'Other';
}

// The configured rate a time line is billed at; else the file's stated one.
export function lineRate(line: PortalInvoiceLine): string {
  const rate = line.billedRate ?? line.unitRate;
  return rate === null ? '—' : formatMoney(rate);
}

// What an imported file claimed, when it differs from what is billed.
export function lineStatedDifference(line: PortalInvoiceLine): string | undefined {
  if (line.statedAmount === null || Number(line.statedAmount) === Number(line.amount)) {
    return undefined;
  }
  const rate = line.unitRate === null ? '' : ` at ${formatMoney(line.unitRate)}/h`;
  return `File said ${formatMoney(line.statedAmount)}${rate}`;
}
