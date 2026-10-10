import { FormGroup, Label } from '@trussworks/react-uswds';

export function PeriodFields({
  idPrefix,
  start,
  end,
  onChange,
}: {
  idPrefix: string;
  start: string;
  end: string;
  onChange: (period: { start: string; end: string }) => void;
}) {
  return (
    <div className="inline-fields period-fields">
      <FormGroup>
        <Label htmlFor={`${idPrefix}-period-start`}>Billing period start (optional)</Label>
        <input
          id={`${idPrefix}-period-start`}
          type="date"
          className="usa-input"
          value={start}
          onChange={(event) => onChange({ start: event.target.value, end })}
        />
      </FormGroup>
      <FormGroup>
        <Label htmlFor={`${idPrefix}-period-end`}>End</Label>
        <input
          id={`${idPrefix}-period-end`}
          type="date"
          className="usa-input"
          min={start || undefined}
          value={end}
          onChange={(event) => onChange({ start, end: event.target.value })}
        />
      </FormGroup>
    </div>
  );
}
