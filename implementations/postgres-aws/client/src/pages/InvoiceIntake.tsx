import { useState } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router';
import {
  addProfessional,
  apiErrorMessage,
  listBillableProfessionals,
  listCases,
  listInvoiceIntake,
  listMyInvoices,
  listProfessionalKinds,
  matchInvoiceToCase,
  type IntakeItem,
} from '../api/client';
import { useApiResource } from '../hooks/useApiResource';
import { PageHeader } from '../components/PageHeader';
import { LoadState } from '../components/LoadState';
import { Notice } from '../components/Notice';
import { RecordTable } from '../components/RecordTable';
import { Toast, useToast } from '../components/Toast';
import { formatDate } from '../formatDateTime';
import { formatMoney } from '../formatMoney';
import { NewInvoiceStart } from '../portal/PortalNewInvoice';
import { MyInvoicesTable } from '../portal/MyInvoicesTable';

const STAGES: Record<IntakeItem['stage'], { label: string; tone: string }> = {
  reading: { label: 'Reading the file', tone: 'neutral' },
  unreadable: { label: "Couldn't be read", tone: 'danger' },
  to_confirm: { label: 'Check the import', tone: 'warning' },
  ready: { label: 'Needs a case', tone: 'info' },
};

// Match an invoice to an open case, adding its providers to the case when
// they aren't on it.
function MatchPanel({ item, onMatched }: { item: IntakeItem; onMatched: (message: string) => void }) {
  const { data } = useApiResource(() => listCases().then((result) => result.cases.filter((c) => !c.closedOn)), []);
  // Saved without a professional: choose who it's from as well.
  const needsProfessional = item.professionalId === null;
  const { data: providers } = useApiResource(
    () => (needsProfessional ? listBillableProfessionals(null).then((result) => result.professionals) : Promise.resolve([])),
    [needsProfessional],
  );
  const [caseId, setCaseId] = useState('');
  const [professionalId, setProfessionalId] = useState('');
  const [addMissing, setAddMissing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const providerName =
    item.professionalDisplayName ?? providers?.find((p) => p.professionalId === professionalId)?.displayName ?? 'the provider';

  async function match() {
    setSaving(true);
    setError(null);
    try {
      const result = await matchInvoiceToCase(item.invoiceId!, {
        caseId,
        addMissing,
        professionalId: needsProfessional ? professionalId : undefined,
      });
      const chosen = data?.find((c) => c.caseId === caseId);
      onMatched(
        `Matched to ${chosen?.clientDisplayName ?? 'the case'}${result.addedProfessionalIds.length ? `, and ${providerName} was added to it` : ''}.`,
      );
    } catch (err) {
      setError(apiErrorMessage(err, 'It could not be matched.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="decision-panel intake-panel">
      <h3>Match to a case</h3>
      <div className="inline-fields intake-match">
        <div className="usa-form-group">
          <label className="usa-label" htmlFor={`match-${item.invoiceId}`}>Case</label>
          <select id={`match-${item.invoiceId}`} className="usa-select" value={caseId} onChange={(event) => setCaseId(event.target.value)}>
            <option value="">{data ? 'Choose an open case' : 'Loading cases…'}</option>
            {data?.map((c) => (
              <option key={c.caseId} value={c.caseId}>
                {[c.externalReference, c.clientDisplayName].filter(Boolean).join(' · ') || c.caseId.slice(0, 8)}
              </option>
            ))}
          </select>
        </div>
        {needsProfessional && (
          <div className="usa-form-group">
            <label className="usa-label" htmlFor={`match-from-${item.invoiceId}`}>From</label>
            <select
              id={`match-from-${item.invoiceId}`}
              className="usa-select"
              value={professionalId}
              onChange={(event) => setProfessionalId(event.target.value)}
            >
              <option value="">{providers ? 'Choose who it’s from' : 'Loading…'}</option>
              {providers?.map((p) => (
                <option key={p.professionalId} value={p.professionalId}>{p.displayName ?? 'Unnamed professional'}</option>
              ))}
            </select>
          </div>
        )}
        <button
          type="button"
          className="btn btn--primary"
          disabled={!caseId || (needsProfessional && !professionalId) || saving}
          onClick={() => void match()}
        >
          Match
        </button>
      </div>
      <label className="checkbox-row">
        <input type="checkbox" checked={addMissing} onChange={(event) => setAddMissing(event.target.checked)} />
        Add {providerName} to the case if they aren't on it
      </label>
      <p className="cell-note">
        {needsProfessional && !professionalId ? (
          'Case not listed? Choose who it’s from, then add the case.'
        ) : (
          <>
            Case not listed?{' '}
            <RouterLink to={`/cases/new?intake=${item.invoiceId}${needsProfessional ? `&from=${professionalId}` : ''}`}>Add it</RouterLink>,
            and this invoice is matched to it.
          </>
        )}
      </p>
      {error && <p className="field-error" role="alert">{error}</p>}
    </div>
  );
}

// A provider who has never signed in, so an invoice can say whose work it
// is. If they sign in later with the same email, they get this profile.
function AddProvider({ onAdded, onCancel }: { onAdded: (name: string) => void; onCancel: () => void }) {
  const { data } = useApiResource(() => listProfessionalKinds().then((result) => result.kinds.filter((kind) => kind.active)), []);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [professionalKindId, setKindId] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    try {
      const added = await addProfessional({ displayName: displayName.trim(), email: email.trim() || undefined, professionalKindId });
      onAdded(added.displayName);
    } catch (err) {
      setError(apiErrorMessage(err, 'They could not be added.'));
    }
  }

  return (
    <form
      className="compact-card intake-provider"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <h2>Add a provider</h2>
      <p className="compact-hint">For someone not in the system yet. Their kind sets the rate their time is priced at.</p>
      <div className="inline-fields intake-provider__fields">
        <div className="usa-form-group">
          <label className="usa-label" htmlFor="provider-name">Name</label>
          <input id="provider-name" className="usa-input" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
        </div>
        <div className="usa-form-group">
          <label className="usa-label" htmlFor="provider-email">Email (optional)</label>
          <input id="provider-email" type="email" className="usa-input" value={email} onChange={(event) => setEmail(event.target.value)} />
        </div>
        <div className="usa-form-group">
          <label className="usa-label" htmlFor="provider-kind">Kind</label>
          <select id="provider-kind" className="usa-select" value={professionalKindId} onChange={(event) => setKindId(event.target.value)}>
            <option value="">Choose</option>
            {data?.map((kind) => (
              <option key={kind.professionalKindId} value={kind.professionalKindId}>{kind.displayName}</option>
            ))}
          </select>
        </div>
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="button-row">
        <button type="submit" className="btn btn--primary" disabled={displayName.trim().length < 2 || !professionalKindId}>Add provider</button>
        <button type="button" className="link-button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
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
              {formatDate(item.receivedOn ?? item.enteredAt.slice(0, 10))}
              {item.receivedViaDisplayName && <span className="cell-note">{item.receivedViaDisplayName}</span>}
            </>
          ),
        },
        {
          header: 'From',
          rowHeader: true,
          render: (item) => item.professionalDisplayName ?? <span className="muted">Not chosen yet</span>,
        },
        {
          header: 'Invoice',
          render: (item) => (
            <>
              {item.fileName ?? 'Typed in'}
              <span className="cell-note">Entered by {item.enteredByDisplayName ?? 'staff'}</span>
            </>
          ),
        },
        { header: 'Amount', align: 'right', render: (item) => (item.submittedTotal ? <strong>{formatMoney(item.submittedTotal)}</strong> : '—') },
        {
          header: 'Status',
          render: (item) => <span className={`chip chip--${STAGES[item.stage].tone}`}>{STAGES[item.stage].label}</span>,
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
              {/* With no professional yet, adding the case starts from Match, where it's chosen. */}
              {item.invoiceId && item.professionalId && <RouterLink to={`/cases/new?intake=${item.invoiceId}`}>Add case info</RouterLink>}
              {item.stage === 'ready' && item.invoiceId ? (
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

// Staff intake: enter invoices received by email or from other tools, finish
// drafts, and hold invoices whose case isn't known until someone matches
// them to a case (model/rules.yaml authorize_staff_invoice_entry,
// match_invoice_to_case).
export default function InvoiceIntake() {
  const [params] = useSearchParams();
  const [version, setVersion] = useState(0);
  const refresh = () => setVersion((v) => v + 1);
  const { data, error } = useApiResource(() => listInvoiceIntake().then((result) => result.items), [version]);
  const { data: drafts } = useApiResource(
    () => listMyInvoices().then((result) => result.invoices.filter((invoice) => invoice.statusCode === 'draft' && invoice.caseId)),
    [version],
  );
  const [addingProvider, setAddingProvider] = useState(false);
  const [providersVersion, setProvidersVersion] = useState(0);
  const [toast, setToast] = useToast();
  const justMatched = params.get('matched');

  return (
    <div>
      <PageHeader
        title="Intake"
        description="Add invoices that came in by email or from other tools."
        actions={
          <button type="button" className="btn btn--outline" onClick={() => setAddingProvider(true)}>Add a provider</button>
        }
      />
      {justMatched && <Notice tone="success">The new case was added and the invoice matched to it.</Notice>}
      {addingProvider && (
        <AddProvider
          onCancel={() => setAddingProvider(false)}
          onAdded={(name) => {
            setAddingProvider(false);
            setProvidersVersion((v) => v + 1);
            setToast({ message: `Added ${name}. You can now choose them under "Billing for".` });
          }}
        />
      )}

      <NewInvoiceStart onSaved={refresh} providersVersion={providersVersion} />

      <section className="detail-section">
        <h2>Waiting for a case{data && data.length > 0 && <span className="nav-count">{data.length}</span>}</h2>
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
        </section>
      )}
      <Toast toast={toast} onUndo={() => undefined} />
    </div>
  );
}
