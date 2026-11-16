// How a line's kind, quantity and rate read in every invoice table, staff's and submitters'.
import type { InvoiceLineType, PortalInvoiceLine } from './api/client';
import { formatDate } from './formatDateTime';
import { formatRate } from './formatMoney';

const KIND_LABELS: Record<InvoiceLineType, string> = { time: 'Time', mileage: 'Mileage', expense: 'Expense', other: 'Other' };

// A trip's time is its travel time, and its other expenses travel expenses.
export function lineKindLabel(kind: InvoiceLineType, { onTrip = false, waiting = false } = {}): string {
  if (onTrip && kind === 'time') return 'Travel time';
  if (onTrip && kind === 'expense') return 'Travel expense';
  if (waiting) return 'Waiting time';
  return KIND_LABELS[kind];
}

const quantityUnit = (kind: InvoiceLineType, quantity: number) =>
  kind === 'time' ? 'hours' : kind === 'mileage' ? (quantity === 1 ? 'mile' : 'miles') : '';

// "1.70 hours", "64 miles"; a dash for none.
export function formatQuantity(kind: InvoiceLineType, quantity: number | null): string {
  if (quantity === null || quantity === 0) return '—';
  const unit = quantityUnit(kind, quantity);
  return kind === 'time' ? `${quantity.toFixed(2)} ${unit}` : unit ? `${quantity} ${unit}` : String(quantity);
}

// "$150.00", "$0.725 a mile"; a dash for none.
export function formatLineRate(kind: InvoiceLineType, rate: number | string | null): string {
  return rate === null ? '—' : `${formatRate(rate)}${kind === 'mileage' ? ' a mile' : ''}`;
}

export function isMileage(line: Pick<PortalInvoiceLine, 'expenseTypeCode'>): boolean {
  return line.expenseTypeCode === 'mileage';
}

export function lineKind(line: PortalInvoiceLine): InvoiceLineType {
  if (isMileage(line)) return 'mileage';
  return line.lineTypeCode === 'time' || line.lineTypeCode === 'expense' ? line.lineTypeCode : 'other';
}

// Supplier-stated values, else the linked time entry's, as in exports.
export function lineDate(line: PortalInvoiceLine): string {
  return formatDate(line.serviceDate ?? line.sourceActivityOn);
}

export function lineHours(line: PortalInvoiceLine): string {
  const quantity = line.quantity ?? line.sourceDurationHours;
  return formatQuantity(lineKind(line), quantity === null ? null : Number(quantity));
}

export function lineDescription(line: PortalInvoiceLine): string {
  return line.description ?? line.sourceDescription ?? 'No description';
}

export function lineTimekeeper(line: PortalInvoiceLine): string {
  return line.timekeeperDisplayName ?? line.timekeeperLabel ?? '—';
}

export function lineType(line: PortalInvoiceLine): string {
  return lineKindLabel(lineKind(line), { onTrip: Boolean(line.tripId), waiting: line.timeCategory === 'waiting' });
}

// The configured rate a time or mileage line is billed at; else the file's stated one.
export function lineRate(line: PortalInvoiceLine): string {
  return formatLineRate(lineKind(line), line.billedRate ?? line.unitRate);
}

// Opens the trip in the reviewer's own browser; nothing is sent by the app.
export function directionsUrl(origin: string, destination: string): string {
  const params = new URLSearchParams({ api: '1', origin, destination, travelmode: 'driving' });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}
