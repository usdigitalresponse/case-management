import { setEnteredDetails, setEnteredSender } from '../../api/client';
import { EntryBadge } from '../../components/EntryBadge';
import { EnteredCaseNumber, EntryReceipt } from '../../components/EntryLines';
import { Notice } from '../../components/ui/Notice';
import { InvoiceDetailsFields } from '../../components/InvoiceDetailsFields';
import { CaseCard, CaseMatch } from '../../components/CaseCard';
import { CaseNumberReview } from '../../components/CaseNumberReview';
import type { ReviewFacts } from './reviewFacts';
import type { ReviewPage } from './useReviewPage';

// Who is entering it and its details while they do, then its case or the case number to match.
export function EntryAndCase({ page, facts }: { page: ReviewPage; facts: ReviewFacts }) {
  const { invoice, data, entering, reviewer, byPerson, status, inReview, permissions } = facts;
  const { refresh, setToast, saveEdits, knownVersion } = page;
  const reloadWith = (message: string) => {
    setToast({ message });
    void refresh();
  };
  return (
    <>
      {data.entryOpen && (
        <EntryBadge enteringName={reviewer?.displayName ?? null} own={entering} changedByName={data.linesChangedByDisplayName} changedAt={invoice.linesChangedAt} />
      )}
      {entering && page.receiptAsked.current.ask && <EntryReceipt invoice={invoice} onSaved={() => void refresh()} />}
      {data.entryOpen && !entering && (
        <Notice tone="info" heading={`${reviewer?.displayName ?? 'Someone'} is still entering this invoice.`}>
          Its lines and decisions may change until they finish the review. This page checks for changes every 30 seconds. Its case number can
          be corrected once the review is finished.
        </Notice>
      )}

      {entering && (
        <InvoiceDetailsFields
          // Not EntryLines' key: a sibling with the same one is kept twice.
          key={`details-${invoice.invoiceId}`}
          invoice={invoice}
          // Flagged once the sender is all that finishing still needs.
          missingSender={facts.everyLineDecided && !invoice.professionalId}
          action="finish"
          warnings={data.fileSource?.warnings ?? []}
          saveSender={async (choice) => {
            if (!(await saveEdits.current())) throw new Error('Line changes not saved');
            try {
              const saved = await setEnteredSender(invoice.invoiceId, choice, knownVersion.current);
              knownVersion.current = Math.max(knownVersion.current, saved.linesVersion);
              if (saved.undecided.length > 0) {
                const count = saved.undecided.length;
                setToast({
                  message: `Priced at their rates, so ${count === 1 ? 'a decision was' : `${count} decisions were`} undone. Decide ${count === 1 ? 'it' : 'them'} again.`,
                });
              }
            } finally {
              // Refused as out of date, it shows the lines as they are now.
              await refresh();
            }
          }}
          saveDetails={(details) => setEnteredDetails(invoice.invoiceId, details)}
          onSenderRenamed={() => void refresh()}
          onPeriodChanged={(saved) => {
            page.period.current = { invoiceId: invoice.invoiceId, ...saved };
          }}
        />
      )}
      {entering && <EnteredCaseNumber invoice={invoice} />}
      {!byPerson && (
        <CaseCard
          invoice={invoice}
          caseNumber={data.caseNumber}
          otherNumbers={data.otherCaseNumbers}
          preauthorization={data.preauthorization}
          overPreauthorized={data.overPreauthorized}
          overrunExplanations={data.overrunExplanations}
        />
      )}
      {byPerson && !entering && (
        <CaseNumberReview
          invoice={invoice}
          matches={data.caseNumberMatches}
          canCorrect={status !== 'awaiting_match' && !data.entryOpen && Boolean(permissions?.reviewLines)}
          onCorrected={reloadWith}
        />
      )}
      {byPerson && inReview && !data.entryOpen && Boolean(permissions?.reviewLines) && <CaseMatch invoice={invoice} onMatched={reloadWith} />}
    </>
  );
}
