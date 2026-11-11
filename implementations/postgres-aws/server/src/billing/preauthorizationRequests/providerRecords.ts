// A provider's CVs and fee schedules are kept records, unlike invoice working copies.
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { and, asc, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { type Database, type DatabaseOrTransaction } from '../../db/client';
import { firstRow } from '../../db/rowHelpers';
import { getReferenceId } from '../../db/referenceLookups';
import { document, documentLink, documentPurposes, providerServiceRate } from '../../db/schema';
import { ConflictError, NotFoundError, ValidationError } from '../../errors';
import { isStaffAccount, type PortalActor } from '../../portal/portalActor';
import { type DocumentStore } from '../../imports/documentStore';
import { OPEN_STATUSES, RATE_BASES, money, parse } from './requestRules';
import { listRequestableProviders } from './submit';
import { loadRequestRow, requireReader } from './read';

// --- documents ---------------------------------------------------------------


const DOCUMENT_PURPOSES = ['cv', 'fee_schedule', 'quote', 'supporting'] as const;
type DocumentPurpose = (typeof DOCUMENT_PURPOSES)[number];
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

// PDFs, Word documents and images; never rendered in the app's origin.
function detectDocument(bytes: Buffer): string {
  if (bytes.length === 0) throw new ValidationError({ file: 'The file is empty.' });
  if (bytes.length > MAX_DOCUMENT_BYTES) throw new ValidationError({ file: 'Files must be 10 MB or smaller.' });
  const head = bytes.subarray(0, 8);
  if (head.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (head[0] === 0x89 && head.subarray(1, 4).toString('latin1') === 'PNG') return 'image/png';
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (head[0] === 0x50 && head[1] === 0x4b && bytes.includes('word/document.xml')) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  throw new ValidationError({ file: 'Upload a PDF, a Word document (.docx), or a PNG or JPEG image.' });
}

type LinkTarget = { preauthorizationRequestId: string } | { professionalId: string };

export async function listLinkedDocuments(db: DatabaseOrTransaction, target: LinkTarget) {
  const condition =
    'preauthorizationRequestId' in target
      ? eq(documentLink.preauthorizationRequestId, target.preauthorizationRequestId)
      : eq(documentLink.professionalId, target.professionalId);
  return db
    .select({
      documentId: document.documentId,
      displayName: document.displayName,
      purposeCode: documentPurposes.code,
      purposeName: documentPurposes.displayName,
      recordedAt: document.recordedAt,
    })
    .from(documentLink)
    .innerJoin(document, eq(documentLink.documentId, document.documentId))
    .innerJoin(documentPurposes, eq(documentLink.purposeId, documentPurposes.id))
    .where(and(condition, isNull(document.contentDeletedAt)))
    .orderBy(desc(document.recordedAt));
}

// model/rules.yaml request_provider_documents.
export async function providerDocumentStatus(db: DatabaseOrTransaction, professionalId: string) {
  const [documents, rates] = await Promise.all([
    listLinkedDocuments(db, { professionalId }),
    db
      .select({
        providerServiceRateId: providerServiceRate.providerServiceRateId,
        serviceDescription: providerServiceRate.serviceDescription,
        rate: providerServiceRate.rate,
        rateBasis: providerServiceRate.rateBasis,
        effectiveFrom: providerServiceRate.effectiveFrom,
      })
      .from(providerServiceRate)
      .where(eq(providerServiceRate.professionalId, professionalId))
      .orderBy(asc(providerServiceRate.serviceDescription), desc(providerServiceRate.effectiveFrom)),
  ]);
  const hasCv = documents.some((row) => row.purposeCode === 'cv');
  const hasFees = documents.some((row) => row.purposeCode === 'fee_schedule' || row.purposeCode === 'quote');
  return { documents, rates, missing: [...(hasCv ? [] : ['cv']), ...(hasFees ? [] : ['fee_schedule'])] };
}

// Staff, or a submitter who may name the provider.
export async function mayFileForProvider(db: DatabaseOrTransaction, actor: PortalActor, professionalId: string): Promise<boolean> {
  if (await isStaffAccount(db, actor.userAccountId)) return true;
  return (await listRequestableProviders(db, actor)).some((row) => row.professionalId === professionalId);
}

export async function addDocument(
  db: Database,
  store: DocumentStore,
  actor: PortalActor,
  target: LinkTarget,
  file: { bytes: Buffer; fileName: string | undefined; purpose: string | undefined },
) {
  const purpose = parse(z.enum(DOCUMENT_PURPOSES, 'Say what the file is.'), file.purpose) as DocumentPurpose;
  if ('preauthorizationRequestId' in target) {
    const row = await loadRequestRow(db, target.preauthorizationRequestId);
    await requireReader(db, actor.userAccountId, row);
    if (!OPEN_STATUSES.includes(row.statusCode)) {
      throw new ConflictError('request_closed', 'This request is already decided or withdrawn.');
    }
  } else if (!(await mayFileForProvider(db, actor, target.professionalId))) {
    throw new NotFoundError('Provider not found.');
  }
  const mediaType = detectDocument(file.bytes);
  const storageReference = await store.put(file.bytes);
  try {
    await db.transaction(async (tx) => {
      const created = firstRow(
        await tx
          .insert(document)
          .values({
            storageReference,
            displayName: (file.fileName ?? 'document').replace(/[\\/\r\n]/g, ' ').slice(0, 200),
            mediaType,
            contentHash: createHash('sha256').update(file.bytes).digest('hex'),
            recordedAt: new Date(),
            recordedByUserAccountId: actor.userAccountId,
          })
          .returning({ documentId: document.documentId }),
      );
      await tx.insert(documentLink).values({
        documentId: created.documentId,
        preauthorizationRequestId: 'preauthorizationRequestId' in target ? target.preauthorizationRequestId : null,
        professionalId: 'professionalId' in target ? target.professionalId : null,
        purposeId: await getReferenceId(tx, documentPurposes, purpose),
      });
    });
  } catch (error) {
    await store.delete(storageReference);
    throw error;
  }
  return 'preauthorizationRequestId' in target ? listLinkedDocuments(db, target) : providerDocumentStatus(db, target.professionalId);
}

export async function readLinkedDocument(db: DatabaseOrTransaction, store: DocumentStore, actor: PortalActor, documentId: string) {
  if (!z.uuid().safeParse(documentId).success) throw new NotFoundError('File not found.');
  const [row] = await db
    .select({
      storageReference: document.storageReference,
      displayName: document.displayName,
      mediaType: document.mediaType,
      preauthorizationRequestId: documentLink.preauthorizationRequestId,
      professionalId: documentLink.professionalId,
    })
    .from(documentLink)
    .innerJoin(document, eq(documentLink.documentId, document.documentId))
    .where(and(eq(document.documentId, documentId), isNull(document.contentDeletedAt), or(sql`${documentLink.preauthorizationRequestId} is not null`, sql`${documentLink.professionalId} is not null`)));
  if (!row) throw new NotFoundError('File not found.');
  if (row.preauthorizationRequestId) {
    await requireReader(db, actor.userAccountId, await loadRequestRow(db, row.preauthorizationRequestId));
  } else if (!(await mayFileForProvider(db, actor, row.professionalId!))) {
    throw new NotFoundError('File not found.');
  }
  const bytes = await store.get(row.storageReference);
  if (!bytes) throw new NotFoundError('File not found.');
  return { fileName: row.displayName, mediaType: row.mediaType, bytes };
}

const serviceRateSchema = z.object({
  serviceDescription: z.string().trim().min(1, 'Name the service.').max(200),
  rate: money,
  rateBasis: z.enum(RATE_BASES, 'Choose hourly, flat or per unit.'),
  effectiveFrom: z.iso.date('Enter the date it applies from.'),
});

export async function addProviderServiceRate(db: Database, actor: PortalActor, professionalId: string, rawInput: unknown) {
  if (!z.uuid().safeParse(professionalId).success || !(await mayFileForProvider(db, actor, professionalId))) {
    throw new NotFoundError('Provider not found.');
  }
  const input = parse(serviceRateSchema, rawInput);
  await db.insert(providerServiceRate).values({
    professionalId,
    serviceDescription: input.serviceDescription,
    rate: input.rate.toFixed(2),
    rateBasis: input.rateBasis,
    effectiveFrom: input.effectiveFrom,
    recordedByUserAccountId: actor.userAccountId,
    recordedAt: new Date(),
  });
  return providerDocumentStatus(db, professionalId);
}
