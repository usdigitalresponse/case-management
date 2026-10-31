// The case number at the top of an invoice filed by person (design G15):
// as the sender typed it, which a reviewer may correct (the typed one is
// kept), with how many other invoices share it and where to look it up.
import { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router';
import { apiErrorMessage, correctCaseNumber, type QueuedInvoice } from '../api/client';
import { EXTERNAL_SYSTEM_NAME } from '../externalSystem';
import { searchPath } from '../caseNumbers';

export function CaseNumberReview({
  invoice,
  matches,
  canCorrect,
  onCorrected,
}: {
  invoice: QueuedInvoice;
  matches: { same: number; close: number };
  canCorrect: boolean;
  onCorrected: (message: string) => void;
}) {
  const sender = invoice.professionalDisplayName ?? 'the sender';
  const firstName = sender.split(' ')[0];
  const current = invoice.caseNumberCorrected ?? invoice.caseNumberAsTyped ?? '';
  const [value, setValue] = useState(current);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setValue(current), [current]);

  async function save() {
    if (value.trim() === current || !value.trim()) {
      setValue(current);
      return;
    }
    setError(null);
    try {
      await correctCaseNumber(invoice.invoiceId, value);
      onCorrected(`Case number changed to ${value.trim()}.`);
    } catch (err) {
      setError(apiErrorMessage(err, 'The case number could not be saved.'));
    }
  }

  const others = [
    matches.same > 0 ? `${matches.same} other ${matches.same === 1 ? 'invoice has' : 'invoices have'} this case number` : null,
    matches.close > 0 ? `${matches.same > 0 ? 'and ' : ''}${matches.close} more ${matches.close === 1 ? 'is a close match' : 'are close matches'}` : null,
  ].filter(Boolean);

  return (
    <section className="case-number-box" aria-labelledby="review-case-number-label">
      <div className="case-number-box__field">
        <label id="review-case-number-label" className="usa-label" htmlFor="review-case-number">
          Case number, as typed by {sender}
        </label>
        <input
          id="review-case-number"
          className="usa-input"
          value={value}
          readOnly={!canCorrect}
          aria-describedby="review-case-number-hint"
          onChange={(event) => setValue(event.target.value)}
          onBlur={() => void save()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void save();
          }}
        />
        <p id="review-case-number-hint" className={error ? 'field-error' : 'field-hint'}>
          {error ??
            (invoice.caseNumberCorrected
              ? `Corrected by a reviewer. ${firstName} typed ${invoice.caseNumberAsTyped ?? 'none'}.`
              : `Not checked against your ${EXTERNAL_SYSTEM_NAME}. If you correct it, the tool keeps what ${firstName} typed.`)}
        </p>
      </div>
      {current && (
        <div className="case-number-box__why">
          <button type="button" className="link-button" disabled title="Not connected yet">
            Search your {EXTERNAL_SYSTEM_NAME} for {current} <span aria-hidden="true">↗</span>
          </button>
          {others.length > 0 && <p>{others.join(', ')}.</p>}
          <p>
            <RouterLink to={searchPath(current)}>See all invoices with this case number</RouterLink>
          </p>
        </div>
      )}
    </section>
  );
}
