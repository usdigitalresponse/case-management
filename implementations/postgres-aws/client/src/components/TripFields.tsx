import { Checkbox, Label, TextInput } from '@trussworks/react-uswds';
import { formatMoney, formatRate } from '../formatMoney';
import type { LineDraft, TravelCost, mileageItemPreview } from './InvoiceLinesEditor';

// A trip's route, miles and other costs, and with `withHours` its travel
// hours: the invoice editor's Travel row and Check the lines' added trip.
export function TripFields({
  idPrefix,
  line,
  mileagePreview,
  withHours = false,
  onChange,
}: {
  idPrefix: string;
  line: LineDraft;
  mileagePreview?: ReturnType<typeof mileageItemPreview>;
  withHours?: boolean;
  onChange: (changes: Partial<LineDraft>) => void;
}) {
  const id = (field: string) => `${idPrefix}-${field}`;
  const updateCost = (costIndex: number, changes: Partial<TravelCost>) =>
    onChange({ travelCosts: line.travelCosts.map((cost, i) => (i === costIndex ? { ...cost, ...changes } : cost)) });

  return (
    <div className="line-trip">
      <div className="usa-form-group">
        <Label htmlFor={id('trip-from')}>From</Label>
        <TextInput
          id={id('trip-from')}
          name={id('trip-from')}
          type="text"
          placeholder="Address or place"
          value={line.tripOrigin}
          onChange={(event) => onChange({ tripOrigin: event.target.value })}
        />
      </div>
      <div className="usa-form-group">
        <Label htmlFor={id('trip-to')}>To</Label>
        <TextInput
          id={id('trip-to')}
          name={id('trip-to')}
          type="text"
          placeholder="Address or place"
          value={line.tripDestination}
          onChange={(event) => onChange({ tripDestination: event.target.value })}
        />
      </div>
      <Checkbox
        id={id('round-trip')}
        name={id('round-trip')}
        label="Round trip"
        checked={line.roundTrip}
        onChange={(event) => onChange({ roundTrip: event.target.checked })}
      />
      {withHours && (
        <div className="usa-form-group line-trip-part">
          <Label htmlFor={id('travel-hours')}>Travel hours</Label>
          <TextInput
            id={id('travel-hours')}
            name={id('travel-hours')}
            type="number"
            min="0"
            step="0.01"
            value={line.travelHours}
            onChange={(event) => onChange({ travelHours: event.target.value })}
          />
        </div>
      )}
      <div className="usa-form-group line-trip-part">
        <Label htmlFor={id('miles')}>Miles</Label>
        <TextInput
          id={id('miles')}
          name={id('miles')}
          type="number"
          min="0"
          step="0.1"
          placeholder="Whole trip"
          value={line.quantity}
          onChange={(event) => onChange({ quantity: event.target.value })}
        />
        {mileagePreview &&
          ('amount' in mileagePreview ? (
            <span className="line-amount-basis">
              at {formatRate(mileagePreview.rate)}/mi = {formatMoney(mileagePreview.amount)}
            </span>
          ) : (
            <span className="line-amount-missing">{mileagePreview.missing}</span>
          ))}
      </div>
      {line.travelCosts.map((cost, costIndex) => (
        <div key={costIndex} className="line-trip-cost">
          <div className="usa-form-group">
            <Label htmlFor={id(`cost-${costIndex}`)}>Travel expense</Label>
            <TextInput
              id={id(`cost-${costIndex}`)}
              name={id(`cost-${costIndex}`)}
              type="text"
              placeholder="Parking, tolls, fare or lodging"
              value={cost.description}
              onChange={(event) => updateCost(costIndex, { description: event.target.value })}
            />
          </div>
          <div className="usa-form-group">
            <Label htmlFor={id(`cost-amount-${costIndex}`)}>Amount</Label>
            <TextInput
              id={id(`cost-amount-${costIndex}`)}
              name={id(`cost-amount-${costIndex}`)}
              type="number"
              min="0.01"
              step="0.01"
              value={cost.amount}
              onChange={(event) => updateCost(costIndex, { amount: event.target.value })}
            />
          </div>
          <button
            type="button"
            className="line-remove"
            aria-label={`Remove travel expense ${costIndex + 1}`}
            title="Remove travel expense"
            onClick={() => onChange({ travelCosts: line.travelCosts.filter((_, i) => i !== costIndex) })}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="link-button line-trip-add"
        onClick={() => onChange({ travelCosts: [...line.travelCosts, { description: '', amount: '', carried: {} }] })}
      >
        + Add a travel expense
      </button>
      <p className="line-trip-note">Travel time, miles and each travel expense are billed and reviewed as separate items.</p>
    </div>
  );
}
