import { useEffect, useState, type ReactNode } from 'react';
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
  fetchFn,
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
  fetchFn: (query: string) => Promise<T[]>;
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
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<T[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runSearch(q: string) {
    setLoading(true);
    setError(null);
    try {
      setResults(await fetchFn(q));
    } catch {
      setError('Failed to load results.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (loadInitially || results) {
      void runSearch(query);
    }
    // On mount, and when reloadKey changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey]);

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
          void runSearch(query);
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
          onClear={() => (loadInitially ? void runSearch('') : setResults(null))}
        />
        <button type="submit" className="btn btn--outline" disabled={loading}>{loading ? 'Searching…' : 'Search'}</button>
      </form>
      {error && <Notice tone="danger">{error}</Notice>}
      {results && <RecordTable rows={results} rowKey={rowKey} columns={columns} emptyMessage="No results." />}
    </>
  );
}
