import { useState } from 'react';
import { addProfessional, apiErrorMessage, listProfessionalKinds } from '../api/client';
import { useApiResource } from '../hooks/useApiResource';
import { Notice } from './Notice';

// A provider (attorney, expert or vendor) who has never signed in, so an
// invoice can say whose work it is (model/rules.yaml
// add_professional_without_login). If they sign in later with the same email,
// they get this profile. Used on Intake and Providers.
export function AddProvider({ onAdded, onCancel }: { onAdded: (name: string) => void; onCancel: () => void }) {
  const { data } = useApiResource(() => listProfessionalKinds().then((result) => result.kinds.filter((kind) => kind.active)), []);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [professionalKindId, setKindId] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    try {
      const added = await addProfessional({ displayName: displayName.trim(), email: email.trim() || undefined, professionalKindId });
      onAdded(added.displayName);
    } catch (err) {
      setError(apiErrorMessage(err, 'They could not be added.'));
    }
  }

  return (
    <form
      className="compact-card intake-provider"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <h2>Add a provider</h2>
      <p className="compact-hint">
        An attorney, expert or vendor not in the system yet. Their kind sets the rate their time is priced at.
      </p>
      <div className="inline-fields intake-provider__fields">
        <div className="usa-form-group">
          <label className="usa-label" htmlFor="provider-name">Name</label>
          <input id="provider-name" className="usa-input" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
        </div>
        <div className="usa-form-group">
          <label className="usa-label" htmlFor="provider-email">Email (optional)</label>
          <input id="provider-email" type="email" className="usa-input" value={email} onChange={(event) => setEmail(event.target.value)} />
        </div>
        <div className="usa-form-group">
          <label className="usa-label" htmlFor="provider-kind">Kind</label>
          <select id="provider-kind" className="usa-select" value={professionalKindId} onChange={(event) => setKindId(event.target.value)}>
            <option value="">Choose</option>
            {data?.map((kind) => (
              <option key={kind.professionalKindId} value={kind.professionalKindId}>{kind.displayName}</option>
            ))}
          </select>
        </div>
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="button-row">
        <button type="submit" className="btn btn--primary" disabled={displayName.trim().length < 2 || !professionalKindId}>Add</button>
        <button type="button" className="link-button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
