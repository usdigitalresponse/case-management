// One request for staff and its requester: details, questions, documents, limit and decision.
import { useState } from 'react';
import { useLocation } from 'react-router';
import { apiErrorMessage, restoreDocument, retireDocument, uploadProviderDocument, uploadRequestDocument, withdrawPreauthorizationRequest, type LinkedDocument, type PreauthorizationRequestDetail } from '../api/client';
import { useResource } from '../hooks/useResource';
import { preauthorizationRequest } from '../resources';
import { formatDay, formatDateTime } from '../formatDateTime';
import { formatMoney } from '../formatMoney';
import { Fact, FactsStrip } from './FactsStrip';
import { LoadState } from './LoadState';
import { Notice } from './ui/Notice';
import { PageHeader } from './PageHeader';
import { Button } from './ui/Button';
import { RequestStatus, caseText, providerText, rateText } from './preauthorizationRequest/requestText';
import { AddDocument, DocumentList, QuotedFees } from './preauthorizationRequest/ProviderOnFile';
import { DecisionForm, MatchForm } from './preauthorizationRequest/StaffForms';
import { Questions } from './preauthorizationRequest/RequestQuestions';
import { Toast, useToast } from './Toast';

export function PreauthorizationRequestView({ requestId, staff, crumbs }: { requestId: string; staff: boolean; crumbs: Array<{ label: string; to?: string }> }) {
  const { data, error, reload } = useResource(preauthorizationRequest(requestId));
  // Each change returns the request as it now is.
  const [changedTo, setChangedTo] = useState<PreauthorizationRequestDetail | null>(null);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [toast, setToast] = useToast(8000);
  const [fileError, setFileError] = useState<string | null>(null);
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
  const retire = (doc: LinkedDocument) => {
    setFileError(null);
    return retireDocument(doc.documentId).then(
      () => {
        setToast({ message: `${doc.displayName} removed.`, undo: () => restoreDocument(doc.documentId) });
        return refetch();
      },
      (err: unknown) => setFileError(apiErrorMessage(err, 'The file could not be removed.')),
    );
  };
  const undoRetire = (undo: () => Promise<unknown>) => {
    setToast(null);
    setFileError(null);
    undo().then(refetch, (err: unknown) => setFileError(apiErrorMessage(err, 'The file could not be put back.')));
  };
  return (
    <div className="preauth-page">
      <PageHeader
        crumbs={[...crumbs, { label: request.requestNumber }]}
        title={`Request ${request.requestNumber}`}
        status={<RequestStatus request={request} />}
        actions={
          !staff &&
          open && (
            <Button
              kind="secondary"
              onClick={() =>
                withdrawPreauthorizationRequest(request.preauthorizationRequestId).then(changed, (err: unknown) =>
                  setWithdrawError(apiErrorMessage(err, 'The request could not be withdrawn.')),
                )
              }
            >
              Withdraw it
            </Button>
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
        <section className="card compact-card">
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
        <section className="card compact-card">
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
      {!staff && request.statusCode === 'info_requested' && (
        // Beside the answer, so a question asking for a file shows where to add it.
        <section className="card compact-card" aria-label="Add a file the question asks for">
          <p className="compact-hint">Add any file the question asks for here.</p>
          {detail.providerDocuments && detail.providerDocuments.missing.length > 0 && (
            <Notice tone="warning">
              Missing: {detail.providerDocuments.missing.map((code) => (code === 'cv' ? 'CV' : 'fee schedule or quote')).join(' and ')}.
            </Notice>
          )}
          <AddDocument
            defaultPurpose={detail.providerDocuments?.missing[0] ?? 'supporting'}
            onAdd={(file, purpose) =>
              (purpose !== 'supporting' && request.professionalId
                ? uploadProviderDocument(request.professionalId, file, purpose)
                : uploadRequestDocument(request.preauthorizationRequestId, file, purpose)
              ).then(refetch)
            }
          />
        </section>
      )}
      {fileError && <Notice tone="danger">{fileError}</Notice>}
      <div className="case-columns">
        <section className="card compact-card">
          <h2>Attached to this request</h2>
          <DocumentList documents={detail.documents} onRetire={open ? retire : undefined} from="this request" />
          {open && <AddDocument defaultPurpose="supporting" onAdd={(file, purpose) => uploadRequestDocument(request.preauthorizationRequestId, file, purpose).then(refetch)} />}
        </section>
        {detail.providerDocuments && request.professionalId && (
          <section className="card compact-card">
            <h2>On file for {request.providerName}</h2>
            {detail.providerDocuments.missing.length > 0 && (
              <Notice tone="warning">
                Missing: {detail.providerDocuments.missing.map((code) => (code === 'cv' ? 'CV' : 'fee schedule or quote')).join(' and ')}.
              </Notice>
            )}
            <DocumentList documents={detail.providerDocuments.documents} onRetire={retire} from={`${request.providerName}'s file`} />
            <AddDocument
              defaultPurpose={detail.providerDocuments.missing[0] ?? 'fee_schedule'}
              onAdd={(file, purpose) => uploadProviderDocument(request.professionalId!, file, purpose).then(refetch)}
            />
            <QuotedFees professionalId={request.professionalId} rates={detail.providerDocuments.rates} onAdded={() => void refetch()} />
          </section>
        )}
      </div>
      {staff && detail.canDecide && (!request.caseId || !request.professionalId) && <MatchForm request={request} onMatched={changed} />}
      {staff && detail.canDecide && <DecisionForm key={request.statusCode} request={request} onDecided={changed} />}
      <Toast toast={toast} onUndo={undoRetire} />
    </div>
  );
}
