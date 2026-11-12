import { useRef, useState } from 'react';
import { Link as RouterLink, useLocation, useNavigate, useSearchParams } from 'react-router';
import {
  apiErrorMessage,
  matchInvoiceToCase,
  returnToSubmitter,
  searchCases,
  type CaseListRecord,
  type IntakeCase,
  type IntakeItem,
} from '../api/client';
import { AddProvider } from '../components/AddProvider';
import { ADD_NEW, PickOrAdd } from '../components/PickOrAdd';
import {
  createCaseFromEntry,
  EnteredFlag,
  NewCaseError,
  newCaseEntry,
  proposedCaseLabel,
  StaffNewCaseFields,
  type NewCaseEntry,
} from '../components/NewEntryFields';
import { useResource } from '../hooks/useResource';
import { useBatchedResource } from '../hooks/useBatchedResource';
import { MoreOnScroll } from '../components/MoreOnScroll';
import { billableProfessionals, invoiceIntake, myInvoices } from '../resources';
import { PageHeader } from '../components/PageHeader';
import { LoadState } from '../components/LoadState';
import { Notice } from '../components/ui/Notice';
import { RecordTable } from '../components/RecordTable';
import { Toast, useToast } from '../components/Toast';
import { formatDate } from '../formatDateTime';
import { formatMoney } from '../formatMoney';
import { StatusPill, type Tone } from '../components/StatusPill';
import { professionalLabel } from '../invoiceLines';
import { caseDisplayLabel } from '../caseDisplayLabel';
import { DropZone, type UploadStart } from '../components/upload/UploadFiles';
import { UPLOAD_PATH } from '../portal/useShell';
import { MyInvoicesTable } from '../portal/MyInvoicesTable';
import type { UploadedState } from '../portal/PortalInvoiceList';
import { Button } from '../components/ui/Button';
import { Tag } from '../components/ui/Tag';

const STAGES: Record<IntakeItem['stage'], { label: string; tone: Tone }> = {
  reading: { label: 'Reading the file', tone: 'neutral' },
  unreadable: { label: "Couldn't be read", tone: 'danger' },
  to_confirm: { label: 'Check the import', tone: 'warning' },
  ready: { label: 'Needs a case', tone: 'info' },
  sent: { label: 'Sent by the submitter: match it', tone: 'warning' },
};

