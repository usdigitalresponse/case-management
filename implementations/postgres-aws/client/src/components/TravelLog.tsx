import { useState } from 'react';
import type { MileageDismissal, PortalInvoiceLine, RuleFinding } from '../api/client';
import { formatDateTime } from '../formatDateTime';
import { RecordTable } from './RecordTable';
import { directionsUrl, isMileage, lineDate } from '../invoiceLineDisplay';
import { formatMoney } from '../formatMoney';

interface Trip {
  tripId: string;
  first: PortalInvoiceLine;
  travel?: PortalInvoiceLine;
  mileage?: PortalInvoiceLine;
  costs: PortalInvoiceLine[];
  total: number;
}

// A trip's lines, in the order its first line appears.
export function tripsOf(lines: PortalInvoiceLine[]): Trip[] {
  const trips = new Map<string, Trip>();
  for (const line of lines) {
    if (!line.tripId) continue;
    const trip = trips.get(line.tripId) ?? { tripId: line.tripId, first: line, costs: [], total: 0 };
    if (isMileage(line)) trip.mileage = line;
    else if (line.lineTypeCode === 'time') trip.travel = line;
    else trip.costs.push(line);
    trip.total = (Math.round(trip.total * 100) + Math.round(Number(line.amount) * 100)) / 100;
    trips.set(line.tripId, trip);
  }
  return [...trips.values()];
}

// The driving route as claimed: both ways for a round trip.
function routeMiles(line: PortalInvoiceLine): number | undefined {
  return line.routeDistance === null ? undefined : Number(line.routeDistance) * (line.roundTrip ? 2 : 1);
}

// Staff only: set a flagged trip's warning aside for stops on the way, or put it back.
export interface StopsDismissal {
  dismissals: MileageDismissal[];
  canChange: boolean;
  onDismiss: (invoiceLineId: string, reason: string) => Promise<boolean>;
  onRestore: (invoiceLineId: string) => void;
}

function StopsNote({ lineId, stops }: { lineId: string; stops: StopsDismissal }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const dismissal = stops.dismissals.find((row) => row.invoiceLineId === lineId);
  if (dismissal) {
    return (
      <span className="trip-note">
        Set aside for stops: {dismissal.reason} ({dismissal.dismissedByDisplayName}, {formatDateTime(dismissal.dismissedAt)})
        {stops.canChange && (
          <button type="button" className="link-button" onClick={() => stops.onRestore(lineId)}>
            Put the warning back
          </button>
        )}
      </span>
    );
  }
  if (!stops.canChange) return null;
  if (!open) {
    return (
      <button type="button" className="link-button trip-note" onClick={() => setOpen(true)}>
        Stops on the way?
      </button>
    );
  }
  return (
    <form
      className="stops-form"
      onSubmit={(event) => {
        event.preventDefault();
        void stops.onDismiss(lineId, reason.trim()).then((done) => done && setOpen(false));
      }}
    >
      <label>
        What were the stops?
        <input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} />
      </label>
      <button type="submit" className="btn btn--outline" disabled={!reason.trim()}>Set the warning aside</button>
      <button type="button" className="link-button" onClick={() => setOpen(false)}>Cancel</button>
    </form>
  );
}

// Each trip with its travel time, miles and costs, in place of a printed
// map. Trips the billing rules flagged are marked.
export function TravelLog({
  lines,
  findings = [],
  stops = null,
}: {
  lines: PortalInvoiceLine[];
  findings?: RuleFinding[];
  stops?: StopsDismissal | null;
}) {
  const trips = tripsOf(lines);
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
        Each part of a trip is a separate item above. Driving distances are looked up when an invoice is submitted with
        the mileage distance rule on. Use the map link to check a trip yourself.
      </p>
      <RecordTable
        rows={trips}
        rowKey={(trip) => trip.tripId}
        columns={[
          { header: 'Date', render: (trip) => lineDate(trip.first) },
          {
            header: 'Trip',
            render: ({ first }) =>
              first.tripOrigin && first.tripDestination ? (
                <>
                  {first.tripOrigin} → {first.tripDestination}
                  {first.roundTrip && <span className="trip-note">Round trip</span>}
                </>
              ) : (
                <span className="line-amount-missing">No From and To given</span>
              ),
          },
          {
            header: 'Travel time',
            render: ({ travel }) => {
              const hours = travel?.quantity ?? travel?.sourceDurationHours;
              return hours ? `${Number(hours)} h` : '—';
            },
          },
          { header: 'Miles claimed', render: ({ mileage }) => (mileage?.quantity ? Number(mileage.quantity) : '—') },
          {
            header: 'Driving route',
            render: ({ first, mileage }) => {
              const route = mileage ? routeMiles(first) : undefined;
              if (!mileage) {
                return '—';
              }
              if (route === undefined) {
                return <span className="trip-note">Not checked</span>;
              }
              const over = Number(mileage.quantity ?? 0) - route;
              const isFlagged = flagged.has(mileage.invoiceLineId);
              return (
                <>
                  {Number(route.toFixed(1))} mi
                  {(over >= 0.5 || isFlagged) && (
                    <span className={isFlagged ? 'trip-note trip-note--flagged' : 'trip-note'}>
                      {Number(over.toFixed(1))} mi more claimed{isFlagged ? ', over tolerance' : ''}
                    </span>
                  )}
                  {isFlagged && stops && <StopsNote lineId={mileage.invoiceLineId} stops={stops} />}
                </>
              );
            },
          },
          {
            header: 'Travel expenses',
            render: ({ costs }) =>
              costs.length === 0
                ? '—'
                : costs.map((cost) => (
                    <span key={cost.invoiceLineId} className="trip-cost">
                      {cost.description ?? 'Travel expense'} {formatMoney(cost.amount)}
                    </span>
                  )),
          },
          { header: 'Requested', render: (trip) => <span className="amount">{formatMoney(trip.total.toFixed(2))}</span> },
          {
            header: 'Map',
            render: ({ first }) =>
              first.tripOrigin && first.tripDestination ? (
                <a href={directionsUrl(first.tripOrigin, first.tripDestination)} target="_blank" rel="noreferrer noopener">
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
