import { useState } from 'react';
import { Checkbox, Label, Select, TextInput } from '@trussworks/react-uswds';
import {
  mileageRateOn,
  rateOn,
  categoryRateIn,
  categoryRateOn,
  type BillableProfessional,
  type CreateInvoiceLineInput,
  type MileageRate,
  type PortalInvoiceLine,
  type ProposedProvider,
  type TimeEntryRecord,
  type TimeCategory,
  type TimeCategoryRate,
} from '../api/client';
import { AddProvider, type AddedProvider } from './AddProvider';
import { NO_PROPOSED_PERSON, ProposedPersonFields } from './NewEntryFields';
import { formatMoney, formatRate } from '../formatMoney';
import { formatDate } from '../formatDateTime';
import { ADD_NEW, PickOrAdd } from './PickOrAdd';
import { TripFields } from './TripFields';

// A trip is one row here and separate lines once saved: its travel time,
// mileage and other costs (model/rules.yaml apply_time_category_rates).
// 'waiting' is waiting time, a time line priced at its own rate. 'mileage'
// is one line alone, where each line is a row (Check the lines).
export type DraftKind = 'time' | 'waiting' | 'travel' | 'mileage' | 'expense' | 'other';

// Time worked and waiting time take hours on the row itself.
export const isTimeKind = (kind: DraftKind) => kind === 'time' || kind === 'waiting';

type Carried = Pick<
  CreateInvoiceLineInput,
  'unitRate' | 'statedAmount' | 'timekeeperLabel' | 'taskCode' | 'activityCode' | 'expenseCode' | 'sourceLocation'
>;

export interface TravelCost {
  description: string;
  amount: string;
  invoiceLineId?: string;
  carried: Carried;
}

// Raw input strings until saved.
export interface LineDraft {
  lineType: DraftKind;
  serviceDate: string;
  description: string;
  quantity: string;
  // Entered for expense and other items; a time item is priced from rates.
  amount: string;
  // Empty: the billed professional, or on import review, not chosen yet.
  // ADD_NEW: someone not listed, named in proposedTimekeeperName.
  timekeeperProfessionalId: string;
  proposedTimekeeperName: string;
  proposedTimekeeperEmail: string;
  // Recorded time this item bills; editing the item edits that time.
  sourceTimeEntryId: string;
  // Travel only: quantity holds the miles, and these the trip's route,
  // travel time and other costs.
  tripOrigin: string;
  tripDestination: string;
  roundTrip: boolean;
  travelHours: string;
  travelCosts: TravelCost[];
  // The travel time line's own saved values; the row's are its mileage's.
  travelTime?: { invoiceLineId?: string; sourceTimeEntryId: string; carried: Carried };
  // One line of a saved trip, where each line is a row: kept on its trip.
  tripKey?: string;
  invoiceLineId?: string;
  // Pre-selected on import and not yet checked.
  suggestedTimekeeper?: boolean;
  // Values the editor doesn't show, saved back so edits never drop them.
  carried: Carried;
}

export const emptyLine: LineDraft = {
  lineType: 'time',
  serviceDate: '',
  description: '',
  quantity: '',
  amount: '',
  timekeeperProfessionalId: '',
  proposedTimekeeperName: '',
  proposedTimekeeperEmail: '',
  sourceTimeEntryId: '',
  tripOrigin: '',
  tripDestination: '',
  roundTrip: false,
  travelHours: '',
  travelCosts: [],
  carried: {},
};

const LINE_TYPE_BY_CODE: Record<string, DraftKind> = { time: 'time', expense: 'expense' };

function carriedFrom(line: PortalInvoiceLine): Carried {
  return {
    unitRate: line.unitRate === null ? undefined : Number(line.unitRate),
    statedAmount: line.statedAmount === null ? undefined : Number(line.statedAmount),
    timekeeperLabel: line.timekeeperLabel ?? undefined,
    taskCode: line.taskCode ?? undefined,
    activityCode: line.activityCode ?? undefined,
    expenseCode: line.expenseCode ?? undefined,
    sourceLocation: line.sourceLocation ?? undefined,
  };
}

// A trip's lines become one travel row, where its first line was; with
// `perLine`, each line stays a row of its own, kept on its trip.
export function lineDraftsFrom(lines: PortalInvoiceLine[], { perLine = false } = {}): LineDraft[] {
  const drafts: LineDraft[] = [];
  const trips = new Map<string, LineDraft>();
  for (const line of lines) {
    const kind: DraftKind =
      line.expenseTypeCode === 'mileage'
        ? 'mileage'
        : line.timeCategory === 'waiting'
          ? 'waiting'
          : (LINE_TYPE_BY_CODE[line.lineTypeCode ?? ''] ?? 'other');
    const draft: LineDraft = {
      ...emptyLine,
      lineType: line.tripId && !perLine ? 'travel' : kind,
      tripOrigin: line.tripOrigin ?? '',
      tripDestination: line.tripDestination ?? '',
      roundTrip: line.roundTrip,
      serviceDate: line.serviceDate ?? '',
      timekeeperProfessionalId: line.timekeeperProfessionalId ?? (line.proposedTimekeeperName ? ADD_NEW : ''),
      proposedTimekeeperName: line.proposedTimekeeperName ?? '',
      proposedTimekeeperEmail: line.proposedTimekeeperEmail ?? '',
    };
    if (!line.tripId || perLine) {
      drafts.push({
        ...draft,
        description: line.description ?? '',
        quantity: line.quantity ?? '',
        amount: line.amount,
        sourceTimeEntryId: line.sourceTimeEntryId ?? '',
        invoiceLineId: line.invoiceLineId,
        tripKey: line.tripId ?? undefined,
        carried: carriedFrom(line),
      });
      continue;
    }
    let travel = trips.get(line.tripId);
    if (!travel) {
      travel = draft;
      trips.set(line.tripId, travel);
      drafts.push(travel);
    }
    if (line.expenseTypeCode === 'mileage') {
      Object.assign(travel, {
        description: line.description ?? travel.description,
        quantity: line.quantity ?? '',
        invoiceLineId: line.invoiceLineId,
        carried: carriedFrom(line),
      });
    } else if (line.lineTypeCode === 'time') {
      Object.assign(travel, {
        description: travel.description || (line.description ?? ''),
        travelHours: line.quantity ?? line.sourceDurationHours ?? '',
        travelTime: { invoiceLineId: line.invoiceLineId, sourceTimeEntryId: line.sourceTimeEntryId ?? '', carried: carriedFrom(line) },
      });
    } else {
      travel.travelCosts = [
        ...travel.travelCosts,
        { description: line.description ?? '', amount: line.amount, invoiceLineId: line.invoiceLineId, carried: carriedFrom(line) },
      ];
    }
  }
  return drafts;
}

