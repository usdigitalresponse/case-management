import type { Ref } from 'react';

export interface UploadCaseNumber {
  value: string;
  // Edited by hand, so a file's number no longer fills it.
  edited: boolean;
  notForCase: boolean;
}

// Staff filing an invoice give its case number, or say it isn't for one case
// (design K60, K68; model/rules.yaml match_invoice_to_case).
export function CaseNumberField({
  value,
  onChange,
  error,
  inputRef,
}: {
  value: UploadCaseNumber;
  onChange: (value: UploadCaseNumber) => void;
  error?: string;
  inputRef: Ref<HTMLInputElement>;
}) {
  return (
    <div className="upload-details__field">
      <label className="usa-label" htmlFor="upload-case-number">
        Case number
      </label>
      <input
        id="upload-case-number"
        ref={inputRef}
        className="usa-input"
        value={value.notForCase ? '' : value.value}
        disabled={value.notForCase}
        aria-describedby="upload-case-number-hint"
        aria-invalid={Boolean(error) || undefined}
        onChange={(event) => onChange({ ...value, value: event.target.value, edited: true })}
      />
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <p id="upload-case-number-hint" className="field-hint">
        Type it as it is written on the invoice.
      </p>
      <label className="checkbox-row">
        <input type="checkbox" checked={value.notForCase} onChange={(event) => onChange({ ...value, notForCase: event.target.checked })} />
        <span>Not for one case, such as court observation</span>
      </label>
    </div>
  );
}
