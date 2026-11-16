export interface UploadCaseNumber {
  value: string;
  // Edited by hand, so a file's number no longer fills it.
  edited: boolean;
}

// Staff filing an invoice give its case number; one not for a case is left blank
// and answered in the case step (model/rules.yaml match_invoice_to_case).
export function CaseNumberField({
  value,
  onChange,
}: {
  value: UploadCaseNumber;
  onChange: (value: UploadCaseNumber) => void;
}) {
  return (
    <div className="upload-details__field">
      <label className="usa-label" htmlFor="upload-case-number">
        Case number
      </label>
      <input
        id="upload-case-number"
        className="usa-input"
        value={value.value}
        aria-describedby="upload-case-number-hint"
        onChange={(event) => onChange({ value: event.target.value, edited: true })}
      />
      <p id="upload-case-number-hint" className="field-hint">
        As written on the invoice. Leave it blank if it isn’t for one case.
      </p>
    </div>
  );
}
