import type { ReactNode } from 'react';
import { TypeAheadPicker } from './TypeAheadPicker';

export const ADD_NEW = 'add-new';

export interface PickOption {
  value: string;
  label: string;
}

// Every case and person picker: its first option adds one that isn't
// listed, and choosing it shows the new entry's fields (children) beneath.
// Leaving it on the placeholder never blocks the next step. With `search`
// (a list too long to load, such as cases), it is typed into and searched.
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
  search,
  selectedLabel,
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
  // Replaces options: those matching what was typed.
  search?: (query: string) => Promise<PickOption[]>;
  // With search: the label of a value chosen before it opened.
  selectedLabel?: string;
  children?: ReactNode;
}) {
  if (search) {
    return (
      <div className="pick-or-add">
        {label && (
          <label className="usa-label" id={`${id}-label`} htmlFor={id}>
            {label}
          </label>
        )}
        <TypeAheadPicker<string>
          id={id}
          placeholder={placeholder}
          search={(query) => search(query).then((options) => options.map((option) => ({ ...option, item: option.value })))}
          onSelect={(chosen) => onChange(chosen ?? '')}
          addOption={{ label: addLabel, onAdd: () => onChange(ADD_NEW) }}
          initial={value && value !== ADD_NEW && selectedLabel ? { value, label: selectedLabel, item: value } : null}
        />
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
