// One control on every list of cases or invoices to filter or group its rows
// by county (../counties.ts).
import { useState } from 'react';
import { listCounties } from '../api/client';
import { useApiResource } from '../hooks/useApiResource';
import {
  ALL_COUNTIES,
  applyCountyControl,
  countyControlOptions,
  GROUPED_BY_COUNTY,
  NO_COUNTY,
  type CountyRow,
} from '../counties';

export function useCountyControl<T>(rows: T[], countyOf: (row: T) => CountyRow) {
  const { data } = useApiResource(() => listCounties().then((result) => result.counties), []);
  const options = data ?? [];
  const [choice, setChoice] = useState(ALL_COUNTIES);
  const offered = countyControlOptions(rows, countyOf, options, choice);
  const label = (name: string, count: number) => `${name} (${count})`;

  const control = (
    <label className="sort-select county-list-control">
      <span>County</span>
      <select className="usa-select" value={choice} onChange={(event) => setChoice(event.target.value)}>
        <option value={ALL_COUNTIES}>All</option>
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