export function professionalLabel(professional: BillableProfessional): string {
  const name = professional.displayName ?? 'Unnamed professional';
  return professional.isSelf ? `${name} (you)` : name;
}

// professionalId ADD_NEW names someone not listed instead.
export function assignTimekeeper(
  lines: LineDraft[],
  professionalId: string,
  only: 'all' | 'unassigned',
  proposed: ProposedProvider = NO_PROPOSED_PERSON,
): LineDraft[] {
  return lines.map((line) =>
    only === 'unassigned' && line.timekeeperProfessionalId
      ? line
      : {
          ...line,
          timekeeperProfessionalId: professionalId,
          proposedTimekeeperName: professionalId === ADD_NEW ? proposed.displayName : '',
          proposedTimekeeperEmail: professionalId === ADD_NEW ? (proposed.email ?? '') : '',
          suggestedTimekeeper: false,
        },
  );
}

// Offered once someone not listed is named: every other item is theirs too,
// except recorded time, which stays whose it is.
function sameTimekeeperForAll(lines: LineDraft[], from: LineDraft, fixed: boolean): LineDraft[] {
  return fixed
    ? lines
    : lines.map((line) =>
        line.sourceTimeEntryId || line.travelTime?.sourceTimeEntryId
          ? line
          : {
              ...line,
              timekeeperProfessionalId: from.timekeeperProfessionalId,
              proposedTimekeeperName: from.proposedTimekeeperName,
              proposedTimekeeperEmail: from.proposedTimekeeperEmail,
              suggestedTimekeeper: false,
            },
      );
}

// Someone not listed: the name entered, else the file's; unnamed, the line
// still waits to be matched.
function proposedName(draft: LineDraft): string | undefined {
  return draft.timekeeperProfessionalId === ADD_NEW
    ? draft.proposedTimekeeperName.trim() || draft.carried.timekeeperLabel || 'Not named'
    : undefined;
}

const hasTravelTime = (draft: LineDraft) => Number(draft.travelHours) > 0 || Boolean(draft.travelTime?.sourceTimeEntryId);
const travelCostsOf = (draft: LineDraft) => draft.travelCosts.filter((cost) => Number(cost.amount) > 0);

// A time item needs hours (or recorded time), a trip travel time, miles or a
// cost, anything else an amount.
function isItem(draft: LineDraft): boolean {
  if (isTimeKind(draft.lineType)) {
    return Number(draft.quantity) > 0 || Boolean(draft.sourceTimeEntryId);
  }
  if (draft.lineType === 'travel') {
    return hasTravelTime(draft) || Number(draft.quantity) > 0 || travelCostsOf(draft).length > 0;
  }
  return draft.lineType === 'mileage' ? Number(draft.quantity) > 0 : Number(draft.amount) > 0;
}

// Save and submit stay disabled until there is one.
export function hasInvoiceItems(drafts: LineDraft[]): boolean {
  return drafts.some(isItem);
}

// A trip as rows of their own, where each line is a row (Check the lines):
// its travel time, miles and costs, sharing `tripKey`, its date and route.
export function tripParts(draft: LineDraft, tripKey: string): LineDraft[] {
  const shared = {
    ...emptyLine,
    serviceDate: draft.serviceDate,
    timekeeperProfessionalId: draft.timekeeperProfessionalId,
    tripOrigin: draft.tripOrigin,
    tripDestination: draft.tripDestination,
    roundTrip: draft.roundTrip,
    tripKey,
  };
  return [
    ...(Number(draft.travelHours) > 0
      ? [{ ...shared, lineType: 'time' as const, description: draft.description, quantity: draft.travelHours, carried: draft.travelTime?.carried ?? {} }]
      : []),
    ...(Number(draft.quantity) > 0 ? [{ ...shared, lineType: 'mileage' as const, description: draft.description, quantity: draft.quantity }] : []),
    ...travelCostsOf(draft).map((cost) => ({ ...shared, lineType: 'expense' as const, description: cost.description, amount: cost.amount })),
  ];
}

