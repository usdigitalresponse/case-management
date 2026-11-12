// Chooses the county a list of cases or invoices shows, or groups it by county
// (../counties.ts); the server filters and orders the list by the choice.
import type { CountyCount } from '../api/client';
import { useResource } from '../hooks/useResource';
import { counties } from '../resources';
import { ALL_COUNTIES, countyControlOptions, GROUPED_BY_COUNTY, NO_COUNTY } from '../counties';
import { useSearchParamState } from '../hooks/useSearchParamState';

// hideLabel: beside other filters, the first choice reads "All counties" instead.
// counts: the list's by county, from its summary; null while loading or not known.
export function useCountyControl(counts: CountyCount[] | null, { hideLabel = false } = {}) {
  const { data } = useResource(counties);
  const options = data ?? [];
  const [choice, setChoice] = useSearchParamState<string>('county', ALL_COUNTIES);
  const offered = countyControlOptions(counts, options, choice);
  const label = (name: string, count: number | null) => (count === null ? name : `${name} (${count})`);

  const control = (
    <label className="sort-select county-list-control">
      <span className={hideLabel ? 'usa-sr-only' : undefined}>County</span>
      <select className="usa-select" value={choice} onChange={(event) => setChoice(event.target.value)}>
        <option value={ALL_COUNTIES}>{hideLabel ? 'All counties' : 'All'}</option>
        <option value={GROUPED_BY_COUNTY}>All, grouped by county</option>
        {offered.settings.length > 0 && (
          <optgroup label="In place of a county">
            {offered.settings.map((option) => (
              <option key={option.countyId} value={option.countyId}>
                {label(option.displayName, option.count)}
              </option>
            ))}
          </optgroup>
        )}
        {offered.counties.length > 0 && (
          <optgroup label="Counties">
            {offered.counties.map((option) => (
              <option key={option.countyId} value={option.countyId}>
                {label(option.displayName, option.count)}
              </option>
            ))}
          </optgroup>
        )}
        <option value={NO_COUNTY}>{label('No county', offered.none)}</option>
      </select>
    </label>
  );

  return {
    control,
    // Showing one county's rows, or those with none, for the empty message.
    narrowed: choice !== ALL_COUNTIES && choice !== GROUPED_BY_COUNTY,
    nameOf: (countyId: string | null) => options.find((option) => option.countyId === countyId)?.displayName ?? null,
  };
}
