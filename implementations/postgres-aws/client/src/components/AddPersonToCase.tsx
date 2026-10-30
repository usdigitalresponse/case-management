import { useState } from 'react';
import { apiErrorMessage, createExternalAssignment, listVendors, type VendorRecord } from '../api/client';
import { AddProvider } from './AddProvider';
import { AssignStaffForm } from './AssignStaffForm';
import { TypeAheadPicker } from './TypeAheadPicker';
import { Notice } from './Notice';

// Adds someone to a case after it was opened. A provider (attorney, expert or
// vendor) needs this to submit invoices on the case, and their invoices are
// checked against it; staff are added for their own work on the case.
export function AddPersonToCase({ caseId, onAdded }: { caseId: string; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<'external' | 'staff'>('external');
  const [selected, setSelected] = useState<VendorRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  // A provider not in the system yet: added, then put on the case.
  const [adding, setAdding] = useState<string | null>(null);

  if (!open) {
    return (
      <button type="button" className="btn btn--outline" onClick={() => setOpen(true)}>
        Add person
      </button>
    );
  }

  async function addExternal(professionalId = selected?.professionalId) {
    if (!professionalId) return;
    setError(null);
    try {
      await createExternalAssignment(caseId, professionalId);
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
        <button type="button" aria-pressed={kind === 'external'} onClick={() => setKind('external')}>Provider</button>
        <button type="button" aria-pressed={kind === 'staff'} onClick={() => setKind('staff')}>Staff</button>
      </div>
      {kind === 'external' ? (
        <>
          <label className="settings-field" htmlFor="vendor-query">Find a provider (attorney, expert or vendor), or add one</label>
          {adding !== null ? (
            <AddProvider
              inline
              idPrefix="case-new-provider"
              initial={{ displayName: adding }}
              onAdded={(provider) => {
                // Back to the search, so a retry finds them rather than adding them twice.
                setAdding(null);
                void addExternal(provider.professionalId);
              }}
              onCancel={() => setAdding(null)}
            />
          ) : (
          <div className="assign-staff-row">
            <TypeAheadPicker
              key={resetKey}
              id="vendor-query"
              placeholder="Search by name or email"
              noResults="No one found."
              addOption={{ label: '+ Add a new provider', onAdd: (query) => setAdding(query) }}
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
          )}
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
