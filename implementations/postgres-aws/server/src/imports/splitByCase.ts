// A file designated to one professional, whose lines name their cases
// (model/rules.yaml validate_invoice_import): previewed with a suggested
// case per line, then, once the uploader has assigned every line, split
// into one import and draft per case sharing one document.
import { z } from 'zod';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { Database } from '../db/client';
import { caseAssignment, caseIdentifier, caseTable, person } from '../db/schema';
import { ValidationError } from '../errors';
import { fieldErrorsFromZodIssues } from '../intake/validation';
import { NotAssignedToCaseError } from '../portal/caseAssignmentAuthorization';
import { representedProfessionalIds, type PortalActor } from '../portal/portalActor';
import type { DocumentStore } from './documentStore';
import { detectInvoiceFile, MAX_UPLOAD_BYTES } from './detectFormat';
import { extractIntoDraft, insertDocument, insertImport, sha256 } from './invoiceImports';
import { UnreadableInvoiceFileError, type ParsedInvoice } from './parsedInvoice';
import { listRates, rateOn } from '../billing/professionalRates';

export interface SplitCase {
  caseId: string;
  externalReference: string | null;
  clientDisplayName: string | null;
  // Normalized reference, identifiers and client name, for matching.
  keys: string[];
}

function key(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
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
    keys: [row.externalReference, row.clientDisplayName, ...identifiers.filter((id) => id.caseId === row.caseId).map((id) => id.value)]
      .flatMap((text) => (text ? [key(text)] : []))
      .filter(Boolean),
  }));
}

// Only a single exact (normalized) match is suggested.
export function suggestCaseForLabel(label: string | undefined, cases: SplitCase[]): string | undefined {
  if (!label) {
    return undefined;
  }
  const wanted = key(label);
  const matches = cases.filter((row) => row.keys.includes(wanted));
  return matches.length === 1 ? matches[0]!.caseId : undefined;
}

async function parseOrRefuse(bytes: Buffer) {
  const detected = detectInvoiceFile(bytes);
  try {
    return { detected, parsed: await detected.parse() };
  } catch (error) {
    if (error instanceof UnreadableInvoiceFileError) {
      throw new ValidationError({ file: error.fieldErrors.file ?? 'The file could not be read.' });
    }
    throw error;
  }
}

const professionalSchema = z.object({ professionalId: z.uuid() });

export async function previewCaseSplit(db: Database, actor: PortalActor, input: { professionalId: unknown; bytes: Buffer }) {
  const params = professionalSchema.safeParse({ professionalId: input.professionalId });
  if (!params.success) {
    throw new ValidationError({ professionalId: 'Choose the professional this file bills for.' });
  }
  const { professionalId } = params.data;
  const cases = await splitCases(db, actor, professionalId);
  const { parsed } = await parseOrRefuse(input.bytes);
  const rates = await listRates(db, [professionalId]);
  return {
    cases: cases.map(({ keys: _keys, ...row }) => row),
    lines: parsed.lines.map((line, index) => {
      // What a time line will be billed at, beside what the file says.
      const billedRate =
        line.lineType === 'time' && line.serviceDate ? rateOn(rates, professionalId, line.serviceDate) : undefined;
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
        billedAmount: line.lineType === 'time' ? (billedAmount ?? null) : line.amount,
        suggestedCaseId: suggestCaseForLabel(line.caseLabel, cases) ?? null,
      };
    }),
  };
}

const splitInputSchema = z.object({
  professionalId: z.uuid(),
  fileName: z.string().max(300).optional(),
  // The file, base64-encoded, sent with its line assignments.
  fileBase64: z.string().min(1),
  // One case per line, in the file's order.
  caseIds: z.array(z.uuid()).min(1),
});

export async function uploadInvoiceFileByCase(db: Database, store: DocumentStore, actor: PortalActor, rawInput: unknown) {
  const parsedInput = splitInputSchema.safeParse(rawInput);
  if (!parsedInput.success) {
    throw new ValidationError(fieldErrorsFromZodIssues(parsedInput.error.issues));
  }
  const input = parsedInput.data;
  const bytes = Buffer.from(input.fileBase64, 'base64');
  if (bytes.length > MAX_UPLOAD_BYTES) {
    throw new ValidationError({ file: 'The file is larger than 10 MB.' });
  }
  const cases = await splitCases(db, actor, input.professionalId);
  const allowed = new Set(cases.map((row) => row.caseId));
  const { detected, parsed } = await parseOrRefuse(bytes);
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

  const contentHash = sha256(bytes);
  const storageReference = await store.put(bytes);
  try {
    return await db.transaction(async (tx) => {
      const now = new Date();
      const documentId = await insertDocument(
        tx,
        actor,
        { storageReference, fileName: input.fileName, mediaType: detected.mediaType, contentHash },
        now,
      );
      const created: Array<{ invoiceImportId: string; caseId: string; invoiceId: string }> = [];
      for (const [caseId, lines] of groups) {
        // eslint-disable-next-line no-await-in-loop
        const importId = await insertImport(tx, actor, { documentId, caseId, format: detected.format, uploadedAt: now });
        // eslint-disable-next-line no-await-in-loop
        const invoiceId = await extractIntoDraft(tx, actor, {
          importId,
          documentId,
          contentHash,
          caseId,
          billedProfessionalId: input.professionalId,
          extractionMethod: detected.extractionMethod,
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
    await store.delete(storageReference);
    throw error;
  }
}
