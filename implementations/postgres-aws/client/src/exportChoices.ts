import type { InvoiceExportFormat } from './api/client';

export type ExportFieldGroup = 'summary' | 'lines' | 'travel';

// What an invoice export may leave out, by the name the file shows it under,
// as server/src/billing/exportInvoice.ts OMITTABLE_EXPORT_FIELDS allows.
export const EXPORT_FIELDS: Record<ExportFieldGroup, readonly string[]> = {
  summary: ['Case number', 'Court numbers', 'Client', 'Professional', 'Submitted by', 'Signed off'],
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
function storageKey(userAccountId: string): string {
  return `invoice-export:${userAccountId}`;
}

export function loadExportChoices(userAccountId: string): ExportChoices {
  try {
    return parseExportChoices(localStorage.getItem(storageKey(userAccountId)));
  } catch {
    return DEFAULT_CHOICES;
  }
}

export function saveExportChoices(userAccountId: string, choices: ExportChoices): void {
  try {
    localStorage.setItem(storageKey(userAccountId), JSON.stringify(choices));
  } catch {
    // Not remembered; the export still downloads.
  }
}
