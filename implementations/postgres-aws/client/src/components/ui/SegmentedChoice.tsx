// The design system's Segmented control: one of two or three short options.
export function SegmentedChoice<T extends string>({
  label,
  options,
  value,
  disabled = false,
  className,
  onChange,
}: {
  label: string;
  options: Array<{ value: T; label: string }>;
  value: T;
  disabled?: boolean;
  className?: string;
  onChange: (value: T) => void;
}) {
  return (
    <div className={className ? `segmented ${className}` : 'segmented'} role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          className={`segmented__option${option.value === value ? ' is-chosen' : ''}`}
          disabled={disabled}
          onClick={() => option.value !== value && onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
