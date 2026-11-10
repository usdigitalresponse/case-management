import type { InvoiceExportFormat } from './api/client';

export type ExportFieldGroup = 'summary' | 'lines' | 'travel';

// What an invoice export may leave out, by the name the file shows it under,
// as server/src/billing/exportInvoice.ts OMITTABLE_EXPORT_FIELDS allows.
export const EXPORT_FIELDS: Record<ExportFieldGroup, readonly string[]> = {
  summary: ['Case number', 'Court numbers', 'County', 'Client', 'Professional', 'Submitted by', 'Signed off'],
  lines: ['Date', 'Type', 'Description', 'Timekeeper', 'Codes', 'Hours / qty', 'Rate', 'Requested', 'Decision', 'Approved', 'Reason', 'Reviewed by'],
  travel: ['Date', 'From', 'To', 'Round trip', 'Travel hours', 'Miles claimed', 'Driving route (mi)', 'Travel expenses', 'Requested'],
};

export function exportFieldKey(group: ExportFieldGroup, name: string): string {
  return `${group}:${name}`;
}

const KNOWN_KEYS = new Set(
  (Object.keys(EXPORT_FIELDS) as ExportFieldGroup[]).flatMap((group) => EXPORT_FIELDS[group].map((name) => exportFieldKey(group, name))),
);

export interface ExportChoices {
  format: InvoiceExportFormat;
  omit: string[];
}

const DEFAULT_CHOICES: ExportChoices = { format: 'pdf', omit: [] };

export function parseExportChoices(raw: string | null): ExportChoices {
  try {
    const saved = JSON.parse(raw ?? 'null') as Partial<ExportChoices> | null;
    return {
      format: saved?.format === 'xlsx' ? 'xlsx' : 'pdf',
      omit: Array.isArray(saved?.omit) ? saved.omit.filter((key) => typeof key === 'string' && KNOWN_KEYS.has(key)) : [],
    };
  } catch {
    return DEFAULT_CHOICES;
  }
}

// Each person's last choices, in this browser only; storage may be blocked.
function loadChoices<T>(key: string, parse: (raw: string | null) => T, fallback: T): T {
  try {
    return parse(localStorage.getItem(key));
  } catch {
    return fallback;
  }
}

function saveChoices(key: string, choices: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(choices));
  } catch {
    // Not remembered; the export still downloads.
  }
}

export function loadExportChoices(userAccountId: string): ExportChoices {
  return loadChoices(`invoice-export:${userAccountId}`, parseExportChoices, DEFAULT_CHOICES);
}

export function saveExportChoices(userAccountId: string, choices: ExportChoices): void {
  saveChoices(`invoice-export:${userAccountId}`, choices);
}

// Must match server/src/billing/billingRecord.ts OMITTABLE_BILLING_RECORD_COLUMNS.
export const BILLING_RECORD_FIELDS = [
  'Case number',
  'Court numbers',
  'County',
  'Client',
  'Provider',
  'Provider role',
  'Submitted by',
  'Received by',
  'Received on',
  'Billing period start',
  'Billing period end',
  'Date submitted',
  'Reasons used',
  'Status',
  'Status changed',
  'Reviewer',
  'Signed off by',
  'Signed off on',
] as const;

export type BillingRecordFormat = 'csv' | 'xlsx';

export interface BillingRecordChoices {
  format: BillingRecordFormat;
  signedOffOnly: boolean;
  omit: string[];
}

const DEFAULT_BILLING_RECORD_CHOICES: BillingRecordChoices = { format: 'xlsx', signedOffOnly: true, omit: [] };

export function parseBillingRecordChoices(raw: string | null): BillingRecordChoices {
  try {
    const saved = JSON.parse(raw ?? 'null') as Partial<BillingRecordChoices> | null;
    const known = new Set<string>(BILLING_RECORD_FIELDS);
    return {
      format: saved?.format === 'csv' ? 'csv' : 'xlsx',
      signedOffOnly: saved?.signedOffOnly !== false,
      omit: Array.isArray(saved?.omit) ? saved.omit.filter((name) => typeof name === 'string' && known.has(name)) : [],
    };
  } catch {
    return DEFAULT_BILLING_RECORD_CHOICES;
  }
}

export function loadBillingRecordChoices(userAccountId: string): BillingRecordChoices {
  return loadChoices(`billing-record-export:${userAccountId}`, parseBillingRecordChoices, DEFAULT_BILLING_RECORD_CHOICES);
}

export function saveBillingRecordChoices(userAccountId: string, choices: BillingRecordChoices): void {
  saveChoices(`billing-record-export:${userAccountId}`, choices);
}
