import { Button, Checkbox, Label, Select, TextInput } from '@trussworks/react-uswds';
import {
  rateOn,
  type BillableProfessional,
  type CreateInvoiceLineInput,
  type InvoiceLineType,
  type PortalInvoiceLine,
} from '../api/client';
import { formatMoney } from '../formatMoney';
import { formatDate } from '../formatDateTime';

// Raw input strings until saved.
export interface LineDraft {
  lineType: InvoiceLineType;
  serviceDate: string;
  description: string;
  quantity: string;
  // Entered for expense and other items; a time item is priced from rates.
  amount: string;
  // Empty: the billed professional, or on import review, not chosen yet.
  timekeeperProfessionalId: string;
  // Recorded time this item bills; editing the item edits that time.
  sourceTimeEntryId: string;
  invoiceLineId?: string;
  // Pre-selected on import and not yet checked.
  suggestedTimekeeper?: boolean;
  // Values the editor doesn't show, saved back so edits never drop them.
  carried: Pick<CreateInvoiceLineInput, 'unitRate' | 'statedAmount' | 'timekeeperLabel' | 'taskCode' | 'activityCode' | 'expenseCode'>;
}

export const emptyLine: LineDraft = {
  lineType: 'time',
  serviceDate: '',
  description: '',
  quantity: '',
  amount: '',
  timekeeperProfessionalId: '',
  sourceTimeEntryId: '',
  carried: {},
};

const LINE_TYPE_BY_CODE: Record<string, InvoiceLineType> = { time: 'time', expense: 'expense' };

export function lineDraftsFrom(lines: PortalInvoiceLine[]): LineDraft[] {
  return lines.map((line) => ({
    lineType: LINE_TYPE_BY_CODE[line.lineTypeCode ?? ''] ?? 'other',
    serviceDate: line.serviceDate ?? '',
    description: line.description ?? '',
    quantity: line.quantity ?? '',
    amount: line.amount,
    timekeeperProfessionalId: line.timekeeperProfessionalId ?? '',
    sourceTimeEntryId: line.sourceTimeEntryId ?? '',
    invoiceLineId: line.invoiceLineId,
    carried: {
      unitRate: line.unitRate === null ? undefined : Number(line.unitRate),
      statedAmount: line.statedAmount === null ? undefined : Number(line.statedAmount),
      timekeeperLabel: line.timekeeperLabel ?? undefined,
      taskCode: line.taskCode ?? undefined,
      activityCode: line.activityCode ?? undefined,
      expenseCode: line.expenseCode ?? undefined,
    },
  }));
}

export function professionalLabel(professional: BillableProfessional): string {
  const name = professional.displayName ?? 'Unnamed professional';
  return professional.isSelf ? `${name} (you)` : name;
}

export function assignTimekeeper(lines: LineDraft[], professionalId: string, only: 'all' | 'unassigned'): LineDraft[] {
  return lines.map((line) =>
    only === 'unassigned' && line.timekeeperProfessionalId
      ? line
      : { ...line, timekeeperProfessionalId: professionalId, suggestedTimekeeper: false },
  );
}

// A time item needs hours (or recorded time); anything else an amount.
function isItem(draft: LineDraft): boolean {
  return draft.lineType === 'time' ? Number(draft.quantity) > 0 || Boolean(draft.sourceTimeEntryId) : Number(draft.amount) > 0;
}

// Save and submit stay disabled until there is one.
export function hasInvoiceItems(drafts: LineDraft[]): boolean {
  return drafts.some(isItem);
}

// Incomplete rows are dropped; the server validates and prices the rest.
export function linesFromDrafts(drafts: LineDraft[]): CreateInvoiceLineInput[] {
  return drafts.filter(isItem).map((draft) => ({
    ...draft.carried,
    lineType: draft.lineType,
    // Ignored on a priced time item; kept while an import is unconfirmed.
    amount: Number(draft.amount) > 0 ? Number(draft.amount) : undefined,
    serviceDate: draft.serviceDate || undefined,
    description: draft.description.trim() || undefined,
    quantity: Number(draft.quantity) > 0 ? Number(draft.quantity) : undefined,
    timekeeperProfessionalId: draft.timekeeperProfessionalId || undefined,
    sourceTimeEntryId: draft.sourceTimeEntryId || undefined,
  }));
}

// What the server will bill for a time item, for display; it prices again
// on save (server/src/billing/priceTimeLines.ts).
export function timeItemPreview(
  line: Pick<LineDraft, 'serviceDate' | 'quantity' | 'timekeeperProfessionalId'>,
  timekeepers: BillableProfessional[],
  billedProfessionalId: string | undefined,
): { amount: string; rate: string; hours: number } | { missing: string } {
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
  const rate = rateOn(professional.rates, line.serviceDate);
  if (rate === undefined) {
    return { missing: 'No rate set for this date' };
  }
  return { amount: (Math.round(hours * Number(rate) * 100) / 100).toFixed(2), rate, hours };
}

