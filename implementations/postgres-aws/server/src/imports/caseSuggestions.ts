// The cases a file uploaded before its case is known may go to, and the one
// it names (./caseMatching.ts).
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { DatabaseOrTransaction } from '../db/client';
import { caseAssignment, caseIdentifier, caseTable, person, professional } from '../db/schema';
import { loadCaseNumbers } from '../billing/invoiceDetail';
import { representedProfessionalIds, type PortalActor } from '../portal/portalActor';
import { exactKeys, matchKeys, namedIn, normalize, type MatchKeys } from './caseMatching';
import type { ParsedInvoice } from './parsedInvoice';

export interface UploadCase {
  caseId: string;
  // Whom an invoice on this case bills: the submitter, or a professional
  // they act for (one option per pair).
  professionalId: string;
  caseNumber: string | null;
  clientDisplayName: string | null;
  professionalDisplayName: string | null;
  keys: MatchKeys;
}

// Open cases where the user, or a professional they act for, is the
// active assigned professional: the only cases an upload may go to.
export async function uploadCases(db: DatabaseOrTransaction, actor: PortalActor): Promise<UploadCase[]> {
  const professionalIds = [
    ...new Set([...(actor.professionalId ? [actor.professionalId] : []), ...(await representedProfessionalIds(db, actor.userAccountId))]),
  ];
  if (professionalIds.length === 0) {
    return [];
  }
  const rows = await db
    .selectDistinct({
      caseId: caseTable.caseId,
      professionalId: caseAssignment.professionalId,
      externalReference: caseTable.externalReference,
      clientDisplayName: person.displayName,
      professionalDisplayName: professional.displayName,
    })
    .from(caseAssignment)
    .innerJoin(caseTable, eq(caseAssignment.caseId, caseTable.caseId))
    .innerJoin(professional, eq(caseAssignment.professionalId, professional.professionalId))
    .leftJoin(person, eq(caseTable.clientId, person.personId))
    .where(
      and(inArray(caseAssignment.professionalId, professionalIds), isNull(caseAssignment.endedAt), isNull(caseTable.closedOn)),
    )
    .orderBy(asc(person.displayName));
  const caseIds = [...new Set(rows.map((row) => row.caseId))];
  const [numbers, identifiers] = await Promise.all([
    loadCaseNumbers(db, caseIds),
    caseIds.length === 0
      ? Promise.resolve([])
      : db.select({ caseId: caseIdentifier.caseId, value: caseIdentifier.value }).from(caseIdentifier).where(inArray(caseIdentifier.caseId, caseIds)),
  ]);
  return rows.flatMap((row) =>
    row.professionalId
      ? [
          {
            caseId: row.caseId,
            professionalId: row.professionalId,
            caseNumber: numbers.get(row.caseId)?.caseNumber ?? row.externalReference,
            clientDisplayName: row.clientDisplayName,
            professionalDisplayName: row.professionalDisplayName,
            keys: matchKeys(row.clientDisplayName, [
              row.externalReference,
              ...identifiers.filter((id) => id.caseId === row.caseId).map((id) => id.value),
            ]),
          },
        ]
      : [],
  );
}

// A case only when the file makes it clear: the user has one case; the
// file's lines, its text or its name ("Firm_Client_Sep.pdf") name one; or
// its text names a professional with one case. Several matches, or a case
// with none of the professionals the text names, suggest none.
export function suggestUploadCase(
  cases: UploadCase[],
  parsed: ParsedInvoice,
  fileName: string | undefined,
): Pick<UploadCase, 'caseId' | 'professionalId'> | null {
  const only = (matches: UploadCase[]) => (matches.length === 1 ? { caseId: matches[0]!.caseId, professionalId: matches[0]!.professionalId } : null);
  if (cases.length === 1) {
    return only(cases);
  }
  const labels = [...new Set(parsed.lines.flatMap((line) => (line.caseLabel ? [normalize(line.caseLabel)] : [])))];
  if (labels.length === 1) {
    const fromLines = only(namedIn(labels[0], cases, (row) => row.keys));
    if (fromLines) {
      return fromLines;
    }
  }
  // Professionals the text names; a case none of them is on suggests nothing.
  const people = [...new Map(cases.map((row) => [row.professionalId, row])).values()];
  const named = new Set(
    namedIn(parsed.invoiceText, people, (row) => matchKeys(row.professionalDisplayName, [])).map((row) => row.professionalId),
  );
  const theirs = (matches: UploadCase[]) =>
    named.size === 0 ? matches : matches.filter((row) => named.has(row.professionalId));
  const fromText = namedIn(parsed.invoiceText, cases, (row) => row.keys);
  if (fromText.length > 0 && fromText.every((row) => row.caseId === fromText[0]!.caseId)) {
    return only(theirs(fromText));
  }
  const name = ` ${normalize((fileName ?? '').replace(/\.[a-z0-9]+$/i, ''))} `;
  const fromName = cases.filter((row) => {
    const surname = row.keys.name.split(' ').at(-1) ?? '';
    return (
      exactKeys(row.keys).some((caseKey) => caseKey.length >= 4 && name.includes(` ${caseKey} `)) ||
      (surname.length >= 3 && name.includes(` ${surname} `))
    );
  });
  if (fromName.length > 0) {
    return only(theirs(fromName));
  }
  // A named professional with only one case.
  return named.size === 1 && fromText.length === 0 ? only(cases.filter((row) => named.has(row.professionalId))) : null;
}
