// One request for staff and its requester: details, questions, documents, limit and decision.
import { useState, type ReactNode } from 'react';
import { Link as RouterLink, useLocation } from 'react-router';
import { ADD_NEW, PickOrAdd } from './PickOrAdd';
import {
  addProviderServiceRate,
  answerPreauthorizationQuestion,
  apiErrorMessage,
  type RateBasis,
  askPreauthorizationQuestion,
  decidePreauthorizationRequest,
  linkedDocumentUrl,
  matchPreauthorizationRequest,
  uploadProviderDocument,
  uploadRequestDocument,
  withdrawPreauthorizationRequest,
  type LinkedDocument,
  type PreauthorizationRequestDetail,
  type PreauthorizationRequestRow,
  type RequestOutcome,
} from '../api/client';
import { useResource } from '../hooks/useResource';
import { cases as casesResource, preauthorizationRequest, providerDocuments, vendorSearch } from '../resources';
import { formatDate, formatDay, formatDateTime } from '../formatDateTime';
import { formatMoney } from '../formatMoney';
import { Fact, FactsStrip } from './FactsStrip';
import { LoadState } from './LoadState';
import { Notice } from './Notice';
import { PageHeader } from './PageHeader';
import { StatusPill, type Tone } from './StatusPill';

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
  return request.caseNumber ?? (request.proposedCaseNumber ? <>{request.proposedCaseNumber} <span className="chip chip--warning">Not matched</span></> : '—');
}

export function providerText(request: Pick<PreauthorizationRequestRow, 'providerName' | 'proposedProviderName'>): ReactNode {
  return request.providerName ?? (request.proposedProviderName ? <>{request.proposedProviderName} <span className="chip chip--warning">Not matched</span></> : '—');
}

const PURPOSES: Array<{ id: LinkedDocument['purposeCode']; label: string }> = [
  { id: 'cv', label: 'CV' },
  { id: 'fee_schedule', label: 'Fee schedule' },
  { id: 'quote', label: 'Quote' },
  { id: 'supporting', label: 'Something else' },
];

function DocumentList({ documents }: { documents: LinkedDocument[] }) {
  if (documents.length === 0) return <p className="muted">None yet.</p>;
  return (
    <ul className="plain-list">
      {documents.map((doc) => (
        <li key={doc.documentId}>
          <a href={linkedDocumentUrl(doc.documentId)}>{doc.displayName}</a> <span className="cell-note">{doc.purposeName}, added {formatDay(doc.recordedAt)}</span>
        </li>
      ))}
    </ul>
  );
}

function AddDocument({ onAdd, defaultPurpose }: { onAdd: (file: File, purpose: LinkedDocument['purposeCode']) => Promise<unknown>; defaultPurpose: LinkedDocument['purposeCode'] }) {
  const [purpose, setPurpose] = useState(defaultPurpose);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = `doc-${Math.random().toString(36).slice(2, 8)}`;
  return (
    <div className="inline-fields">
      <div className="usa-form-group">
        <label className="usa-label" htmlFor={`${id}-purpose`}>It is a</label>
        <select id={`${id}-purpose`} className="usa-select" value={purpose} onChange={(event) => setPurpose(event.target.value as LinkedDocument['purposeCode'])}>
          {PURPOSES.map((option) => (
            <option key={option.id} value={option.id}>{option.label}</option>
          ))}
        </select>
      </div>
      <div className="usa-form-group">
        <label className="usa-label" htmlFor={`${id}-file`}>File (PDF, Word or image)</label>
        <input
          id={`${id}-file`}
          className="usa-file-input"
          type="file"
          disabled={busy}
          accept=".pdf,.docx,.png,.jpg,.jpeg"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            setBusy(true);
            setError(null);
            onAdd(file, purpose)
              .catch((err: unknown) => setError(apiErrorMessage(err, 'The file could not be added.')))
              .finally(() => {
                setBusy(false);
                event.target.value = '';
              });
          }}
        />
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
    </div>
  );
}

