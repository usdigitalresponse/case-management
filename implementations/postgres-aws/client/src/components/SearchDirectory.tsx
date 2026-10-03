import { useEffect, useState } from 'react';
import { Alert, Button } from '@trussworks/react-uswds';
import { PageHeading } from './PageHeading';
import { RecordTable, type RecordTableColumn } from './RecordTable';
import { SearchInput } from './SearchInput';

// Shared "search-then-list" shape for the sidebar's lookup pages (People,
// Clients, Vendors) — each just differs in what it fetches and how it
// renders a row. `loadInitially` is for a small-enough table (Vendors)
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
    if (loadInitially) {
      void runSearch('');
    }
    // Only ever run once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <PageHeading eyebrow={eyebrow} title={title} description={description} />
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
        <Button type="submit" outline disabled={loading}>{loading ? 'Searching…' : 'Search'}</Button>
      </form>
      {error && <Alert type="error">{error}</Alert>}
      {results && <RecordTable rows={results} rowKey={rowKey} columns={columns} emptyMessage="No results." />}
    </>
  );
}
