import { useState } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router';
import { fieldErrorsOf, listBillableProfessionals, listMyCases, listMyTimeEntries, type ProposedCase } from '../api/client';
import { ADD_NEW, PickOrAdd } from '../components/PickOrAdd';
import {
  createCaseFromEntry,
  newCaseEntry,
  NO_PROPOSED_CASE,
  ProposedCaseFields,
  proposedCaseToSend,
  StaffNewCaseFields,
} from '../components/NewEntryFields';
import { useApiResource } from '../hooks/useApiResource';
import { caseDisplayLabel } from '../caseDisplayLabel';
import { NewInvoiceForm } from './NewInvoiceForm';
import { UPLOAD_PATH, useShell } from './useShell';
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

// Two ways in: enter an invoice by hand, or upload files through the same
// upload as external submitters (./PortalUpload.tsx). A case that isn't
// chosen or listed is matched later on Intake.
export function NewInvoiceStart({ onSaved }: { onSaved?: () => void }) {
  const [params, setParams] = useSearchParams();
  const caseId = params.get('case') ?? '';
  const { staff } = useShell();
  const { data: cases, error } = useApiResource(() => listMyCases().then((result) => result.cases), []);
  const [proposedCase, setProposedCase] = useState<ProposedCase>(NO_PROPOSED_CASE);
  const [staffCase, setStaffCase] = useState(newCaseEntry);
  const [caseErrors, setCaseErrors] = useState<Record<string, string>>({});
  const adding = caseId === ADD_NEW;
  const newCase = adding
    ? staff
      ? {
          proposed: proposedCaseToSend(staffCase),
          create: () =>
            createCaseFromEntry(staffCase).catch((err: unknown) => {
              setCaseErrors(fieldErrorsOf(err));
              throw err;
            }),
        }
      : { proposed: proposedCaseToSend(proposedCase) }
    : undefined;

  return (
    <>
      {Boolean(error) && <Notice tone="danger">Failed to load cases.</Notice>}

      <div className="start-options">
        <section className="compact-card start-option">
          <h2>Enter invoice manually</h2>
          <p className="compact-hint">Choose the case, then type in the items.</p>
          <PickOrAdd
            id="new-invoice-case"
            label="Case"
            value={caseId}
            onChange={(value) => setParams(value ? { case: value } : {})}
            addLabel="+ Add a case that isn’t listed"
            placeholder="Choose a case"
            hint="Leave it blank if it isn’t known yet; it’s matched on Intake."
            options={(cases ?? []).map((myCase) => ({
              value: myCase.caseId,
              label: caseDisplayLabel([myCase.externalReference, myCase.clientDisplayName], undefined),
            }))}
          >
            {staff ? (
              <StaffNewCaseFields idPrefix="new-invoice-case-new" value={staffCase} onChange={setStaffCase} errors={caseErrors} />
            ) : (
              <ProposedCaseFields idPrefix="new-invoice-case-new" value={proposedCase} onChange={setProposedCase} />
            )}
          </PickOrAdd>
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

      <CaseInvoice
        key={adding ? '' : caseId}
        caseId={caseId && !adding ? caseId : null}
        newCase={newCase}
        onSaved={() => {
          // A fresh entry, so the next new case isn't taken for this one.
          setStaffCase(newCaseEntry());
          setProposedCase(NO_PROPOSED_CASE);
          setCaseErrors({});
          onSaved?.();
        }}
      />
    </>
  );
}

// caseId null: no case yet; it waits on Intake.
function CaseInvoice({
  caseId,
  newCase,
  onSaved,
}: {
  caseId: string | null;
  newCase: Parameters<typeof NewInvoiceForm>[0]['newCase'];
  onSaved?: () => void;
}) {
  const { casePath } = useShell();
  const [timeVersion, setTimeVersion] = useState(0);
  const { data: loaded, error } = useApiResource(
    () => listBillableProfessionals(caseId).then((result) => result.professionals),
    [caseId],
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
          It will wait under "Waiting for a case" until it's matched.
        </Notice>
      )}
      {/* Files go through "Import invoice" instead. */}
      <NewInvoiceForm
        caseId={caseId}
        newCase={newCase}
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
