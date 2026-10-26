export function isSubmittedStatus(statusCode: string): boolean {
  return !['draft', 'withdrawn'].includes(statusCode);
}

// Matches the export file name.
export function invoiceReference(invoiceId: string): string {
  return `Invoice ${invoiceId.slice(0, 8)}`;
}
