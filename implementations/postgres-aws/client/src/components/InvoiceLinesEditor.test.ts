import { describe, expect, it } from 'vitest';
import type { PortalInvoiceLine } from '../api/client';
import { assignTimekeeper, emptyLine, hasInvoiceItems, lineDraftsFrom, linesFromDrafts } from './InvoiceLinesEditor';

const importedLine: PortalInvoiceLine = {
  invoiceLineId: 'line-1',
  lineTypeCode: 'time',
  amount: '150.00',
  serviceDate: '2026-01-10',
  description: 'Synthetic research',
  quantity: '1.50',
  unitRate: '100.00',
  timekeeperLabel: 'Synthetic Timekeeper',
  timekeeperProfessionalId: 'professional-1',
  timekeeperDisplayName: 'Synthetic Timekeeper',
  taskCode: 'SAMPLE-TASK',
  activityCode: 'SAMPLE-ACT',
  expenseCode: null,
  sourceTimeEntryId: 'time-1',
  sourceActivityOn: '2026-01-10',
  sourceDurationHours: '1.50',
  sourceDescription: 'Synthetic research',
  decisionOutcomeCode: null,
  decisionOutcomeDisplayName: null,
  decisionApprovedAmount: null,
  decisionReason: null,
  decidedAt: null,
};

// Saving a draft replaces all of its lines with what the editor sends, so
// any field the editor doesn't send is lost. Every saved field must survive
// loading into the editor and saving back unchanged.
describe('invoice line editor round trip', () => {
  it('keeps every saved field, including ones the editor does not show', () => {
    expect(linesFromDrafts(lineDraftsFrom([importedLine]))).toEqual([
      {
        lineType: 'time',
        amount: 150,
        serviceDate: '2026-01-10',
        description: 'Synthetic research',
        quantity: 1.5,
        unitRate: 100,
        timekeeperLabel: 'Synthetic Timekeeper',
        timekeeperProfessionalId: 'professional-1',
        taskCode: 'SAMPLE-TASK',
        activityCode: 'SAMPLE-ACT',
        expenseCode: undefined,
        sourceTimeEntryId: 'time-1',
      },
    ]);
  });

  it('maps line type codes, treating the general service type as other', () => {
    const types = lineDraftsFrom([
      { ...importedLine, lineTypeCode: 'expense' },
      { ...importedLine, lineTypeCode: 'service' },
      { ...importedLine, lineTypeCode: null },
    ]).map((draft) => draft.lineType);
    expect(types).toEqual(['expense', 'other', 'other']);
  });
});

describe('assigning who did the work to many items', () => {
  const lines = [
    { ...emptyLine, timekeeperProfessionalId: 'professional-1', suggestedTimekeeper: true },
    { ...emptyLine, description: 'unassigned' },
  ];

  it('fills only unassigned items, keeping existing choices', () => {
    const result = assignTimekeeper(lines, 'professional-2', 'unassigned');
    expect(result.map((line) => line.timekeeperProfessionalId)).toEqual(['professional-1', 'professional-2']);
    expect(result[0]?.suggestedTimekeeper).toBe(true);
    expect(result[1]?.description).toBe('unassigned');
  });

  it('overrides every item when applied to all, clearing suggestions', () => {
    const result = assignTimekeeper(lines, 'professional-2', 'all');
    expect(result.map((line) => line.timekeeperProfessionalId)).toEqual(['professional-2', 'professional-2']);
    expect(result.every((line) => !line.suggestedTimekeeper)).toBe(true);
  });
});

describe('whether an invoice has anything to save', () => {
  it('needs at least one item with an amount above zero', () => {
    expect(hasInvoiceItems([emptyLine])).toBe(false);
    expect(hasInvoiceItems([{ ...emptyLine, description: 'Typed but no amount' }])).toBe(false);
    expect(hasInvoiceItems([{ ...emptyLine, amount: '0' }])).toBe(false);
    expect(hasInvoiceItems([emptyLine, { ...emptyLine, amount: '12.50' }])).toBe(true);
  });
});
