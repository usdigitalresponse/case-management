// Every county picker; a county typed in is added when the caller saves it (countyChoiceOf).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useCombobox } from 'downshift';
import { apiErrorMessage, type CountyChoice, type CountyOption, type SavedCounty } from '../api/client';
import { useResource } from '../hooks/useResource';
import { counties as countiesResource } from '../resources';
import { countyChoiceOf, countyMatches, type CountyValue } from '../counties';

type Item = { option: CountyOption } | { add: string };

const labelOf = (item: Item | null) => (item ? ('option' in item ? item.option.displayName : item.add) : '');

export function CountyPicker({
  id,
  label = 'County',
  value,
  onChange,
  hint,
  error,
  disabled,
}: {
  id: string;
  label?: string;
  value: CountyValue | null;
  onChange: (value: CountyValue | null) => void;
  hint?: ReactNode;
  error?: string | null;
  disabled?: boolean;
}) {
  const { data } = useResource(countiesResource);
  // A county just added isn't in the list fetched before it.
  const options =
    value?.countyId && data && !data.some((option) => option.countyId === value.countyId)
      ? [...data, { countyId: value.countyId, displayName: value.displayName, isCounty: true }]
      : (data ?? []);
  const [inputValue, setInputValue] = useState(value?.displayName ?? '');
  useEffect(() => setInputValue(value?.displayName ?? ''), [value?.countyId, value?.displayName]);

  // The whole list until the person types something else.
  const query = inputValue === (value?.displayName ?? '') ? '' : inputValue;
  const { matches, addName } = countyMatches(options, query);
  const items: Item[] = [...(addName ? [{ add: addName }] : []), ...matches.map((option) => ({ option }))];

  const { isOpen, highlightedIndex, getInputProps, getMenuProps, getItemProps } = useCombobox<Item>({
    items,
    inputValue,
    selectedItem: null,
    itemToString: labelOf,
    inputId: id,
    labelId: `${id}-label`,
    // Enter takes the first match, not "add", so a listed county isn't added again.
    defaultHighlightedIndex: query ? (addName && matches.length > 0 ? 1 : 0) : -1,
    onInputValueChange: ({ inputValue: typed = '' }) => setInputValue(typed),
    onSelectedItemChange: ({ selectedItem }) => {
      if (!selectedItem) return;
      onChange('option' in selectedItem ? { countyId: selectedItem.option.countyId, displayName: selectedItem.option.displayName } : { countyId: null, displayName: selectedItem.add });
    },
  });

  function clear() {
    setInputValue('');
    onChange(null);
  }

  const firstCounty = items.findIndex((item) => 'option' in item && item.option.isCounty);
  const firstSetting = items.findIndex((item) => 'option' in item && !item.option.isCounty);
  const pending = value && value.countyId === null;

  return (
    <div className="county-picker">
      <label id={`${id}-label`} className="usa-label" htmlFor={id}>
        {label}
      </label>
      <div className="type-ahead">
        <div className="clearable">
          <input
            className="usa-input clearable__input"
            placeholder="Type to find or add a county"
            disabled={disabled}
            aria-invalid={Boolean(error) || undefined}
            aria-describedby={`${id}-hint`}
            // Not opened on focus: downshift's click toggle would close it again.
            {...getInputProps({
              // Typed text nobody chose goes back to what is saved.
              onBlur: () => setInputValue(value?.displayName ?? ''),
            })}
          />
          {inputValue && !disabled && (
            <button type="button" className="clearable__clear" aria-label="Clear the county" onClick={clear}>
              ✕
            </button>
          )}
        </div>
        <ul className="type-ahead__menu" hidden={!isOpen || items.length === 0} {...getMenuProps()}>
          {isOpen &&
            items.map((item, index) => (
              <li
                key={'option' in item ? item.option.countyId : 'add'}
                className={[
                  'type-ahead__option',
                  highlightedIndex === index && 'type-ahead__option--highlighted',
                  'add' in item && 'type-ahead__option--add',
                  index === firstCounty && firstSetting >= 0 && 'type-ahead__option--first-county',
                ]
                  .filter(Boolean)
                  .join(' ')}
                {...getItemProps({ item, index })}
              >
                {'add' in item ? `+ Add “${item.add}” as a new county` : item.option.displayName}
              </li>
            ))}
        </ul>
      </div>
      <p id={`${id}-hint`} className={error ? 'field-error' : 'field-hint'}>
        {error ?? (pending ? `“${value.displayName}” isn’t on the list yet. It is added when this is saved.` : hint)}
      </p>
    </div>
  );
}

// Saved as soon as it is chosen, on an invoice's check or review page.
export function SavedCountyPicker({
  id,
  initial,
  save,
  hint,
  disabled,
}: {
  id: string;
  initial: CountyValue | null;
  save: (choice: CountyChoice) => Promise<{ county: SavedCounty | null }>;
  hint?: ReactNode;
  disabled?: boolean;
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  // Only the latest save's answer is shown, whatever order they come back in.
  const latest = useRef(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setValue(initial), [initial?.countyId, initial?.displayName]);

  async function change(next: CountyValue | null) {
    const saving = ++latest.current;
    setValue(next);
    setError(null);
    try {
      const { county } = await save(countyChoiceOf(next));
      if (saving === latest.current) setValue(county);
    } catch (err) {
      if (saving === latest.current) setError(apiErrorMessage(err, 'The county could not be saved. Try again.'));
    }
  }

  return <CountyPicker id={id} value={value} onChange={(next) => void change(next)} hint={hint} error={error} disabled={disabled} />;
}
