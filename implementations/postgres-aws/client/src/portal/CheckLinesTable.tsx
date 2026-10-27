// The lines beside the file (F5–F7, F10): each line in file order, with what
// the submitter changed, removed lines struck through, and on a draft, an
// Edit panel like Approve part on the review side.
import { Fragment, useState, type ReactNode } from 'react';
import type { FileLine, ImportWarning, InvoiceLineType } from '../api/client';
import { emptyLine, type LineDraft } from '../components/InvoiceLinesEditor';
import { changedFields, changeSentence, formatQuantity, type Row } from '../fileChanges';
import { formatMoney, formatRate } from '../formatMoney';
import { formatDay } from './portalWording';
import { priceOf, valuesOf, type PricingContext } from './checkLines';

const TYPE_LABEL: Record<InvoiceLineType, string> = { time: 'Time', mileage: 'Mileage', expense: 'Expense', other: 'Other' };

function EditPanel({
  number,
  initial,
  read,
  context,
  isNew,
  onSave,
  onCancel,
  onRemove,
}: {
  number: number;
  initial: LineDraft;
  read: FileLine | undefined;
  context: PricingContext;
  isNew: boolean;
  onSave: (draft: LineDraft) => void;
  onCancel: () => void;
  onRemove?: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const set = (patch: Partial<LineDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const price = priceOf(draft, context);
  const id = (field: string) => `edit-line-${number}-${field}`;
  const priced = draft.lineType === 'time' || draft.lineType === 'mileage';
  const fields = read ? changedFields(read, valuesOf(draft)) : [];

  return (
    <div className="edit-line" role="group" aria-labelledby={id('heading')}>
      <h3 id={id('heading')}>{isNew ? 'Add a line' : `Change line ${number}`}</h3>
      <div className="edit-line__fields">
        {isNew && (
          <div className="edit-line__field">
            <label className="usa-label" htmlFor={id('type')}>Kind</label>
            <select
              id={id('type')}
              className="usa-select"
              value={draft.lineType}
              onChange={(event) => set({ lineType: event.target.value as InvoiceLineType })}
            >
              <option value="time">Time</option>
              <option value="mileage">Mileage</option>
              <option value="expense">Expense</option>
              <option value="other">Other</option>
            </select>
          </div>
        )}
        <div className="edit-line__field">
          <label className="usa-label" htmlFor={id('date')}>Date</label>
          <input
            id={id('date')}
            className="usa-input"
            type="date"
            value={draft.serviceDate}
            onChange={(event) => set({ serviceDate: event.target.value, carried: { ...draft.carried, serviceDateInferred: undefined } })}
          />
        </div>
        {priced ? (
          <>
            <div className="edit-line__field edit-line__field--short">
              <label className="usa-label" htmlFor={id('quantity')}>{draft.lineType === 'time' ? 'Hours' : 'Miles'}</label>
              <input
                id={id('quantity')}
                className="usa-input"
                inputMode="decimal"
                value={draft.quantity}
                autoFocus={!isNew}
                onChange={(event) => set({ quantity: event.target.value })}
              />
            </div>
            <span className="edit-line__times" aria-hidden="true">×</span>
            <div className="edit-line__field edit-line__field--short">
              <label className="usa-label" htmlFor={id('rate')}>{draft.lineType === 'time' ? 'Rate per hour' : 'Rate per mile'}</label>
              {draft.lineType === 'time' ? (
                <input
                  id={id('rate')}
                  className="usa-input"
                  inputMode="decimal"
                  placeholder={price.rate ?? ''}
                  value={draft.carried.unitRate === undefined ? '' : String(draft.carried.unitRate)}
                  onChange={(event) => {
                    const rate = Number(event.target.value);
                    set({ carried: { ...draft.carried, unitRate: event.target.value === '' || !(rate >= 0) ? undefined : rate } });
                  }}
                />
              ) : (
                <input id={id('rate')} className="usa-input" value={price.rate ? formatRate(price.rate) : '—'} readOnly aria-readonly="true" />
              )}
            </div>
          </>
        ) : (
          <div className="edit-line__field edit-line__field--short">
            <label className="usa-label" htmlFor={id('amount')}>Amount</label>
            <input
              id={id('amount')}
              className="usa-input"
              inputMode="decimal"
              value={draft.amount}
              autoFocus={!isNew}
              onChange={(event) => set({ amount: event.target.value })}
            />
          </div>
        )}
        <div className="edit-line__total" aria-live="polite">
          <span>New amount</span>
          <strong>{price.total === null ? '—' : formatMoney(price.total)}</strong>
          {price.missing && <span className="field-hint">{price.missing}</span>}
        </div>
      </div>
      <div className="edit-line__field">
        <label className="usa-label" htmlFor={id('description')}>What was done</label>
        <input
          id={id('description')}
          className="usa-input"
          value={draft.description}
          onChange={(event) => set({ description: event.target.value })}
        />
      </div>
      {read && (
        <p className="field-hint">
          We read {formatQuantity(read.lineType === 'time' ? 'time' : read.lineType === 'mileage' ? 'mileage' : 'other', read.quantity)}
          {read.amount !== null ? `, ${formatMoney(read.amount)},` : ''} from your file.
          {fields.length > 0 ? ` ${changeSentence(read, valuesOf(draft), fields).replace('You changed', 'You are changing')}` : ''} No reason needed.
        </p>
      )}
      {draft.lineType === 'mileage' && (
        <p className="field-hint">Mileage is paid at the rate per mile set for its date.</p>
      )}
      <div className="edit-line__actions">
        <button type="button" className="btn btn--primary" disabled={price.total === null} onClick={() => onSave(draft)}>
          {isNew ? 'Add line' : 'Save line'}
        </button>
        <button type="button" className="link-button" onClick={onCancel}>
          Cancel
        </button>
        {onRemove && (
          <button type="button" className="link-button link-button--danger edit-line__remove" onClick={onRemove}>
            Remove this line
          </button>
        )}
      </div>
    </div>
  );
}

export interface CheckLinesTableProps {
  rows: Array<Row<LineDraft>>;
  context: PricingContext;
  warnings: ImportWarning[];
  duplicates: Map<number, number>;
  // Off once sent: the lines are locked.
  editable: boolean;
  // The row whose place in the file is shown.
  focus: string | undefined;
  onFocus: (location: string | undefined) => void;
  onSaveLine: (index: number | null, draft: LineDraft, number: number) => void;
  onRemoveLine: (index: number, number: number) => void;
  onPutBack: (read: FileLine, number: number) => void;
  onUndoChange: (index: number, read: FileLine, number: number) => void;
  // Read-only extras, such as a decision, by line index.
  extra?: (index: number) => ReactNode;
  footer: ReactNode;
}

export function CheckLinesTable({
  rows,
  context,
  warnings,
  duplicates,
  editable,
  focus,
  onFocus,
  onSaveLine,
  onRemoveLine,
  onPutBack,
  onUndoChange,
  extra,
  footer,
}: CheckLinesTableProps) {
  // The row number being edited, or 'new' for an added line.
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const columns = 7;

  return (
    <div className="check-lines">
      <table className="check-lines__table">
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Date</th>
            <th scope="col">What was done</th>
            <th scope="col" className="amount">Qty</th>
            <th scope="col" className="amount">Rate</th>
            <th scope="col" className="amount">Amount</th>
            <th scope="col"><span className="usa-sr-only">{extra ? 'Decision' : 'Actions'}</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            if (row.kind === 'removed') {
              const { read } = row;
              const lineType = read.lineType === 'time' ? 'time' : read.lineType === 'mileage' ? 'mileage' : 'other';
              return (
                <tr key={`removed-${read.location}`} className="check-lines__row check-lines__row--removed">
                  <td>{row.number}</td>
                  <td><s>{formatDay(read.serviceDate)}</s></td>
                  <td>
                    <s>{read.description ?? '—'}</s>
                    <span className="cell-note">{TYPE_LABEL[lineType]}</span>
                    <span className="chip chip--neutral">Removed</span>
                  </td>
                  <td className="amount">{formatQuantity(lineType, read.quantity)}</td>
                  <td className="amount">{read.unitRate !== null ? formatRate(read.unitRate) : ''}</td>
                  <td className="amount"><s>{formatMoney(read.amount)}</s></td>
                  <td className="check-lines__actions">
                    {editable && (
                      <button type="button" className="link-button" onClick={() => onPutBack(read, row.number)}>
                        Put it back
                      </button>
                    )}
                  </td>
                </tr>
              );
            }
            const { line, read, index, number } = row;
            const values = valuesOf(line);
            const price = priceOf(line, context);
            const fields = read ? changedFields(read, values) : [];
            const lineWarnings = read ? warnings.filter((warning) => warning.location === read.location) : [];
            const duplicate = duplicates.get(number);
            const location = line.carried.sourceLocation;
            const isEditing = editing === number;
            const flagged = lineWarnings.length > 0 && fields.length === 0;
            return (
              <Fragment key={`line-${index}-${location ?? 'added'}`}>
                <tr
                  className={[
                    'check-lines__row',
                    isEditing ? 'check-lines__row--editing' : '',
                    flagged ? 'check-lines__row--flagged' : '',
                    focus && focus === location ? 'check-lines__row--focus' : '',
                  ].join(' ')}
                  onClick={() => onFocus(location)}
                >
                  <td>{number}</td>
                  <td>{formatDay(line.serviceDate || null)}</td>
                  <td>
                    {line.description || '—'}
                    <span className="cell-note">{TYPE_LABEL[line.lineType]}</span>
                    {flagged && (
                      <>
                        <span className="chip chip--warning">Check this</span>
                        {lineWarnings.map((warning) => (
                          <span key={warning.code} className="cell-note check-lines__warning">{warning.message}</span>
                        ))}
                      </>
                    )}
                    {read && fields.length > 0 && <span className="cell-note check-lines__changed">{changeSentence(read, values, fields)}</span>}
                    {!read && <span className="cell-note check-lines__changed">You added this line.</span>}
                    {duplicate && <span className="cell-note">Same date, text and amount as line {duplicate}. Is it a duplicate?</span>}
                  </td>
                  <td className="amount">
                    {formatQuantity(line.lineType, values.quantity)}
                    {read && fields.includes('quantity') && <span className="cell-note">was {read.quantity ?? 0}</span>}
                  </td>
                  <td className="amount">{price.rate ? formatRate(price.rate) : ''}</td>
                  <td className="amount">
                    <strong>{price.total === null ? '—' : formatMoney(price.total)}</strong>
                  </td>
                  <td className="check-lines__actions" onClick={(event) => event.stopPropagation()}>
                    {extra?.(index)}
                    {editable &&
                      (isEditing ? (
                        <span className="muted">Editing</span>
                      ) : (
                        <>
                          <button type="button" className="link-button" onClick={() => setEditing(number)}>
                            Edit
                          </button>
                          {read && fields.length > 0 ? (
                            <button type="button" className="link-button" onClick={() => onUndoChange(index, read, number)}>
                              Undo change
                            </button>
                          ) : (
                            <button type="button" className="link-button" onClick={() => onRemoveLine(index, number)}>
                              Remove
                            </button>
                          )}
                        </>
                      ))}
                  </td>
                </tr>
                {isEditing && (
                  <tr className="check-lines__edit-row">
                    <td colSpan={columns}>
                      <EditPanel
                        number={number}
                        initial={line}
                        read={read}
                        context={context}
                        isNew={false}
                        onSave={(draft) => {
                          setEditing(null);
                          onSaveLine(index, draft, number);
                        }}
                        onCancel={() => setEditing(null)}
                        onRemove={() => {
                          setEditing(null);
                          onRemoveLine(index, number);
                        }}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
          {editing === 'new' && (
            <tr className="check-lines__edit-row">
              <td colSpan={columns}>
                <EditPanel
                  number={rows.length + 1}
                  initial={{ ...emptyLine, timekeeperProfessionalId: context.billedProfessionalId ?? '' }}
                  read={undefined}
                  context={context}
                  isNew
                  onSave={(draft) => {
                    setEditing(null);
                    onSaveLine(null, draft, rows.length + 1);
                  }}
                  onCancel={() => setEditing(null)}
                />
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="check-lines__footer">
        {editable && editing !== 'new' ? (
          <button type="button" className="link-button check-lines__add" onClick={() => setEditing('new')}>
            <span aria-hidden="true">+ </span>Add a line we missed
          </button>
        ) : (
          <span />
        )}
        {footer}
      </div>
    </div>
  );
}
