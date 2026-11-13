// The request log and usage by county (model/rules.yaml request_preauthorization, report_preauthorization_usage).
import { useState } from 'react';
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
import { caseText, providerText, rateText, RequestStatus } from '../components/preauthorizationRequest/requestText';
import { PreauthorizationRequestView } from '../components/PreauthorizationRequestView';
import { downloadCsv } from '../downloadCsv';
import { formatDay } from '../formatDateTime';
import { formatMoney } from '../formatMoney';
import { FilterTag } from '../components/ui/Tag';
import { Tabs } from '../components/ui/Tabs';
import { preauthorizationRequestsRequest, REQUEST_STATUS_TABS, type RequestStatusTab } from '../caseRequests';
import { Button } from '../components/ui/Button';
import { Notice } from '../components/ui/Notice';
import { UsedBar } from '../components/UsedBar';

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
      <p className="compact-hint">
        Requests count by date received. Used, left and over are as of today, for cases with a request or invoice in the period.
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
                  {count(row, 'submitted', row.requests.submitted)} waiting, {count(row, 'approved', row.requests.approved)} approved
                  <span className="cell-note">
                    {count(row, 'info_requested', row.requests.info_requested)} waiting for information,{' '}
                    {count(row, 'not_needed', row.requests.not_needed)} not needed, {count(row, 'denied', row.requests.denied)} denied,{' '}
                    {count(row, 'withdrawn', row.requests.withdrawn)} withdrawn
                  </span>
                </>
              ),
            },
            { header: 'Asked for / approved', render: (row) => <>{formatMoney(row.requested)}<span className="cell-note">{formatMoney(row.approved)} approved</span></> },
            { header: 'Used and left', render: (row) => <UsedAndLeft row={row} /> },
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
      <Notice tone="info">
        A provider is over their limit when what they billed on a case passes what was pre-authorized, or the threshold if nothing was.
        Going over is explained by the sender and flagged for the reviewer, never refused.
      </Notice>
    </>
  );
}

// Billed so far against each limit, with a bar for the share used (design K55).
function UsedAndLeft({ row }: { row: CountyUsage }) {
  const approved = Number(row.billedApproved);
  const waiting = Number(row.billedWaiting);
  const used = approved + waiting;
  const left = Math.max(0, Number(row.left));
  const limit = used + left;
  return (
    <>
      <strong>{formatMoney(used)} used</strong>
      <UsedBar approved={approved} waiting={waiting} limit={limit} />
      <span className="cell-note">
        {limit > 0 ? `${Math.round((used / limit) * 100)}% used. ` : ''}
        {formatMoney(left)} left.
      </span>
      {waiting > 0 && <span className="cell-note">{formatMoney(waiting)} of it waits for a decision</span>}
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
