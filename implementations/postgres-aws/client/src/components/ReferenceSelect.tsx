import { ErrorMessage, FormGroup, Label, Select } from '@trussworks/react-uswds';

// Label + select + reference-data options, shared by NewCaseIntake's
// reference-data fields. Call sites normalize their options to
// `{ id, label }[]` (a one-line `.map()`), keeping this component itself
// free of any reference-data-specific typing.
export interface ReferenceSelectOption {
  id: string;
  label: string;
}

export function ReferenceSelect({
  id,
  label,
  value,
  onChange,
  options,
  placeholder = 'None',
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: ReferenceSelectOption[];
  placeholder?: string;
  error?: string;
}) {
  return (
    <FormGroup error={Boolean(error)}>
      <Label htmlFor={id}>{label}</Label>
      {error && <ErrorMessage>{error}</ErrorMessage>}
      <Select id={id} name={id} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </Select>
    </FormGroup>
  );
}
