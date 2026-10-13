import type { PortalInvoiceLine, RuleFinding } from '../api/client';
import { RecordTable } from './RecordTable';
import { directionsUrl, isMileage, lineDate, lineRate } from '../invoiceLineDisplay';
import { formatMoney } from '../formatMoney';

// The driving route as claimed: both ways for a round trip.
function routeMiles(line: PortalInvoiceLine): number | undefined {
  return line.routeDistance === null ? undefined : Number(line.routeDistance) * (line.roundTrip ? 2 : 1);
}

// Each mileage item's trip, in place of a printed map. Trips the billing
// rules flagged are marked.
export function TravelLog({ lines, findings = [] }: { lines: PortalInvoiceLine[]; findings?: RuleFinding[] }) {
  const trips = lines.filter(isMileage);
  const flagged = new Set(
    findings.filter((finding) => finding.rule === 'mileage_distance').map((finding) => finding.invoiceLineId),
  );
  if (trips.length === 0) {
    return null;
  }
  return (
    <div className="detail-section">
      <h2>Travel log</h2>
      <p className="compact-hint">
        Driving distances are looked up when an invoice is submitted with the mileage distance rule on. Use the map
        link to check a trip yourself.
      </p>
      <RecordTable
        rows={trips}
        rowKey={(line) => line.invoiceLineId}
        columns={[
          { header: 'Date', render: lineDate },
          {
            header: 'Trip',
            render: (line) =>
              line.tripOrigin && line.tripDestination ? (
                <>
                  {line.tripOrigin} → {line.tripDestination}
                  {line.roundTrip && <span className="trip-note">Round trip</span>}
                </>
              ) : (
                <span className="line-amount-missing">No From and To given</span>
              ),
          },
          { header: 'Miles claimed', render: (line) => (line.quantity === null ? '—' : Number(line.quantity)) },
          {
            header: 'Driving route',
            render: (line) => {
              const route = routeMiles(line);
              if (route === undefined) {
                return <span className="trip-note">Not checked</span>;
              }
              const over = Number(line.quantity ?? 0) - route;
              const isFlagged = flagged.has(line.invoiceLineId);
              return (
                <>
                  {Number(route.toFixed(1))} mi
                  {(over >= 0.5 || isFlagged) && (
                    <span className={isFlagged ? 'trip-note trip-note--flagged' : 'trip-note'}>
                      {Number(over.toFixed(1))} mi more claimed{isFlagged ? ', over tolerance' : ''}
                    </span>
                  )}
                </>
              );
            },
          },
          { header: 'Rate', render: (line) => <span className="amount">{lineRate(line)}</span> },
          { header: 'Requested', render: (line) => <span className="amount">{formatMoney(line.amount)}</span> },
          {
            header: 'Map',
            render: (line) =>
              line.tripOrigin && line.tripDestination ? (
                <a href={directionsUrl(line.tripOrigin, line.tripDestination)} target="_blank" rel="noreferrer noopener">
                  Directions<span className="usa-sr-only"> (opens a new tab)</span>
                </a>
              ) : (
                '—'
              ),
          },
        ]}
      />
    </div>
  );
}
