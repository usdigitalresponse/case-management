// An external sender's case number: only ever read from their file, and added
// or corrected by the billing office in review (design K6).
import type { PortalInvoice } from '../../api/client';
import { Fact } from '../../components/FactsStrip';

export function FileCaseNumber({
  invoice,
  caseNumber,
  editable,
  onShowOnFile,
}: {
  invoice: PortalInvoice['invoice'];
  // The number of the case it is under, once it has one.
  caseNumber: string | null;
  editable: boolean;
  // Shows where it is on the file, if the file has one.
  onShowOnFile?: () => void;
}) {
  const typed = invoice.caseNumberAsTyped;
  const shown = (invoice.caseId ? caseNumber : null) ?? invoice.caseNumberCorrected ?? typed;
  const note = invoice.caseId
    ? 'The case the billing office filed it under.'
    : invoice.caseNumberCorrected
      ? typed
        ? `Corrected by the billing office. Your file said ${typed}.`
        : 'Added by the billing office.'
      : typed
        ? 'Read from your file.'
        : 'The billing office adds it during review.';
  return (
    <section className="card file-case-number" aria-label="Case number">
      <dl>
        <Fact label="Case number" note={note}>
          {shown && onShowOnFile && !invoice.caseNumberCorrected && !invoice.caseId ? (
            <button type="button" className="link-button" onClick={onShowOnFile}>
              {shown}
            </button>
          ) : (
            (shown ?? 'None found in your file')
          )}
        </Fact>
      </dl>
      {editable && (
        <div className="file-case-number__why">
          <strong>Each invoice is for one case.</strong>
          <p>
            The tool reads the case number from your file. You can’t type one here.
            {typed ? ' If it is wrong, the billing office corrects it during review.' : ' You can still send this invoice, and the billing office adds the number during review.'}
          </p>
        </div>
      )}
    </section>
  );
}
