// An invoice's lines in file order, with what the submitter changed and
// removed lines struck through; on a draft, an Edit panel under a line, or
// while staff enter it in review, its fields in the cells.
import { useRef, useState, type ReactNode } from 'react';
import type { FileLine, ImportWarning } from '../api/client';
import { emptyLine, isTimeKind, mileageItemPreview, tripParts, type DraftKind, type LineDraft } from '../invoiceLines';
import { TripFields } from '../components/TripFields';
import { changedFields, changeSentence, type Row } from '../fileChanges';
import { formatMoney, formatRate } from '../formatMoney';
import { formatLineRate, formatQuantity, lineKindLabel } from '../invoiceLineDisplay';
import { formatDay } from './portalWording';
import { priceOf, valuesOf, type PricingContext } from './checkLines';
import { Button } from '../components/ui/Button';
import { Tag } from '../components/ui/Tag';

// Each line of a trip is its own row here.
const typeLabel = (line: LineDraft) =>
  lineKindLabel(valuesOf(line).lineType, { onTrip: Boolean(line.tripKey), waiting: line.lineType === 'waiting' });

// The trip a time or expense row off a trip could join: a trip on the same
// date, and for time, one without travel time yet. Grouping is optional.
export function tripToJoin(lines: LineDraft[], line: LineDraft): string | undefined {
  if (line.tripKey || !line.serviceDate || !(line.lineType === 'time' || line.lineType === 'expense')) {
    return undefined;
  }
  return lines.find(
    (other) =>
      other.lineType === 'mileage' &&
      other.tripKey &&
      other.serviceDate === line.serviceDate &&
      (line.lineType !== 'time' || !lines.some((part) => part.tripKey === other.tripKey && part.lineType === 'time')),
  )?.tripKey;
}

// Saved on leaving the box: typing a year passes through valid dates.
function DateToEnter({ number, onEnter }: { number: number; onEnter: (date: string) => void }) {
  const [value, setValue] = useState('');
  // Enter then leaving the box would save twice.
  const saved = useRef(false);
  const enter = () => {
    if (value && !saved.current) {
      saved.current = true;
      onEnter(value);
    }
  };
  return (
    <input
      className="usa-input check-lines__date"
      type="date"
      aria-label={`Line ${number} date`}
      required
      aria-invalid="true"
      value={value}
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => setValue(event.target.value)}
      onBlur={enter}
      onKeyDown={(event) => event.key === 'Enter' && enter()}
    />
  );
}

// Keeps what is typed, such as "12.", while the line holds a number.
function RateInput({
  id,
  className = 'usa-input check-lines__input',
  label,
  placeholder,
  value,
  onChange,
}: {
  id?: string;
  className?: string;
  // Without a <label> of its own.
  label?: string;
  placeholder: string;
  value: number | undefined;
  onChange: (rate: number | undefined) => void;
}) {
  const [text, setText] = useState(value === undefined ? '' : String(value));
  const shown = Number(text) === value || (text === '' && value === undefined) ? text : value === undefined ? '' : String(value);
  return (
    <input
      id={id}
      className={className}
      inputMode="decimal"
      aria-label={label}
      placeholder={placeholder}
      value={shown}
      onChange={(event) => {
        const rate = Number(event.target.value);
        setText(event.target.value);
        onChange(event.target.value === '' || !(rate >= 0) ? undefined : rate);
      }}
    />
  );
}

