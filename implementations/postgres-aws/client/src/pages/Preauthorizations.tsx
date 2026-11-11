// The request log and usage by county (model/rules.yaml request_preauthorization, report_preauthorization_usage).
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import type { CountyUsage, PreauthorizationRequestRow } from '../api/client';
import { useResource } from '../hooks/useResource';
import { cases as casesResource, preauthorizationRequests, preauthorizationUsage, providerList, thisYear } from '../resources';
import { PageHeader } from '../components/PageHeader';
import { LoadState } from '../components/LoadState';
import { RecordTable } from '../components/RecordTable';
import { PreauthorizationRequestForm } from '../components/PreauthorizationRequestForm';
import { caseText, PreauthorizationRequestView, providerText, rateText, RequestStatus } from '../components/PreauthorizationRequestView';
import { downloadCsv } from '../downloadCsv';
import { formatDay } from '../formatDateTime';
import { formatMoney } from '../formatMoney';

const STATUS_FILTERS = [
  { id: 'open', label: 'Waiting' },
  { id: 'info_requested', label: 'Waiting for information' },
  { id: 'approved', label: 'Approved' },
  { id: 'not_needed', label: 'Not needed' },
  { id: 'denied', label: 'Denied' },
  { id: 'withdrawn', label: 'Withdrawn' },
  { id: '', label: 'All' },
];

export const preauthorizationPath = (requestId: string) => `/preauthorizations/${requestId}`;

function RecordRequest({ onDone }: { onDone: () => void }) {
  const navigate = useNavigate();
  const cases = useResource(casesResource);
  const providers = useResource(providerList(''));
  if (!cases.data || !providers.data) return <LoadState error={cases.error ?? providers.error} what="cases" />;
  return (
    <section className="compact-card">
      <h2>Record an emailed request</h2>
      <PreauthorizationRequestForm
        staff
        cases={cases.data.cases.filter((row) => !row.closedOn).map((row) => ({ id: row.caseId, label: [row.caseNumber, row.clientDisplayName].filter(Boolean).join(' · ') }))}
        providers={providers.data.map((row) => ({ id: row.professionalId, label: row.displayName ?? 'Unnamed' }))}
        onCreated={(created, uploadError) => navigate(preauthorizationPath(created.preauthorizationRequestId), { state: { uploadError } })}
        onCancel={onDone}
      />
    </section>
  );
}

