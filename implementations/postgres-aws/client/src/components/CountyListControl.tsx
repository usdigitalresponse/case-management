// Filters or groups any list of cases or invoices by county (../counties.ts).
import { useState } from 'react';
import { useCachedResource } from '../hooks/useCachedResource';
import { counties } from '../resources';
import {
  ALL_COUNTIES,
  applyCountyControl,
  countyControlOptions,
  GROUPED_BY_COUNTY,
  NO_COUNTY,
  type CountyRow,
} from '../counties';

// hideLabel: beside other filters, the first choice reads "All counties" instead.
export function useCountyControl<T>(rows: T[], countyOf: (row: T) => CountyRow, { hideLabel = false } = {}) {
  const { data } = useCachedResource(counties);
  const options = data ?? [];
  const [choice, setChoice] = useState(ALL_COUNTIES);
  const offered = countyControlOptions(rows, countyOf, options, choice);
  const label = (name: string, count: number) => `${name} (${count})`;

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
    shown: applyCountyControl(rows, countyOf, choice, options),
    control,
    // Showing one county's rows, or those with none, for the empty message.
    narrowed: choice !== ALL_COUNTIES && choice !== GROUPED_BY_COUNTY,
    nameOf: (countyId: string | null) => options.find((option) => option.countyId === countyId)?.displayName ?? null,
  };
}