// The invoice as it would be billed, before saving. `complete` is false
// while any time item can't be priced yet.
export function invoiceTotalPreview(
  lines: LineDraft[],
  timekeepers: BillableProfessional[],
  billedProfessionalId: string | undefined,
): { time: number; other: number; total: number; complete: boolean } {
  let timeCents = 0;
  let otherCents = 0;
  let complete = true;
  for (const line of lines.filter(isItem)) {
    if (line.lineType === 'time') {
      const preview = timeItemPreview(line, timekeepers, billedProfessionalId);
      if ('amount' in preview) {
        timeCents += Math.round(Number(preview.amount) * 100);
      } else {
        complete = false;
      }
    } else {
      otherCents += Math.round(Number(line.amount) * 100);
    }
  }
  return { time: timeCents / 100, other: otherCents / 100, total: (timeCents + otherCents) / 100, complete };
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
  for (const line of lines.filter((candidate) => candidate.lineType === 'time')) {
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

// "page 2, …" links to that page of the original beside the review.
function SourceLocation({ location }: { location: string }) {
  const page = /^page (\d+)/.exec(location)?.[1];
  if (!page) {
    return <>{location}</>;
  }
  return (
    <button
      type="button"
      className="usa-button usa-button--unstyled"
      onClick={() => document.getElementById(`original-page-${page}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
    >
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

// One grid row per item. More than one timekeeper adds a "work done by"
// column; importReview adds notes and duplicate-time links.
export function InvoiceLinesEditor({
  idPrefix,
  lines,
  onChange,
  timekeepers = [],
  billedProfessionalId,
  importReview,
}: {
  idPrefix: string;
  lines: LineDraft[];
  onChange: (lines: LineDraft[]) => void;
  timekeepers?: BillableProfessional[];
  // Whose work an item with no "work done by" is.
  billedProfessionalId?: string;
  importReview?: {
    duplicateTime: DuplicateTimeSuggestion[];
    sourceLocations?: string[];
    // A file designated to one professional: "work done by" is fixed.
    fixedTimekeeper?: boolean;
    // Lines (by location) whose date came from the billing period.
    inferredDateLocations?: string[];
  };
}) {
  const showTimekeeper = timekeepers.length > 1 || Boolean(importReview);
  const columns = [
    ['Type', 'minmax(5.5rem, 6.5rem)'],
    ['Date', 'minmax(8.5rem, 9.5rem)'],
    ['Description', 'minmax(6rem, 1fr)'],
    ...(showTimekeeper ? [['Work done by', 'minmax(7rem, 12rem)']] : []),
    ['Hours', 'minmax(4rem, 5rem)'],
    ['Amount ($)', 'minmax(5.5rem, 7rem)'],
    ['', '1.75rem'],
  ];
  const gridTemplateColumns = columns.map(([, width]) => width).join(' ');

  function update(index: number, changes: Partial<LineDraft>) {
    onChange(lines.map((line, i) => (i === index ? { ...line, ...changes } : line)));
  }

  const pricingFor = importReview ? undefined : billedProfessionalId;
  const inPlay = ratesInPlay(lines, timekeepers, pricingFor);
  const totals = invoiceTotalPreview(lines, timekeepers, pricingFor);

  return (
    <div className="line-editor">
      {inPlay.length > 0 && (
        <p className="rate-note">
          Time billed at:{' '}
          {inPlay
            .map(({ professional, rates }) => {
              const amounts =
                rates.length === 0
                  ? 'no rate set'
                  : rates
                      .map((rate) => `${formatMoney(rate.hourlyRate)}/h${rate.from ? ` from ${formatDate(rate.from)}` : ''}`)
                      .join(', ');
              const who = [professional.kindDisplayName, `(${professionalLabel(professional)})`].filter(Boolean).join(' ');
              return `${amounts} ${who}`;
            })
            .join(' · ')}
          . Set by administrators.
        </p>
      )}
      <div className="line-editor-head" style={{ gridTemplateColumns }} aria-hidden="true">
        {columns.map(([label], index) => (
          <span key={index}>{label}</span>
        ))}
      </div>
      {lines.map((line, index) => {
        const id = (field: string) => `${idPrefix}-${field}-${index}`;
        const item = `Item ${index + 1}`;
        const duplicate = importReview?.duplicateTime.find((candidate) => candidate.invoiceLineId === line.invoiceLineId);
        const unmatched = Boolean(importReview) && !line.timekeeperProfessionalId;
        const linked = Boolean(line.sourceTimeEntryId);
        const preview = line.lineType === 'time' ? timeItemPreview(line, timekeepers, importReview ? undefined : billedProfessionalId) : undefined;
        const stated = line.carried.statedAmount;
        const differsFromFile =
          stated !== undefined && preview && 'amount' in preview && Math.abs(Number(preview.amount) - stated) >= 0.005;
        const location = importReview?.sourceLocations?.[index];
        const dateInferred = Boolean(line.serviceDate && location && importReview?.inferredDateLocations?.includes(location));
        return (
          <div key={index} className="line-row inline-fields" style={{ gridTemplateColumns }} role="group" aria-label={item}>
            <div className="usa-form-group">
              <Label htmlFor={id('type')} className="line-label">{`${item} type`}</Label>
              <Select
                id={id('type')}
                name={id('type')}
                value={line.lineType}
                disabled={linked}
                onChange={(event) => update(index, { lineType: event.target.value as InvoiceLineType })}
              >
                <option value="time">Time</option>
                <option value="expense">Expense</option>
                <option value="other">Other</option>
              </Select>
            </div>
            <div className="usa-form-group">
              <Label htmlFor={id('date')} className="line-label">{`${item} date`}</Label>
              <input
                id={id('date')}
                type="date"
                className="usa-input"
                value={line.serviceDate}
                onChange={(event) => update(index, { serviceDate: event.target.value })}
              />
            </div>
            <div className="usa-form-group">
              <Label htmlFor={id('description')} className="line-label">{`${item} description`}</Label>
              <TextInput
                id={id('description')}
                name={id('description')}
                type="text"
                value={line.description}
                onChange={(event) => update(index, { description: event.target.value })}
              />
            </div>
            {showTimekeeper && (
              <div className="usa-form-group">
                <Label htmlFor={id('timekeeper')} className="line-label">{`${item} work done by`}</Label>
                <Select
                  id={id('timekeeper')}
                  name={id('timekeeper')}
                  value={line.timekeeperProfessionalId}
                  // Recorded time stays whose it is.
                  disabled={linked || Boolean(importReview?.fixedTimekeeper)}
                  validationStatus={unmatched ? 'error' : undefined}
                  aria-describedby={unmatched ? id('timekeeper-error') : undefined}
                  onChange={(event) => update(index, { timekeeperProfessionalId: event.target.value, suggestedTimekeeper: false })}
                >
                  <option value="">{importReview ? '- Choose -' : 'Billed professional'}</option>
                  {timekeepers.map((professional) => (
                    <option key={professional.professionalId} value={professional.professionalId}>
                      {professionalLabel(professional)}
                    </option>
                  ))}
                </Select>
              </div>
            )}
            <div className="usa-form-group">
              <Label htmlFor={id('quantity')} className="line-label">{`${item} hours`}</Label>
              <TextInput
                id={id('quantity')}
                name={id('quantity')}
                type="number"
                min="0"
                step="0.01"
                value={line.quantity}
                onChange={(event) => update(index, { quantity: event.target.value })}
              />
            </div>
            {line.lineType === 'time' ? (
              <div className="usa-form-group line-amount">
                <span className="line-label">{`${item} amount in dollars`}</span>
                {preview && 'amount' in preview ? (
                  <span className="line-amount-priced">
                    <span className="amount">{formatMoney(preview.amount)}</span>
                    <span className="line-amount-basis">
                      {preview.hours} h × {formatMoney(preview.rate)}
                    </span>
                  </span>
                ) : (
                  <span className="line-amount-missing">{preview?.missing}</span>
                )}
              </div>
            ) : (
              <div className="usa-form-group">
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
            {(importReview || linked || differsFromFile) && (
              <p className="line-row-note">
                {linked && <span>Recorded time: changes here update it.</span>}
                {importReview?.sourceLocations?.[index] && line.invoiceLineId ? (
                  <span>
                    In the original: <SourceLocation location={importReview.sourceLocations[index]!} />
                  </span>
                ) : null}
                {line.carried.timekeeperLabel ? <span>On file: {line.carried.timekeeperLabel}</span> : null}
                {dateInferred ? <span className="line-row-suggested">Date from the billing period: check it</span> : null}
                {differsFromFile ? (
                  <span className="line-row-suggested">
                    The file says {formatMoney(String(stated))}
                    {line.carried.unitRate !== undefined ? ` at ${formatMoney(String(line.carried.unitRate))}/h` : ''}; billed at
                    the configured rate.
                  </span>
                ) : null}
                {unmatched ? (
                  <span className="line-row-error" id={id('timekeeper-error')}>
                    Choose who did this work
                  </span>
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
        <Button type="button" unstyled className="line-add" onClick={() => onChange([...lines, emptyLine])}>
          + Add item
        </Button>
        {hasInvoiceItems(lines) && (
          <p className="line-total" aria-live="polite">
            <strong>
              {totals.complete ? 'Total' : 'Total so far'} {formatMoney(totals.total.toFixed(2))}
            </strong>{' '}
            <span>
              (time {formatMoney(totals.time.toFixed(2))} · expenses and other {formatMoney(totals.other.toFixed(2))})
            </span>
            {!totals.complete && <span className="line-amount-missing"> Some time can't be priced yet.</span>}
          </p>
        )}
      </div>
    </div>
  );
}
