// Ask for pre-authorization, or record an emailed request (model/rules.yaml request_preauthorization).
import { useEffect, useState, type FormEvent } from 'react';
import {
  apiErrorMessage,
  createPreauthorizationRequest,
  previewPreauthorizationRequest,
  uploadProviderDocument,
  uploadRequestDocument,
  type RateBasis,
  type RequestPreview,
} from '../api/client';
import type { CountyValue } from '../counties';
import { formatMoney } from '../formatMoney';
import { CountyPicker } from './CountyPicker';
import { ADD_NEW, PickOrAdd } from './PickOrAdd';
import { Notice } from './Notice';

export interface Option {
  id: string;
  label: string;
}


type DocumentPurpose = 'cv' | 'fee_schedule';
const DOCUMENT_LABELS: Record<DocumentPurpose, string> = { cv: 'CV', fee_schedule: 'fee schedule or quote' };

const BASES: Array<{ id: RateBasis; label: string }> = [
  { id: 'hourly', label: 'Hourly' },
  { id: 'flat', label: 'Flat fee' },
  { id: 'per_unit', label: 'Per unit (page, minute…)' },
];

export function PreauthorizationRequestForm({
  cases,
  providers,
  fixedCaseId,
  staff = false,
  onCreated,
  onCancel,
}: {
  cases: Option[];
  providers: Option[];
  fixedCaseId?: string;
  staff?: boolean;
  // uploadError: a file that couldn't be added after the request was sent.
  onCreated: (created: { preauthorizationRequestId: string; requestNumber: string }, uploadError: string | null) => void;
  onCancel: () => void;
}) {
  // '' until chosen; ADD_NEW for one entered as proposed details.
  const [caseId, setCaseId] = useState(fixedCaseId ?? cases[0]?.id ?? '');
  const [caseNumber, setCaseNumber] = useState('');
  const [countyValue, setCountyValue] = useState<CountyValue | null>(null);
  const [professionalId, setProfessionalId] = useState(providers[0]?.id ?? '');
  const [providerName, setProviderName] = useState('');
  const [serviceDescription, setServiceDescription] = useState('');
  const [rateBasis, setRateBasis] = useState<RateBasis>('hourly');
  const [rate, setRate] = useState('');
  const [quantity, setQuantity] = useState('');
  const [amount, setAmount] = useState('');
  const [justification, setJustification] = useState('');
  const [receivedVia, setReceivedVia] = useState('Email');
  const [receivedOn, setReceivedOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [preview, setPreview] = useState<RequestPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const caseListed = caseId !== '' && caseId !== ADD_NEW;
  const providerListed = professionalId !== '' && professionalId !== ADD_NEW;
  const [attachments, setAttachments] = useState<Record<DocumentPurpose, File | null>>({ cv: null, fee_schedule: null });
  const missing: DocumentPurpose[] = providerListed ? (preview?.documents?.missing ?? []) : professionalId === ADD_NEW ? ['cv', 'fee_schedule'] : [];
  // A total entered overrides rate × quantity.
  const worked = rateBasis !== 'flat' && Number(rate) > 0 && Number(quantity) > 0 ? Number(rate) * Number(quantity) : null;
  const total = amount ? Number(amount) : (worked ?? 0);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      previewPreauthorizationRequest({
        caseId: caseListed ? caseId : null,
        professionalId: providerListed ? professionalId : null,
        countyId: caseListed ? null : (countyValue?.countyId ?? null),
        requestedAmount: total || undefined,
      }).then(
        (result) => !cancelled && setPreview(result),
        () => !cancelled && setPreview(null),
      );
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [caseId, professionalId, countyValue?.countyId, total, caseListed, providerListed]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const created = await createPreauthorizationRequest({
        caseId: caseListed ? caseId : null,
        proposedCase:
          caseId === ADD_NEW
            ? { caseNumber: caseNumber.trim(), countyId: countyValue?.countyId ?? null, countyName: countyValue?.countyId ? undefined : countyValue?.displayName }
            : undefined,
        professionalId: providerListed ? professionalId : null,
        proposedProvider: professionalId === ADD_NEW ? { name: providerName.trim() } : undefined,
        serviceDescription: serviceDescription.trim(),
        rateBasis,
        requestedRate: rateBasis === 'flat' ? null : Number(rate) || null,
        estimatedQuantity: rateBasis === 'flat' ? null : Number(quantity) || null,
        requestedAmount: total,
        justification: justification.trim(),
        ...(staff ? { receivedVia, receivedOn } : {}),
      });
      // Kept on the provider when listed, else on the request.
      let uploadError: string | null = null;
      for (const [purpose, file] of Object.entries(attachments) as Array<[DocumentPurpose, File | null]>) {
        if (!file || !missing.includes(purpose)) continue;
        try {
          // eslint-disable-next-line no-await-in-loop
          await (providerListed ? uploadProviderDocument(professionalId, file, purpose) : uploadRequestDocument(created.preauthorizationRequestId, file, purpose));
        } catch (err) {
          uploadError = apiErrorMessage(err, `${file.name} could not be added.`);
        }
      }
      onCreated(created, uploadError);
    } catch (err) {
      setError(apiErrorMessage(err, 'The request could not be sent.'));
    } finally {
      setSaving(false);
    }
  }

  const limit = preview?.limit;
  return (
    <form className="compact-form preauth-request-form" onSubmit={(event) => void submit(event)}>
      {error && <Notice tone="danger">{error}</Notice>}
      {!fixedCaseId && (
        <PickOrAdd
          id="preauth-case"
          label="Case"
          value={caseId}
          onChange={setCaseId}
          addLabel="+ A case not listed"
          placeholder="Choose a case"
          options={cases.map((option) => ({ value: option.id, label: option.label }))}
        >
          <div className="usa-form-group">
            <label className="usa-label" htmlFor="preauth-case-number">Case number</label>
            <input id="preauth-case-number" className="usa-input" required value={caseNumber} onChange={(event) => setCaseNumber(event.target.value)} />
          </div>
          <CountyPicker id="preauth-county" label="County" value={countyValue} onChange={setCountyValue} />
        </PickOrAdd>
      )}
      <PickOrAdd
        id="preauth-provider"
        label="Provider"
        value={professionalId}
        onChange={setProfessionalId}
        addLabel="+ Someone not listed"
        placeholder="Choose a provider"
        options={providers.map((option) => ({ value: option.id, label: option.label }))}
      >
        <div className="usa-form-group">
          <label className="usa-label" htmlFor="preauth-provider-name">Provider’s name</label>
          <input id="preauth-provider-name" className="usa-input" required value={providerName} onChange={(event) => setProviderName(event.target.value)} />
        </div>
      </PickOrAdd>
      <div className="usa-form-group">
        <label className="usa-label" htmlFor="preauth-service">What the work is</label>
        <input
          id="preauth-service"
          className="usa-input"
          required
          placeholder="For example, investigation or a psychological evaluation"
          value={serviceDescription}
          onChange={(event) => setServiceDescription(event.target.value)}
        />
      </div>
      <div className="inline-fields">
        <div className="usa-form-group">
          <label className="usa-label" htmlFor="preauth-basis">Charged</label>
          <select id="preauth-basis" className="usa-select" value={rateBasis} onChange={(event) => setRateBasis(event.target.value as RateBasis)}>
            {BASES.map((basis) => (
              <option key={basis.id} value={basis.id}>{basis.label}</option>
            ))}
          </select>
        </div>
        {rateBasis !== 'flat' && (
          <>
            <div className="usa-form-group">
              <label className="usa-label" htmlFor="preauth-rate">Rate ($)</label>
              <input id="preauth-rate" className="usa-input" type="number" min="0.01" step="0.01" required value={rate} onChange={(event) => setRate(event.target.value)} />
            </div>
            <div className="usa-form-group">
              <label className="usa-label" htmlFor="preauth-quantity">{rateBasis === 'hourly' ? 'Hours expected' : 'Units expected'}</label>
              <input id="preauth-quantity" className="usa-input" type="number" min="0.1" step="0.1" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
            </div>
          </>
        )}
        <div className="usa-form-group">
          <label className="usa-label" htmlFor="preauth-amount">Total to allow ($)</label>
          <input
            id="preauth-amount"
            className="usa-input"
            type="number"
            min="0.01"
            step="0.01"
            placeholder={worked ? worked.toFixed(2) : undefined}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </div>
      </div>
      <p className="compact-hint">
        The provider’s total on this case, including what’s already billed.
        {limit && limit.source === 'preauthorized' && ` Now: ${formatMoney(limit.ceiling)} pre-authorized, ${formatMoney(Number(limit.approvedSoFar) + Number(limit.waiting))} billed.`}
      </p>
      {preview && total > 0 && total < Number(preview.billed) && (
        <Notice tone="warning">{formatMoney(preview.billed)} is already billed. Enter the provider’s total on this case.</Notice>
      )}
      {preview?.withinThreshold && preview.threshold && (
        <Notice tone="info">
          Not needed: {formatMoney(total)} is within this county’s {formatMoney(preview.threshold)} threshold. You can still send it.
        </Notice>
      )}
      {missing.length > 0 && (
        <div className="preauth-attachments">
          <Notice tone={providerListed ? 'warning' : 'info'}>
            {providerListed
              ? `No ${missing.map((code) => DOCUMENT_LABELS[code]).join(' or ')} on file for this provider.`
              : 'Attach the provider’s CV and fee schedule, if you have them.'}
          </Notice>
          <div className="inline-fields">
            {missing.map((purpose) => (
              <div className="usa-form-group" key={purpose}>
                <label className="usa-label" htmlFor={`preauth-attach-${purpose}`}>
                  {DOCUMENT_LABELS[purpose][0]!.toUpperCase() + DOCUMENT_LABELS[purpose].slice(1)} (optional)
                </label>
                <input
                  id={`preauth-attach-${purpose}`}
                  className="usa-file-input"
                  type="file"
                  accept=".pdf,.docx,.png,.jpg,.jpeg"
                  onChange={(event) => setAttachments({ ...attachments, [purpose]: event.target.files?.[0] ?? null })}
                />
              </div>
            ))}
          </div>
          <p className="compact-hint">PDF, Word, PNG or JPEG, up to 10 MB.</p>
        </div>
      )}
      <div className="usa-form-group">
        <label className="usa-label" htmlFor="preauth-justification">Why the work is needed</label>
        <textarea id="preauth-justification" className="usa-textarea" required maxLength={4000} value={justification} onChange={(event) => setJustification(event.target.value)} />
      </div>
      {staff && (
        <div className="inline-fields">
          <div className="usa-form-group">
            <label className="usa-label" htmlFor="preauth-via">Received by</label>
            <input id="preauth-via" className="usa-input" value={receivedVia} onChange={(event) => setReceivedVia(event.target.value)} />
          </div>
          <div className="usa-form-group">
            <label className="usa-label" htmlFor="preauth-on">Received on</label>
            <input id="preauth-on" className="usa-input" type="date" value={receivedOn} onChange={(event) => setReceivedOn(event.target.value)} />
          </div>
        </div>
      )}
      <div className="dialog__actions">
        <button type="submit" className="btn btn--primary" disabled={saving || !(total > 0)}>
          {saving ? 'Sending…' : staff ? 'Record the request' : 'Send the request'}
        </button>
        <button type="button" className="link-button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