// Incomplete rows are dropped; the server validates and prices the rest. A
// trip's parts go as separate lines sharing a trip key and its route.
export function linesFromDrafts(drafts: LineDraft[]): CreateInvoiceLineInput[] {
  return drafts.filter(isItem).flatMap((draft, index): CreateInvoiceLineInput[] => {
    const shared = {
      serviceDate: draft.serviceDate || undefined,
      timekeeperProfessionalId: draft.timekeeperProfessionalId && draft.timekeeperProfessionalId !== ADD_NEW ? draft.timekeeperProfessionalId : undefined,
      proposedTimekeeperName: proposedName(draft),
      proposedTimekeeperEmail: (draft.timekeeperProfessionalId === ADD_NEW && draft.proposedTimekeeperEmail.trim()) || undefined,
    };
    const description = draft.description.trim() || undefined;
    const route = {
      tripOrigin: draft.tripOrigin.trim() || undefined,
      tripDestination: draft.tripDestination.trim() || undefined,
      roundTrip: draft.roundTrip,
    };
    if (draft.lineType !== 'travel') {
      return [
        {
          ...draft.carried,
          ...shared,
          lineType: draft.lineType === 'waiting' ? 'time' : draft.lineType,
          ...(draft.lineType === 'waiting' && { timeCategory: 'waiting' as const }),
          // Ignored on a priced time item; kept while an import is unconfirmed.
          amount: Number(draft.amount) > 0 ? Number(draft.amount) : undefined,
          description,
          quantity: Number(draft.quantity) > 0 ? Number(draft.quantity) : undefined,
          sourceTimeEntryId: draft.sourceTimeEntryId || undefined,
          invoiceLineId: draft.invoiceLineId,
          ...((draft.tripKey || draft.lineType === 'mileage') && { tripKey: draft.tripKey, ...route }),
        },
      ];
    }
    const trip = { ...shared, ...route, tripKey: `trip-${index}` };
    return [
      ...(hasTravelTime(draft)
        ? [
            {
              ...draft.travelTime?.carried,
              ...trip,
              lineType: 'time' as const,
              description,
              quantity: Number(draft.travelHours) > 0 ? Number(draft.travelHours) : undefined,
              sourceTimeEntryId: draft.travelTime?.sourceTimeEntryId || undefined,
              invoiceLineId: draft.travelTime?.invoiceLineId,
            },
          ]
        : []),
      ...(Number(draft.quantity) > 0
        ? [{ ...draft.carried, ...trip, lineType: 'mileage' as const, description, quantity: Number(draft.quantity), invoiceLineId: draft.invoiceLineId }]
        : []),
      ...travelCostsOf(draft).map((cost) => ({
        ...cost.carried,
        ...trip,
        lineType: 'expense' as const,
        description: cost.description.trim() || undefined,
        amount: Number(cost.amount),
        invoiceLineId: cost.invoiceLineId,
      })),
    ];
  });
}

// What the server will bill for a mileage item, for display.
export function mileageItemPreview(
  line: Pick<LineDraft, 'serviceDate' | 'quantity'>,
  rates: MileageRate[],
): { amount: string; rate: string; miles: number } | { missing: string } {
  const miles = Number(line.quantity);
  if (!line.serviceDate || !(miles > 0)) {
    return {
      missing: !line.serviceDate && !(miles > 0) ? 'Add a date and miles' : !line.serviceDate ? 'Add a date' : 'Add the miles',
    };
  }
  const rate = mileageRateOn(rates, line.serviceDate);
  if (rate === undefined) {
    return { missing: 'No mileage rate set for this date' };
  }
  return { amount: (Math.round(miles * Number(rate) * 100) / 100).toFixed(2), rate, miles };
}

// What the server will bill for a time item, for display; it prices again on
// save, as server/src/billing/priceLines.ts does: a rate stated on an imported
// file, else the configured rate, which must exist either way. Travel and
// waiting time's configured rate is that category's, given `category`.
export function timeItemPreview(
  line: Pick<LineDraft, 'serviceDate' | 'quantity' | 'timekeeperProfessionalId'> & { carried?: Pick<LineDraft['carried'], 'unitRate'> },
  timekeepers: BillableProfessional[],
  billedProfessionalId: string | undefined,
  category?: { category: TimeCategory; rates: TimeCategoryRate[] },
): { amount: string; rate: string; hours: number; configuredRate: string } | { missing: string } {
  const professional = timekeepers.find(
    (candidate) => candidate.professionalId === (line.timekeeperProfessionalId || billedProfessionalId),
  );
  const hours = Number(line.quantity);
  if (!professional) {
    return { missing: 'Choose who did the work' };
  }
  if (!line.serviceDate || !(hours > 0)) {
    return {
      missing: !line.serviceDate && !(hours > 0) ? 'Add a date and hours' : !line.serviceDate ? 'Add a date' : 'Add the hours',
    };
  }
  const hourly = rateOn(professional.rates, line.serviceDate);
  const configuredRate = category ? categoryRateOn(category.rates, category.category, line.serviceDate, hourly) : hourly;
  if (configuredRate === undefined) {
    return { missing: 'No rate set for this date' };
  }
  const stated = line.carried?.unitRate;
  const rate = stated !== undefined && stated > 0 ? stated.toFixed(2) : configuredRate;
  return { amount: (Math.round(hours * Number(rate) * 100) / 100).toFixed(2), rate, hours, configuredRate };
}

const toCents = (amount: string | number) => Math.round(Number(amount) * 100);

// Each part of a trip as it would be billed; a part not claimed is absent.
export function travelItemPreview(
  draft: LineDraft,
  timekeepers: BillableProfessional[],
  billedProfessionalId: string | undefined,
  mileageRates: MileageRate[],
  categoryRates: TimeCategoryRate[],
): {
  time?: ReturnType<typeof timeItemPreview>;
  mileage?: ReturnType<typeof mileageItemPreview>;
  timeCents: number;
  otherCents: number;
  complete: boolean;
} {
  const time = hasTravelTime(draft)
    ? timeItemPreview({ ...draft, quantity: draft.travelHours, carried: draft.travelTime?.carried }, timekeepers, billedProfessionalId, {
        category: 'travel',
        rates: categoryRates,
      })
    : undefined;
  const mileage = Number(draft.quantity) > 0 ? mileageItemPreview(draft, mileageRates) : undefined;
  const timeCents = time && 'amount' in time ? toCents(time.amount) : 0;
  const otherCents =
    (mileage && 'amount' in mileage ? toCents(mileage.amount) : 0) +
    travelCostsOf(draft).reduce((cents, cost) => cents + toCents(cost.amount), 0);
  const complete = (!time || 'amount' in time) && (!mileage || 'amount' in mileage);
  return { time, mileage, timeCents, otherCents, complete };
}

