// Files read before their case is known (model/rules.yaml
// validate_invoice_import): split by case for one professional, or a portal
// upload whose case is confirmed after reading. See MAPPING.md.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { Database } from '../db/client';
import { caseAssignment, caseIdentifier, caseTable, person, supportingInvoice } from '../db/schema';
import { NotFoundError, ValidationError } from '../errors';
import { fieldErrorsFromZodIssues } from '../intake/validation';
import { NotAssignedToCaseError } from '../portal/caseAssignmentAuthorization';
import { isStaffAccount, representedProfessionalIds, type PortalActor } from '../portal/portalActor';
import type { DocumentStore } from './documentStore';
import { detectInvoiceFile } from './detectFormat';
import { extractIntoDraft, insertDocument, insertImport, sha256 } from './invoiceImports';
import { cancelExtraction, enqueueExtraction, extractionProgress } from './extractionJobs';
import { ExtractionCancelledError, isolationEnabled, parseIsolated } from './isolatedExtraction';
import { suggestMileage, UnreadableInvoiceFileError, type ImportFormat, type ParsedInvoice } from './parsedInvoice';
import { matchKeys, namedIn, type MatchKeys } from './caseMatching';
import { suggestUploadCase, uploadCases } from './caseSuggestions';
import { listRates, rateOn } from '../billing/professionalRates';
import { listMileageRates, mileageRateOn } from '../billing/mileageRates';

export interface SplitCase {
  caseId: string;
  externalReference: string | null;
  clientDisplayName: string | null;
  keys: MatchKeys;
}

function caseNamedIn(text: string | undefined, cases: SplitCase[]): string | undefined {
  const matches = namedIn(text, cases, (row) => row.keys);
  return matches.length === 1 ? matches[0]!.caseId : undefined;
}

// The professional's open cases, if the user may bill for them.
export async function splitCases(db: Database, actor: PortalActor, professionalId: string): Promise<SplitCase[]> {
  const mayBill =
    professionalId === actor.professionalId ||
    (await representedProfessionalIds(db, actor.userAccountId)).includes(professionalId);
  if (!mayBill) {
    throw new NotAssignedToCaseError();
  }
  const cases = await db
    .selectDistinct({
      caseId: caseTable.caseId,
      externalReference: caseTable.externalReference,
      clientDisplayName: person.displayName,
    })
    .from(caseAssignment)
    .innerJoin(caseTable, eq(caseAssignment.caseId, caseTable.caseId))
    .leftJoin(person, eq(caseTable.clientId, person.personId))
    .where(and(eq(caseAssignment.professionalId, professionalId), isNull(caseAssignment.endedAt)))
    .orderBy(asc(person.displayName));
  const identifiers =
    cases.length === 0
      ? []
      : await db
          .select({ caseId: caseIdentifier.caseId, value: caseIdentifier.value })
          .from(caseIdentifier)
          .where(inArray(caseIdentifier.caseId, cases.map((row) => row.caseId)));
  return cases.map((row) => ({
    ...row,
    keys: matchKeys(row.clientDisplayName, [
      row.externalReference,
      ...identifiers.filter((id) => id.caseId === row.caseId).map((id) => id.value),
    ]),
  }));
}

// A file being read, then waiting for its lines to be given cases. Reads
// run like single uploads: in the background extraction queue (quick
// formats straight away), in the isolated process, with progress; the
// stored file and the reading are then used to make the drafts, so nothing
// is read twice. Held in this process, like the queue: an unused read is
// dropped with its file after an hour, and a restart forgets them all
// (removeUnreferencedFiles clears their files at startup).
interface SplitRead {
  // Each kind is only reachable through its own routes.
  kind: 'split' | 'upload';
  userAccountId: string;
  // A split's professional; an upload's is chosen with its case.
  professionalId: string | null;
  fileName?: string;
  sizeBytes: number;
  storageReference: string;
  contentHash: string;
  mediaType: string;
  format: ImportFormat;
  extractionMethod: string;
  startedAt: Date;
  parsed?: ParsedInvoice;
  // Why it couldn't be read, shown to the uploader.
  failure?: string;
}

export const SPLIT_READ_EXPIRY_MS = 60 * 60 * 1000;
const splitReads = new Map<string, SplitRead>();

export class CaseSplitReadNotFoundError extends NotFoundError {
  constructor() {
    super('This file is no longer waiting to be split; upload it again.');
  }
}

const UNEXPECTED_FAILURE = 'This file couldn’t be read because of an unexpected error. Upload it again.';

