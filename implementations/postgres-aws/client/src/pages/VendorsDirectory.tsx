import { useState, type KeyboardEvent } from 'react';
import { Select } from '@trussworks/react-uswds';
import {
  apiErrorMessage,
  editProfessional,
  listProfessionalKinds,
  listVendors,
  rateOn,
  setProfessionalKind,
  type ProfessionalKind,
  type VendorRecord,
} from '../api/client';
import { useAuth } from '../AuthContext';
import { useApiResource } from '../hooks/useApiResource';
import { SearchDirectory } from '../components/SearchDirectory';
import { AddProvider } from '../components/AddProvider';
import { Toast, useToast } from '../components/Toast';
import { formatMoney } from '../formatMoney';

function rateText(rates: ProfessionalKind['rates']): string {
  const rate = rateOn(rates, new Date().toISOString().slice(0, 10));
  return rate ? `${formatMoney(rate)}/h` : 'no rate set';
}

// The kind whose rates price this provider's time; administrators change it.
function KindAndRate({ vendor, kinds, editable }: { vendor: VendorRecord; kinds: ProfessionalKind[] | null; editable: boolean }) {
  const [kindId, setKindId] = useState(vendor.professionalKindId ?? '');
  const [error, setError] = useState<string | null>(null);
  const kind = kinds?.find((candidate) => candidate.professionalKindId === kindId);
  const rates = kind ? kind.rates : kindId === (vendor.professionalKindId ?? '') ? vendor.rates : [];

  async function change(next: string) {
    const previous = kindId;
    setKindId(next);
    setError(null);
    try {
      await setProfessionalKind(vendor.professionalId, next || null);
    } catch (err) {
      setKindId(previous);
      setError(apiErrorMessage(err, 'The kind could not be changed.'));
    }
  }

  if (!editable || !kinds) {
    return (
      <span>
        {vendor.professionalKindDisplayName ?? 'No kind'}
        {vendor.professionalKindId && ` · ${rateText(vendor.rates)}`}
      </span>
    );
  }
  return (
    <span className="kind-cell">
      <Select
        id={`kind-${vendor.professionalId}`}
        name={`kind-${vendor.professionalId}`}
        aria-label={`Kind of professional for ${vendor.displayName ?? 'this provider'}`}
        value={kindId}
        onChange={(event) => void change(event.target.value)}
      >
        <option value="">No kind</option>
        {kinds.map((candidate) => (
          <option key={candidate.professionalKindId} value={candidate.professionalKindId}>
            {candidate.displayName}
          </option>
        ))}
      </Select>
      {kindId && <span>{rateText(rates)}</span>}
      {error && <span className="line-row-error">{error}</span>}
    </span>
  );
}

// A row being edited in place: administrators correct the name, and the
// email until they sign in with it.
interface RowEdit {
  vendor: VendorRecord;
  displayName: string;
  email: string;
  error?: string;
  saving?: boolean;
}

export const DIRECTORY_TITLE = 'Providers';

