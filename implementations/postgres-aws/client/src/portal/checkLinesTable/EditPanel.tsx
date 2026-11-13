import { useState } from 'react';
import type { FileLine } from '../../api/client';
import { isTimeKind, mileageItemPreview, tripParts, type DraftKind, type LineDraft } from '../../invoiceLines';
import { TripFields } from '../../components/TripFields';
import { changedFields, changeSentence } from '../../fileChanges';
import { formatMoney, formatRate } from '../../formatMoney';
import { formatQuantity } from '../../invoiceLineDisplay';
import { priceOf, valuesOf, type PricingContext } from '../checkLines';
import { Button } from '../../components/ui/Button';

// Keeps what is typed, such as "12.", while the line holds a number.
export function RateInput({
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

export function EditPanel({
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
          Read from {ownFile ? 'your' : 'the'} file:{' '}
          {formatQuantity(read.lineType === 'time' ? 'time' : read.lineType === 'mileage' ? 'mileage' : 'other', read.quantity)}
          {read.amount !== null ? `, ${formatMoney(read.amount)}` : ''}.
          {fields.length > 0 ? ` ${changeSentence(read, valuesOf(draft), fields).replace('You changed', 'You are changing')}` : ''} No reason needed.
        </p>
      )}
      {draft.lineType === 'mileage' && (
        <p className="field-hint">Mileage is paid at the rate per mile set for its date.</p>
      )}
      <div className="edit-line__actions">
        <Button
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
