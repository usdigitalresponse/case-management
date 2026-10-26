import { useState } from 'react';
import { Select } from '@trussworks/react-uswds';
import {
  apiErrorMessage,
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

export const DIRECTORY_TITLE = 'Providers';

export default function VendorsDirectory() {
  const { user } = useAuth();
  const isAdmin = Boolean(user?.isAdmin);
  const { data: kinds } = useApiResource(
    () => (isAdmin ? listProfessionalKinds().then((result) => result.kinds) : Promise.resolve(null)),
    [isAdmin],
  );
  const [adding, setAdding] = useState(false);
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
        <button type="button" className="btn btn--primary" onClick={() => setAdding(true)}>
          Add
        </button>
      }
      fetchFn={(query) => listVendors(query).then((r) => r.professionals)}
      rowKey={(vendor) => vendor.professionalId}
      columns={[
        { header: 'Name', render: (vendor) => vendor.displayName ?? 'Unknown' },
        { header: 'Email', render: (vendor) => vendor.email },
        { header: 'Kind and rate', render: (vendor) => <KindAndRate vendor={vendor} kinds={kinds} editable={isAdmin} /> },
        { header: 'Active', render: (vendor) => (vendor.active ? 'Yes' : 'No') },
      ]}
    >
      {adding && (
        <AddProvider
          onCancel={() => setAdding(false)}
          onAdded={(name) => {
            setAdding(false);
            setVersion((v) => v + 1);
            setToast({ message: `Added ${name}.` });
          }}
        />
      )}
      <Toast toast={toast} />
    </SearchDirectory>
  );
}
