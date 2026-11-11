import { finishReview, markInvoiceCompleted, reopenReview, setMileageWarning, signOffInvoice } from '../../api/client';
import { rateChanged } from '../../components/LineReview';
import { SignOffHistory, SignOffPanel, TotalsBar } from '../../components/ReviewPanels';
import { CompletionNotice, DECIDED_STATUS_CODES } from '../../components/Completion';
import { EmailSender } from '../../components/EmailSender';
import { Notice } from '../../components/ui/Notice';
import { TravelLog } from '../../components/TravelLog';
import { formatMoney, formatRate } from '../../formatMoney';
import { reviewPath } from '../../staffPaths';
import type { ReviewFacts } from './reviewFacts';
import type { ReviewPage } from './useReviewPage';

export function ReviewOutcome({ page, facts }: { page: ReviewPage; facts: ReviewFacts }) {
  const { invoice, data, lines, status, totals, inReview, entering, approvers, permissions, awaitingAnswer } = facts;
  const { act, saving } = page;

  // Entered in review, this also freezes the lines; then the upload goes on
  // to its next invoice.
  async function finish() {
    const finishedId = invoice.invoiceId;
    const done = await act(() => finishReview(finishedId), {
      message: `Review finished. It went to ${approvers[0]?.displayName ?? 'the approver'} to sign off.`,
      // From the upload's next invoice, Undo goes back to this one.
      undo: async () => {
        await reopenReview(finishedId);
        if (page.shownId.current !== finishedId) page.navigate(reviewPath(finishedId));
      },
    });
    // Confirming the file's values may have undone decisions on lines it changed.
    if (!done && entering) void page.refresh();
    if (done && entering && page.checking?.queue.length) {
      page.keepToast.current = true;
      page.goToNext();
    }
  }

  const repriced = lines.filter((line) => rateChanged(line, line.decision));
  return (
    <>
      {(inReview || status === 'awaiting_sign_off' || status === 'approved') && totals.decided > 0 && (
        <TotalsBar
          requested={invoice.submittedTotal}
          totals={totals}
          lineCount={lines.length}
          inReview={inReview}
          canFinish={Boolean(permissions?.reviewLines) && !awaitingAnswer}
          approvers={approvers}
          saving={saving}
          onFinish={() => void finish()}
          locksLines={entering}
          needs={
            entering && !invoice.professionalId
              ? 'Choose who billed the invoice, at the top of the page, to finish the review.'
              : entering && !(invoice.receivedOn && invoice.receivedViaDisplayName)
                ? 'Say how and when the invoice came in, at the top of the page, to finish the review.'
                : null
          }
        />
      )}

      {status === 'awaiting_sign_off' && data.decidedByEnterer && (
        <Notice tone="warning" heading="Entered and decided by the same person.">
          {invoice.submittedByDisplayName ?? 'The reviewer'} entered this invoice's lines from the file and decided them. Compare them with the
          file before signing off.
        </Notice>
      )}

      {status === 'awaiting_sign_off' && repriced.length > 0 && (
        <Notice tone="warning" heading="The reviewer changed the rate on these lines. Check them before signing off.">
          <ul>
            {repriced.map((line) => (
              <li key={line.invoiceLineId}>
                Line {facts.lineNumber.get(line.invoiceLineId)}: {formatRate(line.decision!.approvedRate!)} instead of the billed{' '}
                {formatRate(line.billedRate ?? '0')}
                {line.configuredRate !== null ? ` (default ${formatRate(line.configuredRate)})` : ''}, approved{' '}
                {formatMoney(line.decision!.approvedAmount)} of {formatMoney(line.amount)}.
              </li>
            ))}
          </ul>
        </Notice>
      )}
      {status === 'awaiting_sign_off' && (
        <SignOffPanel
          nextApprover={data.nextSignOff}
          approvedCents={totals.approved}
          canSignOff={Boolean(permissions?.signOff) && data.nextSignOff?.userAccountId === facts.userId}
          canReopen={Boolean(permissions?.reviewLines) && !data.signOffStarted}
          saving={saving}
          onDecide={(outcome, comment) =>
            act(() => signOffInvoice(invoice.invoiceId, { outcome, comment: comment || undefined }), {
              message: { approved: 'Signed off.', rejected: 'Invoice rejected.', changes_requested: 'Sent back to the reviewer.' }[outcome],
            })
          }
          onReopen={() => void act(() => reopenReview(invoice.invoiceId), { message: 'Review reopened.' })}
        />
      )}

      {status === 'rejected' && (
        <Notice tone="warning" heading="Rejected at sign-off.">
          Nothing on this invoice is approved. The sign-off history says who rejected it.
        </Notice>
      )}
      {status === 'approved' && (
        <Notice tone="success" heading="Signed off.">
          Export the PDF or spreadsheet to send for payment. Check it for confidential information before you send it; this system does not
          remove it.
        </Notice>
      )}
      {DECIDED_STATUS_CODES.includes(status) && (
        <CompletionNotice
          completedAt={invoice.completedAt}
          saving={saving}
          onComplete={() => void act(() => markInvoiceCompleted(invoice.invoiceId), { message: 'Marked completed.' })}
          emailSender={<EmailSender email={data.senderEmail} invoice={invoice} caseNumber={facts.caseNumber} />}
        />
      )}

      <SignOffHistory signOffs={data.signOffs} />

      <div id="travel-log">
        <TravelLog
          lines={lines}
          findings={facts.ruleFindings}
          stops={{
            dismissals: data.mileageDismissals,
            canChange: facts.canDecide && !data.entryOpen,
            onDismiss: (lineId, reason) =>
              act(() => setMileageWarning(invoice.invoiceId, lineId, { dismissed: true, reason }), {
                message: 'Mileage warning set aside for stops on the way.',
                undo: () => setMileageWarning(invoice.invoiceId, lineId, { dismissed: false }),
              }),
            onRestore: (lineId) => void act(() => setMileageWarning(invoice.invoiceId, lineId, { dismissed: false }), { message: 'Mileage warning put back.' }),
          }}
        />
      </div>
    </>
  );
}
