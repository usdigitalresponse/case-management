// Amounts are summed in whole cents so totals equal the sum of their lines
// (model/rules.yaml validate_invoice_total).
export function toCents(value: string | number | null | undefined): number {
  return Math.round(Number(value ?? 0) * 100);
}

export function fromCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

// "$1,234.50", for messages and emails.
export function formatMoney(value: string | number): string {
  return `$${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
