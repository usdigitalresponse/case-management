import { useState } from 'react';
import {
  addProfessional,
  apiErrorMessage,
  createExternalAssignment,
  listProfessionalKinds,
  type BillableProfessional,
  type ProposedProvider,
} from '../api/client';
import { useApiResource } from '../hooks/useApiResource';
import { Notice } from './Notice';

export type AddedProvider = { professionalId: string; displayName: string };

// Providers staff add while entering an invoice, offered alongside those
// loaded. On a case they're assigned to it, since only its providers can be billed.
export function useAddedProviders(caseId: string | null) {
  const [added, setAdded] = useState<BillableProfessional[]>([]);
  async function onProviderAdded(provider: AddedProvider) {
    setAdded((current) => [...current, { ...provider, isSelf: false, kindDisplayName: null, rates: [] }]);
    if (caseId) {
      await createExternalAssignment(caseId, provider.professionalId);
    }
  }
  return { added, onProviderAdded };
}

// A provider (attorney, expert or vendor) who has never signed in, so an
// invoice can say whose work it is (model/rules.yaml
// add_professional_without_login). If they sign in later with the same email,
// they get this profile. On its own on Intake and Providers, and inline
// behind PickOrAdd's "add" option, prefilled from what a submitter entered.
export function AddProvider({
  onAdded,
  onCancel,
  initial,
  inline,
  idPrefix = 'provider',
}: {
  onAdded: (added: AddedProvider) => void;
  onCancel?: () => void;
  initial?: ProposedProvider | null;
  inline?: boolean;
  idPrefix?: string;
}) {
  const { data } = useApiResource(() => listProfessionalKinds().then((result) => result.kinds.filter((kind) => kind.active)), []);
  const [displayName, setDisplayName] = useState(initial?.displayName ?? '');
  const [email, setEmail] = useState(initial?.email ?? '');
  const [professionalKindId, setKindId] = useState(initial?.professionalKindId ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setError(null);
    setSaving(true);
    try {
      onAdded(await addProfessional({ displayName: displayName.trim(), email: email.trim() || undefined, professionalKindId }));
    } catch (err) {
      setError(apiErrorMessage(err, 'They could not be added.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={inline ? 'intake-provider' : 'compact-card intake-provider'}>
      {!inline && (
        <>
          <h2>Add a provider</h2>
          <p className="compact-hint">
            An attorney, expert or vendor not in the system yet. Their kind sets the rate their time is priced at.
          </p>
        </>
      )}
      <div className="inline-fields intake-provider__fields">
        <div className="usa-form-group">
          <label className="usa-label" htmlFor={`${idPrefix}-name`}>Name</label>
          <input id={`${idPrefix}-name`} className="usa-input" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
        </div>
        <div className="usa-form-group">
          <label className="usa-label" htmlFor={`${idPrefix}-email`}>Email (optional)</label>
          <input id={`${idPrefix}-email`} type="email" className="usa-input" value={email} onChange={(event) => setEmail(event.target.value)} />
        </div>
        <div className="usa-form-group">
          <label className="usa-label" htmlFor={`${idPrefix}-kind`}>Kind</label>
          <select id={`${idPrefix}-kind`} className="usa-select" value={professionalKindId} onChange={(event) => setKindId(event.target.value)}>
            <option value="">Choose</option>
            {data?.map((kind) => (
              <option key={kind.professionalKindId} value={kind.professionalKindId}>{kind.displayName}</option>
            ))}
          </select>
        </div>
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="button-row">
        <button
          type="button"
          className="btn btn--primary"
          disabled={saving || displayName.trim().length < 2 || !professionalKindId}
          onClick={() => void save()}
        >
          {inline ? 'Add them' : 'Add'}
        </button>
        {onCancel && <button type="button" className="link-button" onClick={onCancel}>Cancel</button>}
      </div>
    </div>
  );
}
