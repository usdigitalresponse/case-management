import type { ReactNode } from 'react';

export const ADD_NEW = 'add-new';

export interface PickOption {
  value: string;
  label: string;
}

// Every case and person picker: its first option adds one that isn't
// listed, and choosing it shows the new entry's fields (children) beneath.
// Leaving it on the placeholder never blocks the next step.
export function PickOrAdd({
  id,
  label,
  ariaLabel,
  value,
  onChange,
  addLabel,
  placeholder,
  options,
  hint,
  error,
  disabled,
  children,
}: {
  id: string;
  label?: string;
  ariaLabel?: string;
  value: string;
  onChange: (value: string) => void;
  addLabel: string;
  placeholder: string;
  options: PickOption[];
  hint?: ReactNode;
  error?: string;
  disabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="pick-or-add">
      {label && (
        <label className="usa-label" htmlFor={id}>
          {label}
        </label>
      )}
      <select
        id={id}
        className="usa-select"
        value={value}
        disabled={disabled}
        aria-label={label ? undefined : ariaLabel}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value={ADD_NEW}>{addLabel}</option>
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error && <p className="field-error">{error}</p>}
      {hint && (
        <p id={`${id}-hint`} className="field-hint">
          {hint}
        </p>
      )}
      {value === ADD_NEW && children && <div className="new-entry">{children}</div>}
    </div>
  );
}
