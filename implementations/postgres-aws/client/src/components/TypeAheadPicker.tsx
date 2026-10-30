import { useEffect, useRef, useState } from 'react';
import { useCombobox } from 'downshift';

// Shared type-ahead search-and-select. Downshift's useCombobox supplies
// the keyboard handling and ARIA wiring; matches come from a server
// search that runs once typing pauses (DEBOUNCE_MS). Whatever the field
// shows is the selection: editing the text after picking an option
// deselects it, and the ✕ button clears both. The caller renders its own
// <Label> with htmlFor={id} and id={`${id}-label`}.
const DEBOUNCE_MS = 300;
const ADD_VALUE = 'add-new';

export interface TypeAheadOption<T> {
  value: string;
  label: string;
  item: T;
}

export function TypeAheadPicker<T>({
  id,
  placeholder,
  noResults = 'No matches found.',
  search,
  onSelect,
  addOption,
}: {
  id: string;
  placeholder?: string;
  noResults?: string;
  search: (query: string) => Promise<TypeAheadOption<T>[]>;
  onSelect: (item: T | undefined) => void;
  // Offered first among the matches, to add someone not found; gets the text typed.
  addOption?: { label: string; onAdd: (query: string) => void };
}) {
  const [options, setOptions] = useState<TypeAheadOption<T>[]>([]);
  const [selected, setSelected] = useState<TypeAheadOption<T> | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [status, setStatus] = useState<'idle' | 'searching' | 'done' | 'error'>('idle');
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout>>();
  // Only the latest search's response is applied, so a slow earlier
  // response can't overwrite a newer one.
  const latestSearch = useRef(0);

  useEffect(() => () => clearTimeout(debounceTimer.current), []);

  function select(option: TypeAheadOption<T> | null) {
    setSelected(option);
    onSelect(option?.item);
  }

  function scheduleSearch(query: string) {
    clearTimeout(debounceTimer.current);
    const searchId = ++latestSearch.current;
    if (!query.trim()) {
      setOptions([]);
      setStatus('idle');
      return;
    }
    setStatus('searching');
    debounceTimer.current = setTimeout(() => {
      search(query.trim()).then(
        (results) => {
          if (searchId === latestSearch.current) {
            setOptions(results);
            setStatus('done');
          }
        },
        () => {
          if (searchId === latestSearch.current) {
            setOptions([]);
            setStatus('error');
          }
        },
      );
    }, DEBOUNCE_MS);
  }

  const addItem = addOption && ({ value: ADD_VALUE, label: addOption.label, item: undefined as T } satisfies TypeAheadOption<T>);
  const items = status === 'done' ? [...(addItem ? [addItem] : []), ...options] : [];
  const { isOpen, highlightedIndex, getInputProps, getMenuProps, getItemProps } = useCombobox({
    items,
    selectedItem: selected,
    inputValue,
    itemToString: (option) => option?.label ?? '',
    inputId: id,
    labelId: `${id}-label`,
    // Enter picks the first match, not "add", so a match isn't added again.
    defaultHighlightedIndex: addItem && options.length > 0 ? 1 : 0,
    onInputValueChange: ({ inputValue: value = '', type }) => {
      // Downshift rewrites the text whenever the controlled selectedItem
      // changes; deselecting on edit must keep what the user typed.
      if (type === useCombobox.stateChangeTypes.ControlledPropUpdatedSelectedItem) {
        return;
      }
      setInputValue(value);
      if (type === useCombobox.stateChangeTypes.InputChange) {
        if (selected) {
          select(null);
        }
        scheduleSearch(value);
      } else {
        // An option was picked, or Escape cleared the field.
        scheduleSearch('');
      }
    },
    onSelectedItemChange: ({ selectedItem }) => {
      if (selectedItem?.value === ADD_VALUE) {
        addOption?.onAdd(inputValue.trim());
        return;
      }
      select(selectedItem ?? null);
    },
  });

  function clear() {
    setInputValue('');
    select(null);
    scheduleSearch('');
    inputRef.current?.focus();
  }

  let message: string | null = null;
  if (status === 'searching') {
    message = 'Searching…';
  } else if (status === 'error') {
    message = 'Search failed. Try again.';
  } else if (status === 'done' && options.length === 0 && !addItem) {
    message = noResults;
  }
  const showMenu = isOpen && status !== 'idle' && !selected;

  return (
    <div className="type-ahead">
      <div className="clearable">
        <input className="usa-input clearable__input" placeholder={placeholder} {...getInputProps({ ref: inputRef })} />
        {inputValue && (
          <button type="button" className="clearable__clear" aria-label="Clear" onClick={clear}>
            ✕
          </button>
        )}
      </div>
      <ul className="type-ahead__menu" hidden={!showMenu} {...getMenuProps()}>
        {showMenu &&
          (message ? (
            <li className="type-ahead__message">{message}</li>
          ) : (
            <>
              {items.map((option, index) => (
                <li
                  key={option.value}
                  className={`type-ahead__option${highlightedIndex === index ? ' type-ahead__option--highlighted' : ''}${option === addItem ? ' type-ahead__option--add' : ''}`}
                  {...getItemProps({ item: option, index })}
                >
                  {option.label}
                </li>
              ))}
              {options.length === 0 && <li className="type-ahead__message">{noResults}</li>}
            </>
          ))}
      </ul>
    </div>
  );
}
