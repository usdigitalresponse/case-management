import { Notice } from '../../components/ui/Notice';
import { OriginalDocument } from '../../components/OriginalDocument';
import { RecordedDecision } from '../../components/lineReview/DecisionCell';
import { LineQuestions } from '../../components/ReviewQuestions';
import { SentBackNotice } from '../../components/SentBackNotice';
import { formatDateTime } from '../../formatDateTime';
import { formatMoney } from '../../formatMoney';
import { CheckLinesTable } from '../CheckLinesTable';
import type { Submission } from './useSubmission';

export function SubmissionLines({ s }: { s: Submission }) {
  const { data, staff, user, focus, setFocus } = s;
  const { invoice, isDraft, editable, awaiting, sent } = s.facts;
  const { fileSource } = data;
  const { lines, rows, context, askingFor, duplicates, notice, undatedRow, fileSays, error, handlers, edited, editLine } = s.entry;
  const decisionFor = (index: number) => {
    const line = data.lines[index];
    return line?.decision ? <RecordedDecision line={line} decision={line.decision} /> : null;
  };
  const questionsFor = (index: number) => {
    const lineId = data.lines[index]?.invoiceLineId;
    const questions = data.questions.filter((question) => question.invoiceLineId === lineId);
    return questions.length === 0 ? null : (
      <LineQuestions questions={questions} staff={false} canAnswer={data.canAnswer} saving={s.answering} onAnswer={s.answer} />
    );
  };
  return (
    <div className={fileSource ? 'submission__layout' : undefined}>
      {fileSource &&
        (fileSource.fileAvailable ? (
          <OriginalDocument
            invoiceId={invoice.invoiceId}
            portal
            fileName={fileSource.fileName}
            heading="Your file"
            focus={focus}
            regions={[...fileSource.lines, ...s.caseNumberRegion]}
          />
        ) : (
          <section className="card original-document original-document--gone">
            <p>The uploaded file {fileSource.fileName} is no longer kept.</p>
          </section>
        ))}
      <div className="submission__lines">
        {error && <Notice tone="danger">{error}</Notice>}
        {invoice.statusCode === 'submitted' && data.submissionAttempt && (
          <Notice tone="success">
            {staff
              ? `Sent for review on ${formatDateTime(data.submissionAttempt.submittedAt)}.`
              : `Sent for review on ${formatDateTime(data.submissionAttempt.submittedAt)}. We emailed a receipt to ${user?.email}. You can withdraw it until review starts.`}
          </Notice>
        )}
        {!isDraft &&
          data.overrunExplanations.map((entry) => (
            <Notice key={entry.recordedAt} tone="warning" heading="Over the limit when sent">
              {formatMoney(entry.total)} against {formatMoney(entry.limit)} {entry.source === 'threshold' ? 'threshold' : 'pre-authorized'}.{' '}
              <strong>Explanation given:</strong> {entry.explanation}
            </Notice>
          ))}
        {isDraft && <SentBackNotice reason={invoice.returnedReason} />}
        {awaiting && (
          <Notice tone="info">
            Sent. Some of its details aren’t in our system yet, so the billing office will match them, then send it for review.
            You can withdraw it until then.
          </Notice>
        )}
        {invoice.statusCode === 'awaiting_answer' && (
          <Notice tone="warning" heading="The billing office has a question.">
            Review is waiting for {data.canAnswer ? 'your' : 'an'} answer. Answer it on the line it's about, below.
          </Notice>
        )}
        {(invoice.statusCode === 'under_review' || invoice.statusCode === 'awaiting_sign_off') && (
          <Notice tone="info">Review has started, so the invoice can no longer be withdrawn. Contact the billing office to change it.</Notice>
        )}
        {(invoice.statusCode === 'approved' || invoice.statusCode === 'rejected') && data.approvedTotal !== null && (
          <Notice tone="success">
            Decided: {formatMoney(data.approvedTotal)} approved of {formatMoney(invoice.submittedTotal)}. Each line shows why.
          </Notice>
        )}
        {isDraft && notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
        {editable && undatedRow && <Notice tone="warning">Line {undatedRow.number} has no date in your file. Enter its date before you send.</Notice>}
        <CheckLinesTable
          rows={rows}
          context={context}
          warnings={fileSource?.warnings ?? []}
          duplicates={isDraft ? duplicates : new Map()}
          editable={editable}
          focus={focus?.location}
          onFocus={(location) => setFocus(location ? { location } : undefined)}
          {...handlers}
          onEditLine={editLine}
          edited={(index) => edited.has(lines[index]?.invoiceLineId ?? '')}
          extra={sent ? decisionFor : undefined}
          detail={sent ? questionsFor : undefined}
          addLabel={fileSource ? 'Add a line we missed' : 'Add a line'}
          footer={
            <div className="check-lines__totals">
              {fileSays !== null && (
                <div>
                  <span>Your file says</span>
                  <span>{formatMoney(fileSays)}</span>
                </div>
              )}
              <div className="check-lines__asking">
                <span>{isDraft ? 'You are asking for' : 'Sent for review'}</span>
                <strong>{formatMoney(isDraft ? askingFor : invoice.submittedTotal)}</strong>
              </div>
            </div>
          }
        />
        <p className="compact-hint">
          {isDraft
            ? fileSource
              ? 'Correct any line where it is; click it to see where it is on your file. Changes save when you send or save for later.'
              : 'Add each line of the invoice, and correct any line where it is. Changes save when you send or save for later.'
            : invoice.statusCode === 'submitted' || awaiting
              ? 'This invoice is with the billing office, so the lines are locked. Withdraw it if you need to change something.'
              : 'The lines are locked while the billing office reviews them.'}
        </p>
      </div>
    </div>
  );
}
