export function UploadPeriodField({
  start,
  end,
  error,
  hint,
  onChange,
}: {
  start: string;
  end: string;
  error?: string;
  hint: string;
  onChange: (period: { periodStart: string; periodEnd: string }) => void;
}) {
  return (
    <div className="upload-details__field">
      <span className="usa-label" id="upload-period-label">Billing period</span>
      <div className="upload-period" role="group" aria-labelledby="upload-period-label">
        <input
          className="usa-input"
          type="date"
          aria-label="First day"
          value={start}
          onChange={(event) => onChange({ periodStart: event.target.value, periodEnd: end })}
        />
        <span>to</span>
        <input
          className="usa-input"
          type="date"
          aria-label="Last day"
          min={start || undefined}
          value={end}
          onChange={(event) => onChange({ periodStart: start, periodEnd: event.target.value })}
        />
      </div>
      {error && <p className="field-error">{error}</p>}
      <p className="field-hint">{hint}</p>
    </div>
  );
}

export function InvoiceNumberField({
  label,
  value,
  error,
  hint,
  onChange,
  onSave,
}: {
  label: string;
  value: string;
  error?: string;
  hint: string;
  onChange: (value: string) => void;
  // On blur or Enter.
  onSave?: () => void;
}) {
  return (
    <div className="upload-details__field">
      <label className="usa-label" htmlFor="upload-invoice-number">{label}</label>
      <input
        id="upload-invoice-number"
        className="usa-input"
        value={value}
        aria-describedby="upload-invoice-number-hint"
        onChange={(event) => onChange(event.target.value)}
        onBlur={onSave}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onSave?.();
        }}
      />
      {error && <p className="field-error">{error}</p>}
      <p id="upload-invoice-number-hint" className="field-hint">{hint}</p>
    </div>
  );
}
