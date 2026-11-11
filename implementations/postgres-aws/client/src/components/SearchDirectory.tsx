import { useEffect, useState, type ReactNode } from 'react';
import { useResource, type Resource } from '../hooks/useResource';
import { useSearchParamState } from '../hooks/useSearchParamState';
import { PageHeading } from './PageHeading';
import { RecordTable, type RecordTableColumn } from './RecordTable';
import { SearchInput } from './SearchInput';
import { Notice } from './Notice';

// Shared "search-then-list" shape for the sidebar's lookup pages (People,
// Clients, Providers) — each just differs in what it fetches and how it
// renders a row. `loadInitially` is for a small-enough table (Providers)
// where showing everything up front makes sense; People/Clients leave it
// off since those tables could be large and a query is expected first.
export function SearchDirectory<T>({
  eyebrow,
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
  reloadKey = 0,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  searchLabel: string;
  searchPlaceholder: string;
  resource: (query: string) => Resource<T[]>;
  columns: RecordTableColumn<T>[];
  rowKey: (row: T) => string;
  loadInitially?: boolean;
  // Beside the title, e.g. an Add button.
  actions?: ReactNode;
  // Above the search, e.g. the form an action opens.
  children?: ReactNode;
  // Changing it runs the current search again, e.g. after adding a row.
  reloadKey?: number;
}) {
  const [stored, setSearched] = useSearchParamState<string>('q', '');
  const searched = stored.trim();
  const [query, setQuery] = useState(searched);
  // A search changed elsewhere, as by Back or the sidebar, shows in the box.
  useEffect(() => setQuery(searched), [searched]);
  const { data: results, error, pending, reload } = useResource(loadInitially || searched ? resource(searched) : null, { resetKey: reloadKey });
  const [rerunning, setRerunning] = useState(false);
  const searching = rerunning || ((loadInitially || searched !== '') && pending);

  const heading = <PageHeading eyebrow={eyebrow} title={title} description={description} />;
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
        className="list-toolbar"
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
          // Back to the page's starting state: everything for a
          // loadInitially directory, otherwise no results until a search.
          onClear={() => setSearched('')}
        />
        <button type="submit" className="btn btn--outline" disabled={searching}>{searching ? 'Searching…' : 'Search'}</button>
      </form>
      {Boolean(error) && <Notice tone="danger">Failed to load results.</Notice>}
      {results && <RecordTable rows={results} rowKey={rowKey} columns={columns} emptyMessage="No results." />}
    </>
  );
}
