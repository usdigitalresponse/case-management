import { describe, expect, it } from 'vitest';
import type { MyCasesResult } from '../api/client';
import type { ImportInProgress } from '../api/client';
import {
  caseChoiceGroups,
  choiceValue,
  currentStep,
  nextInQueue,
  outstanding,
  parseChoice,
  professionalChoiceValue,
  reviewQueue,
  sectionOf,
  suggestChoice,
} from './bulkImport';
import { progressFraction, progressText } from './importProgress';

function upload(id: string, changes: Partial<ImportInProgress> = {}): ImportInProgress {
  return {
    invoiceImportId: id,
    uploadedAt: '2026-01-01T00:00:00Z',
    statusCode: 'extracted',
    fileName: `${id}.csv`,
    caseId: 'case',
    caseExternalReference: null,
    caseClientDisplayName: 'Client',
    invoiceId: `invoice-${id}`,
    invoiceStatusCode: 'draft',
    professionalDisplayName: 'Pat',
    submittedTotal: '100.00',
    statedTotal: '100.00',
    lineCount: 2,
    unmatchedCount: 0,
    undatedCount: 0,
    inferredDateCount: 0,
    warningCount: 0,
    otherWarningCount: 0,
    failureMessage: null,
    expiresAt: null,
    progress: null,
    ...changes,
  };
}

describe('files still being read', () => {
  const reading = upload('r', { statusCode: 'received', invoiceId: null, progress: { stage: 'queued', ahead: 1 } });

  it('wait in their own section, outside the review queue, and keep the review step open', () => {
    expect(sectionOf(reading)).toBe('reading');
    expect(reviewQueue([reading, upload('a')]).map((row) => row.invoiceImportId)).toEqual(['a']);
    expect(currentStep(0, [reading])).toBe(2);
  });

  it('say where reading has got to', () => {
    expect(progressText(null)).toBe('Reading the file…');
    expect(progressText({ stage: 'queued', ahead: 2 })).toBe('Waiting to be read: 2 files ahead');
    expect(progressText({ stage: 'queued', ahead: 0 })).toBe('Waiting to be read');
    expect(progressText({ stage: 'recognizing', page: 3, pages: 12 })).toBe('Recognizing the scanned text: page 3 of 12');
    expect(progressFraction({ stage: 'recognizing', page: 3, pages: 12 })).toBeCloseTo(2 / 12);
    expect(progressFraction({ stage: 'reading' })).toBeUndefined();
  });
});

describe('after upload: review each, then submit', () => {
  const imports = [
    upload('a'),
    upload('b', { statusCode: 'confirmed' }),
    upload('c', { statusCode: 'failed', invoiceId: null }),
    upload('d', { unmatchedCount: 2, undatedCount: 1, inferredDateCount: 1, warningCount: 3, otherWarningCount: 1 }),
  ];

  it('sorts files into what each needs', () => {
    expect(imports.map(sectionOf)).toEqual(['review', 'ready', 'unreadable', 'review']);
    expect(reviewQueue(imports).map((row) => row.invoiceImportId)).toEqual(['a', 'c', 'd']);
    expect(outstanding(imports[3]!)).toEqual(['2 items to match', '1 date to add', '1 date to check', '1 warning']);
  });

  it('walks the queue in order, wrapping round, and ends at the last file', () => {
    expect(nextInQueue(imports, 'a')?.invoiceImportId).toBe('c');
    expect(nextInQueue(imports, 'd')?.invoiceImportId).toBe('a');
    expect(nextInQueue([upload('only')], 'only')).toBeUndefined();
  });

  it('puts you on the first step with something to do', () => {
    expect(currentStep(2, imports)).toBe(1);
    expect(currentStep(0, imports)).toBe(2);
    expect(currentStep(0, [upload('b', { statusCode: 'confirmed' })])).toBe(3);
    expect(currentStep(0, [])).toBe(1);
  });
});

const caseFields = { statusId: 's', statusDisplayName: 'Open', caseNumber: null, assignedAt: '2026-01-01T00:00:00Z', unsubmittedTimeProfessionalIds: [], unsubmittedInvoiceProfessionalIds: [] };

const result: MyCasesResult = {
  professionals: [
    { professionalId: 'me', displayName: 'Pat Self', isSelf: true },
    { professionalId: 'colleague', displayName: 'Sam Colleague', isSelf: false },
  ],
  cases: [
    { ...caseFields, caseId: 'mine', externalReference: 'CR-2026-0042', clientDisplayName: 'Jordan Rivera', assignedProfessionalIds: ['me'] },
    { ...caseFields, caseId: 'shared', externalReference: null, clientDisplayName: 'Alex Moreno', assignedProfessionalIds: ['me', 'colleague'] },
    { ...caseFields, caseId: 'theirs', externalReference: null, clientDisplayName: 'Casey Lin', assignedProfessionalIds: ['colleague'] },
    { ...caseFields, caseId: 'other-rivera', externalReference: null, clientDisplayName: 'Morgan Rivera', assignedProfessionalIds: ['colleague'] },
  ],
};

describe('bulk import case choices', () => {
  it('offers each case under every person billing it, or one person for several cases', () => {
    const groups = caseChoiceGroups(result);
    expect(groups.map((group) => [group.label, group.choices.map((choice) => choice.value)])).toEqual([
      ['Your cases', [choiceValue('mine', 'me'), choiceValue('shared', 'me')]],
      [
        'Cases for Sam Colleague',
        [choiceValue('shared', 'colleague'), choiceValue('theirs', 'colleague'), choiceValue('other-rivera', 'colleague')],
      ],
      ['One person, several cases (the file names each case)', [professionalChoiceValue('me'), professionalChoiceValue('colleague')]],
    ]);
    expect(parseChoice(choiceValue('shared', 'colleague'))).toEqual({ kind: 'case', caseId: 'shared', professionalId: 'colleague' });
    expect(parseChoice(professionalChoiceValue('me'))).toEqual({ kind: 'professional', professionalId: 'me' });
    expect(parseChoice('')).toBeUndefined();
  });

  it('suggests a case from the file name only when one fits', () => {
    expect(suggestChoice('Invoice CR-2026-0042 March.pdf', result)).toBe(choiceValue('mine', 'me'));
    expect(suggestChoice('moreno_feb.xlsx', result)).toBe(choiceValue('shared', 'me'));
    expect(suggestChoice('Casey Lin.csv', result)).toBe(choiceValue('theirs', 'colleague'));
    // Two clients called Rivera; a full name decides.
    expect(suggestChoice('rivera.pdf', result)).toBeUndefined();
    expect(suggestChoice('Jordan Rivera.pdf', result)).toBe(choiceValue('mine', 'me'));
    expect(suggestChoice('invoice.pdf', result)).toBeUndefined();
  });
});
