import type { ImportInProgress, MyCaseRecord, MyCasesResult } from '../api/client';
import { caseDisplayLabel } from '../caseDisplayLabel';

// A file is designated either to one case, which also says whom it bills
// (a case shared by colleagues is offered under each), or to one
// professional whose lines name their cases (split after upload). Staff may
// also import a file for a professional with no case yet; it waits on Intake
// until it is matched (model/rules.yaml match_invoice_to_case).
export interface CaseChoice {
  value: string;
  label: string;
}

export interface CaseChoiceGroup {
  label: string;
  choices: CaseChoice[];
}

export type ParsedChoice =
  | { kind: 'case'; caseId: string; professionalId: string }
  | { kind: 'professional'; professionalId: string }
  // Staff only; with no professional either, both are chosen on matching.
  | { kind: 'no_case'; professionalId?: string };

export function choiceValue(caseId: string, professionalId: string): string {
  return `case|${caseId}|${professionalId}`;
}

export function professionalChoiceValue(professionalId: string): string {
  return `professional|${professionalId}`;
}

export function noCaseChoiceValue(professionalId: string): string {
  return `no_case|${professionalId}`;
}

export function parseChoice(value: string): ParsedChoice | undefined {
  const [kind, first, second] = value.split('|');
  if (kind === 'case' && first && second) {
    return { kind, caseId: first, professionalId: second };
  }
  if ((kind === 'professional' || kind === 'no_case') && first) {
    return { kind, professionalId: first };
  }
  return undefined;
}

function caseLabel(caseRecord: MyCaseRecord): string {
  return caseDisplayLabel([caseRecord.externalReference, caseRecord.clientDisplayName], {
    label: 'Case assigned',
    date: caseRecord.assignedAt,
  });
}

function personName(professional: MyCasesResult['professionals'][number]): string {
  return professional.isSelf ? 'You' : (professional.displayName ?? 'An unnamed professional');
}

// noCase: the professionals staff may import for with no case yet.
export function caseChoiceGroups(
  { professionals, cases }: MyCasesResult,
  noCase: Array<{ professionalId: string; displayName: string | null }> = [],
): CaseChoiceGroup[] {
  const byCase = professionals
    .map((professional) => ({
      label: professional.isSelf ? 'Your cases' : `Cases for ${professional.displayName ?? 'an unnamed professional'}`,
      choices: cases
        .filter((caseRecord) => caseRecord.assignedProfessionalIds.includes(professional.professionalId))
        .map((caseRecord) => ({
          value: choiceValue(caseRecord.caseId, professional.professionalId),
          label: caseLabel(caseRecord),
        })),
    }))
    .filter((group) => group.choices.length > 0);
  const severalCases = professionals.filter((professional) =>
    cases.some((caseRecord) => caseRecord.assignedProfessionalIds.includes(professional.professionalId)),
  );
  return [
    ...byCase,
    {
      label: 'One person, several cases (the file names each case)',
      choices: severalCases.map((professional) => ({
        value: professionalChoiceValue(professional.professionalId),
        label: `${personName(professional)}: split by case`,
      })),
    },
    {
      label: 'No case yet (match it later on Intake)',
      choices: noCase.map((professional) => ({
        value: noCaseChoiceValue(professional.professionalId),
        label: `${professional.displayName ?? 'An unnamed professional'}: no case yet`,
      })),
    },
  ].filter((group) => group.choices.length > 0);
}

