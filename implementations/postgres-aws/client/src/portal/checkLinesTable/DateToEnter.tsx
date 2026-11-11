import { useRef, useState } from 'react';

// Saved on leaving the box: typing a year passes through valid dates.
export function DateToEnter({ number, onEnter }: { number: number; onEnter: (date: string) => void }) {
  const [value, setValue] = useState('');
  // Enter then leaving the box would save twice.
  const saved = useRef(false);
  const enter = () => {
    if (value && !saved.current) {
      saved.current = true;
      onEnter(value);
    }
  };
  return (
    <input
      className="usa-input check-lines__date"
      type="date"
      aria-label={`Line ${number} date`}
      required
      aria-invalid="true"
      value={value}
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => setValue(event.target.value)}
      onBlur={enter}
      onKeyDown={(event) => event.key === 'Enter' && enter()}
    />
  );
}