// A time or waiting item as it would be billed.
export function timeKindPreview(
  line: LineDraft,
  timekeepers: BillableProfessional[],
  billedProfessionalId: string | undefined,
  categoryRates: TimeCategoryRate[],
) {
  return timeItemPreview(
    line,
    timekeepers,
    billedProfessionalId,
    line.lineType === 'waiting' ? { category: 'waiting', rates: categoryRates } : undefined,
  );
}

// The invoice as it would be billed, before saving. `complete` is false
// while any time, travel time or mileage can't be priced yet.
export function invoiceTotalPreview(
  lines: LineDraft[],
  timekeepers: BillableProfessional[],
  billedProfessionalId: string | undefined,
  mileageRates: MileageRate[] = [],
  categoryRates: TimeCategoryRate[] = [],
): { time: number; other: number; total: number; complete: boolean } {
  let timeCents = 0;
  let otherCents = 0;
  let complete = true;
  for (const line of lines.filter(isItem)) {
    if (isTimeKind(line.lineType)) {
      const preview = timeKindPreview(line, timekeepers, billedProfessionalId, categoryRates);
      if ('amount' in preview) {
        timeCents += toCents(preview.amount);
      } else {
        complete = false;
      }
    } else if (line.lineType === 'travel') {
      const preview = travelItemPreview(line, timekeepers, billedProfessionalId, mileageRates, categoryRates);
      timeCents += preview.timeCents;
      otherCents += preview.otherCents;
      complete &&= preview.complete;
    } else if (line.lineType === 'mileage') {
      const preview = mileageItemPreview(line, mileageRates);
      if ('amount' in preview) {
        otherCents += toCents(preview.amount);
      } else {
        complete = false;
      }
    } else {
      otherCents += toCents(line.amount);
    }
  }
  return { time: timeCents / 100, other: otherCents / 100, total: (timeCents + otherCents) / 100, complete };
}

// How travel or waiting time is billed today, for the note above the items.
export function categoryRateNote(categoryRates: TimeCategoryRate[], category: TimeCategory): string {
  return timeCategoryRateLabel(categoryRateIn(categoryRates, category, new Date().toISOString().slice(0, 10)));
}

// With no setting, the hourly rate.
export function timeCategoryRateLabel(setting: TimeCategoryRate | undefined): string {
  if (setting?.basis === 'flat_rate') {
    return `${formatMoney(setting.hourlyRate ?? '0')}/h`;
  }
  if (setting?.basis === 'percent_of_hourly_rate') {
    return `${Number(setting.percent)}% of the hourly rate`;
  }
  return 'the hourly rate';
}

// Switching a trip to another kind keeps what that kind takes: its hours
// as time or waiting, its first cost as an expense or other cost.
function switchKind(line: LineDraft, kind: DraftKind): LineDraft {
  if (kind === line.lineType) {
    return line;
  }
  if (kind === 'travel') {
    const timed = isTimeKind(line.lineType);
    const cost = Number(line.amount) > 0 && !timed ? [{ description: line.description, amount: line.amount, carried: {} }] : [];
    return { ...line, lineType: kind, travelHours: timed ? line.quantity : '', quantity: '', travelCosts: cost };
  }
  if (line.lineType !== 'travel') {
    return { ...line, lineType: kind };
  }
  const [cost] = travelCostsOf(line);
  return isTimeKind(kind)
    ? { ...line, lineType: kind, quantity: line.travelHours, travelHours: '', travelCosts: [] }
    : { ...line, lineType: kind, quantity: '', amount: cost?.amount ?? '', description: line.description || (cost?.description ?? ''), travelHours: '', travelCosts: [] };
}

// What switching would drop, to ask before it does.
function dropsOnSwitch(line: LineDraft, kind: DraftKind): string[] {
  if (line.lineType !== 'travel' || kind === 'travel') {
    return [];
  }
  const costs = travelCostsOf(line);
  return [
    ...(!isTimeKind(kind) && hasTravelTime(line) ? ['its travel time'] : []),
    ...(Number(line.quantity) > 0 ? ['its miles'] : []),
    ...(costs.length > (isTimeKind(kind) ? 0 : 1) ? [costs.length > 1 ? 'its travel expenses' : 'its travel expense'] : []),
  ];
}

// Puts a time or expense row onto a trip row of the same date, as its travel
// time or one of its costs; the row's own values carry over.
export function addToTrip(lines: LineDraft[], index: number, tripIndex: number): LineDraft[] {
  const line = lines[index]!;
  const trip = lines[tripIndex]!;
  const joined: LineDraft = isTimeKind(line.lineType)
    ? {
        ...trip,
        travelHours: line.quantity,
        travelTime: { invoiceLineId: line.invoiceLineId, sourceTimeEntryId: line.sourceTimeEntryId, carried: line.carried },
        description: trip.description || line.description,
      }
    : {
        ...trip,
        travelCosts: [...trip.travelCosts, { description: line.description, amount: line.amount, invoiceLineId: line.invoiceLineId, carried: line.carried }],
      };
  return lines.flatMap((candidate, i) => (i === index ? [] : i === tripIndex ? [joined] : [candidate]));
}