async function settle(read: SplitRead, parse: () => Promise<ParsedInvoice>): Promise<void> {
  try {
    read.parsed = await parse();
  } catch (error) {
    if (error instanceof UnreadableInvoiceFileError) {
      read.failure = error.fieldErrors.file ?? 'The file could not be read.';
    } else if (!(error instanceof ExtractionCancelledError)) {
      // eslint-disable-next-line no-console
      console.error('Case-split read failed', error);
      read.failure = UNEXPECTED_FAILURE;
    }
  }
}

const startSchema = z.object({ professionalId: z.uuid() });

export async function startCaseSplitRead(
  db: Database,
  store: DocumentStore,
  actor: PortalActor,
  input: { professionalId: unknown; fileName?: string; bytes: Buffer },
): Promise<{ splitReadId: string }> {
  const params = startSchema.safeParse({ professionalId: input.professionalId });
  if (!params.success) {
    throw new ValidationError({ professionalId: 'Choose the professional this file bills for.' });
  }
  const { professionalId } = params.data;
  await splitCases(db, actor, professionalId);
  return { splitReadId: await beginRead(store, actor, 'split', professionalId, input) };
}

async function beginRead(
  store: DocumentStore,
  actor: PortalActor,
  kind: SplitRead['kind'],
  professionalId: string | null,
  input: { fileName?: string; bytes: Buffer },
): Promise<string> {
  const detected = detectInvoiceFile(input.bytes);
  const splitReadId = randomUUID();
  const read: SplitRead = {
    kind,
    userAccountId: actor.userAccountId,
    professionalId,
    fileName: input.fileName,
    sizeBytes: input.bytes.length,
    storageReference: await store.put(input.bytes),
    contentHash: sha256(input.bytes),
    mediaType: detected.mediaType,
    format: detected.format,
    extractionMethod: detected.extractionMethod,
    startedAt: new Date(),
  };
  splitReads.set(splitReadId, read);
  if (!detected.slow) {
    const { bytes } = input;
    await settle(read, () => (isolationEnabled() ? parseIsolated(bytes, () => undefined) : detected.parse()));
  } else {
    queueSplitRead(store, splitReadId, read);
  }
  return splitReadId;
}

// Out here so the waiting job holds only the stored file's reference.
function queueSplitRead(store: DocumentStore, splitReadId: string, read: SplitRead) {
  void enqueueExtraction(splitReadId, async (onProgress, signal) => {
    const bytes = await store.get(read.storageReference);
    if (!bytes) {
      read.failure = 'The uploaded file is no longer available. Upload it again.';
      return;
    }
    await settle(read, () =>
      isolationEnabled() ? parseIsolated(bytes, onProgress, { signal }) : detectInvoiceFile(bytes).parse({ onProgress }),
    );
  }).catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error('Case-split read failed', error);
  });
}

// Anyone but the uploader gets a 404.
function ownRead(actor: PortalActor, splitReadId: string, kind: SplitRead['kind'] = 'split'): SplitRead {
  const read = splitReads.get(splitReadId);
  if (!read || read.userAccountId !== actor.userAccountId || read.kind !== kind) {
    throw new CaseSplitReadNotFoundError();
  }
  return read;
}

export async function getCaseSplitRead(db: Database, actor: PortalActor, splitReadId: string) {
  const read = ownRead(actor, splitReadId);
  if (read.failure) {
    return { status: 'failed' as const, failureMessage: read.failure };
  }
  if (!read.parsed) {
    return { status: 'reading' as const, progress: extractionProgress(splitReadId) ?? null };
  }
  return { status: 'ready' as const, preview: await splitPreview(db, actor, read.professionalId!, read.parsed) };
}

export async function discardCaseSplitRead(
  store: DocumentStore,
  actor: PortalActor,
  splitReadId: string,
  kind: SplitRead['kind'] = 'split',
) {
  const read = ownRead(actor, splitReadId, kind);
  splitReads.delete(splitReadId);
  cancelExtraction(splitReadId);
  await store.delete(read.storageReference);
  return { splitReadId };
}

// Drops reads left unused for an hour, with their files.
export async function expireCaseSplitReads(store: DocumentStore, now: Date = new Date()): Promise<number> {
  const stale = [...splitReads].filter(([, read]) => now.getTime() - read.startedAt.getTime() > SPLIT_READ_EXPIRY_MS);
  for (const [splitReadId, read] of stale) {
    splitReads.delete(splitReadId);
    cancelExtraction(splitReadId);
    // eslint-disable-next-line no-await-in-loop
    await store.delete(read.storageReference);
  }
  return stale.length;
}

