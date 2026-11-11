import type { ReactNode } from 'react';
import type { PreauthorizationRequestRow } from '../../api/client';
import { formatMoney } from '../../formatMoney';
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
