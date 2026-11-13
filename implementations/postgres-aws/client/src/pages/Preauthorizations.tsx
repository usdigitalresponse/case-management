// The request log and usage by county (model/rules.yaml request_preauthorization, report_preauthorization_usage).
import { lazy, Suspense, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { caseOptionLabel, searchCases, searchProviders, type CountyUsage, type PreauthorizationRequestRow } from '../api/client';
import { useResource } from '../hooks/useResource';
import { useBatchedResource } from '../hooks/useBatchedResource';
import { MoreOnScroll } from '../components/MoreOnScroll';
import { preauthorizationRequests, preauthorizationUsage, thisYear } from '../resources';
import { PageHeader } from '../components/PageHeader';
import { LoadState } from '../components/LoadState';
import { RecordTable } from '../components/RecordTable';
import { PreauthorizationRequestForm } from '../components/PreauthorizationRequestForm';
import { requestColumns } from '../components/preauthorizationRequest/requestText';
import { PreauthorizationRequestView } from '../components/PreauthorizationRequestView';
import { downloadCsv } from '../downloadCsv';
import { formatDollars, formatMoney } from '../formatMoney';
import { FilterTag } from '../components/ui/Tag';
import { Tabs } from '../components/ui/Tabs';
import { preauthorizationRequestsRequest, REQUEST_STATUS_TABS, type RequestStatusTab } from '../caseRequests';
import { Button } from '../components/ui/Button';
import { UsedBar } from '../components/UsedBar';

// Loaded only on this tab, so the chart library stays out of other pages.
const UsageRunningTotals = lazy(() => import('../components/UsageRunningTotals'));

const STATUS_LABELS: Record<RequestStatusTab, string> = { all: 'All', in_review: 'In review', decided: 'Decided' };

export const preauthorizationPath = (requestId: string) => `/preauthorizations/${requestId}`;

function RecordRequest({ onDone }: { onDone: () => void }) {
  const navigate = useNavigate();
  return (
    <section className="card compact-card">
      <h2>Record an emailed request</h2>
      <PreauthorizationRequestForm
        staff
        cases={[]}
        searchCases={(query) => searchCases(query).then((found) => found.map((row) => ({ id: row.caseId, label: caseOptionLabel(row) })))}
        providers={[]}
        searchProviders={(query) => searchProviders(query).then((found) => found.map((row) => ({ id: row.professionalId, label: row.displayName ?? 'Unnamed' })))}
        onCreated={(created, uploadError) => navigate(preauthorizationPath(created.preauthorizationRequestId), { state: { uploadError } })}
        onCancel={onDone}
      />
    </section>
  );
}

function Requests() {
  const [params, setParams] = useSearchParams();
  const { tab: status, filter } = preauthorizationRequestsRequest(params);
  const { countyId, caseId } = filter;
  const [recording, setRecording] = useState(false);
  const list = useBatchedResource(preauthorizationRequests(filter));
  const data = list.items;
  const setFilter = (next: Record<string, string | undefined>) => {
    const merged = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) {
      if (value === undefined) merged.delete(key);
      else merged.set(key, value);
    }
    // Replaced, so arrowing across tabs leaves one history entry.
    setParams(merged, { preventScrollReset: true, replace: true });
  };
  const columns = requestColumns(preauthorizationPath);
  return (
    <>
      <div className="list-controls">
        <Tabs
          label="Requests by status"
          controls="preauthorization-requests"
          tabs={REQUEST_STATUS_TABS.map((id) => ({ id, label: STATUS_LABELS[id], count: list.summary?.counts[id] }))}
          selected={status}
          onSelect={(id) => setFilter({ status: id })}
        />
        {countyId && data?.[0]?.countyName && (
          <FilterTag aria-pressed onClick={() => setFilter({ countyId: undefined })}>
            {data[0].countyName} ✕
          </FilterTag>
        )}
        {caseId && (
          <FilterTag aria-pressed onClick={() => setFilter({ caseId: undefined })}>
            One case ✕
          </FilterTag>
        )}
        {!recording && (
          <Button kind="secondary" onClick={() => setRecording(true)}>
            Record request
          </Button>
        )}
      </div>
      {recording && <RecordRequest onDone={() => setRecording(false)} />}
      <div id="preauthorization-requests" role="tabpanel" aria-label={STATUS_LABELS[status]}>
      {!data ? (
        <LoadState error={list.error} what="requests" />
      ) : (
        <RecordTable
          className="queue-table"
          label="Pre-authorization requests"
          rows={data}
          rowKey={(row) => row.preauthorizationRequestId}
          emptyMessage="No requests here."
          columns={[
            { ...columns.number, width: '9%' },
            { ...columns.case, width: '12%' },
            { header: 'Asked by', width: '12%', render: (row) => row.requestedForName ?? row.requestedByName },
            { ...columns.provider, width: '15%' },
            { ...columns.askedFor, width: '14%' },
            { ...columns.approved, width: '9%' },
            { ...columns.status, width: '17%' },
            { header: 'Billed / left', width: '11%', render: (row) => <LimitCell row={row} /> },
          ]}
        />
      )}
      <MoreOnScroll list={list} what="requests" />
      <p className="compact-hint">
        A request that is not needed was within the county’s threshold. The provider can still bill up to the threshold without asking.
      </p>
      </div>
    </>
  );
}

