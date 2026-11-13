// An external sender's case number once they can no longer change it; the billing
// office adds or corrects it in review.
import type { PortalInvoice } from '../../api/client';
import { Fact } from '../../components/FactsStrip';

export function FileCaseNumber({
  invoice,
  caseNumber,
  onShowOnFile,
}: {
  invoice: PortalInvoice['invoice'];
  // The number of the case it is under, once it has one.
  caseNumber: string | null;
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
        ? 'As you sent it.'
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
    </section>
  );
}
