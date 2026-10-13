import type { PortalInvoiceLine } from './api/client';
import { formatDate } from './formatDateTime';
import { formatMoney, formatRate } from './formatMoney';

// Supplier-stated values, else the linked time entry's, as in exports.
export function lineDate(line: PortalInvoiceLine): string {
  return formatDate(line.serviceDate ?? line.sourceActivityOn);
}

export function isMileage(line: Pick<PortalInvoiceLine, 'expenseTypeCode'>): boolean {
  return line.expenseTypeCode === 'mileage';
}

export function lineHours(line: PortalInvoiceLine): string {
  const quantity = line.quantity ?? line.sourceDurationHours;
  return quantity === null ? '—' : isMileage(line) ? `${Number(quantity)} mi` : quantity;
}

export function lineDescription(line: PortalInvoiceLine): string {
  return line.description ?? line.sourceDescription ?? 'No description';
}

export function lineTimekeeper(line: PortalInvoiceLine): string {
  return line.timekeeperDisplayName ?? line.timekeeperLabel ?? '—';
}

const LINE_TYPE_LABELS: Record<string, string> = { time: 'Time', expense: 'Expense' };

export function lineType(line: PortalInvoiceLine): string {
  return isMileage(line) ? 'Mileage' : (LINE_TYPE_LABELS[line.lineTypeCode ?? ''] ?? 'Other');
}

// The configured rate a time or mileage line is billed at; else the file's stated one.
export function lineRate(line: PortalInvoiceLine): string {
  const rate = line.billedRate ?? line.unitRate;
  return rate === null ? '—' : `${formatRate(rate)}${isMileage(line) ? '/mi' : ''}`;
}

// What an imported file claimed, when it differs from what is billed.
export function lineStatedDifference(line: PortalInvoiceLine): string | undefined {
  if (line.statedAmount === null || Number(line.statedAmount) === Number(line.amount)) {
    return undefined;
  }
  const rate = line.unitRate === null ? '' : ` at ${formatMoney(line.unitRate)}${isMileage(line) ? '/mi' : '/h'}`;
  return `File said ${formatMoney(line.statedAmount)}${rate}`;
}

// Opens the trip in the reviewer's own browser; nothing is sent by the app.
export function directionsUrl(origin: string, destination: string): string {
  const params = new URLSearchParams({ api: '1', origin, destination, travelmode: 'driving' });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}
