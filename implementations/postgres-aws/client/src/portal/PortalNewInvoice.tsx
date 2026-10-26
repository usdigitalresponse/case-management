import { useState } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router';
import { listBillableProfessionals, listMyCases, listMyTimeEntries } from '../api/client';
import { useApiResource } from '../hooks/useApiResource';
import { caseDisplayLabel } from '../caseDisplayLabel';
import { NewInvoiceForm } from './NewInvoiceForm';
import { Notice } from '../components/Notice';
import { PageHeader } from '../components/PageHeader';

// The submitter's start page: import invoice files (which can cover several
// cases), or choose a case and enter or import one invoice for it.
export default function PortalNewInvoice() {
  const [params, setParams] = useSearchParams();
  const caseId = params.get('case') ?? '';
  const { data: cases, error } = useApiResource(() => listMyCases().then((result) => result.cases), []);

  return (
    <div>
      <PageHeader title="New invoice" description="Import invoice files, or choose a case to enter an invoice by hand." />
      {Boolean(error) && <Notice tone="danger">Failed to load your cases.</Notice>}

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
            {cases?.map((myCase) => (
              <option key={myCase.caseId} value={myCase.caseId}>
                {caseDisplayLabel([myCase.externalReference, myCase.clientDisplayName], undefined)}
              </option>
            ))}
          </select>
          {cases && cases.length === 0 && <p className="compact-hint">You aren't assigned to any cases yet.</p>}
        </section>
      </div>

      {caseId && <CaseInvoice key={caseId} caseId={caseId} />}
    </div>
  );
}

function CaseInvoice({ caseId }: { caseId: string }) {
  const [timeVersion, setTimeVersion] = useState(0);
  const { data: billable, error } = useApiResource(
    () => listBillableProfessionals(caseId).then((result) => result.professionals),
    [caseId],
  );
  const { data: entries } = useApiResource(
    () => listMyTimeEntries(caseId).then((result) => result.timeEntries),
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
      <p className="compact-hint">
        Recorded time and earlier invoices for this case are on its <RouterLink to={`/portal/cases/${caseId}`}>case page</RouterLink>.
      </p>
      <NewInvoiceForm caseId={caseId} billable={billable} entries={entries} onSaved={() => setTimeVersion((v) => v + 1)} />
    </section>
  );
}
