import { useState } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router';
import { listBillableProfessionals, listMyCases, listMyTimeEntries } from '../api/client';
import { useApiResource } from '../hooks/useApiResource';
import { caseDisplayLabel } from '../caseDisplayLabel';
import { NewInvoiceForm } from './NewInvoiceForm';
import { LATER, UPLOAD_PATH, useShell } from './useShell';
import { Notice } from '../components/Notice';
import { PageHeader } from '../components/PageHeader';

// The submitter's start page for entering invoices. Staff enter invoices
// received by email or from other tools on Intake (pages/InvoiceIntake.tsx),
// which uses the same NewInvoiceStart.
export default function PortalNewInvoice() {
  return (
    <div>
      <PageHeader title="New invoice" description="Enter an invoice by hand for a case, or import invoice files." />
      <NewInvoiceStart />
    </div>
  );
}

// Two ways in: enter an invoice by hand for a chosen case, or upload files
// through the same upload as external submitters (./PortalUpload.tsx).
// Staff may leave the case for later in either. providersVersion reloads
// who can be billed after a provider is added.
export function NewInvoiceStart({ onSaved, providersVersion = 0 }: { onSaved?: () => void; providersVersion?: number }) {
  const [params, setParams] = useSearchParams();
  const caseId = params.get('case') ?? '';
  const { staff } = useShell();
  const { data: cases, error } = useApiResource(() => listMyCases().then((result) => result.cases), []);

  return (
    <>
      {Boolean(error) && <Notice tone="danger">Failed to load cases.</Notice>}

      <div className="start-options">
        <section className="compact-card start-option">
          <h2>Enter invoice manually</h2>
          <p className="compact-hint">Choose the case, then type in the items.</p>
          <label className="settings-field" htmlFor="new-invoice-case">Case</label>
          <select
            id="new-invoice-case"
            className="usa-select"
            value={caseId}
            onChange={(event) => setParams(event.target.value ? { case: event.target.value } : {})}
          >
            <option value="">Choose a case</option>
            {staff && <option value={LATER}>No case yet: match it later</option>}
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

        <section className="compact-card start-option">
          <h2>Upload invoices</h2>
          <p className="compact-hint">
            Upload one or several PDFs, spreadsheets or billing files. Check what was read from each, then its lines, before
            sending it for review.
          </p>
          <RouterLink className="btn btn--primary" to={UPLOAD_PATH}>Upload Invoices</RouterLink>
        </section>
      </div>

      {caseId && (
        <CaseInvoice key={caseId} caseId={caseId === LATER ? null : caseId} providersVersion={providersVersion} onSaved={onSaved} />
      )}
    </>
  );
}

// caseId null: "No case yet"; it waits on Intake.
function CaseInvoice({
  caseId,
  providersVersion,
  onSaved,
}: {
  caseId: string | null;
  providersVersion: number;
  onSaved?: () => void;
}) {
  const { casePath } = useShell();
  const [timeVersion, setTimeVersion] = useState(0);
  const { data: loaded, error } = useApiResource(
    () => listBillableProfessionals(caseId).then((result) => result.professionals),
    [caseId, providersVersion],
  );
  // Keep the form, and what was typed, while the list reloads.
  const [lastLoaded, setLastLoaded] = useState(loaded);
  if (loaded && loaded !== lastLoaded) {
    setLastLoaded(loaded);
  }
  const billable = loaded ?? lastLoaded;
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
          It will wait under "Waiting for a case" until it's matched. Provider not listed? Use "Add a provider" above.
        </Notice>
      )}
      {/* Files go through "Import invoice" instead. */}
      <NewInvoiceForm
        caseId={caseId}
        billable={billable}
        entries={entries}
        allowImport={false}
        onSaved={() => {
          setTimeVersion((v) => v + 1);
          onSaved?.();
        }}
      />
    </section>
  );
}