// model/rules.yaml request_provider_documents.
export function ProviderOnFile({ professionalId, name }: { professionalId: string; name: string }) {
  const { data, error, reload } = useResource(providerDocuments(professionalId));
  const [service, setService] = useState('');
  const [rate, setRate] = useState('');
  const [basis, setBasis] = useState<RateBasis>('hourly');
  const [from, setFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [rateError, setRateError] = useState<string | null>(null);
  if (!data) return error ? <Notice tone="danger">Failed to load what is on file.</Notice> : null;
  return (
    <section className="compact-card preauth-page">
      <h2>On file for {name}</h2>
      {data.missing.length > 0 && (
        <Notice tone="warning">Missing: {data.missing.map((code) => (code === 'cv' ? 'CV' : 'fee schedule or quote')).join(' and ')}.</Notice>
      )}
      <DocumentList documents={data.documents} />
      <AddDocument defaultPurpose={data.missing[0] ?? 'fee_schedule'} onAdd={(file, purpose) => uploadProviderDocument(professionalId, file, purpose).then(reload)} />
      <h3>Fees they quote</h3>
      {data.rates.length === 0 ? (
        <p className="muted">None recorded.</p>
      ) : (
        <ul className="plain-list">
          {data.rates.map((row) => (
            <li key={row.providerServiceRateId}>
              {row.serviceDescription}: {formatMoney(row.rate)} {row.rateBasis === 'flat' ? 'flat' : row.rateBasis === 'hourly' ? 'an hour' : 'a unit'}
              <span className="cell-note">from {formatDate(row.effectiveFrom)}</span>
            </li>
          ))}
        </ul>
      )}
      <form
        className="inline-fields"
        onSubmit={(event) => {
          event.preventDefault();
          setRateError(null);
          addProviderServiceRate(professionalId, { serviceDescription: service.trim(), rate: Number(rate), rateBasis: basis, effectiveFrom: from }).then(
            () => {
              setService('');
              setRate('');
              void reload();
            },
            (err: unknown) => setRateError(apiErrorMessage(err, 'The fee could not be added.')),
          );
        }}
      >
        <div className="usa-form-group">
          <label className="usa-label" htmlFor="fee-service">Service</label>
          <input id="fee-service" className="usa-input" value={service} onChange={(event) => setService(event.target.value)} />
        </div>
        <div className="usa-form-group">
          <label className="usa-label" htmlFor="fee-rate">Fee ($)</label>
          <input id="fee-rate" className="usa-input" type="number" min="0.01" step="0.01" value={rate} onChange={(event) => setRate(event.target.value)} />
        </div>
        <div className="usa-form-group">
          <label className="usa-label" htmlFor="fee-basis">Per</label>
          <select id="fee-basis" className="usa-select" value={basis} onChange={(event) => setBasis(event.target.value as RateBasis)}>
            <option value="hourly">Hour</option>
            <option value="flat">Flat fee</option>
            <option value="per_unit">Unit</option>
          </select>
        </div>
        <div className="usa-form-group">
          <label className="usa-label" htmlFor="fee-from">From</label>
          <input id="fee-from" className="usa-input" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        </div>
        <button type="submit" className="btn btn--outline" disabled={!service.trim() || !(Number(rate) > 0)}>
          Add fee
        </button>
        {rateError && <p className="field-error" role="alert">{rateError}</p>}
      </form>
    </section>
  );
}

function MatchForm({ request, onMatched }: { request: PreauthorizationRequestRow; onMatched: (next: PreauthorizationRequestDetail) => void }) {
  const cases = useResource(request.caseId ? null : casesResource);
  const [query, setQuery] = useState(request.proposedProviderName ?? '');
  const vendors = useResource(request.professionalId || !query.trim() ? null : vendorSearch(query.trim()));
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
    <section className="compact-card">
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
            placeholder={vendors.data?.professionals.length ? 'Choose a provider' : 'No match'}
            options={(vendors.data?.professionals ?? []).map((row) => ({ value: row.professionalId, label: row.displayName ?? 'Unnamed' }))}
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

function DecisionForm({ request, onDecided }: { request: PreauthorizationRequestRow; onDecided: (next: PreauthorizationRequestDetail) => void }) {
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
    <section className="compact-card">
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
      <button
        type="button"
        className="btn btn--primary"
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
      </button>
    </section>
  );
}

function Questions({ detail, staff, mayAnswer, onChanged }: { detail: PreauthorizationRequestDetail; staff: boolean; mayAnswer: boolean; onChanged: (next: PreauthorizationRequestDetail) => void }) {
  const [question, setQuestion] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const open = detail.request.statusCode === 'submitted' || detail.request.statusCode === 'info_requested';
  const id = detail.request.preauthorizationRequestId;
  return (
    <section className="compact-card">
      <h2>Questions</h2>
      {error && <Notice tone="danger">{error}</Notice>}
      {detail.questions.length === 0 && <p className="muted">No questions asked.</p>}
      {detail.questions.map((row) => (
        <div key={row.preauthorizationQuestionId} className="preauth-question">
          <p>
            <strong>{row.question}</strong>
            <span className="cell-note">{row.askedByName}, {formatDateTime(row.askedAt)}</span>
          </p>
          {row.answer ? (
            <p>
              {row.answer}
              <span className="cell-note">{row.answeredByName}, {row.answeredAt ? formatDateTime(row.answeredAt) : ''}</span>
            </p>
          ) : (
            open &&
            mayAnswer && (
              <div className="preauth-message">
                <label className="usa-sr-only" htmlFor={`answer-${row.preauthorizationQuestionId}`}>Answer</label>
                <textarea
                  id={`answer-${row.preauthorizationQuestionId}`}
                  className="usa-textarea"
                  placeholder={staff ? 'Record the answer you were given' : 'Your answer'}
                  value={answers[row.preauthorizationQuestionId] ?? ''}
                  onChange={(event) => setAnswers({ ...answers, [row.preauthorizationQuestionId]: event.target.value })}
                />
                <button
                  type="button"
                  className="btn btn--outline"
                  disabled={!answers[row.preauthorizationQuestionId]?.trim()}
                  onClick={() =>
                    answerPreauthorizationQuestion(id, row.preauthorizationQuestionId, answers[row.preauthorizationQuestionId]!.trim()).then(onChanged, (err: unknown) =>
                      setError(apiErrorMessage(err, 'The answer could not be saved.')),
                    )
                  }
                >
                  {staff ? 'Record answer' : 'Send answer'}
                </button>
              </div>
            )
          )}
        </div>
      ))}
      {staff && open && (
        <div className="preauth-message">
          <label className="usa-sr-only" htmlFor="preauth-ask">Ask the requester</label>
          <textarea id="preauth-ask" className="usa-textarea" placeholder="Ask the requester for more information" maxLength={2000} value={question} onChange={(event) => setQuestion(event.target.value)} />
          <button
            type="button"
            className="btn btn--outline"
            disabled={!question.trim()}
            onClick={() =>
              askPreauthorizationQuestion(id, question.trim()).then(
                (next) => {
                  setQuestion('');
                  onChanged(next);
                },
                (err: unknown) => setError(apiErrorMessage(err, 'The question could not be sent.')),
              )
            }
          >
            Ask
          </button>
        </div>
      )}
    </section>
  );
}

export function PreauthorizationRequestView({ requestId, staff, crumbs }: { requestId: string; staff: boolean; crumbs: Array<{ label: string; to?: string }> }) {
  const { data, error, reload } = useResource(preauthorizationRequest(requestId));
  // Each change returns the request as it now is.
  const [changedTo, setChangedTo] = useState<PreauthorizationRequestDetail | null>(null);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const sentUploadError = (useLocation().state as { uploadError?: string | null } | null)?.uploadError ?? null;
  const detail = changedTo?.request.preauthorizationRequestId === requestId ? changedTo : data;
  if (!detail) return <LoadState error={error} what="request" />;
  const changed = (next: PreauthorizationRequestDetail) => setChangedTo(next);
  const refetch = () => {
    setChangedTo(null);
    return reload();
  };
  const { request } = detail;
  const open = request.statusCode === 'submitted' || request.statusCode === 'info_requested';
  const limit = request.limit;
  const billed = limit ? Number(limit.approvedSoFar) + Number(limit.waiting) : null;
  return (
    <div className="preauth-page">
      <PageHeader
        crumbs={[...crumbs, { label: request.requestNumber }]}
        title={`Request ${request.requestNumber}`}
        status={<RequestStatus request={request} />}
        actions={
          !staff &&
          open && (
            <button
              type="button"
              className="btn btn--outline"
              onClick={() =>
                withdrawPreauthorizationRequest(request.preauthorizationRequestId).then(changed, (err: unknown) =>
                  setWithdrawError(apiErrorMessage(err, 'The request could not be withdrawn.')),
                )
              }
            >
              Withdraw it
            </button>
          )
        }
      />
      {withdrawError && <Notice tone="danger">{withdrawError}</Notice>}
      {sentUploadError && (
        <Notice tone="danger">The request was sent, but a file wasn’t added: {sentUploadError} Add it under Documents below.</Notice>
      )}
      {request.statusCode === 'info_requested' && !staff && <Notice tone="warning">The billing office asked a question. Answer it below.</Notice>}
      <FactsStrip>
        <Fact label="Case">{caseText(request)}</Fact>
        <Fact label="County">{request.countyName ?? '—'}</Fact>
        <Fact label="Provider" note={request.kindName ?? undefined}>{providerText(request)}</Fact>
        <Fact label="Asked for" note={rateText(request)}>
          <strong>{formatMoney(request.requestedAmount)}</strong>
        </Fact>
        <Fact label="Received" note={[request.receivedVia, request.requestedForName ? `from ${request.requestedForName}` : request.requestedByName].filter(Boolean).join(', ')}>
          {formatDay(request.receivedAt)}
        </Fact>
      </FactsStrip>
      <div className="case-columns">
        <section className="compact-card">
          <h2>The request</h2>
          <p><strong>{request.serviceDescription}</strong></p>
          <p className="preserve-lines">{request.justification}</p>
          {request.decidedAt && (
            <>
              <h3>Decision</h3>
              <p>
                <RequestStatus request={request} />{' '}
                {request.approvedAmount && <>Total approved {formatMoney(request.approvedAmount)}{request.approvedHourlyRate && ` at ${formatMoney(request.approvedHourlyRate)} an hour`}. </>}
                <span className="cell-note">{[request.decidedByName, formatDateTime(request.decidedAt)].filter(Boolean).join(', ')}</span>
              </p>
              {request.decisionReason && <p className="preserve-lines">{request.decisionReason}</p>}
            </>
          )}
        </section>
        <section className="compact-card">
          <h2>Provider’s limit on this case</h2>
          {limit ? (
            <div className="preauth-billed"><dl>
              <div>
                <dt>{limit.source === 'threshold' ? 'Threshold (nothing pre-authorized)' : 'Pre-authorized'}</dt>
                <dd>{formatMoney(limit.ceiling)}</dd>
              </div>
              <div>
                <dt>Billed (approved and waiting)</dt>
                <dd>{formatMoney(billed ?? 0)}</dd>
              </div>
              <div>
                <dt>{(billed ?? 0) > Number(limit.ceiling) ? 'Over' : 'Left'}</dt>
                <dd className={(billed ?? 0) > Number(limit.ceiling) ? 'total-figure--cut' : undefined}>{formatMoney(Math.abs(Number(limit.ceiling) - (billed ?? 0)))}</dd>
              </div>
            </dl></div>
          ) : (
            <p className="muted">{request.caseId && request.professionalId ? 'No limit applies to this provider here.' : 'Shown once the case and provider are matched.'}</p>
          )}
        </section>
      </div>
      <Questions detail={detail} staff={staff} mayAnswer onChanged={changed} />
      <div className="case-columns">
        <section className="compact-card">
          <h2>Attached to this request</h2>
          <DocumentList documents={detail.documents} />
          {open && <AddDocument defaultPurpose="supporting" onAdd={(file, purpose) => uploadRequestDocument(request.preauthorizationRequestId, file, purpose).then(refetch)} />}
        </section>
        {detail.providerDocuments && request.professionalId && (
          <section className="compact-card">
            <h2>On file for {request.providerName}</h2>
            {detail.providerDocuments.missing.length > 0 && (
              <Notice tone="warning">
                Missing: {detail.providerDocuments.missing.map((code) => (code === 'cv' ? 'CV' : 'fee schedule or quote')).join(' and ')}.
              </Notice>
            )}
            <DocumentList documents={detail.providerDocuments.documents} />
            <AddDocument
              defaultPurpose={detail.providerDocuments.missing[0] ?? 'fee_schedule'}
              onAdd={(file, purpose) => uploadProviderDocument(request.professionalId!, file, purpose).then(refetch)}
            />
          </section>
        )}
      </div>
      {staff && detail.canDecide && (!request.caseId || !request.professionalId) && <MatchForm request={request} onMatched={changed} />}
      {staff && detail.canDecide && <DecisionForm key={request.statusCode} request={request} onDecided={changed} />}
    </div>
  );
}