function EditPanel({
  number,
  initial,
  read,
  context,
  isNew,
  onSave,
  onCancel,
  onRemove,
  ownFile = true,
}: {
  number: number;
  initial: LineDraft;
  read: FileLine | undefined;
  context: PricingContext;
  isNew: boolean;
  // A trip saves as several lines.
  onSave: (drafts: LineDraft[]) => void;
  onCancel: () => void;
  onRemove?: () => void;
  ownFile?: boolean;
}) {
  const [draft, setDraft] = useState(initial);
  const set = (patch: Partial<LineDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const price = priceOf(draft, context);
  const id = (field: string) => `edit-line-${number}-${field}`;
  const travel = draft.lineType === 'travel';
  const timed = isTimeKind(draft.lineType);
  const priced = timed || draft.lineType === 'mileage';
  const fields = read ? changedFields(read, valuesOf(draft)) : [];

  return (
    <div className="edit-line" role="group" aria-labelledby={id('heading')}>
      <h3 id={id('heading')}>{isNew ? (travel ? 'Add a trip' : 'Add a line') : `Change line ${number}`}</h3>
      <div className="edit-line__fields">
        {isNew && (
          <div className="edit-line__field">
            <label className="usa-label" htmlFor={id('type')}>Kind</label>
            <select
              id={id('type')}
              className="usa-select"
              value={draft.lineType}
              onChange={(event) => set({ lineType: event.target.value as DraftKind })}
            >
              <option value="time">Time</option>
              <option value="waiting">Waiting time</option>
              <option value="travel">Travel</option>
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
            onChange={(event) => set({ serviceDate: event.target.value })}
          />
        </div>
        {travel ? null : priced ? (
          <>
            <div className="edit-line__field edit-line__field--short">
              <label className="usa-label" htmlFor={id('quantity')}>{timed ? 'Hours' : 'Miles'}</label>
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
              <label className="usa-label" htmlFor={id('rate')}>{timed ? 'Rate per hour' : 'Rate per mile'}</label>
              {timed ? (
                <RateInput
                  id={id('rate')}
                  className="usa-input"
                  placeholder={price.rate ?? ''}
                  value={draft.carried.unitRate}
                  onChange={(unitRate) => set({ carried: { ...draft.carried, unitRate } })}
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
      {travel && (
        <TripFields
          idPrefix={id('trip')}
          line={draft}
          withHours
          mileagePreview={Number(draft.quantity) > 0 ? mileageItemPreview(draft, context.mileageRates) : undefined}
          onChange={set}
        />
      )}
      {read && (
        <p className="field-hint">
          We read {formatQuantity(read.lineType === 'time' ? 'time' : read.lineType === 'mileage' ? 'mileage' : 'other', read.quantity)}
          {read.amount !== null ? `, ${formatMoney(read.amount)},` : ''} from {ownFile ? 'your' : 'the'} file.
          {fields.length > 0 ? ` ${changeSentence(read, valuesOf(draft), fields).replace('You changed', 'You are changing')}` : ''} No reason needed.
        </p>
      )}
      {draft.lineType === 'mileage' && (
        <p className="field-hint">Mileage is paid at the rate per mile set for its date.</p>
      )}
      <div className="edit-line__actions">
        <Button
          type="button"
          kind="primary"
          disabled={price.total === null}
          onClick={() => onSave(travel ? tripParts(draft, `new-${Date.now()}`) : [draft])}
        >
          {isNew ? (travel ? 'Add trip' : 'Add line') : 'Save line'}
        </Button>
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
  editable: boolean;
  focus: string | undefined;
  onFocus: (location: string | undefined) => void;
  onSaveLine: (index: number | null, drafts: LineDraft[], number: number) => void;
  onRemoveLine: (index: number, number: number) => void;
  onPutBack: (read: FileLine, number: number) => void;
  onUndoChange: (index: number, read: FileLine, number: number) => void;
  // Puts a time or expense line on a trip, or with undefined takes it off.
  onTrip: (index: number, tripKey: string | undefined, number: number) => void;
  // Read-only extras, such as a decision, by line index.
  extra?: (index: number) => ReactNode;
  // A full-width row under a line, such as the billing office's questions.
  detail?: (index: number) => ReactNode;
  footer: ReactNode;
  // An invoice entered by hand has no file to have missed lines from.
  addLabel?: string;
  // Given, lines are edited in their cells and kept unsaved until the next action.
  onEditLine?: (index: number, patch: Partial<LineDraft>) => void;
  // Changed in place and not saved yet.
  edited?: (index: number) => boolean;
  // Shown with a line's description, such as its questions.
  notes?: (index: number) => ReactNode;
  // A bar under the description, such as asking about the line and
  // deciding it; given, it takes the place of `extra`.
  actions?: (index: number) => ReactNode;
  // False for staff entering someone else's invoice.
  ownFile?: boolean;
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
  onTrip,
  extra,
  detail,
  footer,
  addLabel = 'Add a line we missed',
  onEditLine,
  edited,
  ownFile = true,
  notes,
  actions,
}: CheckLinesTableProps) {
  const inPlace = Boolean(onEditLine) && editable;
  const allLines = rows.flatMap((row) => (row.kind === 'line' ? [row.line] : []));
  const numberOf = (tripKey: string) => rows.find((row) => row.kind === 'line' && row.line.tripKey === tripKey && row.line.lineType === 'mileage')?.number;
  // The row number being edited, or 'new' for an added line; an empty
  // invoice opens on adding its first line.
  const [editing, setEditing] = useState<number | 'new' | null>(() => (editable && rows.length === 0 ? 'new' : null));
  // Edited in place, a line's actions are in its bar, not a last column.
  const columns = inPlace ? 6 : 7;

  return (
    <div className="card check-lines">
      <table className="check-lines__table">
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Date</th>
            <th scope="col">Kind</th>
            <th scope="col" className="amount">Qty</th>
            <th scope="col" className="amount">Rate</th>
            <th scope="col" className="amount">Amount</th>
            {!inPlace && <th scope="col"><span className="usa-sr-only">{extra && !actions ? 'Decision' : 'Actions'}</span></th>}
          </tr>
        </thead>
        {rows.length === 0 && editing !== 'new' && (
          <tbody>
            <tr>
              <td colSpan={columns} className="check-lines__empty">No lines yet.</td>
            </tr>
          </tbody>
        )}
        {rows.map((row) => {
          if (row.kind === 'removed') {
            const { read } = row;
            const lineType = read.lineType === 'time' ? 'time' : read.lineType === 'mileage' ? 'mileage' : 'other';
            return (
              <tbody key={`removed-${read.location}`} className="check-lines__row check-lines__row--removed">
                <tr className="check-lines__summary">
                  <td>{row.number}</td>
                  <td><s>{formatDay(read.serviceDate)}</s></td>
                  <td>
                    {lineKindLabel(lineType)} <Tag tone="neutral">Removed</Tag>
                  </td>
                  <td className="amount">{formatQuantity(lineType, read.quantity)}</td>
                  <td className="amount">{formatLineRate(lineType, read.unitRate)}</td>
                  <td className="amount"><s>{formatMoney(read.amount)}</s></td>
                  {!inPlace && (
                    <td className="check-lines__actions">
                      {editable && (
                        <button type="button" className="link-button" onClick={() => onPutBack(read, row.number)}>
                          Put it back
                        </button>
                      )}
                    </td>
                  )}
                </tr>
                <tr className="check-lines__what">
                  <td />
                  <td colSpan={columns - 1}>
                    <s>{read.description ?? '—'}</s>
                    {inPlace && (
                      <span className="cell-note">
                        <button type="button" className="link-button" onClick={() => onPutBack(read, row.number)}>
                          Put it back
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              </tbody>
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
          const joinable = editable ? tripToJoin(allLines, line) : undefined;
          const lineDetail = detail?.(index);
          return (
            <tbody
              key={`line-${index}-${location ?? 'added'}`}
              className={[
                'check-lines__row',
                isEditing ? 'check-lines__row--editing' : '',
                flagged ? 'check-lines__row--flagged' : '',
                focus && focus === location ? 'check-lines__row--focus' : '',
              ].join(' ')}
              onClick={() => onFocus(location)}
            >
              <tr className="check-lines__summary">
                <td>{number}</td>
                <td>
                  {inPlace ? (
                    <input
                      className="usa-input check-lines__input check-lines__date"
                      type="date"
                      aria-label={`Line ${number} date`}
                      aria-invalid={!line.serviceDate || undefined}
                      value={line.serviceDate}
                      onChange={(event) => onEditLine!(index, { serviceDate: event.target.value })}
                    />
                  ) : editable && !line.serviceDate && !isEditing ? (
                    <DateToEnter number={number} onEnter={(serviceDate) => onSaveLine(index, [{ ...line, serviceDate }], number)} />
                  ) : (
                    formatDay(line.serviceDate || null)
                  )}
                </td>
                <td>
                  {typeLabel(line)}
                  {flagged && <Tag tone="warning">Check this</Tag>}
                </td>
                <td className="amount">
                  {inPlace && (isTimeKind(line.lineType) || line.lineType === 'mileage') ? (
                    <input
                      className="usa-input check-lines__input"
                      inputMode="decimal"
                      aria-label={`Line ${number} ${line.lineType === 'mileage' ? 'miles' : 'hours'}`}
                      value={line.quantity}
                      onChange={(event) => onEditLine!(index, { quantity: event.target.value })}
                    />
                  ) : (
                    formatQuantity(values.lineType, values.quantity)
                  )}
                  {read && fields.includes('quantity') && <span className="cell-note">was {read.quantity ?? 0}</span>}
                </td>
                <td className="amount">
                  {inPlace && isTimeKind(line.lineType) ? (
                    <RateInput
                      label={`Line ${number} rate per hour`}
                      placeholder={price.rate ?? ''}
                      value={line.carried.unitRate}
                      onChange={(unitRate) => onEditLine!(index, { carried: { ...line.carried, unitRate } })}
                    />
                  ) : (
                    formatLineRate(values.lineType, price.rate || null)
                  )}
                </td>
                <td className="amount">
                  {inPlace && (line.lineType === 'expense' || line.lineType === 'other') ? (
                    <input
                      className="usa-input check-lines__input"
                      inputMode="decimal"
                      aria-label={`Line ${number} amount`}
                      aria-invalid={price.total === null || undefined}
                      value={line.amount}
                      onChange={(event) => onEditLine!(index, { amount: event.target.value })}
                    />
                  ) : (
                    <strong>{price.total === null ? '—' : formatMoney(price.total)}</strong>
                  )}
                </td>
                {!inPlace && (
                  <td
                    className={`check-lines__actions${extra && !actions ? ' check-lines__actions--decide' : ''}`}
                    onClick={(event) => event.stopPropagation()}
                  >
                    {!actions && extra?.(index)}
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
                )}
              </tr>
              <tr className="check-lines__what">
                <td />
                <td colSpan={columns - 1}>
                  {inPlace ? (
                    <>
                      <textarea
                        className="usa-textarea check-lines__input check-lines__description"
                        rows={2}
                        aria-label={`Line ${number} what was done`}
                        placeholder="What was done"
                        value={line.description}
                        onChange={(event) => onEditLine!(index, { description: event.target.value })}
                      />
                      {line.lineType === 'mileage' && line.tripKey && (
                        <div className="check-lines__route">
                          <input
                            className="usa-input check-lines__input"
                            aria-label={`Line ${number} from`}
                            placeholder="From"
                            value={line.tripOrigin}
                            onChange={(event) => onEditLine!(index, { tripOrigin: event.target.value })}
                          />
                          <input
                            className="usa-input check-lines__input"
                            aria-label={`Line ${number} to`}
                            placeholder="To"
                            value={line.tripDestination}
                            onChange={(event) => onEditLine!(index, { tripDestination: event.target.value })}
                          />
                          <label className="check-lines__round-trip">
                            <input
                              type="checkbox"
                              checked={line.roundTrip}
                              onChange={(event) => onEditLine!(index, { roundTrip: event.target.checked })}
                            />{' '}
                            Round trip
                          </label>
                        </div>
                      )}
                      {edited?.(index) && (
                        <span className="cell-note check-lines__unsaved">
                          {price.total === null
                            ? `${price.missing ?? 'Finish this line'} before you go on.`
                            : actions
                              ? 'Saved when you decide this line or finish.'
                              : 'Saved when you send it or save it for later.'}
                        </span>
                      )}
                    </>
                  ) : (
                    line.description || '—'
                  )}
                  {flagged &&
                    lineWarnings.map((warning) => (
                      <span key={warning.code} className="cell-note check-lines__warning">{warning.message}</span>
                    ))}
                  {read && fields.length > 0 && <span className="cell-note check-lines__changed">{changeSentence(read, values, fields)}</span>}
                  {!read && addLabel !== 'Add a line' && <span className="cell-note check-lines__changed">You added this line.</span>}
                  {duplicate && <span className="cell-note">Same date, text and amount as line {duplicate}. Is it a duplicate?</span>}
                  {joinable && (
                    <span className="cell-note" onClick={(event) => event.stopPropagation()}>
                      Mileage on line {numberOf(joinable)} is the same day.{' '}
                      <button type="button" className="link-button" onClick={() => onTrip(index, joinable, number)}>
                        Add to that trip
                      </button>
                    </span>
                  )}
                  {editable && line.tripKey && line.lineType !== 'mileage' && (
                    <span className="cell-note" onClick={(event) => event.stopPropagation()}>
                      <button type="button" className="link-button" onClick={() => onTrip(index, undefined, number)}>
                        Take off the trip
                      </button>
                    </span>
                  )}
                  {notes && <div onClick={(event) => event.stopPropagation()}>{notes(index)}</div>}
                </td>
              </tr>
              {(actions || inPlace) && !isEditing && (
                <tr className="check-lines__bar" onClick={(event) => event.stopPropagation()}>
                  <td />
                  <td colSpan={columns - 1}>
                    <div className="line-bar">
                      {inPlace && (
                        <span className="line-bar__line">
                          {read && fields.length > 0 && (
                            <button type="button" className="link-button" onClick={() => onUndoChange(index, read, number)}>
                              Put it back as read
                            </button>
                          )}
                          <button type="button" className="link-button link-button--danger" onClick={() => onRemoveLine(index, number)}>
                            Remove
                          </button>
                        </span>
                      )}
                      {actions?.(index)}
                    </div>
                  </td>
                </tr>
              )}
              {isEditing && (
                <tr className="check-lines__edit-row" onClick={(event) => event.stopPropagation()}>
                  <td colSpan={columns}>
                    <EditPanel
                      number={number}
                      initial={line}
                      read={read}
                      context={context}
                      isNew={false}
                      onSave={(drafts) => {
                        setEditing(null);
                        onSaveLine(index, drafts, number);
                      }}
                      onCancel={() => setEditing(null)}
                      onRemove={() => {
                        setEditing(null);
                        onRemoveLine(index, number);
                      }}
                      ownFile={ownFile}
                    />
                  </td>
                </tr>
              )}
              {lineDetail && (
                <tr className="check-lines__detail-row" onClick={(event) => event.stopPropagation()}>
                  <td colSpan={columns}>{lineDetail}</td>
                </tr>
              )}
            </tbody>
          );
        })}
        {editing === 'new' && (
          <tbody>
            <tr className="check-lines__edit-row">
              <td colSpan={columns}>
                <EditPanel
                  number={rows.length + 1}
                  initial={{ ...emptyLine, timekeeperProfessionalId: context.billedProfessionalId ?? '' }}
                  read={undefined}
                  context={context}
                  isNew
                  onSave={(drafts) => {
                    setEditing(null);
                    onSaveLine(null, drafts, rows.length + 1);
                  }}
                  onCancel={() => setEditing(null)}
                />
              </td>
            </tr>
          </tbody>
        )}
      </table>
      <div className="check-lines__footer">
        {editable && editing !== 'new' ? (
          <button type="button" className="link-button check-lines__add" onClick={() => setEditing('new')}>
            <span aria-hidden="true">+ </span>{addLabel}
          </button>
        ) : (
          <span />
        )}
        {footer}
      </div>
    </div>
  );
}
