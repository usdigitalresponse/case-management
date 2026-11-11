import { Link as RouterLink } from 'react-router';
import { repriceInvoice } from '../../api/client';
import { Notice } from '../../components/Notice';
import { EnteredFlag, proposedCaseLabel } from '../../components/NewEntryFields';
import { SignOffApprovers } from '../../components/ReviewRouting';
import { EmailSender } from '../../components/EmailSender';
import { InvoiceCaseRates } from '../../components/CaseRates';
import { RateCheckNotice } from '../../components/ReviewPanels';
import { RuleFindings } from '../../components/BillingRules';
import { formatDate, formatDateTime } from '../../formatDateTime';
import { formatMoney } from '../../formatMoney';
import { personPath } from '../../staffPaths';
import type { ReviewFacts } from './reviewFacts';
import type { ReviewPage } from './useReviewPage';

// What needs attention before deciding: entered details, status, questions, rates and rule findings.
export function ReviewNotices({ page, facts }: { page: ReviewPage; facts: ReviewFacts }) {
  const { invoice, data, lines, status, byPerson, inReview, awaitingAnswer, openQuestions, answeredQuestions, sentBack, mileageFindings } = facts;
  const proposedPeople = [...new Set(lines.flatMap((line) => (line.proposedTimekeeperName ? [line.proposedTimekeeperName] : [])))];
  const stopsSetAside = data.mileageDismissals.length;
  const emailOpenQuestions = (
    <EmailSender
      email={data.senderEmail}
      invoice={invoice}
      caseNumber={facts.caseNumber}
      lines={lines.flatMap((line) => {
        const open = data.questions.filter((question) => question.invoiceLineId === line.invoiceLineId && !question.answeredAt);
        return open.length > 0 ? [{ line, number: facts.lineNumber.get(line.invoiceLineId), questions: open.map((question) => question.question) }] : [];
      })}
    />
  );
  return (
    <>
      {(invoice.proposedCase || invoice.proposedProvider || proposedPeople.length > 0) && (
        <Notice tone="warning" heading="Some details were entered by the submitter.">
          They weren't listed when it was sent, so staff matched them on Intake. Check them.
          <ul className="entered-details">
            {invoice.proposedCase && (
              <li>
                <EnteredFlag what="Case" matched={Boolean(invoice.caseId)} /> {proposedCaseLabel(invoice.proposedCase)}
                {invoice.proposedCase.details ? ` (${invoice.proposedCase.details})` : ''}
              </li>
            )}
            {invoice.proposedProvider && (
              <li>
                <EnteredFlag what="Provider" matched={Boolean(invoice.professionalId)} /> {invoice.proposedProvider.displayName}
              </li>
            )}
            {proposedPeople.length > 0 && (
              <li>
                <EnteredFlag what="Person" matched /> {proposedPeople.join(', ')}
              </li>
            )}
          </ul>
        </Notice>
      )}

      {status === 'awaiting_match' && (
        <Notice tone="info" heading="Waiting on Intake to be matched.">
          It goes to review once its case and anyone not listed are matched. Match it or send it back for changes on{' '}
          <RouterLink to="/intake">Intake</RouterLink>.
        </Notice>
      )}

      {byPerson && !invoice.caseNumberAsTyped && status !== 'awaiting_match' && !data.entryOpen && (
        <Notice tone="warning" heading="Not linked to a case.">
          Staff chose to review this invoice without one. This system didn't check the case, whether{' '}
          {invoice.professionalDisplayName ?? 'the provider'} is assigned to it, or any pre-authorization. Exports and the billing record say so.
        </Notice>
      )}

      {facts.someoneElses && (
        <Notice tone="info" heading={`${facts.reviewer!.displayName} is reviewing this invoice.`}>
          You can still decide lines and finish the review. Each decision records who made it.
        </Notice>
      )}

      {inReview && (
        <SignOffApprovers
          invoiceId={invoice.invoiceId}
          approvers={facts.approvers}
          canChange={Boolean(facts.permissions?.reassign)}
          onChanged={(message) => {
            page.setToast({ message });
            void page.refresh();
          }}
        />
      )}

      {awaitingAnswer && (
        <Notice tone="warning" heading="Review is waiting for an answer." action={emailOpenQuestions}>
          {openQuestions} {openQuestions === 1 ? 'question is' : 'questions are'} unanswered, shown on {openQuestions === 1 ? 'its line' : 'their lines'}.
          You can keep deciding lines, but the review can't be finished until {facts.askWhom} answers. If they answer another way, record it on
          the line.
        </Notice>
      )}

      {inReview && !awaitingAnswer && answeredQuestions > 0 && (
        <Notice tone="info" heading={answeredQuestions === 1 ? 'Your question was answered.' : `${answeredQuestions} questions were answered.`}>
          Read {answeredQuestions === 1 ? 'the answer on its line' : 'the answers on their lines'} before you finish the review.
        </Notice>
      )}

      {sentBack && (
        <Notice tone="info" heading={`Sent back by ${sentBack.displayName ?? 'the approver'} on ${formatDateTime(sentBack.decidedAt)}.`}>
          {sentBack.comment && <>“{sentBack.comment}” Only staff see this comment.</>}
        </Notice>
      )}

      <InvoiceCaseRates
        invoiceId={invoice.invoiceId}
        caseRates={data.caseRates}
        changedSinceSent={inReview ? data.caseRatesChangedSinceSent : []}
        awaitingSignOff={status === 'awaiting_sign_off'}
      />
      <RateCheckNotice
        lines={lines}
        canReprice={facts.canDecide}
        saving={page.saving}
        onReprice={(configured) =>
          void page.act(
            () => repriceInvoice(invoice.invoiceId, page.linesVersion()),
            ({ repriced }) => ({
              message: `${repriced} ${repriced === 1 ? 'line' : 'lines'} re-priced at ${formatMoney(configured)} an hour.`,
            }),
          )
        }
      />
      <RuleFindings
        findings={facts.ruleFindings.filter((finding) => finding.rule !== 'mileage_distance')}
        submitted={!data.entryOpen}
        fixBefore={data.entryOpen ? 'finishing the review' : undefined}
      />
      {mileageFindings.length > 0 && (
        <Notice tone="warning">
          Mileage: {mileageFindings.length} {mileageFindings.length === 1 ? 'trip is' : 'trips are'} longer than the driving route allows.{' '}
          <a href="#travel-log">See the travel log</a>, where a warning caused by stops on the way can be set aside.
        </Notice>
      )}
      {stopsSetAside > 0 && (
        <Notice tone="info">
          {stopsSetAside} mileage {stopsSetAside === 1 ? 'warning was' : 'warnings were'} set aside for stops on the way.{' '}
          <a href="#travel-log">See why in the travel log</a>.
        </Notice>
      )}
      {invoice.professionalId && data.sameDayTravel.length > 0 && (
        // The same trip may be claimed on more than one case.
        <Notice tone="info" heading="Travel on other cases the same day">
          <ul>
            {data.sameDayTravel.map(({ date, otherInvoiceCount }) => (
              <li key={date}>
                {formatDate(date)}: {otherInvoiceCount} other {otherInvoiceCount === 1 ? 'invoice' : 'invoices'} from{' '}
                {invoice.professionalDisplayName ?? 'this person'} also claim travel.{' '}
                <RouterLink to={`${personPath(invoice.professionalId!)}?day=${date}`} target="_blank" rel="noopener">
                  Review their invoices for that day<span className="usa-sr-only"> (opens a new tab)</span>
                </RouterLink>
              </li>
            ))}
          </ul>
        </Notice>
      )}
      {page.actionError && <Notice tone="danger">{page.actionError}</Notice>}
      {facts.changedCount > 0 && !facts.entering && (
        <Notice tone="info">
          {facts.entered ? facts.changer : facts.who} changed {facts.changesSummary} {facts.changedWhen}. Changed lines are marked
          {data.fileSource?.fileAvailable ? '; open one on the file to compare' : ''}.
        </Notice>
      )}
    </>
  );
}
