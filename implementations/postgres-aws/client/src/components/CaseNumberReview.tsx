// A reviewer's correction beside the case number as typed, with how many
// other invoices share it, and its county; or the number a file without one
// lacked, added by the reviewer (design K69).
import { useEffect, useRef, useState } from 'react';
import { Link as RouterLink } from 'react-router';
import { apiErrorMessage, changeInvoiceCounty, correctCaseNumber, type QueuedInvoice } from '../api/client';
import { EXTERNAL_SYSTEM_NAME } from '../externalSystem';
import { searchPath } from '../staffPaths';
import { countyValueOf } from '../counties';
import { CaseNumberBox } from './CaseNumberBox';
import { Notice } from './ui/Notice';
import { SavedCountyPicker } from './CountyPicker';

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
  // Only when the saved number changes, never over what is being typed on first render.
  const shownFor = useRef(current);
  useEffect(() => {
    if (shownFor.current === current) return;
    shownFor.current = current;
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
      () => onCorrected(current ? `Case number changed to ${next}.` : `Case number ${next} added.`),
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

  const none = !invoice.caseNumberAsTyped && !invoice.caseNumberCorrected;
  return (
    <>
      {none && canCorrect && (
        <Notice tone="warning">{sender}’s invoice had no case number. Add it below. The tool then lists this invoice under that case.</Notice>
      )}
      <CaseNumberBox
        id="review-case-number"
        label={none ? 'Case number' : `Case number, as typed by ${sender}`}
        value={value}
        readOnly={!canCorrect}
        hint={
          none
            ? canCorrect
              ? 'Type it from the invoice or the paperwork that came with it.'
              : 'None found in the file.'
            : invoice.caseNumberCorrected
              ? invoice.caseNumberAsTyped
                ? `Corrected by a reviewer. ${firstName} typed ${invoice.caseNumberAsTyped}.`
                : `Added by a reviewer. ${firstName}’s file had none.`
              : `Not checked against your ${EXTERNAL_SYSTEM_NAME}. If you correct it, the tool keeps what ${firstName} typed.`
        }
        error={error}
        onChange={setValue}
        onSave={save}
        county={
          canCorrect ? (
            <SavedCountyPicker
              id="review-county"
              initial={countyValueOf(invoice)}
              save={(choice) => changeInvoiceCounty(invoice.invoiceId, choice)}
              hint={
                invoice.caseCountyDisplayName
                  ? `Its case is in ${invoice.caseCountyDisplayName}. Check which county is right. A change is recorded with the county it replaced.`
                  : 'A change is recorded with the county it replaced.'
              }
            />
          ) : (
            <p className="field-hint">County: {invoice.countyDisplayName ?? 'Not added'}</p>
          )
        }
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
    </>
  );
}
