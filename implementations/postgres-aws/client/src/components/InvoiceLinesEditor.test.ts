import { describe, expect, it } from 'vitest';
import type { PortalInvoiceLine } from '../api/client';
import {
  assignTimekeeper,
  emptyLine,
  hasInvoiceItems,
  invoiceTotalPreview,
  lineDraftsFrom,
  linesFromDrafts,
  mileageItemPreview,
  ratesInPlay,
  timeItemPreview,
  addToTrip,
  travelItemPreview,
  tripParts,
  tripToJoin,
} from './InvoiceLinesEditor';
import { ADD_NEW } from './PickOrAdd';

const importedLine: PortalInvoiceLine = {
  invoiceLineId: 'line-1',
  lineTypeCode: 'time',
  amount: '150.00',
  serviceDate: '2026-01-10',
  description: 'Synthetic research',
  quantity: '1.50',
  unitRate: '100.00',
  statedAmount: '150.00',
  billedRate: '100.00',
  configuredRate: '120.00',
  rateLimit: '120.00',
  rateLimitSource: 'configured',
  timekeeperLabel: 'Synthetic Timekeeper',
  proposedTimekeeperName: null,
  proposedTimekeeperEmail: null,
  timekeeperProfessionalId: 'professional-1',
  timekeeperDisplayName: 'Synthetic Timekeeper',
  taskCode: 'SAMPLE-TASK',
  activityCode: 'SAMPLE-ACT',
  expenseCode: null,
  expenseTypeCode: null,
  tripId: null,
  timeCategory: null,
  tripOrigin: null,
  tripDestination: null,
  roundTrip: false,
  routeDistance: null,
  routeCheckedAt: null,
  sourceTimeEntryId: 'time-1',
  sourceLocation: 'line 2',
  sourceActivityOn: '2026-01-10',
  sourceDurationHours: '1.50',
  sourceDescription: 'Synthetic research',
  decisionOutcomeCode: null,
  decisionOutcomeDisplayName: null,
  decisionApprovedAmount: null,
  decisionReason: null,
  decidedAt: null,
  decision: null,
  history: [],
  working: null,
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
        timekeeperLabel: 'Synthetic Timekeeper',
        timekeeperProfessionalId: 'professional-1',
        taskCode: 'SAMPLE-TASK',
        activityCode: 'SAMPLE-ACT',
        expenseCode: undefined,
        sourceTimeEntryId: 'time-1',
        sourceLocation: 'line 2',
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
  it('names someone not listed on items, sent as a name for staff to match', () => {
    const result = assignTimekeeper(lines, ADD_NEW, 'unassigned', { displayName: 'Synthetic Colleague', email: 'colleague@example.com' });
    const sent = linesFromDrafts(result.map((line) => ({ ...line, quantity: '1', serviceDate: '2026-02-02' })));
    expect(sent.map((line) => [line.timekeeperProfessionalId, line.proposedTimekeeperName, line.proposedTimekeeperEmail])).toEqual([
      ['professional-1', undefined, undefined],
      [undefined, 'Synthetic Colleague', 'colleague@example.com'],
    ]);
    // Reloaded, the item still shows them as someone not listed.
    const [reloaded] = lineDraftsFrom([{ ...importedLine, timekeeperProfessionalId: null, timekeeperDisplayName: null, proposedTimekeeperName: 'Synthetic Colleague' }]);
    expect(reloaded).toMatchObject({ timekeeperProfessionalId: ADD_NEW, proposedTimekeeperName: 'Synthetic Colleague' });
  });

  it('falls back to the name the file gives when none is typed', () => {
    const [line] = linesFromDrafts([
      { ...emptyLine, quantity: '1', timekeeperProfessionalId: ADD_NEW, carried: { timekeeperLabel: 'File Name' } },
    ]);
    expect(line?.proposedTimekeeperName).toBe('File Name');
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
    expect(timeItemPreview(line, [attorney], 'professional-1')).toEqual({
      amount: '150.00',
      rate: '100.00',
      hours: 1.5,
      configuredRate: '100.00',
    });
    expect(timeItemPreview({ ...line, serviceDate: '2026-03-01' }, [attorney], 'professional-1')).toMatchObject({
      amount: '225.00',
      rate: '150.00',
    });
  });

  it('uses a rate stated on an imported file, as the server does, and still shows the configured one', () => {
    expect(timeItemPreview({ ...line, carried: { unitRate: 175 } }, [attorney], 'professional-1')).toEqual({
      amount: '262.50',
      rate: '175.00',
      hours: 1.5,
      configuredRate: '100.00',
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

describe('trips', () => {
  const rates = [
    { ratePerMile: '0.655', effectiveFrom: '2025-01-01' },
    { ratePerMile: '0.700', effectiveFrom: '2026-02-01' },
  ];
  const attorney = {
    professionalId: 'professional-1',
    displayName: 'Synthetic Attorney',
    isSelf: true,
    kindDisplayName: 'Attorney',
    rates: [{ hourlyRate: '100.00', effectiveFrom: '2026-01-01' }],
  };
  const halfRate = [
    { category: 'travel' as const, basis: 'percent_of_hourly_rate' as const, percent: '50.00', hourlyRate: null, effectiveFrom: '2026-01-01' },
    { category: 'waiting' as const, basis: 'flat_rate' as const, percent: null, hourlyRate: '30.00', effectiveFrom: '2026-01-01' },
  ];
  const trip = {
    ...emptyLine,
    lineType: 'travel' as const,
    serviceDate: '2026-02-10',
    description: 'Court hearing',
    quantity: '40',
    travelHours: '2',
    travelCosts: [{ description: 'Parking', amount: '12', carried: {} }],
    tripOrigin: ' 100 Main St ',
    tripDestination: '1 Court Plaza',
    roundTrip: true,
  };

  it('price miles at the mileage rate on their date', () => {
    expect(mileageItemPreview(trip, rates)).toEqual({ amount: '28.00', rate: '0.700', miles: 40 });
    expect(mileageItemPreview({ ...trip, serviceDate: '2026-01-10' }, rates)).toMatchObject({ amount: '26.20' });
    expect(mileageItemPreview({ ...trip, quantity: '' }, rates)).toEqual({ missing: 'Add the miles' });
    expect(mileageItemPreview(trip, [])).toEqual({ missing: 'No mileage rate set for this date' });
  });

  it('price travel time at the travel time rate, and total every part', () => {
    expect(travelItemPreview(trip, [attorney], 'professional-1', rates, halfRate).time).toMatchObject({ amount: '100.00', rate: '50.00' });
    expect(invoiceTotalPreview([trip], [attorney], 'professional-1', rates, halfRate)).toEqual({ time: 100, other: 40, total: 140, complete: true });
    // With no travel time rate, the hourly rate.
    expect(invoiceTotalPreview([trip], [attorney], 'professional-1', rates)).toMatchObject({ time: 200 });
    expect(invoiceTotalPreview([trip], [attorney], 'professional-1', [], halfRate).complete).toBe(false);
  });

  it('save as separate lines sharing a trip key, date and route', () => {
    const sent = linesFromDrafts([trip]);
    expect(sent.map((line) => line.lineType)).toEqual(['time', 'mileage', 'expense']);
    expect(new Set(sent.map((line) => line.tripKey)).size).toBe(1);
    expect(sent.every((line) => line.serviceDate === '2026-02-10' && line.tripOrigin === '100 Main St' && line.roundTrip)).toBe(true);
    expect(sent.map((line) => line.quantity ?? line.amount)).toEqual([2, 40, 12]);
    // Only the parts claimed.
    expect(linesFromDrafts([{ ...trip, travelHours: '', travelCosts: [] }]).map((line) => line.lineType)).toEqual(['mileage']);
    expect(hasInvoiceItems([{ ...trip, quantity: '', travelHours: '', travelCosts: [] }])).toBe(false);
  });

  it("load a trip's lines back as one row, or as rows of their own where each line is one", () => {
    const onTrip = { ...importedLine, sourceTimeEntryId: null, tripId: 'trip-1', tripOrigin: 'A', tripDestination: 'B', roundTrip: true };
    const lines = [
      { ...onTrip, invoiceLineId: 'time', quantity: '2.00' },
      { ...onTrip, invoiceLineId: 'miles', lineTypeCode: 'expense', expenseTypeCode: 'mileage', quantity: '40.0' },
      { ...onTrip, invoiceLineId: 'parking', lineTypeCode: 'expense', amount: '12.00', description: 'Parking' },
      { ...importedLine, invoiceLineId: 'other', sourceTimeEntryId: null },
    ];
    const drafts = lineDraftsFrom(lines);
    expect(drafts.map((draft) => draft.lineType)).toEqual(['travel', 'time']);
    expect(drafts[0]).toMatchObject({ quantity: '40.0', travelHours: '2.00', tripOrigin: 'A', invoiceLineId: 'miles' });
    expect(drafts[0]?.travelCosts).toMatchObject([{ description: 'Parking', amount: '12.00', invoiceLineId: 'parking' }]);
    expect(linesFromDrafts(drafts)).toHaveLength(4);
    const rows = lineDraftsFrom(lines, { perLine: true });
    expect(rows.map((row) => [row.lineType, row.tripKey])).toEqual([
      ['time', 'trip-1'],
      ['mileage', 'trip-1'],
      ['expense', 'trip-1'],
      ['time', undefined],
    ]);
    expect(linesFromDrafts(rows).map((line) => line.tripKey)).toEqual(['trip-1', 'trip-1', 'trip-1', undefined]);
  });

  it('price waiting time at its own rate and send it as time marked waiting', () => {
    const waiting = { ...emptyLine, lineType: 'waiting' as const, serviceDate: '2026-02-10', quantity: '2' };
    expect(invoiceTotalPreview([waiting], [attorney], 'professional-1', rates, halfRate)).toMatchObject({ time: 60, complete: true });
    expect(linesFromDrafts([waiting])[0]).toMatchObject({ lineType: 'time', timeCategory: 'waiting', quantity: 2 });
    const [loaded] = lineDraftsFrom([{ ...importedLine, sourceTimeEntryId: null, timeCategory: 'waiting' }]);
    expect(loaded?.lineType).toBe('waiting');
  });

  it('let a time or expense row on the same day join a trip, never on their own', () => {
    const time = { ...emptyLine, serviceDate: '2026-02-10', quantity: '1.5', description: 'Drive' };
    const parking = { ...emptyLine, lineType: 'expense' as const, serviceDate: '2026-02-10', amount: '7', description: 'Parking' };
    const mileageOnly = { ...trip, travelHours: '', travelCosts: [] };
    const lines = [mileageOnly, time, parking];
    expect(tripToJoin(lines, 1)).toBe(0);
    expect(tripToJoin([...lines.slice(0, 1), { ...time, serviceDate: '2026-02-11' }], 1)).toBeUndefined();
    const joined = addToTrip(addToTrip(lines, 1, 0), 1, 0);
    expect(joined).toHaveLength(1);
    expect(joined[0]).toMatchObject({ travelHours: '1.5', travelCosts: [expect.objectContaining({ description: 'Parking', amount: '7' })] });
    // A trip with travel time takes no more.
    expect(tripToJoin([joined[0]!, time], 1)).toBeUndefined();
  });

  it('add as rows of their own on one trip, where each line is a row', () => {
    const parts = tripParts(trip, 'new-1');
    expect(parts.map((part) => [part.lineType, part.tripKey, part.serviceDate])).toEqual([
      ['time', 'new-1', '2026-02-10'],
      ['mileage', 'new-1', '2026-02-10'],
      ['expense', 'new-1', '2026-02-10'],
    ]);
    expect(linesFromDrafts(parts)).toEqual(linesFromDrafts([trip]).map((line) => ({ ...line, tripKey: 'new-1' })));
  });
});