// The trip row a time or expense row could join: same date, and for time,
// no travel time yet.
export function tripToJoin(lines: LineDraft[], index: number): number | undefined {
  const line = lines[index]!;
  if (!line.serviceDate || !(line.lineType === 'time' || line.lineType === 'expense')) {
    return undefined;
  }
  const found = lines.findIndex(
    (candidate, i) =>
      i !== index && candidate.lineType === 'travel' && candidate.serviceDate === line.serviceDate && (line.lineType !== 'time' || !hasTravelTime(candidate)),
  );
  return found >= 0 ? found : undefined;
}

// Each person billed on these items, with the rates their dates fall under
// (more than one when the items span a rate change).
export function ratesInPlay(
  lines: LineDraft[],
  timekeepers: BillableProfessional[],
  billedProfessionalId: string | undefined,
): Array<{ professional: BillableProfessional; rates: Array<{ hourlyRate: string; from?: string }> }> {
  const today = new Date().toISOString().slice(0, 10);
  const people = new Map<string, Set<string>>();
  // Travel and waiting time's rates follow the hourly rate, unless flat rates are set.
  for (const line of lines.filter((candidate) => isTimeKind(candidate.lineType) || (candidate.lineType === 'travel' && hasTravelTime(candidate)))) {
    const professionalId = line.timekeeperProfessionalId || billedProfessionalId;
    if (professionalId) {
      people.set(professionalId, (people.get(professionalId) ?? new Set()).add(line.serviceDate || today));
    }
  }
  return [...people].flatMap(([professionalId, dates]) => {
    const professional = timekeepers.find((candidate) => candidate.professionalId === professionalId);
    if (!professional) {
      return [];
    }
    // The rate rows whose periods cover these dates.
    const applying = professional.rates.filter((rate, index) => {
      const next = professional.rates[index + 1];
      return [...dates].some((date) => date >= rate.effectiveFrom && (!next || date < next.effectiveFrom));
    });
    return [
      {
        professional,
        rates: applying.map((rate, index) => ({
          hourlyRate: rate.hourlyRate,
          from: applying.length > 1 && index > 0 ? rate.effectiveFrom : undefined,
        })),
      },
    ];
  });
}

// "page 2, …" shows where it was read in the original beside the review.
export function SourceLocation({ location, onShow }: { location: string; onShow: (location: string) => void }) {
  if (!/^page \d+/.test(location)) {
    return <>{location}</>;
  }
  return (
    <button type="button" className="link-button" onClick={() => onShow(location)}>
      {location}
    </button>
  );
}

export interface DuplicateTimeSuggestion {
  invoiceLineId: string;
  timeEntryId: string;
  activityOn: string;
  durationHours: string;
  description: string;
}

