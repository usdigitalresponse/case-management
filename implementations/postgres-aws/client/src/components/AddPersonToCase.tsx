import { useState } from 'react';
import { apiErrorMessage, createExternalAssignment, listVendors, type VendorRecord } from '../api/client';
import { AssignStaffForm } from './AssignStaffForm';
import { TypeAheadPicker } from './TypeAheadPicker';
import { Notice } from './Notice';

// Adds someone to a case after it was opened. An attorney or vendor needs
// this to submit invoices on the case, and their invoices are checked
// against it; staff are added for their own work on the case.
export function AddPersonToCase({ caseId, onAdded }: { caseId: string; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<'external' | 'staff'>('external');
  const [selected, setSelected] = useState<VendorRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);

  if (!open) {
    return (
      <button type="button" className="btn btn--outline" onClick={() => setOpen(true)}>
        Add person
      </button>
    );
  }

  async function addExternal() {
    if (!selected) return;
    setError(null);
    try {
      await createExternalAssignment(caseId, selected.professionalId);
      setSelected(null);
      setResetKey((key) => key + 1);
      onAdded();
    } catch (err) {
      setError(apiErrorMessage(err, 'They could not be added.'));
    }
  }

  return (
    <div className="inline-editor add-person">
      <div className="choice-toggle" role="group" aria-label="Who are you adding?">
        <button type="button" aria-pressed={kind === 'external'} onClick={() => setKind('external')}>Attorney or vendor</button>
        <button type="button" aria-pressed={kind === 'staff'} onClick={() => setKind('staff')}>Staff</button>
      </div>
      {kind === 'external' ? (
        <>
          <label className="settings-field" htmlFor="vendor-query">Find an attorney or vendor</label>
          <div className="assign-staff-row">
            <TypeAheadPicker
              key={resetKey}
              id="vendor-query"
              placeholder="Search by name or email"
              noResults="No one found. They appear here after their first sign-in."
              search={(query) =>
                listVendors(query).then((result) =>
                  result.professionals.map((vendor) => ({
                    value: vendor.professionalId,
                    label: `${vendor.displayName ?? vendor.email}${vendor.professionalKindDisplayName ? `, ${vendor.professionalKindDisplayName}` : ''}`,
                    item: vendor,
                  })),
                )
              }
              onSelect={(vendor) => setSelected(vendor ?? null)}
            />
            <button type="button" className="btn btn--primary" disabled={!selected} onClick={() => void addExternal()}>
              Add to case
            </button>
          </div>
          {error && <Notice tone="danger">{error}</Notice>}
        </>
      ) : (
        <AssignStaffForm caseId={caseId} onAssigned={onAdded} />
      )}
      <div className="button-row">
        <button type="button" className="link-button" onClick={() => setOpen(false)}>Done</button>
      </div>
    </div>
  );
}