export default function VendorsDirectory() {
  const { user } = useAuth();
  const isAdmin = Boolean(user?.isAdmin);
  const { data: kinds } = useApiResource(
    () => (isAdmin ? listProfessionalKinds().then((result) => result.kinds) : Promise.resolve(null)),
    [isAdmin],
  );
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<RowEdit | null>(null);
  const editingRow = (vendor: VendorRecord) => (editing?.vendor.professionalId === vendor.professionalId ? editing : null);

  async function saveRow(edit: RowEdit) {
    setEditing({ ...edit, saving: true, error: undefined });
    try {
      const saved = await editProfessional(edit.vendor.professionalId, {
        displayName: edit.displayName.trim(),
        email: edit.vendor.signedIn ? (edit.vendor.email ?? undefined) : edit.email.trim(),
      });
      setEditing(null);
      setVersion((v) => v + 1);
      setToast({ message: `Saved ${saved.displayName}.` });
    } catch (err) {
      setEditing({ ...edit, saving: false, error: apiErrorMessage(err, 'The changes could not be saved.') });
    }
  }

  // Enter saves and Escape cancels, from either field.
  const keys = (edit: RowEdit) => (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void saveRow(edit);
    } else if (event.key === 'Escape') {
      setEditing(null);
    }
  };
  const [version, setVersion] = useState(0);
  const [toast, setToast] = useToast();
  return (
    <SearchDirectory
      eyebrow="Look something up"
      title={DIRECTORY_TITLE}
      description="Attorneys, experts and vendors who can be assigned to a case and bill for their work. Each one's kind sets the hourly rate their time is invoiced at."
      searchLabel="Search providers by name or email"
      searchPlaceholder="Search by name or email"
      loadInitially
      reloadKey={version}
      actions={
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => {
            setEditing(null);
            setAdding(true);
          }}
        >
          Add
        </button>
      }
      fetchFn={(query) => listVendors(query).then((r) => r.professionals)}
      rowKey={(vendor) => vendor.professionalId}
      columns={[
        {
          header: 'Name',
          render: (vendor) => {
            const edit = editingRow(vendor);
            return edit ? (
              <input
                className="usa-input row-edit__input"
                size={1}
                aria-label="Name"
                autoComplete="off"
                value={edit.displayName}
                autoFocus
                onKeyDown={keys(edit)}
                onChange={(event) => setEditing({ ...edit, displayName: event.target.value })}
              />
            ) : (
              (vendor.displayName ?? 'Unknown')
            );
          },
        },
        {
          header: 'Email',
          render: (vendor) => {
            const edit = editingRow(vendor);
            if (!edit) return vendor.email ?? <span className="muted">None yet</span>;
            return vendor.signedIn ? (
              <>
                {vendor.email}
                <span className="cell-note">They sign in with it, so it can’t be changed here.</span>
              </>
            ) : (
              <input
                className="usa-input row-edit__input"
                size={1}
                type="email"
                aria-label="Email (optional)"
                autoComplete="off"
                placeholder="Email (optional)"
                value={edit.email}
                onKeyDown={keys(edit)}
                onChange={(event) => setEditing({ ...edit, email: event.target.value })}
              />
            );
          },
        },
        { header: 'Kind and rate', render: (vendor) => <KindAndRate vendor={vendor} kinds={kinds} editable={isAdmin} /> },
        { header: 'Active', render: (vendor) => (vendor.active ? 'Yes' : 'No') },
        ...(isAdmin
          ? [
              {
                header: 'Actions',
                hiddenHeader: true,
                render: (vendor: VendorRecord) => {
                  const edit = editingRow(vendor);
                  return edit ? (
                    <>
                    <span className="row-actions row-edit__actions">
                      <button
                        type="button"
                        className="btn btn--primary btn--small"
                        disabled={edit.saving || edit.displayName.trim().length < 2}
                        onClick={() => void saveRow(edit)}
                      >
                        {edit.saving ? 'Saving…' : 'Save'}
                      </button>
                      <button type="button" className="link-button" disabled={edit.saving} onClick={() => setEditing(null)}>
                        Cancel
                      </button>
                    </span>
                    {edit.error && <span className="line-row-error row-edit__error" role="alert">{edit.error}</span>}
                    </>
                  ) : (
                    <button
                      type="button"
                      className="link-button"
                      aria-label={`Edit ${vendor.displayName ?? 'this provider'}`}
                      onClick={() => {
                        setAdding(false);
                        setEditing({ vendor, displayName: vendor.displayName ?? '', email: vendor.email ?? '' });
                      }}
                    >
                      Edit
                    </button>
                  );
                },
              },
            ]
          : []),
      ]}
    >
      {adding && (
        <AddProvider
          onCancel={() => setAdding(false)}
          onAdded={({ displayName }) => {
            setAdding(false);
            setVersion((v) => v + 1);
            setToast({ message: `Added ${displayName}.` });
          }}
        />
      )}
      <Toast toast={toast} />
    </SearchDirectory>
  );
}
