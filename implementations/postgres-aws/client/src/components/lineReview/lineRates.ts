import type { CaseRate, InvoiceReviewLine, LineDecision, LineRateInput, RateType } from '../../api/client';
import { cents } from '../../formatMoney';
import { PanelMode } from './DecisionPanel';

// Time, travel time and mileage: corrected by quantity and rate.
export function hasHours(line: Pick<InvoiceReviewLine, 'quantity' | 'billedRate'>): boolean {
  return line.quantity !== null && Number(line.quantity) > 0 && line.billedRate !== null;
}

export const RATE_TYPE_LABELS: Record<RateType, string> = {
  hourly: 'hourly',
  travel: 'travel time',
  waiting: 'waiting time',
  mileage: 'mileage',
};

// Where else a changed rate may go: the matching lines on this invoice, or
// the case's default (model/rules.yaml set_case_rate).
export interface RateScope {
  personName: string;
  // Undecided lines by the same person at the same kind of rate, this one included.
  matching: InvoiceReviewLine[];
  hasCase: boolean;
  caseRates: CaseRate[];
  onApply: (input: LineRateInput) => void;
}

// The latest case rate for this person or kind, which a new one must follow.
export function latestCaseRate(caseRates: CaseRate[], line: InvoiceReviewLine, target: 'person' | 'kind'): CaseRate | null {
  const own = caseRates.filter(
    (row) =>
      row.rateType === line.rateType &&
      (target === 'person' ? row.professionalId === line.rateProfessionalId : row.professionalKindId === line.rateKindId),
  );
  return own.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt)).at(-1) ?? null;
}

// What a Part or Rate panel's figures decide. Rate keeps the hours: a higher
// rate approves more with no reason, a lower one is a cut and needs one, and
// only Rate offers the rate to the matching lines or the case.
export function lineAdjustment(
  line: Pick<InvoiceReviewLine, 'quantity' | 'billedRate' | 'amount' | 'rateType' | 'rateSource'>,
  mode: PanelMode,
  figures: { hours: string; rate: string; amount: string },
  scope: { offered: boolean; matching: number; canSetCase: boolean },
) {
  const byHours = hasHours(line);
  const adjusting = mode === 'approved_in_part' || mode === 'rate';
  const hours = mode === 'rate' ? (line.quantity ?? '') : figures.hours;
  const rate = Number(figures.rate);
  const changedRate = rate > 0 && rate !== Number(line.billedRate);
  const hoursKept = adjusting && byHours && Number(hours) === Number(line.quantity);
  const rateOnly = hoursKept && changedRate;
  const requestedCents = cents(line.amount);
  const approvedCents = byHours ? cents(Number(hours) * rate) : cents(Number(figures.amount));
  const validAmount = Number.isFinite(approvedCents) && approvedCents > 0 && approvedCents < requestedCents;
  // The same hours at a higher rate approve more than was asked; sign-off sees it flagged.
  const raised = rateOnly && approvedCents >= requestedCents;
  const rateValid = mode !== 'rate' || changedRate;
  const fromCase = line.rateSource === 'case_person' || line.rateSource === 'case_kind';
  const offerScope =
    mode === 'rate' &&
    scope.offered &&
    Boolean(line.rateType) &&
    hoursKept &&
    ((rateOnly && (scope.matching > 1 || scope.canSetCase)) || (scope.canSetCase && fromCase));
  return { rateOnly, requestedCents, approvedCents, validAmount, raised, rateValid, cutNeedsReason: adjusting && rateValid && !raised, offerScope };
}

// Approved at a rate other than the one billed.
export function rateChanged(line: Pick<InvoiceReviewLine, 'billedRate'>, decision: LineDecision | null): boolean {
  return Boolean(decision?.approvedRate) && Number(decision!.approvedRate) !== Number(line.billedRate);
}
