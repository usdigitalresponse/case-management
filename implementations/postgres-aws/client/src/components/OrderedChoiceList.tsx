import type { ReactNode } from 'react';

// Tick people in order; each ticked one shows their place. Used for who
// signs off, by default (Settings) and on one invoice.
export function OrderedChoiceList<T>({
  options,
  optionKey,
  render,
  chosen,
  onChange,
  disabled,
}: {
  options: T[];
  optionKey: (option: T) => string;
  render: (option: T) => ReactNode;
  chosen: string[];
  onChange: (chosen: string[]) => void;
  disabled?: boolean;
}) {
  return (
    <ul className="choice-list">
      {options.map((option) => {
        const key = optionKey(option);
        const position = chosen.indexOf(key);
        return (
          <li key={key}>
            <label className={position >= 0 ? 'is-chosen' : undefined}>
              <input
                type="checkbox"
                disabled={disabled}
                checked={position >= 0}
                onChange={(event) => onChange(event.target.checked ? [...chosen, key] : chosen.filter((id) => id !== key))}
              />
              <span>
                {position >= 0 && <span className="order-badge">{position + 1}</span>}
                {render(option)}
              </span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}
