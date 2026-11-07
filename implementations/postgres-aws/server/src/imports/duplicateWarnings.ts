// Whether an imported file, or the number on it, was imported before for the
// same professional: checked when the file is read, and again when whom it
// is from changes (../billing/uploadDetails.ts).
import { and, eq, ne, sql } from 'drizzle-orm';
import type { Transaction } from '../db/client';
import { document, invoice, invoiceImport } from '../db/schema';
import type { ImportWarning } from './parsedInvoice';

const DUPLICATE_CODES = ['duplicate_file', 'duplicate_invoice_number'];

// Imports split from the same document don't count as duplicates.
export async function duplicateWarnings(
  tx: Transaction,
  importId: string,
  documentId: string,
  contentHash: string,
  billedProfessionalId: string | null,
  invoiceNumber: string | undefined,
): Promise<ImportWarning[]> {
  const warnings: ImportWarning[] = [];
  // Duplicates are judged per professional; none is known yet.
  if (!billedProfessionalId) {
    return warnings;
  }
  const sameFile = await tx
    .select({ invoiceImportId: invoiceImport.invoiceImportId })
    .from(invoiceImport)
    .innerJoin(document, eq(invoiceImport.documentId, document.documentId))
    .innerJoin(invoice, eq(invoiceImport.invoiceId, invoice.invoiceId))
    .where(
      and(
        eq(document.contentHash, contentHash),
        eq(invoice.professionalId, billedProfessionalId),
        ne(invoiceImport.invoiceImportId, importId),
        ne(invoiceImport.documentId, documentId),
      ),
    )
    .limit(1);
  if (sameFile.length > 0) {
    warnings.push({ code: 'duplicate_file', message: 'This exact file was uploaded before for the same professional.' });
  }
  if (invoiceNumber) {
    const sameNumber = await tx
      .select({ invoiceImportId: invoiceImport.invoiceImportId })
      .from(invoiceImport)
      .innerJoin(invoice, eq(invoiceImport.invoiceId, invoice.invoiceId))
      .where(
        and(
          eq(invoice.professionalId, billedProfessionalId),
          ne(invoiceImport.invoiceImportId, importId),
          ne(invoiceImport.documentId, documentId),
          sql`${invoiceImport.extractionResult} -> 'invoice' -> 'invoice_number' ->> 'value' = ${invoiceNumber}`,
        ),
      )
      .limit(1);
    if (sameNumber.length > 0) {
      warnings.push({
        code: 'duplicate_invoice_number',
        message: `Invoice number ${invoiceNumber} was already imported for the same professional.`,
      });
    }
  }
  return warnings;
}

// Replaces an invoice's duplicate warnings with those for its new sender,
// judged by the file and the number read from it, as on reading.
// With no sender, it has none.
export async function recheckDuplicates(tx: Transaction, invoiceId: string, billedProfessionalId: string | null): Promise<void> {
  const [imported] = await tx
    .select({
      invoiceImportId: invoiceImport.invoiceImportId,
      documentId: invoiceImport.documentId,
      extractionResult: invoiceImport.extractionResult,
      contentHash: document.contentHash,
    })
    .from(invoiceImport)
    .innerJoin(document, eq(invoiceImport.documentId, document.documentId))
    .where(eq(invoiceImport.invoiceId, invoiceId))
    .limit(1);
  if (!imported) return;
  const result = (imported.extractionResult ?? {}) as {
    warnings?: ImportWarning[];
    invoice?: { invoice_number?: { value?: string } };
  };
  const found = await duplicateWarnings(
    tx,
    imported.invoiceImportId,
    imported.documentId,
    imported.contentHash,
    billedProfessionalId,
    result.invoice?.invoice_number?.value,
  );
  const warnings = [...(result.warnings ?? []).filter((warning) => !DUPLICATE_CODES.includes(warning.code)), ...found];
  await tx
    .update(invoiceImport)
    .set({ extractionResult: { ...result, warnings } })
    .where(eq(invoiceImport.invoiceImportId, imported.invoiceImportId));
}