async function splitPreview(db: Database, actor: PortalActor, professionalId: string, parsed: ParsedInvoice) {
  const cases = await splitCases(db, actor, professionalId);
  // For lines without a case column, as in a PDF.
  const fileCase = caseNamedIn(parsed.invoiceText, cases);
  const rates = await listRates(db, [professionalId]);
  const mileageRates = await listMileageRates(db);
  return {
    cases: cases.map(({ keys: _keys, ...row }) => row),
    lines: parsed.lines.map(suggestMileage).map((line, index) => {
      // What a time or mileage line will be billed at, beside what the file says.
      const priced = line.lineType === 'time' || line.lineType === 'mileage';
      const billedRate = !line.serviceDate
        ? undefined
        : line.lineType === 'time'
          ? rateOn(rates, professionalId, line.serviceDate)
          : line.lineType === 'mileage'
            ? mileageRateOn(mileageRates, line.serviceDate)
            : undefined;
      const billedAmount =
        billedRate !== undefined && line.quantity !== undefined && line.quantity > 0
          ? Math.round(line.quantity * Number(billedRate) * 100) / 100
          : undefined;
      return {
        index,
        location: line.location,
        caseLabel: line.caseLabel ?? null,
        lineType: line.lineType,
        serviceDate: line.serviceDate ?? null,
        description: line.description ?? null,
        quantity: line.quantity ?? null,
        amount: line.amount,
        billedRate: billedRate ?? null,
        billedAmount: priced ? (billedAmount ?? null) : line.amount,
        suggestedCaseId:
          (line.caseLabel ? caseNamedIn(line.caseLabel, cases) : (fileCase ?? caseNamedIn(line.description, cases))) ?? null,
      };
    }),
  };
}

const splitInputSchema = z.object({
  splitReadId: z.uuid(),
  // One case per line, in the file's order.
  caseIds: z.array(z.uuid()).min(1),
});

export async function uploadInvoiceFileByCase(db: Database, actor: PortalActor, rawInput: unknown) {
  const parsedInput = splitInputSchema.safeParse(rawInput);
  if (!parsedInput.success) {
    throw new ValidationError(fieldErrorsFromZodIssues(parsedInput.error.issues));
  }
  const input = parsedInput.data;
  const read = ownRead(actor, input.splitReadId);
  const { parsed } = read;
  if (!parsed) {
    throw new ValidationError({ file: read.failure ?? 'The file is still being read.' });
  }
  const professionalId = read.professionalId!;
  const cases = await splitCases(db, actor, professionalId);
  const allowed = new Set(cases.map((row) => row.caseId));
  if (input.caseIds.length !== parsed.lines.length) {
    throw new ValidationError({ caseIds: 'Assign a case to every line in the file.' });
  }
  if (input.caseIds.some((caseId) => !allowed.has(caseId))) {
    throw new NotAssignedToCaseError();
  }

  const groups = new Map<string, ParsedInvoice['lines']>();
  parsed.lines.forEach((line, index) => {
    const caseId = input.caseIds[index]!;
    groups.set(caseId, [...(groups.get(caseId) ?? []), line]);
  });

  // Claimed for this request, so a second click can't make the drafts twice;
  // put back if they couldn't be made, to try again.
  splitReads.delete(input.splitReadId);
  try {
    return await db.transaction(async (tx) => {
      const now = new Date();
      const documentId = await insertDocument(
        tx,
        actor,
        { storageReference: read.storageReference, fileName: read.fileName, mediaType: read.mediaType, contentHash: read.contentHash },
        now,
      );
      const created: Array<{ invoiceImportId: string; caseId: string; invoiceId: string }> = [];
      for (const [caseId, lines] of groups) {
        // eslint-disable-next-line no-await-in-loop
        const importId = await insertImport(tx, actor, { documentId, caseId, format: read.format, uploadedAt: now });
        // eslint-disable-next-line no-await-in-loop
        const invoiceId = await extractIntoDraft(tx, actor, {
          importId,
          documentId,
          contentHash: read.contentHash,
          caseId,
          billedProfessionalId: professionalId,
          extractionMethod: read.extractionMethod,
          extractedAt: now,
          // The file's stated total covers every case, so it isn't compared per case.
          parsed: { ...parsed, statedTotal: undefined, lines },
          everyLineBilled: true,
        });
        created.push({ invoiceImportId: importId, caseId, invoiceId });
      }
      return { imports: created };
    });
  } catch (error) {
    splitReads.set(input.splitReadId, read);
    throw error;
  }
}

// --- Portal upload: one file, one invoice, its case chosen after reading ---

export async function startUploadRead(
  db: Database,
  store: DocumentStore,
  actor: PortalActor,
  input: { fileName?: string; bytes: Buffer },
): Promise<{ uploadReadId: string }> {
  // Staff may hold an invoice with no case yet, on Intake.
  if (!(await isStaffAccount(db, actor.userAccountId)) && (await uploadCases(db, actor)).length === 0) {
    throw new NotAssignedToCaseError();
  }
  return { uploadReadId: await beginRead(store, actor, 'upload', null, input) };
}

