import { useSearchParamState } from '../hooks/useSearchParamState';
import { useResource, type Resource } from '../hooks/useResource';
import { Tabs } from './ui/Tabs';

const TABS = ['list', 'duplicates'] as const;
export type ListTab = (typeof TABS)[number];

export function useListTab(): [ListTab, (next: ListTab) => void] {
  return useSearchParamState<ListTab>('tab', 'list', TABS);
}

// While the tab is open, its own list's count (listed); on the list, the
// server's remembered count, loaded again each time, until it arrives.
export function useDuplicateCount(tab: ListTab, count: Resource<number>, listed: number | null): number | null {
  const { data: remembered } = useResource(tab === 'list' ? count : null);
  return tab === 'list' ? (remembered ?? listed) : (listed ?? remembered);
}

// Shown only while there is something to review, or while its tab is open.
export function DuplicatesTabs({
  listLabel,
  toReview,
  show,
  tab,
  onSelect,
}: {
  listLabel: string;
  toReview: number | null;
  show: boolean;
  tab: ListTab;
  onSelect: (next: ListTab) => void;
}) {
  if (!show && tab === 'list') return null;
  return (
    <Tabs
      label="Show"
      className="page-tabs"
      tabs={[
        { id: 'list', label: listLabel },
        { id: 'duplicates', label: 'Review duplicates', ...(toReview !== null && { count: toReview }) },
      ]}
      selected={tab}
      onSelect={onSelect}
    />
  );
}
