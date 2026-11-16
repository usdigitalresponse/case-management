import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { PreauthorizationRequestRow } from '../../api/client';
import { formatDay } from '../../formatDateTime';
import { formatMoney } from '../../formatMoney';
import type { RecordTableColumn } from '../RecordTable';
import { StatusPill, type Tone } from '../StatusPill';
import { Tag } from '../ui/Tag';

const STATUS_TONES: Record<string, Tone> = {
  submitted: 'info',
  info_requested: 'warning',
  approved: 'success',
  denied: 'danger',
  not_needed: 'neutral',
  withdrawn: 'neutral',
};

export function RequestStatus({ request }: { request: Pick<PreauthorizationRequestRow, 'statusCode' | 'statusName' | 'outcomeName'> }) {
  return <StatusPill tone={STATUS_TONES[request.statusCode]} label={request.outcomeName ?? request.statusName} />;
}

export function rateText(request: Pick<PreauthorizationRequestRow, 'rateBasis' | 'requestedRate' | 'estimatedQuantity'>): string {
  if (request.rateBasis === 'flat') return 'Flat fee';
  const unit = request.rateBasis === 'hourly' ? 'hour' : 'unit';
  const rate = request.requestedRate ? `${formatMoney(request.requestedRate)} an ${unit === 'hour' ? 'hour' : 'unit'}` : 'No rate';
  return request.estimatedQuantity ? `${rate} × ${Number(request.estimatedQuantity)}` : rate;
}

export function caseText(request: Pick<PreauthorizationRequestRow, 'caseNumber' | 'proposedCaseNumber'>): ReactNode {
  return request.caseNumber ?? (request.proposedCaseNumber ? <>{request.proposedCaseNumber} <Tag tone="warning">Not matched</Tag></> : '—');
}

export function providerText(request: Pick<PreauthorizationRequestRow, 'providerName' | 'proposedProviderName'>): ReactNode {
  return request.providerName ?? (request.proposedProviderName ? <>{request.proposedProviderName} <Tag tone="warning">Not matched</Tag></> : '—');
}

// The columns staff and requesters' request lists share (design K).
export function requestColumns(pathOf: (requestId: string) => string): Record<
  'number' | 'case' | 'provider' | 'askedFor' | 'approved' | 'status',
  RecordTableColumn<PreauthorizationRequestRow>
> {
  return {
    number: {
      header: 'Number',
      rowHeader: true,
      render: (row) => (
        <>
          <Link className="nowrap" to={pathOf(row.preauthorizationRequestId)}>{row.requestNumber}</Link>
          <span className="cell-note nowrap">{formatDay(row.receivedAt)}</span>
        </>
      ),
    },
    case: { header: 'Case', render: (row) => <><span className="nowrap">{caseText(row)}</span><span className="cell-note">{row.countyName ?? ''}</span></> },
    provider: { header: 'Provider', render: (row) => <>{providerText(row)}<span className="cell-note">{row.kindName ?? row.serviceDescription}</span></> },
    askedFor: {
      header: 'Asked for',
      render: (row) => <><span className="amount">{formatMoney(row.requestedAmount)}</span><span className="cell-note">{rateText(row)}</span></>,
    },
    approved: { header: 'Approved', render: (row) => (row.approvedAmount ? <span className="amount">{formatMoney(row.approvedAmount)}</span> : '—') },
    status: { header: 'Status', render: (row) => <RequestStatus request={row} /> },
  };
}