export async function getUploadRead(db: Database, actor: PortalActor, uploadReadId: string) {
  const read = ownRead(actor, uploadReadId, 'upload');
  const file = { fileName: read.fileName ?? 'uploaded-invoice', sizeBytes: read.sizeBytes, format: read.format };
  if (read.failure) {
    return { status: 'failed' as const, file, failureMessage: read.failure };
  }
  if (!read.parsed) {
    return { status: 'reading' as const, file, progress: extractionProgress(uploadReadId) ?? null };
  }
  const cases = await uploadCases(db, actor);
  const { parsed } = read;
  return {
    status: 'ready' as const,
    file,
    read: {
      lineCount: parsed.lines.length,
      invoiceNumber: parsed.invoiceNumber ?? null,
      periodStart: parsed.periodStart ?? null,
      periodEnd: parsed.periodEnd ?? null,
      statedTotal: parsed.statedTotal ?? null,
    },
    cases: cases.map(({ keys: _keys, ...row }) => row),
    suggested: suggestUploadCase(cases, parsed, read.fileName),
  };
}

export function discardUploadRead(store: DocumentStore, actor: PortalActor, uploadReadId: string) {
  return discardCaseSplitRead(store, actor, uploadReadId, 'upload');
}

const uploadDraftSchema = z
  .object({
    uploadReadId: z.uuid(),
    // Null (staff only): no case yet; it waits on Intake to be matched, and
    // whom it bills may be left for then too.
    caseId: z.uuid('Choose the case this invoice is for.').nullable(),
    professionalId: z.uuid('Choose who this invoice is from.').nullable(),
    periodStart: z.iso.date('Enter the first day of the billing period.').optional(),
    periodEnd: z.iso.date('Enter the last day of the billing period.').optional(),
    invoiceNumber: z.string().trim().max(100, 'Keep the invoice number under 100 characters.').optional(),
  })
  .refine((input) => Boolean(input.periodStart) === Boolean(input.periodEnd), {
    message: 'Enter both days of the billing period, or neither.',
    path: ['periodEnd'],
  })
  .refine((input) => !input.periodStart || !input.periodEnd || input.periodEnd >= input.periodStart, {
    message: 'The billing period must end on or after its first day.',
    path: ['periodEnd'],
  });

// The checked file becomes one import and draft; its lines are checked next.
export async function createDraftFromUpload(db: Database, actor: PortalActor, rawInput: unknown) {
  const parsedInput = uploadDraftSchema.safeParse(rawInput);
  if (!parsedInput.success) {
    throw new ValidationError(fieldErrorsFromZodIssues(parsedInput.error.issues));
  }
  const input = parsedInput.data;
  const read = ownRead(actor, input.uploadReadId, 'upload');
  const { parsed } = read;
  if (!parsed) {
    throw new ValidationError({ file: read.failure ?? 'The file is still being read.' });
  }
  // Claimed before anything is awaited, so a second click can't make the
  // draft twice; put back if it couldn't be made, to try again.
  splitReads.delete(input.uploadReadId);
  try {
    if (input.caseId === null) {
      if (!(await isStaffAccount(db, actor.userAccountId))) {
        throw new ValidationError({ caseId: 'Choose the case this invoice is for.' });
      }
      // Checked on creating the draft: any active professional.
    } else {
      const allowed = (await uploadCases(db, actor)).some(
        (row) => row.caseId === input.caseId && row.professionalId === input.professionalId,
      );
      if (!allowed) {
        throw new NotAssignedToCaseError();
      }
    }
    return await db.transaction(async (tx) => {
      const now = new Date();
      const documentId = await insertDocument(
        tx,
        actor,
        { storageReference: read.storageReference, fileName: read.fileName, mediaType: read.mediaType, contentHash: read.contentHash },
        now,
      );
      const importId = await insertImport(tx, actor, { documentId, caseId: input.caseId, format: read.format, uploadedAt: now });
      const invoiceId = await extractIntoDraft(tx, actor, {
        importId,
        documentId,
        contentHash: read.contentHash,
        caseId: input.caseId,
        billedProfessionalId: input.professionalId,
        extractionMethod: read.extractionMethod,
        extractedAt: now,
        parsed,
        fileName: read.fileName,
        // With no one chosen yet, timekeepers named in the file are suggested.
        everyLineBilled: input.professionalId !== null,
        checkedPeriod: { start: input.periodStart, end: input.periodEnd },
      });
      if (input.invoiceNumber) {
        await tx.insert(supportingInvoice).values({
          invoiceId,
          invoiceNumber: input.invoiceNumber,
          periodStart: input.periodStart ?? null,
          periodEnd: input.periodEnd ?? null,
          documentId,
        });
      }
      return { invoiceImportId: importId, invoiceId };
    });
  } catch (error) {
    splitReads.set(input.uploadReadId, read);
    throw error;
  }
}