function LimitCell({ row }: { row: PreauthorizationRequestRow }) {
  if (!row.limit) return <span className="muted">—</span>;
  const billed = Number(row.limit.approvedSoFar) + Number(row.limit.waiting);
  const left = Number(row.limit.ceiling) - billed;
  return (
    <>
      {formatMoney(billed)}
      <span className={`cell-note${left < 0 ? ' total-figure--cut' : ''}`}>{left < 0 ? `${formatMoney(-left)} over` : `${formatMoney(left)} left`}</span>
    </>
  );
}

const REQUEST_NOTES: Array<[keyof CountyUsage['requests'], string]> = [
  ['info_requested', 'waiting for information'],
  ['not_needed', 'not needed'],
  ['denied', 'denied'],
  ['withdrawn', 'withdrawn'],
];

function UsageByCounty() {
  const [period, setPeriod] = useState(thisYear);
  const { data, error } = useResource(preauthorizationUsage(period));
  const isTotal = (row: CountyUsage) => row.countyName === 'All';
  const requestsLink = (row: CountyUsage, status: string) =>
    `/preauthorizations?status=${status}${row.countyId ? `&countyId=${row.countyId}` : ''}`;
  const count = (row: CountyUsage, status: string, n: number) =>
    n > 0 && !isTotal(row) ? <Link to={requestsLink(row, status)}>{n}</Link> : n;
  const rows = data ? [...data.counties, data.total] : [];
  return (
    <>
      <div className="list-controls">
        <div className="inline-fields">
          <div className="usa-form-group">
            <label className="usa-label" htmlFor="usage-from">From</label>
            <input id="usage-from" className="usa-input" type="date" value={period.from} onChange={(event) => event.target.value && setPeriod({ ...period, from: event.target.value })} />
          </div>
          <div className="usa-form-group">
            <label className="usa-label" htmlFor="usage-to">To</label>
            <input id="usage-to" className="usa-input" type="date" value={period.to} onChange={(event) => event.target.value && setPeriod({ ...period, to: event.target.value })} />
          </div>
        </div>
        {data && (
          <Button
            kind="secondary"
            onClick={() =>
              downloadCsv(
                `preauthorization-usage-${period.from}-to-${period.to}.csv`,
                rows.map((row) => ({
                  County: row.countyName,
                  Threshold: row.threshold,
                  'Requests waiting': row.requests.submitted,
                  'Waiting for information': row.requests.info_requested,
                  'Requests approved': row.requests.approved,
                  'Not needed': row.requests.not_needed,
                  Denied: row.requests.denied,
                  Withdrawn: row.requests.withdrawn,
                  'Asked for': row.requested,
                  Approved: row.approved,
                  Authorized: row.authorized,
                  'Billed, approved': row.billedApproved,
                  'Billed, waiting': row.billedWaiting,
                  Left: row.left,
                  'Providers over': row.over.providers,
                  'Amount over': row.over.amount,
                  'Over, not explained': row.over.unexplained,
                  'Providers within threshold': row.withinThreshold.providers,
                  'Billed within threshold': row.withinThreshold.billed,
                })),
              )
            }
          >
            Download CSV
          </Button>
        )}
      </div>
      {data &&
        (data.months.length > 0 ? (
          <Suspense fallback={<LoadState error={null} what="chart" />}>
            <UsageRunningTotals months={data.months} />
          </Suspense>
        ) : (
          <p className="compact-hint">Choose a period of five years or less to see the running total.</p>
        ))}
      {!data ? (
        <LoadState error={error} what="usage" />
      ) : (
        <RecordTable
          className="queue-table usage-table"
          label="Pre-authorization use by county"
          rows={rows}
          rowKey={(row) => (isTotal(row) ? 'total' : (row.countyId ?? 'none'))}
          rowClassName={(row) => (isTotal(row) ? 'usage-table__total' : undefined)}
          emptyMessage="No requests or invoices in this period."
          columns={[
            { header: 'County or setting', width: '10%', rowHeader: true, render: (row) => row.countyName },
            { header: 'Threshold', width: '9%', render: (row) => (row.threshold ? formatDollars(row.threshold) : '—') },
            {
              header: 'Requests',
              width: '20%',
              render: (row) => {
                const others = REQUEST_NOTES.filter(([status]) => row.requests[status] > 0);
                return (
                  <>
                    {count(row, 'submitted', row.requests.submitted)} waiting, {count(row, 'approved', row.requests.approved)} approved
                    {others.length > 0 && (
                      <span className="cell-note">
                        {others.map(([status, label], index) => (
                          <span key={status}>
                            {index > 0 && ', '}
                            {count(row, status, row.requests[status])} {label}
                          </span>
                        ))}
                      </span>
                    )}
                    {Number(row.requested) > 0 && (
                      <span className="cell-note">
                        {formatDollars(row.requested)} asked for, {formatDollars(row.approved)} approved
                      </span>
                    )}
                  </>
                );
              },
            },
            { header: 'Authorized', width: '10%', render: (row) => formatDollars(row.authorized) },
            {
              header: 'Signed off',
              width: '10%',
              render: (row) => (
                <>
                  {formatDollars(row.billedApproved)}
                  {Number(row.billedWaiting) > 0 && <span className="cell-note">{formatDollars(row.billedWaiting)} in review</span>}
                </>
              ),
            },
            { header: 'Used', width: '12%', render: (row) => <UsedShare row={row} /> },
            { header: 'Left', width: '8%', render: (row) => formatDollars(row.left) },
            {
              header: 'Over their limit',
              width: '10%',
              render: (row) =>
                row.over.providers === 0 ? (
                  <span className="muted">None</span>
                ) : (
                  <>
                    <span className="total-figure--cut">{row.over.providers} {row.over.providers === 1 ? 'provider' : 'providers'}, {formatDollars(row.over.amount)}</span>
                    <span className="cell-note">{row.over.unexplained} not explained</span>
                  </>
                ),
            },
            {
              header: 'Within the threshold',
              width: '10%',
              render: (row) =>
                row.withinThreshold.providers === 0 ? (
                  <span className="muted">None</span>
                ) : (
                  <>
                    {row.withinThreshold.providers} {row.withinThreshold.providers === 1 ? 'provider' : 'providers'}
                    <span className="cell-note">{formatDollars(row.withinThreshold.billed)} billed</span>
                  </>
                ),
            },
          ]}
        />
      )}
      <p className="compact-hint">
        Requests count by date received. Authorized is each pre-authorization’s current ceiling; signed off, in review and left are as of
        today, for cases with a request or invoice in the period, against the pre-authorization or else the county’s threshold. Going over
        a limit is explained by the sender and flagged for the reviewer, never refused.
      </p>
    </>
  );
}