// Match an invoice to a case, adding its providers to the case when they
// aren't on it. A case closed here is reopened by matching.
function MatchPanel({ item, onMatched }: { item: IntakeItem; onMatched: (message: string) => void }) {
  const needsProfessional = item.professionalId === null;
  const unlisted = item.unlistedTimekeepers;
  const [added, setAdded] = useState<Array<{ professionalId: string; displayName: string }>>([]);
  const { data: listed } = useResource(needsProfessional || unlisted.length > 0 ? billableProfessionals(null) : null);
  const providers = [...(listed ?? []).map((p) => ({ value: p.professionalId, label: professionalLabel(p) })), ...added.map((p) => ({ value: p.professionalId, label: p.displayName }))];
  // Starts from the file's suggestion, or what the submitter entered.
  const [caseId, setCaseId] = useState(item.caseId ?? item.suggestedCaseId ?? (item.proposedCase ? ADD_NEW : ''));
  const [newCase, setNewCase] = useState<NewCaseEntry>(() => newCaseEntry(item.proposedCase ?? undefined));
  const [caseErrors, setCaseErrors] = useState<Record<string, string>>({});
  const [professionalId, setProfessionalId] = useState(
    needsProfessional ? (item.suggestedProfessionalId ?? (item.proposedProvider ? ADD_NEW : '')) : '',
  );
  const [timekeepers, setTimekeepers] = useState<Record<string, string>>(() => Object.fromEntries(unlisted.map((line) => [line.invoiceLineId, ADD_NEW])));
  const [addMissing, setAddMissing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // The chosen case's client, for the message once matched.
  const [chosenClient, setChosenClient] = useState<string | null>(item.suggestedCase?.clientDisplayName ?? null);
  const found = useRef(new Map<string, string | null>());
  const caseLabel = (row: IntakeCase | CaseListRecord) =>
    `${caseDisplayLabel([row.externalReference, row.clientDisplayName], undefined)}${row.closedOn ? ' (closed: matching reopens it)' : ''}`;
  const isId = (value: string) => value !== '' && value !== ADD_NEW;
  const providerName =
    item.professionalDisplayName ?? providers.find((p) => p.value === professionalId)?.label ?? 'the provider';
  const ready =
    (Boolean(item.caseId) || caseId !== '') &&
    (!needsProfessional || isId(professionalId)) &&
    unlisted.every((line) => isId(timekeepers[line.invoiceLineId] ?? ''));

  const addProvider = (onChosen: (id: string) => void) => (provider: { professionalId: string; displayName: string }) => {
    setAdded((current) => [...current, provider]);
    onChosen(provider.professionalId);
  };

  async function match() {
    setSaving(true);
    setError(null);
    setCaseErrors({});
    try {
      const matchedCaseId = item.caseId ?? (caseId === ADD_NEW ? await createCaseFromEntry(newCase) : caseId);
      const result = await matchInvoiceToCase(item.invoiceId!, {
        caseId: matchedCaseId,
        addMissing,
        professionalId: needsProfessional ? professionalId : undefined,
        timekeepers: Object.fromEntries(unlisted.map((line) => [line.invoiceLineId, timekeepers[line.invoiceLineId]!])),
      });
      const to = (caseId === ADD_NEW ? newCase.clientName : chosenClient) ?? 'the case';
      onMatched(
        `Matched to ${to}${result.addedProfessionalIds.length ? `, and ${providerName} was added to it` : ''}.${
          result.released ? ' It has gone on to review.' : result.releaseProblem ? ` It can't go to review yet: ${result.releaseProblem}` : ''
        }`,
      );
    } catch (err) {
      if (err instanceof NewCaseError) {
        setCaseErrors(err.fieldErrors);
      } else {
        setError(apiErrorMessage(err, 'It could not be matched.'));
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="decision-panel">
      <h3>Match to a case</h3>
      {(item.proposedCase || item.proposedProvider) && (
        <div className="entered-details">
          {item.proposedCase && (
            <p>
              <EnteredFlag what="Case" /> {proposedCaseLabel(item.proposedCase)}
              {item.proposedCase.details && <span className="cell-note">{item.proposedCase.details}</span>}
            </p>
          )}
          {item.proposedProvider && (
            <p>
              <EnteredFlag what="Provider" /> {[item.proposedProvider.displayName, item.proposedProvider.email].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
      )}
      <div className="intake-match">
        {item.caseId ? (
          <p>Case: {caseDisplayLabel([item.case?.externalReference ?? null, item.case?.clientDisplayName ?? null], undefined)}</p>
        ) : (
          <PickOrAdd
            id={`match-${item.invoiceId}`}
            label="Case"
            value={caseId}
            onChange={(value) => {
              setCaseId(value);
              setChosenClient(found.current.get(value) ?? null);
            }}
            addLabel="+ Add new case"
            placeholder="Search by case number or client"
            options={[]}
            search={async (query) => {
              const rows = await searchCases(query, 'all');
              for (const row of rows) found.current.set(row.caseId, row.clientDisplayName);
              return rows.map((row) => ({ value: row.caseId, label: caseLabel(row) }));
            }}
            selectedLabel={item.suggestedCase && caseId === item.suggestedCaseId ? caseLabel(item.suggestedCase) : undefined}
            hint={caseId && caseId === item.suggestedCaseId ? <span className="line-row-suggested">Named in the file: check it</span> : undefined}
          >
            <StaffNewCaseFields idPrefix={`match-new-${item.invoiceId}`} value={newCase} onChange={setNewCase} errors={caseErrors} />
          </PickOrAdd>
        )}
        {needsProfessional && (
          <PickOrAdd
            id={`match-from-${item.invoiceId}`}
            label="From"
            value={professionalId}
            onChange={setProfessionalId}
            addLabel="+ Add new person"
            placeholder={listed ? 'Choose who it’s from' : 'Loading…'}
            options={providers}
          >
            <AddProvider inline idPrefix={`match-from-new-${item.invoiceId}`} initial={item.proposedProvider} onAdded={addProvider(setProfessionalId)} />
          </PickOrAdd>
        )}
        {unlisted.map((line) => (
          <PickOrAdd
            key={line.invoiceLineId}
            id={`match-line-${line.invoiceLineId}`}
            label={`Who did “${line.description ?? 'this item'}”`}
            value={timekeepers[line.invoiceLineId] ?? ''}
            onChange={(value) => setTimekeepers((current) => ({ ...current, [line.invoiceLineId]: value }))}
            addLabel="+ Add new person"
            placeholder="Choose who did the work"
            options={providers}
            hint={
              <>
                <EnteredFlag what="Person" />
                {unlisted.length > 1 && added.some((p) => p.professionalId === timekeepers[line.invoiceLineId]) && (
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => setTimekeepers(Object.fromEntries(unlisted.map((other) => [other.invoiceLineId, timekeepers[line.invoiceLineId]!])))}
                  >
                    {`Use ${added.find((p) => p.professionalId === timekeepers[line.invoiceLineId])?.displayName} for the other items too`}
                  </button>
                )}
              </>
            }
          >
            <AddProvider
              inline
              idPrefix={`match-line-new-${line.invoiceLineId}`}
              initial={{ displayName: line.name, email: line.email ?? undefined }}
              onAdded={addProvider((id) => setTimekeepers((current) => ({ ...current, [line.invoiceLineId]: id })))}
            />
          </PickOrAdd>
        ))}
      </div>
      <label className="checkbox-row">
        <input type="checkbox" checked={addMissing} onChange={(event) => setAddMissing(event.target.checked)} />
        Add {providerName} and anyone else who did the work to the case if they aren't on it
      </label>
      <div className="button-row">
        <Button kind="primary" disabled={!ready || saving} onClick={() => void match()}>
          {caseId === ADD_NEW ? 'Add the case and match' : 'Match'}
        </Button>
        {!item.caseId && item.professionalId && (
          <RouterLink to={`/cases/new?intake=${item.invoiceId}`}>Add the case with all its details instead</RouterLink>
        )}
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
      {item.stage === 'sent' && <SendBack item={item} onSent={onMatched} />}
    </div>
  );
}

// Back to the submitter's drafts, with what to change; they see the reason
// until they send it again.
function SendBack({ item, onSent }: { item: IntakeItem; onSent: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const who = item.enteredByDisplayName ?? 'the submitter';

  async function send() {
    setSaving(true);
    setError(null);
    try {
      await returnToSubmitter(item.invoiceId!, reason.trim());
      onSent(`Sent back to ${who} for changes.`);
    } catch (err) {
      setError(apiErrorMessage(err, 'It could not be sent back.'));
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="link-button send-back__open" onClick={() => setOpen(true)}>
        Send back for changes
      </button>
    );
  }
  return (
    <div className="send-back">
      <label className="usa-label" htmlFor={`send-back-${item.invoiceId}`}>
        What should {who} change?
      </label>
      <textarea
        id={`send-back-${item.invoiceId}`}
        className="usa-textarea"
        rows={3}
        maxLength={2000}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />
      <p className="field-hint">They see this on the invoice until they send it again.</p>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="button-row">
        <Button kind="danger" disabled={saving || !reason.trim()} onClick={() => void send()}>
          {saving ? 'Sending…' : 'Send back'}
        </Button>
        <button type="button" className="link-button" disabled={saving} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// Invoices and files whose case isn't known yet, longest held first.
function WaitingTable({ items, onMatched }: { items: IntakeItem[]; onMatched: (message: string) => void }) {
  const [matching, setMatching] = useState<string | null>(null);
  return (
    <RecordTable
      className="queue-table"
      label="Invoices waiting for a case"
      rows={items}
      rowKey={(item) => item.invoiceId ?? item.invoiceImportId ?? item.enteredAt}
      emptyMessage="Nothing is waiting for a case."
      rowDetail={(item) =>
        item.invoiceId && matching === item.invoiceId ? (
          <MatchPanel
            item={item}
            onMatched={(message) => {
              setMatching(null);
              onMatched(message);
            }}
          />
        ) : null
      }
      columns={[
        {
          header: 'Received',
          render: (item) => (
            <>
              <span className="nowrap">{formatDate(item.receivedOn ?? item.enteredAt.slice(0, 10))}</span>
              {item.receivedViaDisplayName && <span className="cell-note">{item.receivedViaDisplayName}</span>}
            </>
          ),
        },
        {
          header: 'From',
          rowHeader: true,
          render: (item) =>
            item.professionalDisplayName ??
            (item.proposedProvider ? (
              <>
                {item.proposedProvider.displayName} <EnteredFlag what="Provider" compact />
              </>
            ) : (
              <span className="muted">Not chosen yet</span>
            )),
        },
        {
          header: 'Invoice',
          render: (item) => (
            <>
              {item.fileName ?? 'Typed in'}
              <span className="cell-note">Entered by {item.enteredByDisplayName ?? 'staff'}</span>
              {item.proposedCase && (
                <span className="cell-note">
                  Case: {proposedCaseLabel(item.proposedCase)} <EnteredFlag what="Case" compact />
                </span>
              )}
              {item.unlistedTimekeepers.length > 0 && (
                <span className="cell-note">
                  Work by {item.unlistedTimekeepers.map((line) => line.name).filter((name, index, all) => all.indexOf(name) === index).join(', ')}{' '}
                  <EnteredFlag what={item.unlistedTimekeepers.length === 1 ? 'Person' : 'People'} compact />
                </span>
              )}
            </>
          ),
        },
        { header: 'Amount', align: 'right', render: (item) => (item.submittedTotal ? <strong>{formatMoney(item.submittedTotal)}</strong> : '—') },
        {
          header: 'Status',
          render: (item) => <StatusPill tone={STAGES[item.stage].tone} label={STAGES[item.stage].label} />,
        },
        {
          header: 'Actions',
          hiddenHeader: true,
          render: (item) => (
            <span className="row-actions">
              {item.invoiceId && (
                <button
                  type="button"
                  className="link-button"
                  aria-expanded={matching === item.invoiceId}
                  onClick={() => setMatching(matching === item.invoiceId ? null : item.invoiceId)}
                >
                  Match to a case
                </button>
              )}
              {/* A submitter's sent invoice is theirs to change, so staff view it read-only. */}
              {item.stage === 'sent' && item.invoiceId ? (
                <RouterLink to={`/billing/${item.invoiceId}`}>View</RouterLink>
              ) : item.stage === 'ready' && item.invoiceId ? (
                <RouterLink to={`/portal/invoices/${item.invoiceId}`}>Open</RouterLink>
              ) : (
                item.invoiceImportId && <RouterLink to={`/portal/imports/${item.invoiceImportId}`}>Open the import</RouterLink>
              )}
            </span>
          ),
        },
      ]}
    />
  );
}

// The same way in as external submitters: files go on to be checked on the
// upload page, and an invoice without one is entered there by hand.
function AddInvoices() {
  const navigate = useNavigate();
  const start = (state: UploadStart) => navigate(UPLOAD_PATH, { state });
  return (
    <section className="card upload-card intake-add">
      <DropZone hasFiles={false} onFiles={(files) => files.length > 0 && start({ files })} />
      <p className="manual-entry__offer">
        No file?{' '}
        <button type="button" className="link-button" onClick={() => start({ manual: true })}>
          Enter an invoice by hand
        </button>
      </p>
    </section>
  );
}

// Staff intake: enter invoices received by email or from other tools, finish
// drafts, and hold invoices whose case isn't known until someone matches
// them to a case (model/rules.yaml authorize_staff_invoice_entry,
// match_invoice_to_case).
export default function InvoiceIntake() {
  const [params] = useSearchParams();
  const { data: intake, error, reload: reloadIntake } = useResource(invoiceIntake);
  const data = intake?.items ?? null;
  // Drafts with no case are listed under "Waiting for a case" instead.
  const mine = useBatchedResource(myInvoices({ show: 'case_drafts' }));
  const refresh = () => void Promise.all([reloadIntake(), mine.reload()]);
  const drafts = mine.items;
  const [toast, setToast] = useToast();
  const justMatched = params.get('matched');
  const uploadedCount = (useLocation().state as UploadedState | null)?.uploadedCount ?? 0;

  return (
    <div>
      <PageHeader
        list
        title="Intake"
        description="Add invoices that came in by email or from other tools."
      />
      {justMatched && <Notice tone="success">The new case was added and the invoice matched to it.</Notice>}
      {uploadedCount > 1 && (
        <Notice tone="info" heading={`${uploadedCount} invoices uploaded and saved as drafts.`}>
          Those with a case are under "Drafts to finish"; the rest wait for a case. Check each one's lines before sending it
          for review.
        </Notice>
      )}
      <AddInvoices />

      <section className="detail-section">
        <h2>
          Waiting for a case
          {data && data.length > 0 && <Tag tone="neutral" className="heading-count">{data.length}</Tag>}
        </h2>
        {error || !data ? (
          <LoadState error={error} what="invoices waiting for a case" />
        ) : (
          <WaitingTable
            items={data}
            onMatched={(message) => {
              setToast({ message });
              refresh();
            }}
          />
        )}
        <p className="compact-hint">To review one without a case, open it and choose "Review without a case".</p>
      </section>

      {drafts && drafts.length > 0 && (
        <section className="detail-section">
          <h2>Drafts to finish</h2>
          <MyInvoicesTable rows={drafts} label="Drafts to finish" onDeleted={refresh} />
          <MoreOnScroll list={mine} what="drafts" />
        </section>
      )}
      <Toast toast={toast} />
    </div>
  );
}