// One grid row per item. With several timekeepers, or on import review, "work
// done by" shows under the description; importReview adds notes and
// duplicate-time links.
export function InvoiceLinesEditor({
  idPrefix,
  lines,
  onChange,
  timekeepers = [],
  billedProfessionalId,
  recordedTime = [],
  billingCodes = [],
  mileageRates = [],
  timeCategoryRates = [],
  importReview,
  onProviderAdded,
}: {
  idPrefix: string;
  lines: LineDraft[];
  onChange: (lines: LineDraft[]) => void;
  timekeepers?: BillableProfessional[];
  // Whose work an item with no "work done by" is.
  billedProfessionalId?: string;
  // Unbilled recorded time, to spot typed items that repeat it.
  recordedTime?: TimeEntryRecord[];
  // The agency's task codes, when it uses them: adds a code column.
  billingCodes?: Array<{ code: string; displayName: string }>;
  // Price mileage, travel and waiting time in the preview.
  mileageRates?: MileageRate[];
  timeCategoryRates?: TimeCategoryRate[];
  importReview?: {
    duplicateTime: DuplicateTimeSuggestion[];
    sourceLocations?: string[];
    onShowSource: (location: string) => void;
    // A file designated to one professional: "work done by" is fixed.
    fixedTimekeeper?: boolean;
  };
  // Staff only: "add" creates the provider, and this readies them to be
  // billed (on a case, assigns them to it). Others name someone instead.
  // Expected to add them to `timekeepers` (useAddedProviders).
  onProviderAdded?: (provider: AddedProvider) => Promise<void>;
}) {
  // Added here, to offer using them for the other items.
  const [addedIds, setAddedIds] = useState<string[]>([]);
  // A switch away from a trip that would drop some of it, until confirmed.
  const [pendingSwitch, setPendingSwitch] = useState<{ index: number; kind: DraftKind; drops: string[] }>();
  const showTimekeeper = timekeepers.length > 1 || Boolean(importReview);
  // Staff review's columns (client/src/pages/InvoiceReview.tsx), led by the
  // kind of item, which decides whether it takes hours or an amount; a trip
  // takes its miles and costs below. Who did it and its code sit under the
  // description. Widths and the narrow layouts are in app.css (.line-editor).
  const columns = ['Kind', 'Date', 'What was done', 'Hours', 'Rate', 'Amount', ''];

  function update(index: number, changes: Partial<LineDraft>) {
    onChange(lines.map((line, i) => (i === index ? { ...line, ...changes } : line)));
  }

  function chooseKind(index: number, kind: DraftKind) {
    const drops = dropsOnSwitch(lines[index]!, kind);
    if (drops.length > 0) {
      setPendingSwitch({ index, kind, drops });
      return;
    }
    setPendingSwitch(undefined);
    onChange(lines.map((line, i) => (i === index ? switchKind(line, kind) : line)));
  }

  async function addProvider(index: number, provider: AddedProvider) {
    // If putting them on the case fails, saving says so.
    await onProviderAdded?.(provider).catch(() => undefined);
    setAddedIds((current) => [...current, provider.professionalId]);
    update(index, { timekeeperProfessionalId: provider.professionalId, proposedTimekeeperName: '', proposedTimekeeperEmail: '' });
  }

  const pricingFor = importReview ? undefined : billedProfessionalId;
  const inPlay = ratesInPlay(lines, timekeepers, pricingFor);
  const totals = invoiceTotalPreview(lines, timekeepers, pricingFor, mileageRates, timeCategoryRates);
  const mileageRateToday = mileageRateOn(mileageRates, new Date().toISOString().slice(0, 10));

  return (
    <>
      {inPlay.length > 0 && (
        <p className="rate-note">
          Time is billed at{' '}
          {inPlay
            .map(({ professional, rates }) => {
              const amounts =
                rates.length === 0
                  ? 'no rate set yet'
                  : rates
                      .map((rate) => `${formatMoney(rate.hourlyRate)}/h${rate.from ? ` from ${formatDate(rate.from)}` : ''}`)
                      .join(', then ');
              const kind = professional.kindDisplayName ? `, ${professional.kindDisplayName.toLowerCase()}` : '';
              return `${amounts} for ${professionalLabel(professional)}${kind}`;
            })
            .join('; ')}
          . Administrators set the rates.
        </p>
      )}
      {lines.some((line) => line.lineType === 'travel') && (
        <p className="rate-note">
          Travel time is billed at {categoryRateNote(timeCategoryRates, 'travel')}, and mileage at{' '}
          {mileageRateToday ? `${formatRate(mileageRateToday)} per mile` : 'a rate not set yet'}.
        </p>
      )}
      {lines.some((line) => line.lineType === 'waiting') && (
        <p className="rate-note">Waiting time is billed at {categoryRateNote(timeCategoryRates, 'waiting')}.</p>
      )}
    <div className="line-editor">
      <div className="line-editor-head" aria-hidden="true">
        {columns.map((label, index) => (
          // Hours to Amount are right-aligned figures.
          <span key={index} className={index >= 3 && index <= 5 ? 'amount' : undefined}>
            {label}
          </span>
        ))}
      </div>
      {lines.map((line, index) => {
        const id = (field: string) => `${idPrefix}-${field}-${index}`;
        const item = `Item ${index + 1}`;
        const duplicate = importReview?.duplicateTime.find((candidate) => candidate.invoiceLineId === line.invoiceLineId);
        const unmatched = Boolean(importReview) && !line.timekeeperProfessionalId;
        const linked = Boolean(line.sourceTimeEntryId || line.travelTime?.sourceTimeEntryId);
        const travel = line.lineType === 'travel';
        const pricingProfessionalId = importReview ? undefined : billedProfessionalId;
        const travelPreview = travel ? travelItemPreview(line, timekeepers, pricingProfessionalId, mileageRates, timeCategoryRates) : undefined;
        // The hours column's: time worked or waiting, or a trip's travel time.
        const preview = isTimeKind(line.lineType)
          ? timeKindPreview(line, timekeepers, pricingProfessionalId, timeCategoryRates)
          : travelPreview?.time;
        const joinTrip = tripToJoin(lines, index);
        const mileagePreview = travelPreview?.mileage;
        const stated = line.carried.statedAmount;
        // The file's stated amount is on a time line or a trip's mileage.
        const priced = travel ? mileagePreview : preview;
        const missing = [preview, mileagePreview].flatMap((part) => (part && 'missing' in part ? [part.missing] : []));
        // A trip's task code is its travel time's.
        const taskCode = travel ? line.travelTime?.carried.taskCode : line.carried.taskCode;
        const setTaskCode = (code: string | undefined) =>
          travel
            ? update(index, {
                travelTime: { sourceTimeEntryId: '', ...line.travelTime, carried: { ...line.travelTime?.carried, taskCode: code } },
              })
            : update(index, { carried: { ...line.carried, taskCode: code } });
        const differsFromFile =
          stated !== undefined && priced && 'amount' in priced && Math.abs(Number(priced.amount) - stated) >= 0.005;
        // Typed time that looks like work already recorded: offered, never merged.
        const sameAsRecorded =
          line.lineType === 'time' && !linked
            ? recordedTime.find(
                (entry) =>
                  entry.professionalId === (line.timekeeperProfessionalId || billedProfessionalId) &&
                  entry.activityOn === line.serviceDate &&
                  Number(entry.durationHours) === Number(line.quantity) &&
                  !lines.some((other) => other.sourceTimeEntryId === entry.timeEntryId),
              )
            : undefined;
        return (
          // data-label: a short visible label when a narrow editor stacks its cells (app.css).
          <div key={index} className="line-row inline-fields" role="group" aria-label={item}>
            <div className="usa-form-group" data-label="Kind">
              <Label htmlFor={id('type')} className="line-label">{`${item} kind`}</Label>
              <Select
                id={id('type')}
                name={id('type')}
                value={line.lineType}
                disabled={linked}
                title="Time and waiting time are priced by the hour. A trip takes its travel time, miles and other costs together; each is billed as its own item. Enter an amount for an expense or other cost."
                onChange={(event) => chooseKind(index, event.target.value as DraftKind)}
              >
                <option value="time">Time worked</option>
                <option value="waiting">Waiting time</option>
                <option value="travel">Travel</option>
                <option value="expense">Expense</option>
                <option value="other">Other cost</option>
              </Select>
              {pendingSwitch?.index === index && (
                <p className="line-switch-confirm" role="alert">
                  This removes {pendingSwitch.drops.join(' and ')}.{' '}
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => {
                      setPendingSwitch(undefined);
                      onChange(lines.map((other, i) => (i === index ? switchKind(other, pendingSwitch.kind) : other)));
                    }}
                  >
                    Switch
                  </button>{' '}
                  <button type="button" className="link-button" onClick={() => setPendingSwitch(undefined)}>
                    Keep the trip
                  </button>
                </p>
              )}
            </div>
            <div className="usa-form-group" data-label="Date">
              <Label htmlFor={id('date')} className="line-label">{`${item} date`}</Label>
              <input
                id={id('date')}
                type="date"
                className="usa-input"
                value={line.serviceDate}
                required={Boolean(line.carried.sourceLocation)}
                onChange={(event) => update(index, { serviceDate: event.target.value })}
              />
            </div>
            <div className="usa-form-group line-what" data-label="What was done">
              <Label htmlFor={id('description')} className="line-label">{`${item} description`}</Label>
              <TextInput
                id={id('description')}
                name={id('description')}
                type="text"
                placeholder="What was done"
                value={line.description}
                onChange={(event) => update(index, { description: event.target.value })}
              />
              {(showTimekeeper || (billingCodes.length > 0 && (isTimeKind(line.lineType) || travel))) && (
              <div className="line-meta">
                {showTimekeeper && (
                  <>
                    <Label htmlFor={id('timekeeper')} className="line-label">{`${item} work done by`}</Label>
                    <PickOrAdd
                      id={id('timekeeper')}
                      value={line.timekeeperProfessionalId}
                      // Recorded time stays whose it is.
                      disabled={linked || Boolean(importReview?.fixedTimekeeper)}
                      onChange={(value) =>
                        update(index, {
                          timekeeperProfessionalId: value,
                          proposedTimekeeperName: value === ADD_NEW ? line.proposedTimekeeperName || (line.carried.timekeeperLabel ?? '') : '',
                          proposedTimekeeperEmail: value === ADD_NEW ? line.proposedTimekeeperEmail : '',
                          suggestedTimekeeper: false,
                        })
                      }
                      addLabel="+ Add new person"
                      placeholder={importReview ? '- Who did the work? -' : 'Billed professional'}
                      options={timekeepers.map((professional) => ({ value: professional.professionalId, label: professionalLabel(professional) }))}
                    >
                      {onProviderAdded ? (
                        <AddProvider
                          inline
                          idPrefix={id('timekeeper-new')}
                          initial={{ displayName: line.proposedTimekeeperName, email: line.proposedTimekeeperEmail || undefined }}
                          onAdded={(provider) => void addProvider(index, provider)}
                        />
                      ) : (
                        <ProposedPersonFields
                          idPrefix={id('timekeeper-new')}
                          value={{ displayName: line.proposedTimekeeperName, email: line.proposedTimekeeperEmail }}
                          onChange={(person) => update(index, { proposedTimekeeperName: person.displayName, proposedTimekeeperEmail: person.email ?? '' })}
                        />
                      )}
                    </PickOrAdd>
                    {lines.length > 1 &&
                      (line.timekeeperProfessionalId === ADD_NEW ? line.proposedTimekeeperName.trim() : addedIds.includes(line.timekeeperProfessionalId)) && (
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => onChange(sameTimekeeperForAll(lines, line, Boolean(importReview?.fixedTimekeeper)))}
                        >
                          {`Use ${line.timekeeperProfessionalId === ADD_NEW ? line.proposedTimekeeperName.trim() : timekeepers.find((p) => p.professionalId === line.timekeeperProfessionalId)?.displayName} for every other item`}
                        </button>
                      )}
                  </>
                )}
                {billingCodes.length > 0 && (isTimeKind(line.lineType) || travel) && (
                  <>
                    <Label htmlFor={id('task-code')} className="line-label">{`${item} ${travel ? 'travel time ' : ''}task code`}</Label>
                    <Select
                      id={id('task-code')}
                      name={id('task-code')}
                      value={taskCode ?? ''}
                      onChange={(event) => setTaskCode(event.target.value || undefined)}
                    >
                      <option value="">{travel ? '- Travel time task code -' : '- Task code -'}</option>
                      {taskCode && !billingCodes.some((code) => code.code === taskCode) && (
                        <option value={taskCode}>{taskCode} (not on list)</option>
                      )}
                      {billingCodes.map((code) => (
                        <option key={code.code} value={code.code}>
                          {code.code} {code.displayName}
                        </option>
                      ))}
                    </Select>
                  </>
                )}
              </div>
              )}
            </div>
            <div className="usa-form-group" data-label={travel ? 'Travel hours' : 'Hours'}>
              <Label htmlFor={id('quantity')} className="line-label">{`${item} ${travel ? 'travel hours' : 'hours'}`}</Label>
              <TextInput
                id={id('quantity')}
                name={id('quantity')}
                type="number"
                min="0"
                step="0.01"
                placeholder={isTimeKind(line.lineType) ? 'Hours' : travel ? 'Travel hours' : 'Optional'}
                value={travel ? line.travelHours : line.quantity}
                onChange={(event) => update(index, travel ? { travelHours: event.target.value } : { quantity: event.target.value })}
              />
            </div>
            <div className="line-amount line-rate" data-label="Rate">
              <span className="line-label">{`${item} rate`}</span>
              {preview && 'amount' in preview ? (
                <span className="line-amount-priced">
                  <span className="amount">{formatMoney(preview.rate)}/h</span>
                  {Number(preview.rate) !== Number(preview.configuredRate) && (
                    <span className="line-amount-basis line-rate-differs">Configured {formatMoney(preview.configuredRate)}</span>
                  )}
                </span>
              ) : (
                <span className="muted amount">—</span>
              )}
            </div>
            {isTimeKind(line.lineType) ? (
              <div className="usa-form-group line-amount" data-label="Amount">
                <span className="line-label">{`${item} amount in dollars`}</span>
                {preview && 'amount' in preview ? (
                  <strong className="amount">{formatMoney(preview.amount)}</strong>
                ) : (
                  <span className="line-amount-missing">{preview?.missing}</span>
                )}
              </div>
            ) : travelPreview ? (
              // The trip's total; each part is priced below.
              <div className="usa-form-group line-amount" data-label="Trip total">
                <span className="line-label">{`${item} trip total in dollars`}</span>
                {missing.length > 0 || !isItem(line) ? (
                  <span className="line-amount-missing">{missing.length > 0 ? missing.join('; ') : 'Add hours, miles or a cost'}</span>
                ) : (
                  <strong className="amount">{formatMoney(((travelPreview.timeCents + travelPreview.otherCents) / 100).toFixed(2))}</strong>
                )}
              </div>
            ) : (
              <div className="usa-form-group" data-label="Amount">
                <Label htmlFor={id('amount')} className="line-label">{`${item} amount in dollars`}</Label>
                <TextInput
                  id={id('amount')}
                  name={id('amount')}
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={line.amount}
                  onChange={(event) => update(index, { amount: event.target.value })}
                />
              </div>
            )}
            {lines.length > 1 ? (
              <button
                type="button"
                className="line-remove"
                aria-label={`Remove ${item.toLowerCase()}`}
                title={linked ? 'Remove item (the time stays recorded, unbilled)' : 'Remove item'}
                onClick={() => onChange(lines.filter((_, i) => i !== index))}
              >
                ×
              </button>
            ) : (
              <span />
            )}
            {travel && (
              <TripFields idPrefix={`${idPrefix}-${index}`} line={line} mileagePreview={mileagePreview} onChange={(changes) => update(index, changes)} />
            )}
            {(importReview || linked || differsFromFile || sameAsRecorded || joinTrip !== undefined) && (
              <p className="line-row-note">
                {joinTrip !== undefined && (
                  // Offered, never done for them: grouping is optional.
                  <span>
                    A trip on the same day is item {joinTrip + 1}.{' '}
                    <button type="button" className="link-button" onClick={() => onChange(addToTrip(lines, index, joinTrip))}>
                      {line.lineType === 'time' ? 'Make this its travel time' : 'Add this as one of its travel expenses'}
                    </button>
                  </span>
                )}
                {sameAsRecorded && (
                  <span className="line-row-suggested">
                    Matches time already recorded on {formatDate(sameAsRecorded.activityOn)} ({Number(sameAsRecorded.durationHours)} h).{' '}
                    <button
                      type="button"
                      className="link-button"
                      onClick={() =>
                        update(index, {
                          sourceTimeEntryId: sameAsRecorded.timeEntryId,
                          description: sameAsRecorded.description,
                          timekeeperProfessionalId: sameAsRecorded.professionalId,
                        })
                      }
                    >
                      Bill that instead
                    </button>
                  </span>
                )}
                {linked && <span>Recorded time: changes here update it.</span>}
                {importReview?.sourceLocations?.[index] && line.invoiceLineId ? (
                  <span>
                    In the original: <SourceLocation location={importReview.sourceLocations[index]!} onShow={importReview.onShowSource} />
                  </span>
                ) : null}
                {line.carried.timekeeperLabel ? <span>On file: {line.carried.timekeeperLabel}</span> : null}
                {differsFromFile ? (
                  <span className="line-row-suggested">
                    The file says {formatMoney(String(stated))}
                    {line.carried.unitRate !== undefined
                      ? ` at ${formatRate(String(line.carried.unitRate))}${travel ? '/mi' : '/h'}`
                      : ''}
                    , which doesn't match the {travel ? 'miles' : 'hours'} and rate.
                  </span>
                ) : null}
                {unmatched ? (
                  <span className="line-row-suggested">Who did this work will be matched on Intake</span>
                ) : line.timekeeperProfessionalId === ADD_NEW ? (
                  <span className="line-row-suggested">Not in the system yet: matched on Intake</span>
                ) : line.suggestedTimekeeper ? (
                  <span className="line-row-suggested">Suggested match: check it</span>
                ) : null}
              </p>
            )}
            {duplicate && (
              <Checkbox
                id={id('link-time')}
                name={id('link-time')}
                checked={line.sourceTimeEntryId === duplicate.timeEntryId}
                onChange={(event) => update(index, { sourceTimeEntryId: event.target.checked ? duplicate.timeEntryId : '' })}
                label={`Time already recorded on ${duplicate.activityOn} (${duplicate.durationHours} h): link it instead of recording this work again`}
              />
            )}
          </div>
        );
      })}
      <div className="line-editor-foot">
        <button type="button" className="link-button line-add" onClick={() => onChange([...lines, emptyLine])}>
          + Add item
        </button>
        {hasInvoiceItems(lines) && (
          <p className="line-total" aria-live="polite">
            <strong>
              {totals.complete ? 'Total' : 'Total so far'} {formatMoney(totals.total.toFixed(2))}
            </strong>{' '}
            <span>
              (time {formatMoney(totals.time.toFixed(2))} · expenses and other {formatMoney(totals.other.toFixed(2))})
            </span>
            {!totals.complete && <span className="line-amount-missing"> Some items can't be priced yet.</span>}
          </p>
        )}
      </div>
    </div>
    </>
  );
}
