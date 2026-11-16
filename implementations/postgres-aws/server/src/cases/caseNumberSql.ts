// The number an invoice or case goes by, in SQL, as loadCaseNumbers and currentCaseNumber work it out: a
// correction, else as typed, else its case's primary identifier, else its reference.
import { aliasedTable, and, eq, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { caseIdentifier, caseTable, invoice } from '../db/schema';

export const primaryIdentifier = aliasedTable(caseIdentifier, 'primary_identifier');

// Join on, beside caseTable joined on the same case.
export const isPrimaryIdentifierOf = (caseId: AnyColumn | SQL) => and(eq(primaryIdentifier.caseId, caseId), eq(primaryIdentifier.isPrimary, true));

export const typedCaseNumber = sql<string | null>`coalesce(${invoice.caseNumberCorrected}, ${invoice.caseNumberAsTyped})`;

// With caseTable and primaryIdentifier joined.
export const joinedInvoiceCaseNumber = sql<string | null>`coalesce(${typedCaseNumber}, ${primaryIdentifier.value}, ${caseTable.externalReference})`;

// A case's own number, by its id, with nothing joined.
export const caseNumberOfCase = (caseId: AnyColumn | SQL) =>
  // Aliased, so the outer query's own "case" isn't shadowed.
  sql<string | null>`coalesce((select ci.value from case_identifier ci where ci.case_id = ${caseId} and ci.is_primary limit 1),
    (select c.external_reference from "case" c where c.case_id = ${caseId}))`;

export const invoiceCaseNumber = sql<string | null>`coalesce(${typedCaseNumber}, ${caseNumberOfCase(invoice.caseId)})`;
