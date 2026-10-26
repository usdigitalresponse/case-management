import { useState } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router';
import { listBillableProfessionals, listMyCases, listMyInvoices, listMyTimeEntries } from '../api/client';
import { useApiResource } from '../hooks/useApiResource';
import { caseDisplayLabel } from '../caseDisplayLabel';
import { NewInvoiceForm } from './NewInvoiceForm';
import { MyInvoicesTable } from './MyInvoicesTable';
import { useShell } from './useShell';
import { Notice } from '../components/Notice';
import { PageHeader } from '../components/PageHeader';

// The start page for entering invoices: import invoice files (which can
// cover several cases), or choose a case and enter or import one invoice for
// it. Submitters use it for their own work; staff for invoices received by
// email or from other tools, and they finish their drafts here.
// The case choice for an invoice whose case staff will add later.
const LATER = 'later';

export default function PortalNewInvoice() {
  const [params, setParams] = useSearchParams();
  const caseId = params.get('case') ?? '';
  const { staff } = useShell();
  const [version, setVersion] = useState(0);
  const { data: cases, error } = useApiResource(() => listMyCases().then((result) => result.cases), []);
  const { data: drafts } = useApiResource(
    () => (staff ? listMyInvoices().then((result) => result.invoices.filter((invoice) => invoice.statusCode === 'draft')) : Promise.resolve([])),
    [staff, version],
  );

  return (
    <div>
      <PageHeader
        title="New invoice"
        description={
          staff
            ? 'Enter an invoice a professional sent by email or from another tool, for them. Import the file, or choose a case and type it in.'
            : 'Import invoice files, or choose a case to enter an invoice by hand.'
        }
      />
      {Boolean(error) && <Notice tone="danger">Failed to load cases.</Notice>}

      <div className="start-options">
        <section className="compact-card start-option">
          <h2>Import invoice files</h2>
          <p className="compact-hint">
            Upload PDFs, spreadsheets or billing files. You check what was read before anything is submitted, and a
            file covering several cases can be split between them.
          </p>
          <RouterLink className="btn btn--primary" to="/portal/imports">Import files</RouterLink>
        </section>

        <section className="compact-card start-option">
          <h2>Enter an invoice for a case</h2>
          <label className="settings-field" htmlFor="new-invoice-case">Case</label>
          <select
            id="new-invoice-case"
            className="usa-select"
            value={caseId}
            onChange={(event) => setParams(event.target.value ? { case: event.target.value } : {})}
          >
            <option value="">Choose a case</option>
            {staff && <option value={LATER}>Add case later (hold in invoice intake)</option>}
            {cases?.map((myCase) => (
              <option key={myCase.caseId} value={myCase.caseId}>
                {caseDisplayLabel([myCase.externalReference, myCase.clientDisplayName], undefined)}
              </option>
            ))}
          </select>
          {cases && cases.length === 0 && (
            <p className="compact-hint">{staff ? 'No case has a professional assigned yet.' : "You aren't assigned to any cases yet."}</p>
          )}
        </section>
      </div>

      {caseId && (
        <CaseInvoice key={caseId} caseId={caseId === LATER ? null : caseId} onSaved={() => setVersion((v) => v + 1)} />
      )}

      {staff && drafts && drafts.length > 0 && (
        <section className="detail-section">
          <h2>Drafts to finish</h2>
          <MyInvoicesTable rows={drafts} label="Drafts to finish" onDeleted={() => setVersion((v) => v + 1)} />
        </section>
      )}
    </div>
  );
}

// caseId null: staff will add the case later, in invoice intake.
function CaseInvoice({ caseId, onSaved }: { caseId: string | null; onSaved: () => void }) {
  const { casePath } = useShell();
  const [timeVersion, setTimeVersion] = useState(0);
  const { data: billable, error } = useApiResource(
    () => listBillableProfessionals(caseId).then((result) => result.professionals),
    [caseId],
  );
  // Recorded time belongs to a case.
  const { data: entries } = useApiResource(
    () => (caseId ? listMyTimeEntries(caseId).then((result) => result.timeEntries) : Promise.resolve([])),
    [caseId, timeVersion],
  );

  if (error) {
    return <Notice tone="danger">You can't bill on this case.</Notice>;
  }
  if (!billable) {
    return <p role="status">Loading…</p>;
  }
  return (
    <section className="detail-section">
      {caseId ? (
        <p className="compact-hint">
          Recorded time and earlier invoices for this case are on its <RouterLink to={casePath(caseId)}>case page</RouterLink>.
        </p>
      ) : (
        <Notice tone="info">
          Saved invoices wait in <RouterLink to="/intake">Invoice intake</RouterLink> until someone matches them to a case.
          A provider who isn't listed can be added there first.
        </Notice>
      )}
      <NewInvoiceForm
        caseId={caseId}
        billable={billable}
        entries={entries}
        onSaved={() => {
          setTimeVersion((v) => v + 1);
          onSaved();
        }}
      />
    </section>
  );
}
