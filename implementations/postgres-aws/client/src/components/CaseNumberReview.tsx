// A reviewer's correction beside the case number as typed, with how many
// other invoices share it.
import { useEffect, useRef, useState } from 'react';
import { Link as RouterLink } from 'react-router';
import { apiErrorMessage, correctCaseNumber, type QueuedInvoice } from '../api/client';
import { EXTERNAL_SYSTEM_NAME } from '../externalSystem';
import { searchPath } from '../staffPaths';
import { CaseNumberBox } from './CaseNumberBox';

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
  const saved = useRef(current);
  useEffect(() => {
    setValue(current);
    saved.current = current;
  }, [current]);

  function save() {
    const next = value.trim();
    if (!next || next === saved.current) {
      setValue(saved.current);
      return;
    }
    saved.current = next;
    setError(null);
    correctCaseNumber(invoice.invoiceId, next).then(
      () => onCorrected(`Case number changed to ${next}.`),
      (err: unknown) => {
        saved.current = current;
        setError(apiErrorMessage(err, 'The case number could not be saved.'));
      },
    );
  }

  const others = [
    matches.same > 0 ? `${matches.same} other ${matches.same === 1 ? 'invoice has' : 'invoices have'} this case number` : null,
    matches.close > 0 ? `${matches.same > 0 ? 'and ' : ''}${matches.close} more ${matches.close === 1 ? 'is a close match' : 'are close matches'}` : null,
  ].filter(Boolean);

  return (
    <CaseNumberBox
      id="review-case-number"
      label={`Case number, as typed by ${sender}`}
      value={value}
      readOnly={!canCorrect}
      hint={
        invoice.caseNumberCorrected
          ? `Corrected by a reviewer. ${firstName} typed ${invoice.caseNumberAsTyped ?? 'none'}.`
          : `Not checked against your ${EXTERNAL_SYSTEM_NAME}. If you correct it, the tool keeps what ${firstName} typed.`
      }
      error={error}
      onChange={setValue}
      onSave={save}
    >
      {current && (
        <>
          <button type="button" className="link-button" disabled title="Not connected yet">
            Search your {EXTERNAL_SYSTEM_NAME} for {current} <span aria-hidden="true">↗</span>
          </button>
          {others.length > 0 && <p>{others.join(', ')}.</p>}
          <p>
            <RouterLink to={searchPath(current)}>See all invoices with this case number</RouterLink>
          </p>
        </>
      )}
    </CaseNumberBox>
  );
}