function UsedShare({ row }: { row: CountyUsage }) {
  const approved = Number(row.billedApproved);
  const waiting = Number(row.billedWaiting);
  const limit = approved + waiting + Number(row.left);
  const share = (amount: number) => (limit > 0 ? Math.round((amount / limit) * 100) : 0);
  return (
    <>
      <UsedBar approved={approved} waiting={waiting} limit={limit} />
      <span className="cell-note">
        {share(approved)}% signed off{waiting > 0 && `, ${share(waiting)}% in review`}
      </span>
    </>
  );
}

export default function Preauthorizations() {
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'county' ? 'county' : 'requests';
  return (
    <div>
      <PageHeader
        list
        title="Pre-authorizations"
        description="Requests, and how each county’s limits are used."
      />
      <Tabs
        label="View"
        controls="preauthorization-view"
        tabs={[
          { id: 'requests', label: 'Requests' },
          { id: 'county', label: 'By county' },
        ]}
        selected={view}
        onSelect={(id) => setParams(id === 'county' ? { view: 'county' } : {}, { preventScrollReset: true, replace: true })}
      />
      <div id="preauthorization-view" role="tabpanel" aria-label={view === 'county' ? 'By county' : 'Requests'}>
        {view === 'county' ? <UsageByCounty /> : <Requests />}
      </div>
    </div>
  );
}

export function StaffPreauthorizationRequest() {
  const { requestId } = useParams<{ requestId: string }>();
  return <PreauthorizationRequestView staff requestId={requestId as string} crumbs={[{ label: 'Pre-authorizations', to: '/preauthorizations' }]} />;
}
