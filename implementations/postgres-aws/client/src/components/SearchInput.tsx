import { useRef, type JSX } from 'react';

// A text input with a ✕ clear button, shown whenever there's text. Shares
// its .clearable styling with TypeAheadPicker's field. Clearing empties
// the value and puts focus back in the input.
export function SearchInput({
  value,
  onChange,
  onClear,
  ...inputProps
}: Omit<JSX.IntrinsicElements['input'], 'value' | 'onChange' | 'type'> & {
  value: string;
  onChange: (value: string) => void;
  onClear?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="clearable">
      <input
        {...inputProps}
        ref={inputRef}
        type="text"
        className="usa-input clearable__input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {value && (
        <button
          type="button"
          className="clearable__clear"
          aria-label="Clear"
          onClick={() => {
            onChange('');
            onClear?.();
            inputRef.current?.focus();
          }}
        >
          ✕
        </button>
      )}
    </div>
  );
}