function tokens(text: string): string[] {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

// A case whose reference or client's full name appears in the file name,
// else whose client's family name does; only when exactly one case fits.
// Billing for yourself when you're on it, else the one person who is;
// otherwise left to choose.
export function suggestChoice(fileName: string, result: MyCasesResult): string | undefined {
  const fileTokens = tokens(fileName.replace(/\.[^.]+$/, ''));
  const words = new Set(fileTokens);
  const joined = ` ${fileTokens.join(' ')} `;
  const strong = result.cases.filter((caseRecord) => {
    const reference = tokens(caseRecord.externalReference ?? '');
    const name = tokens(caseRecord.clientDisplayName ?? '');
    return (
      (reference.length > 0 && joined.includes(` ${reference.join(' ')} `)) ||
      (name.length > 1 && name.every((word) => words.has(word)))
    );
  });
  const matches =
    strong.length > 0
      ? strong
      : result.cases.filter((caseRecord) => {
          const family = tokens(caseRecord.clientDisplayName ?? '').at(-1);
          return family !== undefined && family.length >= 3 && words.has(family);
        });
  if (matches.length !== 1) {
    return undefined;
  }
  const [match] = matches as [MyCaseRecord];
  const people = result.professionals.filter((professional) => match.assignedProfessionalIds.includes(professional.professionalId));
  const billed = people.find((professional) => professional.isSelf) ?? (people.length === 1 ? people[0] : undefined);
  return billed ? choiceValue(match.caseId, billed.professionalId) : undefined;
}

// --- after upload: review each, then submit ---------------------------------

// Pages opened from the bulk page lead back to it and through its queue.
export const FROM_BULK = '?from=bulk';

// Imports uploaded in this browser session, which Cancel discards. Kept in
// session storage so review pages in between don't lose it.
const BATCH_KEY = 'bulkImportBatch';

export function loadBatch(): string[] {
  try {
    const stored = JSON.parse(sessionStorage.getItem(BATCH_KEY) ?? '[]') as unknown;
    return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export function saveBatch(importIds: string[]): void {
  try {
    if (importIds.length > 0) {
      sessionStorage.setItem(BATCH_KEY, JSON.stringify(importIds));
    } else {
      sessionStorage.removeItem(BATCH_KEY);
    }
  } catch {
    // Without storage, Cancel only covers this page's uploads.
  }
}

export function reviewUrl(row: Pick<ImportInProgress, 'invoiceImportId'>): string {
  return `/portal/imports/${row.invoiceImportId}${FROM_BULK}`;
}

export type BulkSection = 'reading' | 'review' | 'unreadable' | 'ready';

export function sectionOf(row: ImportInProgress): BulkSection {
  if (row.statusCode === 'received') {
    return 'reading';
  }
  if (row.statusCode === 'failed') {
    return 'unreadable';
  }
  return row.statusCode === 'confirmed' && row.invoiceId ? 'ready' : 'review';
}

// Files still needing attention, in upload order: what "Review next" walks.
// Files still being read join it once they're read.
export function reviewQueue(imports: ImportInProgress[]): ImportInProgress[] {
  return imports.filter((row) => sectionOf(row) === 'review' || sectionOf(row) === 'unreadable');
}

// The next file after this one, wrapping round; undefined when it's the last.
export function nextInQueue(imports: ImportInProgress[], currentId: string): ImportInProgress | undefined {
  const queue = reviewQueue(imports);
  const index = queue.findIndex((row) => row.invoiceImportId === currentId);
  const others = index < 0 ? queue : [...queue.slice(index + 1), ...queue.slice(0, index)];
  return others[0];
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

// What's left on a file needing review, in plain words.
export function outstanding(row: ImportInProgress): string[] {
  return [
    row.unmatchedCount > 0 ? `${count(row.unmatchedCount, 'item', 'items')} to match` : undefined,
    row.undatedCount > 0 ? `${count(row.undatedCount, 'date', 'dates')} to add` : undefined,
    row.inferredDateCount > 0 ? `${count(row.inferredDateCount, 'date', 'dates')} to check` : undefined,
    row.otherWarningCount > 0 ? count(row.otherWarningCount, 'warning', 'warnings') : undefined,
  ].filter((note): note is string => Boolean(note));
}

export type BulkStep = 1 | 2 | 3;

// The first step with something to do: files waiting to upload, then
// files to review, then invoices to submit.
export function currentStep(stagedCount: number, imports: ImportInProgress[]): BulkStep {
  if (stagedCount > 0) {
    return 1;
  }
  if (reviewQueue(imports).length > 0 || imports.some((row) => sectionOf(row) === 'reading')) {
    return 2;
  }
  return imports.some((row) => sectionOf(row) === 'ready') ? 3 : 1;
}
