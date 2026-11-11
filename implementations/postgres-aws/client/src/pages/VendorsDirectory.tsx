import { useState, type KeyboardEvent } from 'react';
import { Select } from '@trussworks/react-uswds';
import {
  apiErrorMessage,
  editProfessional,
  rateOn,
  setProfessionalKind,
  type ProfessionalKind,
  type VendorRecord,
} from '../api/client';
import { useAuth } from '../AuthContext';
import { useResource } from '../hooks/useResource';
import { professionalKinds, providerList } from '../resources';
import { SearchDirectory } from '../components/SearchDirectory';
import { AddProvider } from '../components/AddProvider';
import { Notice } from '../components/ui/Notice';
import { Toast, useToast } from '../components/Toast';
import { formatMoney } from '../formatMoney';
import { Button } from '../components/ui/Button';

function rateText(rates: ProfessionalKind['rates']): string {
  const rate = rateOn(rates, new Date().toISOString().slice(0, 10));
  return rate ? `${formatMoney(rate)}/h` : 'No rate set';
}

// Who can send their invoices: themselves once they can sign in, and their office's billing delegates.
function sentBy(vendor: VendorRecord): string {
  const own = vendor.signedIn ? ['Themselves'] : [];
  const names = [...own, ...vendor.sentByDisplayNames];
  const who = names.length === 0 ? 'Staff, for them' : names.join(' or ');
  return vendor.sendsForCount > 0 ? `${who}. Also sends for ${vendor.sendsForCount} ${vendor.sendsForCount === 1 ? 'other' : 'others'}.` : who;
}

// The kind whose rates price this provider's time; administrators change it.
function Kind({ vendor, kinds, editable, onChanged }: { vendor: VendorRecord; kinds: ProfessionalKind[] | null; editable: boolean; onChanged: (rates: ProfessionalKind['rates']) => void }) {
  const [kindId, setKindId] = useState(vendor.professionalKindId ?? '');
  const [error, setError] = useState<string | null>(null);

  async function change(next: string) {
    const previous = kindId;
    setKindId(next);
    setError(null);
    try {
      await setProfessionalKind(vendor.professionalId, next || null);
      onChanged(kinds?.find((candidate) => candidate.professionalKindId === next)?.rates ?? []);
    } catch (err) {
      setKindId(previous);
      setError(apiErrorMessage(err, 'The kind could not be changed.'));
    }
  }

  if (!editable || !kinds) {
    return <span>{vendor.professionalKindDisplayName ?? 'No kind'}</span>;
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
  const { data: kinds } = useResource(isAdmin ? professionalKinds : null);
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
  // A kind just changed here prices their time at its rates.
  const [changedRates, setChangedRates] = useState<Record<string, ProfessionalKind['rates']>>({});
  return (
    <SearchDirectory
      eyebrow="Look something up"
      title={DIRECTORY_TITLE}
      description="Attorneys, experts and investigators who can be assigned to a case and bill for their work. Each one's kind sets the hourly rate their time is billed at."
      searchLabel="Search providers by name or email"
      searchPlaceholder="Search by name or email"
      loadInitially
      reloadKey={version}
      actions={
        <Button
          type="button"
          kind="primary"
          onClick={() => {
            setEditing(null);
            setAdding(true);
          }}
        >
          Add provider
        </Button>
      }
      resource={providerList}
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
              <>
                <strong>{vendor.displayName ?? 'Unknown'}</strong>
                <span className="cell-note">{vendor.email ?? 'No email yet'}</span>
              </>
            );
          },
        },
        ...(editing
          ? [
              {
                header: 'Email',
                render: (vendor: VendorRecord) => {
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
            ]
          : []),
        {
          header: 'Kind',
          render: (vendor) => (
            <Kind
              vendor={vendor}
              kinds={kinds}
              editable={isAdmin}
              onChanged={(rates) => setChangedRates((current) => ({ ...current, [vendor.professionalId]: rates }))}
            />
          ),
        },
        { header: 'Rate today', render: (vendor) => rateText(changedRates[vendor.professionalId] ?? vendor.rates) },
        { header: 'Office', render: (vendor) => vendor.officeDisplayName ?? <span className="muted">None</span> },
        { header: 'Who can send their invoices', render: (vendor) => sentBy(vendor) },
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
                      <Button
                        type="button"
                        kind="primary" small
                        disabled={edit.saving || edit.displayName.trim().length < 2}
                        onClick={() => void saveRow(edit)}
                      >
                        {edit.saving ? 'Saving…' : 'Save'}
                      </Button>
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
      <Notice tone="info">
        Rates for each kind are set in Settings, under Rates. A person's own approved rate on their People page can differ
        from their kind's rate.
      </Notice>
      <Toast toast={toast} />
    </SearchDirectory>
  );
}