function Requests() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? 'open';
  const countyId = params.get('countyId') ?? undefined;
  const caseId = params.get('caseId') ?? undefined;
  const [recording, setRecording] = useState(false);
  const { data, error } = useResource(preauthorizationRequests({ status, countyId, caseId }));
  const setFilter = (next: Record<string, string | undefined>) => {
    const merged = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) {
      if (value === undefined) merged.delete(key);
      else merged.set(key, value);
    }
    setParams(merged, { preventScrollReset: true });
  };
  return (
    <>
      <div className="list-controls">
        <div className="chip-filters" role="group" aria-label="Show">
          {STATUS_FILTERS.map(({ id, label }) => (
            <button key={id || 'all'} type="button" className="chip chip--filter" aria-pressed={status === id} onClick={() => setFilter({ status: id })}>
              {label}
            </button>
          ))}
        </div>
        {countyId && data?.requests[0]?.countyName && (
          <button type="button" className="chip chip--filter" aria-pressed onClick={() => setFilter({ countyId: undefined })}>
            {data.requests[0].countyName} ✕
          </button>
        )}
        {caseId && (
          <button type="button" className="chip chip--filter" aria-pressed onClick={() => setFilter({ caseId: undefined })}>
            One case ✕
          </button>
        )}
        {!recording && (
          <button type="button" className="btn btn--outline" onClick={() => setRecording(true)}>
            Record a request
          </button>
        )}
      </div>
      {recording && <RecordRequest onDone={() => setRecording(false)} />}
      {!data ? (
        <LoadState error={error} what="requests" />
      ) : (
        <RecordTable
          className="queue-table"
          label="Pre-authorization requests"
          rows={data.requests}
          rowKey={(row) => row.preauthorizationRequestId}
          emptyMessage="No requests here."
          columns={[
            {
              header: 'Number',
              width: '9%',
              rowHeader: true,
              render: (row) => (
                <>
                  <Link className="nowrap" to={preauthorizationPath(row.preauthorizationRequestId)}>{row.requestNumber}</Link>
                  <span className="cell-note nowrap">{formatDay(row.receivedAt)}</span>
                </>
              ),
            },
            { header: 'Case', width: '13%', render: (row) => <><span className="nowrap">{caseText(row)}</span><span className="cell-note">{row.countyName ?? ''}</span></> },
            { header: 'Asked by', width: '10%', render: (row) => row.requestedForName ?? row.requestedByName },
            { header: 'Provider', width: '18%', render: (row) => <>{providerText(row)}<span className="cell-note">{row.kindName ?? row.serviceDescription}</span></> },
            {
              header: 'Asked for',
              width: '12%',
              render: (row) => <><span className="amount">{formatMoney(row.requestedAmount)}</span><span className="cell-note">{rateText(row)}</span></>,
            },
            { header: 'Approved', width: '10%', render: (row) => (row.approvedAmount ? <span className="amount">{formatMoney(row.approvedAmount)}</span> : '—') },
            { header: 'Status', width: '14%', render: (row) => <RequestStatus request={row} /> },
            { header: 'Billed / left', width: '11%', render: (row) => <LimitCell row={row} /> },
          ]}
        />
      )}
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

function UsageByCounty() {
  const [period, setPeriod] = useState(thisYear);
  const { data, error } = useResource(preauthorizationUsage(period));
  const requestsLink = (row: CountyUsage, status: string) =>
    `/preauthorizations?status=${status}${row.countyId ? `&countyId=${row.countyId}` : ''}`;
  const count = (row: CountyUsage, status: string, n: number) =>
    n > 0 && row.countyName !== 'All' ? <Link to={requestsLink(row, status)}>{n}</Link> : n;
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
          <button
            type="button"
            className="btn btn--outline"
            onClick={() =>
              downloadCsv(
                `preauthorization-usage-${period.from}-to-${period.to}.csv`,
                rows.map((row) => ({
                  County: row.countyName,
                  Threshold: row.threshold,
                  'Requests waiting': row.requests.open,
                  'Requests approved': row.requests.approved,
                  'Not needed': row.requests.not_needed,
                  Denied: row.requests.denied,
                  Withdrawn: row.requests.withdrawn,
                  'Asked for': row.requested,
                  Approved: row.approved,
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
          </button>
        )}
      </div>
      <p className="compact-hint">
        Requests count by date received. Billed, left and over are as of today, for cases with a request or invoice in the period.
      </p>
      {!data ? (
        <LoadState error={error} what="usage" />
      ) : (
        <RecordTable
          className="queue-table usage-table"
          label="Pre-authorization use by county"
          rows={rows}
          rowKey={(row) => (row.countyName === 'All' ? 'total' : (row.countyId ?? 'none'))}
          emptyMessage="No requests or invoices in this period."
          columns={[
            { header: 'County or setting', rowHeader: true, render: (row) => (row.countyName === 'All' ? <strong>All</strong> : row.countyName) },
            { header: 'Threshold', render: (row) => (row.threshold ? formatMoney(row.threshold) : '—') },
            {
              header: 'Requests',
              render: (row) => (
                <>
                  {count(row, 'open', row.requests.open)} waiting, {count(row, 'approved', row.requests.approved)} approved
                  <span className="cell-note">
                    {count(row, 'not_needed', row.requests.not_needed)} not needed, {count(row, 'denied', row.requests.denied)} denied,{' '}
                    {count(row, 'withdrawn', row.requests.withdrawn)} withdrawn
                  </span>
                </>
              ),
            },
            { header: 'Asked for / approved', render: (row) => <>{formatMoney(row.requested)}<span className="cell-note">{formatMoney(row.approved)} approved</span></> },
            { header: 'Billed', render: (row) => <>{formatMoney(Number(row.billedApproved) + Number(row.billedWaiting))}<span className="cell-note">{formatMoney(row.billedWaiting)} waiting</span></> },
            { header: 'Left', render: (row) => formatMoney(row.left) },
            {
              header: 'Over their limit',
              render: (row) =>
                row.over.providers === 0 ? (
                  <span className="muted">None</span>
                ) : (
                  <>
                    <span className="total-figure--cut">{row.over.providers} {row.over.providers === 1 ? 'provider' : 'providers'}, {formatMoney(row.over.amount)}</span>
                    <span className="cell-note">{row.over.unexplained} not explained</span>
                  </>
                ),
            },
            {
              header: 'Within the threshold',
              render: (row) =>
                row.withinThreshold.providers === 0 ? (
                  <span className="muted">None</span>
                ) : (
                  <>
                    {row.withinThreshold.providers} {row.withinThreshold.providers === 1 ? 'provider' : 'providers'}
                    <span className="cell-note">{formatMoney(row.withinThreshold.billed)} billed</span>
                  </>
                ),
            },
          ]}
        />
      )}
    </>
  );
}

export default function Preauthorizations() {
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'county' ? 'county' : 'requests';
  return (
    <div>
      <PageHeader
        title="Pre-authorizations"
        description="Requests, and how each county’s limits are used."
      />
      <div className="chip-filters page-tabs" role="tablist" aria-label="View">
        <button type="button" role="tab" className="chip chip--filter" aria-selected={view === 'requests'} aria-pressed={view === 'requests'} onClick={() => setParams({}, { preventScrollReset: true })}>
          Requests
        </button>
        <button type="button" role="tab" className="chip chip--filter" aria-selected={view === 'county'} aria-pressed={view === 'county'} onClick={() => setParams({ view: 'county' }, { preventScrollReset: true })}>
          By county
        </button>
      </div>
      {view === 'county' ? <UsageByCounty /> : <Requests />}
    </div>
  );
}

export function StaffPreauthorizationRequest() {
  const { requestId } = useParams<{ requestId: string }>();
  return <PreauthorizationRequestView staff requestId={requestId as string} crumbs={[{ label: 'Pre-authorizations', to: '/preauthorizations' }]} />;
}
