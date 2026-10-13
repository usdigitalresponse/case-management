import { describe, expect, it } from 'vitest';
import type { PortalInvoiceLine } from '../api/client';
import {
  assignTimekeeper,
  emptyLine,
  hasInvoiceItems,
  invoiceTotalPreview,
  lineDraftsFrom,
  linesFromDrafts,
  ratesInPlay,
  timeItemPreview,
} from './InvoiceLinesEditor';

const importedLine: PortalInvoiceLine = {
  invoiceLineId: 'line-1',
  lineTypeCode: 'time',
  amount: '150.00',
  serviceDate: '2026-01-10',
  serviceDateInferred: true,
  description: 'Synthetic research',
  quantity: '1.50',
  unitRate: '100.00',
  statedAmount: '150.00',
  billedRate: '120.00',
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
        statedAmount: 150,
        serviceDateInferred: true,
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
  const expense = { ...emptyLine, lineType: 'expense' as const };

  it('needs time with hours or recorded time, or another item with an amount', () => {
    expect(hasInvoiceItems([emptyLine])).toBe(false);
    expect(hasInvoiceItems([{ ...emptyLine, amount: '12.50' }])).toBe(false);
    expect(hasInvoiceItems([{ ...emptyLine, quantity: '1.5' }])).toBe(true);
    expect(hasInvoiceItems([{ ...emptyLine, sourceTimeEntryId: 'time-1' }])).toBe(true);
    expect(hasInvoiceItems([{ ...expense, description: 'Typed but no amount' }])).toBe(false);
    expect(hasInvoiceItems([{ ...expense, amount: '0' }])).toBe(false);
    expect(hasInvoiceItems([emptyLine, { ...expense, amount: '12.50' }])).toBe(true);
  });
});

describe('previewing what a time item bills', () => {
  const attorney = {
    professionalId: 'professional-1',
    displayName: 'Synthetic Attorney',
    isSelf: true,
    kindDisplayName: 'Attorney',
    rates: [
      { hourlyRate: '100.00', effectiveFrom: '2026-01-01' },
      { hourlyRate: '150.00', effectiveFrom: '2026-03-01' },
    ],
  };
  const line = { serviceDate: '2026-02-10', quantity: '1.5', timekeeperProfessionalId: '' };

  it("uses the billed professional's rate on the item's date", () => {
    expect(timeItemPreview(line, [attorney], 'professional-1')).toEqual({ amount: '150.00', rate: '100.00', hours: 1.5 });
    expect(timeItemPreview({ ...line, serviceDate: '2026-03-01' }, [attorney], 'professional-1')).toMatchObject({
      amount: '225.00',
      rate: '150.00',
    });
  });

  it('totals the invoice before saving, and names the rates in play', () => {
    const items = [
      { ...emptyLine, ...line },
      { ...emptyLine, ...line, serviceDate: '2026-03-02' },
      { ...emptyLine, lineType: 'expense' as const, amount: '12.50' },
    ];
    expect(invoiceTotalPreview(items, [attorney], 'professional-1')).toEqual({ time: 375, other: 12.5, total: 387.5, complete: true });
    expect(invoiceTotalPreview([...items, { ...emptyLine, quantity: '2' }], [attorney], 'professional-1').complete).toBe(false);
    // The items straddle the March rate change, so both rates apply.
    expect(ratesInPlay(items, [attorney], 'professional-1')).toEqual([
      {
        professional: attorney,
        rates: [{ hourlyRate: '100.00' }, { hourlyRate: '150.00', from: '2026-03-01' }],
      },
    ]);
    expect(ratesInPlay(items.slice(0, 1), [attorney], 'professional-1')[0]?.rates).toEqual([{ hourlyRate: '100.00' }]);
  });

  it('says what is missing', () => {
    expect(timeItemPreview(line, [attorney], undefined)).toEqual({ missing: 'Choose who did the work' });
    expect(timeItemPreview({ ...line, quantity: '' }, [attorney], 'professional-1')).toEqual({ missing: 'Add the hours' });
    expect(timeItemPreview({ ...line, serviceDate: '' }, [attorney], 'professional-1')).toEqual({ missing: 'Add a date' });
    expect(timeItemPreview({ ...line, serviceDate: '', quantity: '' }, [attorney], 'professional-1')).toEqual({
      missing: 'Add a date and hours',
    });
    expect(timeItemPreview({ ...line, serviceDate: '2025-12-31' }, [attorney], 'professional-1')).toEqual({
      missing: 'No rate set for this date',
    });
  });
});
