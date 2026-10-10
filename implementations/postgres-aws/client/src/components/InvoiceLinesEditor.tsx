import { Button, Checkbox, Label, Select, TextInput } from '@trussworks/react-uswds';
import type { BillableProfessional, CreateInvoiceLineInput, InvoiceLineType, PortalInvoiceLine } from '../api/client';

// Raw input strings until saved.
export interface LineDraft {
  lineType: InvoiceLineType;
  serviceDate: string;
  description: string;
  quantity: string;
  amount: string;
  // Empty: the billed professional, or on import review, not chosen yet.
  timekeeperProfessionalId: string;
  sourceTimeEntryId: string;
  invoiceLineId?: string;
  // Pre-selected on import and not yet checked.
  suggestedTimekeeper?: boolean;
  // Values the editor doesn't show, saved back so edits never drop them.
  carried: Pick<CreateInvoiceLineInput, 'unitRate' | 'timekeeperLabel' | 'taskCode' | 'activityCode' | 'expenseCode'>;
}

export const emptyLine: LineDraft = {
  lineType: 'other',
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

// An item with an amount; save and submit stay disabled until there is one.
export function hasInvoiceItems(drafts: LineDraft[]): boolean {
  return linesFromDrafts(drafts).length > 0;
}

// Rows without a positive amount are dropped; the server validates the rest.
export function linesFromDrafts(drafts: LineDraft[]): CreateInvoiceLineInput[] {
  return drafts
    .filter((draft) => Number(draft.amount) > 0)
    .map((draft) => ({
      ...draft.carried,
      lineType: draft.lineType,
      amount: Number(draft.amount),
      serviceDate: draft.serviceDate || undefined,
      description: draft.description.trim() || undefined,
      quantity: Number(draft.quantity) > 0 ? Number(draft.quantity) : undefined,
      timekeeperProfessionalId: draft.timekeeperProfessionalId || undefined,
      sourceTimeEntryId: draft.sourceTimeEntryId || undefined,
    }));
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
// column; importReview adds type, notes and duplicate-time links.
export function InvoiceLinesEditor({
  idPrefix,
  lines,
  onChange,
  timekeepers = [],
  importReview,
}: {
  idPrefix: string;
  lines: LineDraft[];
  onChange: (lines: LineDraft[]) => void;
  timekeepers?: BillableProfessional[];
  importReview?: { duplicateTime: DuplicateTimeSuggestion[]; sourceLocations?: string[] };
}) {
  const showType = Boolean(importReview);
  const showTimekeeper = timekeepers.length > 1 || Boolean(importReview);
  const columns = [
    ...(showType ? [['Type', 'minmax(5.5rem, 6.5rem)']] : []),
    ['Date', 'minmax(8.5rem, 9.5rem)'],
    ['Description', 'minmax(6rem, 1fr)'],
    ...(showTimekeeper ? [['Work done by', 'minmax(7rem, 12rem)']] : []),
    ['Hours', 'minmax(4rem, 5rem)'],
    ['Amount ($)', 'minmax(5rem, 6.5rem)'],
    ['', '1.75rem'],
  ];
  const gridTemplateColumns = columns.map(([, width]) => width).join(' ');

  function update(index: number, changes: Partial<LineDraft>) {
    onChange(lines.map((line, i) => (i === index ? { ...line, ...changes } : line)));
  }

  return (
    <div className="line-editor">
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
        return (
          <div key={index} className="line-row inline-fields" style={{ gridTemplateColumns }} role="group" aria-label={item}>
            {showType && (
              <div className="usa-form-group">
                <Label htmlFor={id('type')} className="line-label">{`${item} type`}</Label>
                <Select
                  id={id('type')}
                  name={id('type')}
                  value={line.lineType}
                  onChange={(event) => update(index, { lineType: event.target.value as InvoiceLineType })}
                >
                  <option value="time">Time</option>
                  <option value="expense">Expense</option>
                  <option value="other">Other</option>
                </Select>
              </div>
            )}
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
            {lines.length > 1 ? (
              <button
                type="button"
                className="line-remove"
                aria-label={`Remove ${item.toLowerCase()}`}
                title="Remove item"
                onClick={() => onChange(lines.filter((_, i) => i !== index))}
              >
                ×
              </button>
            ) : (
              <span />
            )}
            {importReview && (
              <p className="line-row-note">
                {importReview.sourceLocations?.[index] && line.invoiceLineId ? (
                  <span>
                    In the original: <SourceLocation location={importReview.sourceLocations[index]!} />
                  </span>
                ) : null}
                {line.carried.timekeeperLabel ? <span>On file: {line.carried.timekeeperLabel}</span> : null}
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
      <Button type="button" unstyled className="line-add" onClick={() => onChange([...lines, emptyLine])}>
        + Add item
      </Button>
    </div>
  );
}
