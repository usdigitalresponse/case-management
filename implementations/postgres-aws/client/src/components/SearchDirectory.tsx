import { useEffect, useState, type ReactNode } from 'react';
import { useBatchedResource, type BatchedResource } from '../hooks/useBatchedResource';
import { MoreOnScroll } from './MoreOnScroll';
import { useSearchParamState } from '../hooks/useSearchParamState';
import { PageHeading } from './PageHeading';
import { RecordTable, type RecordTableColumn } from './RecordTable';
import { SearchInput } from './SearchInput';
import { Notice } from './ui/Notice';
import { Button } from './ui/Button';

// A lookup page's search and batched results; `loadInitially` lists everyone before a search.
export function SearchDirectory<T>({
  title,
  description,
  searchLabel,
  searchPlaceholder,
  resource,
  columns,
  rowKey,
  loadInitially = false,
  actions,
  children,
  after,
  reloadKey = 0,
}: {
  title: string;
  description?: string;
  searchLabel: string;
  searchPlaceholder: string;
  resource: (query: string) => BatchedResource<T>;
  columns: RecordTableColumn<T>[];
  rowKey: (row: T) => string;
  loadInitially?: boolean;
  // Beside the title, e.g. an Add button.
  actions?: ReactNode;
  // Above the search, e.g. the form an action opens.
  children?: ReactNode;
  // Below the results, e.g. a note about them.
  after?: ReactNode;
  // Changing it runs the current search again, e.g. after adding a row.
  reloadKey?: number;
}) {
  const [stored, setSearched] = useSearchParamState<string>('q', '');
  const searched = stored.trim();
  const [query, setQuery] = useState(searched);
  // A search changed elsewhere, as by Back or the sidebar, shows in the box.
  useEffect(() => setQuery(searched), [searched]);
  const list = useBatchedResource(loadInitially || searched ? resource(searched) : null, { resetKey: reloadKey });
  const { items: results, error, pending, reload } = list;
  const [rerunning, setRerunning] = useState(false);
  const searching = rerunning || ((loadInitially || searched !== '') && pending);

  const heading = <PageHeading list title={title} description={description} />;
  return (
    <>
      {actions ? (
        <div className="page-title-row">
          {heading}
          <div className="title-actions">{actions}</div>
        </div>
      ) : (
        heading
      )}
      {children}
      <form
        className="list-toolbar list-toolbar--end"
        onSubmit={(event) => {
          event.preventDefault();
          if (query.trim() !== searched) {
            setSearched(query.trim());
          } else if (results) {
            setRerunning(true);
            void reload().finally(() => setRerunning(false));
          }
        }}
      >
        <SearchInput
          id="directory-query"
          name="directoryQuery"
          aria-label={searchLabel}
          placeholder={searchPlaceholder}
          value={query}
          onChange={setQuery}
          onClear={() => setSearched('')}
        />
        <Button type="submit" kind="secondary" disabled={searching}>{searching ? 'Searching…' : 'Search'}</Button>
      </form>
      {Boolean(error) && <Notice tone="danger">Failed to load results.</Notice>}
      {results && <RecordTable rows={results} rowKey={rowKey} columns={columns} emptyMessage="No results." />}
      <MoreOnScroll list={list} what="results" />
      {after}
    </>
  );
}
