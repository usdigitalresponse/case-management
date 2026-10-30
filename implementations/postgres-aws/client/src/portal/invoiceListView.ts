import type { InvoiceRecord } from '../api/client';

export const INVOICE_FILTERS = {
  all: 'All',
  changes: 'Needs changes',
  drafts: 'Drafts',
  waiting: 'Sent, waiting for review',
  review: 'Being reviewed',
  decided: 'Decided',
} as const;
export type InvoiceFilter = keyof typeof INVOICE_FILTERS;

export const INVOICE_SORTS = {
  recent: 'Newest first',
  oldest: 'Oldest first',
  amount_desc: 'Amount, highest first',
  amount_asc: 'Amount, lowest first',
  client: 'Client, A to Z',
  period: 'Billing period, latest first',
} as const;
export type InvoiceSort = keyof typeof INVOICE_SORTS;

// A choice read from the address, or the default if it isn't one.
export function choiceFrom<T extends string>(value: string | null, choices: Record<T, string>, fallback: T): T {
  return value !== null && Object.hasOwn(choices, value) ? (value as T) : fallback;
}

function filterOf(invoice: InvoiceRecord): Exclude<InvoiceFilter, 'all'> | null {
  if (invoice.returnedReason) return 'changes';
  switch (invoice.statusCode) {
    case 'draft':
      return 'drafts';
    case 'awaiting_match':
    case 'submitted':
      return 'waiting';
    case 'under_review':
    case 'awaiting_sign_off':
      return 'review';
    case 'approved':
    case 'rejected':
      return 'decided';
    default:
      return null;
  }
}

export function matchesFilter(invoice: InvoiceRecord, filter: InvoiceFilter): boolean {
  return filter === 'all' || filterOf(invoice) === filter;
}

const clientOf = (invoice: InvoiceRecord) => invoice.caseClientDisplayName ?? invoice.proposedCase?.clientName ?? null;

function matchesQuery(invoice: InvoiceRecord, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const text = [
    invoice.caseNumber,
    invoice.caseExternalReference,
    invoice.proposedCase?.caseNumber,
    clientOf(invoice),
    invoice.professionalDisplayName,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return words.every((word) => text.includes(word));
}

// Missing values sort last either way.
function byValue<T>(value: (invoice: InvoiceRecord) => T | null, compare: (a: T, b: T) => number) {
  return (a: InvoiceRecord, b: InvoiceRecord) => {
    const [x, y] = [value(a), value(b)];
    return x === null ? (y === null ? 0 : 1) : y === null ? -1 : compare(x, y);
  };
}

const sentAt = (invoice: InvoiceRecord) => invoice.submittedAt;
const COMPARE: Record<InvoiceSort, (a: InvoiceRecord, b: InvoiceRecord) => number> = {
  // Unsent drafts are the newest work.
  recent: (a, b) => (a.submittedAt === null ? -1 : 0) + (b.submittedAt === null ? 1 : 0) || byValue(sentAt, (x, y) => y.localeCompare(x))(a, b),
  oldest: byValue(sentAt, (x, y) => x.localeCompare(y)),
  amount_desc: (a, b) => Number(b.submittedTotal) - Number(a.submittedTotal),
  amount_asc: (a, b) => Number(a.submittedTotal) - Number(b.submittedTotal),
  client: byValue(clientOf, (x, y) => x.localeCompare(y)),
  period: byValue((invoice) => invoice.periodStart, (x, y) => y.localeCompare(x)),
};

export function invoiceView(
  invoices: InvoiceRecord[],
  { query, filter, sort }: { query: string; filter: InvoiceFilter; sort: InvoiceSort },
): InvoiceRecord[] {
  return invoices.filter((invoice) => matchesFilter(invoice, filter) && matchesQuery(invoice, query)).sort(COMPARE[sort]);
}
