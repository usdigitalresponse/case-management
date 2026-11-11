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
  type TimeCategory,
  type TimeCategoryRate,
} from './api/client';
import { cents, formatMoney } from './formatMoney';
import { ADD_NEW } from './components/PickOrAdd';
import { NO_PROPOSED_PERSON } from './components/NewEntryFields';


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
export function sameTimekeeperForAll(lines: LineDraft[], from: LineDraft, fixed: boolean): LineDraft[] {
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
export function isItem(draft: LineDraft): boolean {
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
  const ownTravel = category?.category === 'travel' ? rateOn(professional.travelRates ?? [], line.serviceDate) : undefined;
  const configuredRate = ownTravel ?? (category ? categoryRateOn(category.rates, category.category, line.serviceDate, hourly) : hourly);
  if (configuredRate === undefined) {
    return { missing: 'No rate set for this date' };
  }
  const stated = line.carried?.unitRate;
  const rate = stated !== undefined && stated > 0 ? stated.toFixed(2) : configuredRate;
  return { amount: (Math.round(hours * Number(rate) * 100) / 100).toFixed(2), rate, hours, configuredRate };
}

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
  const timeCents = time && 'amount' in time ? cents(time.amount) : 0;
  const otherCents =
    (mileage && 'amount' in mileage ? cents(mileage.amount) : 0) +
    travelCostsOf(draft).reduce((total, cost) => total + cents(cost.amount), 0);
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
        timeCents += cents(preview.amount);
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
        otherCents += cents(preview.amount);
      } else {
        complete = false;
      }
    } else {
      otherCents += cents(line.amount);
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
export function switchKind(line: LineDraft, kind: DraftKind): LineDraft {
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
export function dropsOnSwitch(line: LineDraft, kind: DraftKind): string[] {
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
