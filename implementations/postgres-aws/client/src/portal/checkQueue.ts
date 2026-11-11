// Drafts from one upload still to check after this one, oldest first.
export interface CheckQueue {
  queue: string[];
  total: number;
}

// Staff check the lines in their own shell; submitters on the invoice's page.
export function checkLinesPath(invoiceId: string, staff: boolean): string {
  return staff ? `/invoices/${invoiceId}/check` : `/portal/invoices/${invoiceId}`;
}
