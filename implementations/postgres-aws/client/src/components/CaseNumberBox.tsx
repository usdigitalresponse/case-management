// An invoice's typed case number, saved on blur or Enter, with its county below;
// inline, one field among the invoice's details (InvoiceDetailsFields), its county left to the caller
// and its explainer below the row.
import type { ReactNode } from 'react';

export function CaseNumberBox({
  id,
  label,
  value,
  readOnly,
  hint,
  error,
  missing = false,
  placeholder,
  onChange,
  onSave,
  onFocus,
  county,
  children,
  inline = false,
}: {
  inline?: boolean;
  id: string;
  label: string;
  value: string;
  readOnly: boolean;
  hint: string;
  error: string | null;
  missing?: boolean;
  placeholder?: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onFocus?: () => void;
  county?: ReactNode;
  children?: ReactNode;
}) {
  const field = (
    <>
      <label id={`${id}-label`} className="usa-label" htmlFor={id}>{label}</label>
      <input
        id={id}
        className="usa-input"
        placeholder={placeholder}
        value={value}
        readOnly={readOnly}
        aria-describedby={inline && children ? `${id}-hint ${id}-why` : `${id}-hint`}
        aria-invalid={missing || undefined}
        onChange={(event) => onChange(event.target.value)}
        onFocus={onFocus}
        onBlur={onSave}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onSave();
        }}
      />
      <p id={`${id}-hint`} className={error || missing ? 'field-error' : 'field-hint'}>{error ?? hint}</p>
    </>
  );
  if (inline) {
    return (
      <>
        <div className={`upload-details__field case-number-field${missing ? ' case-number-field--missing' : ''}`}>{field}</div>
        {/* One line across the bottom of the details, rather than lengthening this column. */}
        {children && <div id={`${id}-why`} className="case-number-field__why">{children}</div>}
      </>
    );
  }
  return (
    <section className={`card case-number-box${missing ? ' case-number-box--missing' : ''}`} aria-labelledby={`${id}-label`}>
      <div className="case-number-box__field">
        {field}
        {county}
      </div>
      {children && <div className="case-number-box__why">{children}</div>}
    </section>
  );
}
