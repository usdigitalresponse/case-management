import { useState } from 'react';
import { addProviderServiceRate, apiErrorMessage, type RateBasis, linkedDocumentUrl, uploadProviderDocument, type LinkedDocument } from '../../api/client';
import { useResource } from '../../hooks/useResource';
import { providerDocuments } from '../../resources';
import { formatDate, formatDay } from '../../formatDateTime';
import { formatMoney } from '../../formatMoney';
import { Notice } from '../ui/Notice';
import { Button } from '../ui/Button';

const PURPOSES: Array<{ id: LinkedDocument['purposeCode']; label: string }> = [
  { id: 'cv', label: 'CV' },
  { id: 'fee_schedule', label: 'Fee schedule' },
  { id: 'quote', label: 'Quote' },
  { id: 'supporting', label: 'Something else' },
];

export function DocumentList({ documents }: { documents: LinkedDocument[] }) {
  if (documents.length === 0) return <p className="muted">None yet.</p>;
  return (
    <ul className="plain-list">
      {documents.map((doc) => (
        <li key={doc.documentId}>
          <a href={linkedDocumentUrl(doc.documentId)}>{doc.displayName}</a> <span className="cell-note">{doc.purposeName}, added {formatDay(doc.recordedAt)}</span>
        </li>
      ))}
    </ul>
  );
}

export function AddDocument({ onAdd, defaultPurpose }: { onAdd: (file: File, purpose: LinkedDocument['purposeCode']) => Promise<unknown>; defaultPurpose: LinkedDocument['purposeCode'] }) {
  const [purpose, setPurpose] = useState(defaultPurpose);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = `doc-${Math.random().toString(36).slice(2, 8)}`;
  return (
    <div className="inline-fields">
      <div className="usa-form-group">
        <label className="usa-label" htmlFor={`${id}-purpose`}>It is a</label>
        <select id={`${id}-purpose`} className="usa-select" value={purpose} onChange={(event) => setPurpose(event.target.value as LinkedDocument['purposeCode'])}>
          {PURPOSES.map((option) => (
            <option key={option.id} value={option.id}>{option.label}</option>
          ))}
        </select>
      </div>
      <div className="usa-form-group">
        <label className="usa-label" htmlFor={`${id}-file`}>File (PDF, Word or image)</label>
        <input
          id={`${id}-file`}
          className="usa-file-input"
          type="file"
          disabled={busy}
          accept=".pdf,.docx,.png,.jpg,.jpeg"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            setBusy(true);
            setError(null);
            onAdd(file, purpose)
              .catch((err: unknown) => setError(apiErrorMessage(err, 'The file could not be added.')))
              .finally(() => {
                setBusy(false);
                event.target.value = '';
              });
          }}
        />
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
    </div>
  );
}

// model/rules.yaml request_provider_documents.
export function ProviderOnFile({ professionalId, name }: { professionalId: string; name: string }) {
  const { data, error, reload } = useResource(providerDocuments(professionalId));
  const [service, setService] = useState('');
  const [rate, setRate] = useState('');
  const [basis, setBasis] = useState<RateBasis>('hourly');
  const [from, setFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [rateError, setRateError] = useState<string | null>(null);
  if (!data) return error ? <Notice tone="danger">Failed to load what is on file.</Notice> : null;
  return (
    <section className="card compact-card preauth-page">
      <h2>On file for {name}</h2>
      {data.missing.length > 0 && (
        <Notice tone="warning">Missing: {data.missing.map((code) => (code === 'cv' ? 'CV' : 'fee schedule or quote')).join(' and ')}.</Notice>
      )}
      <DocumentList documents={data.documents} />
      <AddDocument defaultPurpose={data.missing[0] ?? 'fee_schedule'} onAdd={(file, purpose) => uploadProviderDocument(professionalId, file, purpose).then(reload)} />
      <h3>Fees they quote</h3>
      {data.rates.length === 0 ? (
        <p className="muted">None recorded.</p>
      ) : (
        <ul className="plain-list">
          {data.rates.map((row) => (
            <li key={row.providerServiceRateId}>
              {row.serviceDescription}: {formatMoney(row.rate)} {row.rateBasis === 'flat' ? 'flat' : row.rateBasis === 'hourly' ? 'an hour' : 'a unit'}
              <span className="cell-note">from {formatDate(row.effectiveFrom)}</span>
            </li>
          ))}
        </ul>
      )}
      <form
        className="inline-fields"
        onSubmit={(event) => {
          event.preventDefault();
          setRateError(null);
          addProviderServiceRate(professionalId, { serviceDescription: service.trim(), rate: Number(rate), rateBasis: basis, effectiveFrom: from }).then(
            () => {
              setService('');
              setRate('');
              void reload();
            },
            (err: unknown) => setRateError(apiErrorMessage(err, 'The fee could not be added.')),
          );
        }}
      >
        <div className="usa-form-group">
          <label className="usa-label" htmlFor="fee-service">Service</label>
          <input id="fee-service" className="usa-input" value={service} onChange={(event) => setService(event.target.value)} />
        </div>
        <div className="usa-form-group">
          <label className="usa-label" htmlFor="fee-rate">Fee ($)</label>
          <input id="fee-rate" className="usa-input" type="number" min="0.01" step="0.01" value={rate} onChange={(event) => setRate(event.target.value)} />
        </div>
        <div className="usa-form-group">
          <label className="usa-label" htmlFor="fee-basis">Per</label>
          <select id="fee-basis" className="usa-select" value={basis} onChange={(event) => setBasis(event.target.value as RateBasis)}>
            <option value="hourly">Hour</option>
            <option value="flat">Flat fee</option>
            <option value="per_unit">Unit</option>
          </select>
        </div>
        <div className="usa-form-group">
          <label className="usa-label" htmlFor="fee-from">From</label>
          <input id="fee-from" className="usa-input" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        </div>
        <Button type="submit" kind="secondary" disabled={!service.trim() || !(Number(rate) > 0)}>
          Add fee
        </Button>
        {rateError && <p className="field-error" role="alert">{rateError}</p>}
      </form>
    </section>
  );
}
