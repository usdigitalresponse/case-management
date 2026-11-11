// Staff only: matching a request's proposed details, and deciding it.
import { useState } from 'react';
import { Link as RouterLink } from 'react-router';
import { ADD_NEW, PickOrAdd } from '../PickOrAdd';
import { apiErrorMessage, decidePreauthorizationRequest, matchPreauthorizationRequest, type PreauthorizationRequestDetail, type PreauthorizationRequestRow, type RequestOutcome } from '../../api/client';
import { useResource } from '../../hooks/useResource';
import { cases as casesResource, providerList } from '../../resources';
import { Notice } from '../ui/Notice';
import { Button } from '../ui/Button';

export function MatchForm({ request, onMatched }: { request: PreauthorizationRequestRow; onMatched: (next: PreauthorizationRequestDetail) => void }) {
  const cases = useResource(request.caseId ? null : casesResource);
  const [query, setQuery] = useState(request.proposedProviderName ?? '');
  const vendors = useResource(request.professionalId || !query.trim() ? null : providerList(query.trim()));
  const [error, setError] = useState<string | null>(null);
  const [casePick, setCasePick] = useState('');
  const [providerPick, setProviderPick] = useState('');
  const match = (input: { caseId?: string; professionalId?: string }) =>
    matchPreauthorizationRequest(request.preauthorizationRequestId, input).then(onMatched, (err: unknown) => setError(apiErrorMessage(err, 'Could not match it.')));
  const pick = (value: string, set: (value: string) => void, input: (value: string) => { caseId?: string; professionalId?: string }) => {
    set(value);
    if (value && value !== ADD_NEW) void match(input(value));
  };
  return (
    <section className="card compact-card">
      <h2>Match it</h2>
      <p className="compact-hint">Match what the requester entered to records before deciding. Their entries stay on the request.</p>
      {error && <Notice tone="danger">{error}</Notice>}
      {!request.caseId && (
        <PickOrAdd
          id="match-case"
          label={`Case for ${request.proposedCaseNumber ?? 'this request'}`}
          value={casePick}
          onChange={(value) => pick(value, setCasePick, (caseId) => ({ caseId }))}
          addLabel="+ Add the case"
          placeholder="Choose a case"
          options={(cases.data?.cases ?? []).map((row) => ({ value: row.caseId, label: [row.caseNumber, row.clientDisplayName].filter(Boolean).join(' · ') }))}
        >
          <RouterLink to={`/cases/new?${new URLSearchParams(request.proposedCaseNumber ? { number: request.proposedCaseNumber } : {})}`}>
            Add case {request.proposedCaseNumber}
          </RouterLink>
          , then come back and choose it.
        </PickOrAdd>
      )}
      {!request.professionalId && (
        <>
          <div className="usa-form-group">
            <label className="usa-label" htmlFor="match-provider-search">Find the provider</label>
            <input id="match-provider-search" className="usa-input" value={query} onChange={(event) => setQuery(event.target.value)} />
          </div>
          <PickOrAdd
            id="match-provider"
            label="Provider"
            value={providerPick}
            onChange={(value) => pick(value, setProviderPick, (professionalId) => ({ professionalId }))}
            addLabel="+ Add the provider"
            placeholder={vendors.data?.length ? 'Choose a provider' : 'No match'}
            options={(vendors.data ?? []).map((row) => ({ value: row.professionalId, label: row.displayName ?? 'Unnamed' }))}
          >
            <RouterLink to="/vendors">Add them on Providers</RouterLink>, then come back and choose them.
          </PickOrAdd>
        </>
      )}
    </section>
  );
}

const OUTCOMES: Array<{ id: RequestOutcome; label: string }> = [
  { id: 'approved', label: 'Approve' },
  { id: 'not_needed', label: 'Not needed: within the threshold' },
  { id: 'duplicate', label: 'Duplicate' },
  { id: 'moot', label: 'Moot: the work was already done' },
  { id: 'denied', label: 'Deny' },
];

export function DecisionForm({ request, onDecided }: { request: PreauthorizationRequestRow; onDecided: (next: PreauthorizationRequestDetail) => void }) {
  // Within the threshold, "not needed" is the likely decision.
  const [outcome, setOutcome] = useState<RequestOutcome>(
    request.limit?.source === 'threshold' && Number(request.requestedAmount) <= Number(request.limit.ceiling) ? 'not_needed' : 'approved',
  );
  const [amount, setAmount] = useState(request.requestedAmount);
  const [hourlyRate, setHourlyRate] = useState(request.rateBasis === 'hourly' ? (request.requestedRate ?? '') : '');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const approving = outcome === 'approved';
  return (
    <section className="card compact-card">
      <h2>Decide</h2>
      {error && <Notice tone="danger">{error}</Notice>}
      <fieldset className="usa-fieldset">
        <legend className="usa-sr-only">Decision</legend>
        {OUTCOMES.map((option) => (
          <label key={option.id} className="radio-row">
            <input type="radio" name="preauth-outcome" checked={outcome === option.id} onChange={() => setOutcome(option.id)} />
            <span>{option.label}</span>
          </label>
        ))}
      </fieldset>
      {approving && (
        <div className="inline-fields">
          <div className="usa-form-group">
            <label className="usa-label" htmlFor="decide-amount">Total approved ($)</label>
            <input id="decide-amount" className="usa-input" type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} />
          </div>
          <div className="usa-form-group">
            <label className="usa-label" htmlFor="decide-rate">Hourly rate approved ($, optional)</label>
            <input id="decide-rate" className="usa-input" type="number" min="0.01" step="0.01" value={hourlyRate} onChange={(event) => setHourlyRate(event.target.value)} />
          </div>
        </div>
      )}
      <div className="usa-form-group">
        <label className="usa-label" htmlFor="decide-reason">{approving ? 'Note (optional)' : 'Reason the requester will see'}</label>
        <textarea id="decide-reason" className="usa-textarea" maxLength={2000} value={reason} onChange={(event) => setReason(event.target.value)} />
      </div>
      <Button
        kind="primary"
        disabled={busy || (approving ? !(Number(amount) > 0) : !reason.trim())}
        onClick={() => {
          setBusy(true);
          setError(null);
          decidePreauthorizationRequest(request.preauthorizationRequestId, {
            outcome,
            ...(approving ? { approvedAmount: Number(amount), approvedHourlyRate: hourlyRate ? Number(hourlyRate) : null } : {}),
            reason: reason.trim() || undefined,
          })
            .then(onDecided, (err: unknown) => setError(apiErrorMessage(err, 'The decision could not be saved.')))
            .finally(() => setBusy(false));
        }}
      >
        Record the decision
      </Button>
    </section>
  );
}
