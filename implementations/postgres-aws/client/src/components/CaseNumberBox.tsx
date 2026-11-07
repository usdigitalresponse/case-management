// An invoice's typed case number, saved on blur or Enter, with its county below.
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
}: {
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
  return (
    <section className={`case-number-box${missing ? ' case-number-box--missing' : ''}`} aria-labelledby={`${id}-label`}>
      <div className="case-number-box__field">
        <label id={`${id}-label`} className="usa-label" htmlFor={id}>{label}</label>
        <input
          id={id}
          className="usa-input"
          placeholder={placeholder}
          value={value}
          readOnly={readOnly}
          aria-describedby={`${id}-hint`}
          aria-invalid={missing || undefined}
          onChange={(event) => onChange(event.target.value)}
          onFocus={onFocus}
          onBlur={onSave}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onSave();
          }}
        />
        <p id={`${id}-hint`} className={error || missing ? 'field-error' : 'field-hint'}>{error ?? hint}</p>
        {county}
      </div>
      {children && <div className="case-number-box__why">{children}</div>}
    </section>
  );
}
