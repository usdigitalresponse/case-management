import { useState } from 'react';
import { apiErrorMessage, setDraftCase, setDraftCaseChoice, type PortalInvoice } from '../../api/client';
import { SegmentedChoice } from '../../components/ui/SegmentedChoice';
import { useResource } from '../../hooks/useResource';
import { myCases } from '../../resources';

// One of the sender's cases, as the billing office matched their invoices
// to them, or "not listed" to type its number (design I). Only the cases of
// the person whose work it is.
export function CaseChoice({
  invoice,
  beforeChange,
  onChanged,
}: {
  invoice: PortalInvoice['invoice'];
  // Saves the lines first, since a case prices them again.
  beforeChange: () => Promise<boolean>;
  onChanged: (caseNumber: string | null) => void;
}) {
  const { data } = useResource(myCases);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cases = (data?.cases ?? []).filter(
    (row) => invoice.professionalId && row.assignedProfessionalIds.includes(invoice.professionalId),
  );
  if (cases.length === 0) {
    return null;
  }
  async function choose(caseId: string | null) {
    setSaving(true);
    setError(null);
    try {
      if (!(await beforeChange())) return;
      const saved = await setDraftCase(invoice.invoiceId, caseId);
      onChanged(saved.caseNumber);
    } catch (err) {
      setError(apiErrorMessage(err, 'The case could not be saved. Try again.'));
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="usa-form-group case-choice">
      <label className="usa-label" htmlFor="case-choice">Which case is it?</label>
      <select
        id="case-choice"
        className="usa-select"
        value={invoice.caseId ?? ''}
        disabled={saving}
        onChange={(event) => void choose(event.target.value || null)}
      >
        <option value="">Not listed: type its case number below</option>
        {cases.map((row) => (
          <option key={row.caseId} value={row.caseId}>
            {[row.caseNumber ?? 'No number', row.clientDisplayName].filter(Boolean).join(' · ')}
          </option>
        ))}
      </select>
      <span className="field-hint">
        {invoice.caseId ? 'It goes straight to review when you send it.' : 'Cases the billing office has matched your invoices to.'}
      </span>
      {error && <p className="field-error" role="alert">{error}</p>}
    </div>
  );
}

// An external sender's own answer: for a case, or not for one case such as
// court observation. Only the billing office chooses or adds a case.
export function NotForOneCase({
  invoice,
  beforeChange,
  onChanged,
}: {
  invoice: PortalInvoice['invoice'];
  beforeChange: () => Promise<boolean>;
  onChanged: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (invoice.caseId) {
    return null;
  }
  async function answer(value: 'case' | 'none') {
    setSaving(true);
    setError(null);
    try {
      if (!(await beforeChange())) return;
      await setDraftCaseChoice(invoice.invoiceId, { choice: value === 'none' ? 'none' : null });
      onChanged();
    } catch (err) {
      setError(apiErrorMessage(err, 'Your answer could not be saved. Try again.'));
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="usa-form-group">
      <SegmentedChoice
        label="Is it for a case?"
        value={invoice.caseChoice === 'none' ? 'none' : 'case'}
        disabled={saving}
        options={[
          { value: 'case', label: 'For a case' },
          { value: 'none', label: 'Not for one case' },
        ]}
        onChange={(value) => void answer(value)}
      />
      <span className="field-hint">
        {invoice.caseChoice === 'none'
          ? 'For work like court observation. Add its county below.'
          : 'Type its case number below if you have it. The billing office matches it to the case.'}
      </span>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
