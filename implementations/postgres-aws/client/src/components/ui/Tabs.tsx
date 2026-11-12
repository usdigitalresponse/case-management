import { useRef, type KeyboardEvent } from 'react';

export interface TabItem<T extends string> {
  id: T;
  label: string;
  count?: number;
}

// Only the selected tab is in the Tab order; arrow keys, Home and End select as they move.
export function Tabs<T extends string>({
  label,
  tabs,
  selected,
  onSelect,
  controls,
  className,
}: {
  label: string;
  tabs: TabItem<T>[];
  selected: T;
  onSelect: (id: T) => void;
  // The id of the region the tabs switch.
  controls?: string;
  className?: string;
}) {
  const list = useRef<HTMLDivElement>(null);
  const move = (event: KeyboardEvent, index: number) => {
    const last = tabs.length - 1;
    const next = { ArrowRight: index === last ? 0 : index + 1, ArrowLeft: index === 0 ? last : index - 1, Home: 0, End: last }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    onSelect(tabs[next]!.id);
    list.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  };
  return (
    <div ref={list} className={['tabs', className].filter(Boolean).join(' ')} role="tablist" aria-label={label}>
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          className="tabs__tab"
          aria-selected={tab.id === selected}
          aria-controls={controls}
          aria-label={tab.count === undefined ? undefined : `${tab.label}, ${tab.count}`}
          tabIndex={tab.id === selected ? 0 : -1}
          onClick={() => onSelect(tab.id)}
          onKeyDown={(event) => move(event, index)}
        >
          {tab.label}
          {tab.count !== undefined && <span className="tabs__count">{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}
