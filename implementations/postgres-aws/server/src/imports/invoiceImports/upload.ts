// Storing an uploaded file and starting its import; for how long it is kept, see ../documentRetention.ts.
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { type Database, type Transaction } from '../../db/client';
import { firstRow } from '../../db/rowHelpers';
import { getReferenceId } from '../../db/referenceLookups';
import { document, invoiceImport, invoiceImportFormats } from '../../db/schema';
import { ValidationError } from '../../errors';
import { authorizeBilling, type PortalActor } from '../../portal/portalActor';
import { type DocumentStore } from '../documentStore';
import { detectInvoiceFile } from '../detectFormat';
import { isolationEnabled, parseIsolated } from '../isolatedExtraction';
import { importStatusId } from './importStatus';
import { queueBackgroundRead, readFile, recordExtraction } from './read';

const uploadParamsSchema = z.object({
  // Absent: staff hold it in invoice intake until it is matched to a case.
  caseId: z.string().uuid().optional(),
  professionalId: z.string().uuid().optional(),
});

export function sha256(bytes: Buffer): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

// Display only; never used as a path.
function safeDisplayName(fileName: string | undefined): string {
  const cleaned = (fileName ?? '').replace(/[^\w .()-]/g, '_').trim().slice(0, 200);
  return cleaned || 'uploaded-invoice';
}

export interface UploadInvoiceFileInput {
  caseId: unknown;
  professionalId?: unknown;
  fileName: string | undefined;
  bytes: Buffer;
}

export async function uploadInvoiceFile(
  db: Database,
  store: DocumentStore,
  actor: PortalActor,
  input: UploadInvoiceFileInput,
): Promise<{ invoiceImportId: string; status: string; invoiceId: string | null }> {
  const params = uploadParamsSchema.safeParse({ caseId: input.caseId || undefined, professionalId: input.professionalId || undefined });
  if (!params.success) {
    throw new ValidationError({ caseId: 'Choose a case to import the invoice into.' });
  }
  const caseId = params.data.caseId ?? null;
  // Staff may import with neither a case nor a professional; both are
  // chosen when it's matched.
  const billedProfessionalId = params.data.professionalId ?? actor.professionalId ?? null;
  if (!billedProfessionalId && caseId !== null) {
    throw new ValidationError({ professionalId: 'Choose the professional this invoice bills for.' });
  }
  await authorizeBilling(db, actor, caseId, billedProfessionalId);

  const detected = detectInvoiceFile(input.bytes);
  const contentHash = sha256(input.bytes);
  const storageReference = await store.put(input.bytes);

  // Slow formats are read in the background; the uploader sees progress.
  if (detected.slow) {
    let created: { importId: string; documentId: string };
    try {
      created = await db.transaction(async (tx) => {
        const now = new Date();
        const documentId = await insertDocument(
          tx,
          actor,
          { storageReference, fileName: input.fileName, mediaType: detected.mediaType, contentHash },
          now,
        );
        return { importId: await insertImport(tx, actor, { documentId, caseId, format: detected.format, uploadedAt: now }), documentId };
      });
    } catch (error) {
      await store.delete(storageReference);
      throw error;
    }
    queueBackgroundRead(db, store, actor, storageReference, {
      ...created,
      contentHash,
      caseId,
      billedProfessionalId,
      extractionMethod: detected.extractionMethod,
      fileName: input.fileName,
    });
    return { invoiceImportId: created.importId, status: 'received', invoiceId: null };
  }

  // Quick formats are read during the upload, but still in the isolated
  // process: a spreadsheet can inflate far beyond its file size.
  const outcome = await readFile(() => (isolationEnabled() ? parseIsolated(input.bytes, () => undefined) : detected.parse()));
  if (outcome.error) {
    await store.delete(storageReference);
    throw outcome.error;
  }
  try {
    return await db.transaction(async (tx) => {
      const now = new Date();
      const documentId = await insertDocument(
        tx,
        actor,
        { storageReference, fileName: input.fileName, mediaType: detected.mediaType, contentHash },
        now,
      );
      const importId = await insertImport(tx, actor, { documentId, caseId, format: detected.format, uploadedAt: now });
      return recordExtraction(
        tx,
        actor,
        { importId, documentId, contentHash, caseId, billedProfessionalId, extractionMethod: detected.extractionMethod, fileName: input.fileName },
        outcome,
      );
    });
  } catch (error) {
    // Nothing references the stored copy if the records weren't written.
    await store.delete(storageReference);
    throw error;
  }
}

export async function insertDocument(
  tx: Transaction,
  actor: PortalActor,
  file: { storageReference: string; fileName: string | undefined; mediaType: string; contentHash: string },
  now: Date,
): Promise<string> {
  const { documentId } = firstRow(
    await tx
      .insert(document)
      .values({
        storageReference: file.storageReference,
        displayName: safeDisplayName(file.fileName),
        mediaType: file.mediaType,
        contentHash: file.contentHash,
        recordedAt: now,
        recordedByUserAccountId: actor.userAccountId,
      })
      .returning({ documentId: document.documentId }),
  );
  return documentId;
}

export async function insertImport(
  tx: Transaction,
  actor: PortalActor,
  values: { documentId: string; caseId: string | null; format: string; uploadedAt: Date },
): Promise<string> {
  const imported = firstRow(
    await tx
      .insert(invoiceImport)
      .values({
        documentId: values.documentId,
        uploadedByUserAccountId: actor.userAccountId,
        uploadedAt: values.uploadedAt,
        caseId: values.caseId,
        sourceFormatId: await getReferenceId(tx, invoiceImportFormats, values.format),
        statusId: await importStatusId(tx, 'received'),
      })
      .returning({ invoiceImportId: invoiceImport.invoiceImportId }),
  );
  return imported.invoiceImportId;
}
