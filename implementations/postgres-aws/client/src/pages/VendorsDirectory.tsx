import { useState } from 'react';
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
import { Notice } from '../components/Notice';
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

// Administrators correct the name, and the email until they sign in with it.
function EditProvider({ vendor, onSaved, onCancel }: { vendor: VendorRecord; onSaved: (name: string) => void; onCancel: () => void }) {
  const [displayName, setDisplayName] = useState(vendor.displayName ?? '');
  const [email, setEmail] = useState(vendor.email ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const saved = await editProfessional(vendor.professionalId, {
        displayName: displayName.trim(),
        email: vendor.signedIn ? (vendor.email ?? undefined) : email.trim(),
      });
      onSaved(saved.displayName);
    } catch (err) {
      setError(apiErrorMessage(err, 'The changes could not be saved.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="compact-card intake-provider">
      <h2>Edit {vendor.displayName ?? 'provider'}</h2>
      <div className="inline-fields intake-provider__fields">
        <div className="usa-form-group">
          <label className="usa-label" htmlFor="edit-provider-name">Name</label>
          <input id="edit-provider-name" className="usa-input" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
        </div>
        <div className="usa-form-group">
          <label className="usa-label" htmlFor="edit-provider-email">Email{vendor.signedIn ? '' : ' (optional)'}</label>
          <input
            id="edit-provider-email"
            type="email"
            className="usa-input"
            value={email}
            disabled={vendor.signedIn}
            aria-describedby={vendor.signedIn ? 'edit-provider-email-hint' : undefined}
            onChange={(event) => setEmail(event.target.value)}
          />
          {vendor.signedIn && (
            <p id="edit-provider-email-hint" className="field-hint">They sign in with this email, so it can’t be changed here.</p>
          )}
        </div>
      </div>
      {!vendor.signedIn && (
        <p className="compact-hint">When they first sign in with this email, they get this profile.</p>
      )}
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="button-row">
        <button type="button" className="btn btn--primary" disabled={saving || displayName.trim().length < 2} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="link-button" disabled={saving} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
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
  const [editing, setEditing] = useState<VendorRecord | null>(null);
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
        { header: 'Name', render: (vendor) => vendor.displayName ?? 'Unknown' },
        { header: 'Email', render: (vendor) => vendor.email ?? <span className="muted">None yet</span> },
        { header: 'Kind and rate', render: (vendor) => <KindAndRate vendor={vendor} kinds={kinds} editable={isAdmin} /> },
        { header: 'Active', render: (vendor) => (vendor.active ? 'Yes' : 'No') },
        ...(isAdmin
          ? [
              {
                header: 'Actions',
                hiddenHeader: true,
                render: (vendor: VendorRecord) => (
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => {
                      setAdding(false);
                      setEditing(vendor);
                    }}
                  >
                    Edit
                  </button>
                ),
              },
            ]
          : []),
      ]}
    >
      {editing && (
        <EditProvider
          key={editing.professionalId}
          vendor={editing}
          onCancel={() => setEditing(null)}
          onSaved={(name) => {
            setEditing(null);
            setVersion((v) => v + 1);
            setToast({ message: `Saved ${name}.` });
          }}
        />
      )}
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
