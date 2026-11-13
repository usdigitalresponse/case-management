// Staff only: matching a request's proposed details, and deciding it.
import { useState } from 'react';
import { Link as RouterLink } from 'react-router';
import { ADD_NEW, PickOrAdd } from '../PickOrAdd';
import { apiErrorMessage, caseOptionLabel, fieldError, searchCases, searchProviders, decidePreauthorizationRequest, matchPreauthorizationRequest, type PreauthorizationMatch, type PreauthorizationRequestDetail, type PreauthorizationRequestRow, type RequestOutcome } from '../../api/client';
import { CountyPicker } from '../CountyPicker';
import { SegmentedChoice } from '../ui/SegmentedChoice';
import type { CountyValue } from '../../counties';
import { Notice } from '../ui/Notice';
import { Button } from '../ui/Button';

export function MatchForm({ request, onMatched }: { request: PreauthorizationRequestRow; onMatched: (next: PreauthorizationRequestDetail) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [providerPick, setProviderPick] = useState('');
  const match = (input: PreauthorizationMatch) =>
    matchPreauthorizationRequest(request.preauthorizationRequestId, input).then(onMatched, (err: unknown) => setError(apiErrorMessage(err, 'Could not match it.')));
  return (
    <section className="card compact-card">
      <h2>Match it</h2>
      <p className="compact-hint">Match what the requester entered to records before deciding. Their entries stay on the request.</p>
      {error && <Notice tone="danger">{error}</Notice>}
      {!request.caseId && <RequestCaseStep request={request} match={match} />}
      {!request.professionalId && (
        <PickOrAdd
          id="match-provider"
          label={`Provider for ${request.proposedProviderName ?? 'this request'}`}
          value={providerPick}
          onChange={(value) => {
            setProviderPick(value);
            if (value && value !== ADD_NEW) void match({ professionalId: value });
          }}
          addLabel="+ Add the provider"
          placeholder="Search by name or email"
          options={[]}
          search={(query) => searchProviders(query).then((found) => found.map((row) => ({ value: row.professionalId, label: row.displayName ?? 'Unnamed' })))}
        >
          <RouterLink to="/vendors">Add them on Providers</RouterLink>, then come back and choose them.
        </PickOrAdd>
      )}
    </section>
  );
}

// The case step as on an invoice (model/rules.yaml match_invoice_to_case): a
// case chosen, one added from its number and county, or not for one case.
function RequestCaseStep({ request, match }: { request: PreauthorizationRequestRow; match: (input: PreauthorizationMatch) => Promise<void> }) {
  const [casePick, setCasePick] = useState('');
  const [caseNumber, setCaseNumber] = useState(request.proposedCaseNumber ?? '');
  const [county, setCounty] = useState<CountyValue | null>(null);
  const [clientName, setClientName] = useState('');
  const [similarListed, setSimilarListed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The county comes first: a case is found in it, and work not for one case counts under it.
  const countyId = county?.countyId ?? request.proposedCountyId ?? request.countyId ?? null;
  const countyHint = county ? undefined : request.proposedCountyId ? 'The county the requester gave.' : !countyId ? 'Add the county first.' : undefined;
  async function addCase(confirmedNew: boolean) {
    setError(null);
    try {
      await matchPreauthorizationRequest(request.preauthorizationRequestId, {
        newCase: { caseNumber, countyId, clientName: clientName.trim() || undefined, confirmedNew },
      }).then(() => match({}));
    } catch (err) {
      setSimilarListed(Boolean(fieldError(err, 'confirmedNew')));
      setError(apiErrorMessage(err, 'The case could not be added.'));
    }
  }
  return (
    <div className="case-step">
      <SegmentedChoice
        label="Which case is it for?"
        value={request.notForCase ? 'none' : 'case'}
        options={[
          { value: 'case', label: 'For a case' },
          { value: 'none', label: 'Not for one case' },
        ]}
        onChange={(value) => void match(value === 'none' ? { notForCase: true, ...(countyId ? { countyId } : {}) } : { notForCase: false })}
      />
      <CountyPicker
        id="match-case-county"
        value={county}
        onChange={(value) => {
          setCounty(value);
          if (request.notForCase && value?.countyId) void match({ notForCase: true, countyId: value.countyId });
        }}
        hint={countyHint}
      />
      {request.notForCase ? (
        <p className="field-hint">
          For work like court observation{request.countyName ? ` in ${request.countyName}` : ''}. Approving it records the decision and amount only, with
          no pre-authorization or limit.
        </p>
      ) : (
        <PickOrAdd
          id="match-case"
          label={`Case for ${request.proposedCaseNumber ?? 'this request'}`}
          value={casePick}
          onChange={(value) => {
            setCasePick(value);
            if (value && value !== ADD_NEW) void match({ caseId: value, ...(countyId ? { countyId } : {}) });
          }}
          addLabel={`+ Add case ${caseNumber || 'from its number'}`}
          placeholder="Search by case number or client"
          options={[]}
          search={(query) => searchCases(query).then((found) => found.map((row) => ({ value: row.caseId, label: caseOptionLabel(row) })))}
        >
          <div className="usa-form-group">
            <label className="usa-label" htmlFor="match-case-number">Case number</label>
            <input id="match-case-number" className="usa-input" value={caseNumber} onChange={(event) => setCaseNumber(event.target.value)} />
          </div>
          <div className="usa-form-group">
            <label className="usa-label" htmlFor="match-case-client">
              Client’s name <span className="field-hint">(optional)</span>
            </label>
            <input id="match-case-client" className="usa-input" value={clientName} onChange={(event) => setClientName(event.target.value)} />
          </div>
          {error && <p className="field-error" role="alert">{error}</p>}
          <Button kind="primary" disabled={!caseNumber.trim() || !countyId} onClick={() => void addCase(similarListed)}>
            {similarListed ? 'It’s a different case: add it' : 'Add the case'}
          </Button>
        </PickOrAdd>
      )}
    </div>
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
