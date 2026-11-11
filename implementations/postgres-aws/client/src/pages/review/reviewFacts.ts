import type { InvoiceReview as InvoiceReviewData, InvoiceReviewLine, LineDecision, ReviewPermissions } from '../../api/client';
import { shownCaseNumber } from '../../caseNumbers';
import { reviewTotals } from '../../reviewTotals';

export function reviewFacts(data: InvoiceReviewData, userId: string, permissions: ReviewPermissions | null | undefined) {
  const { invoice, lines, assignments } = data;
  const status = invoice.statusCode;
  const awaitingAnswer = status === 'awaiting_answer';
  const openQuestions = data.questions.filter((question) => !question.answeredAt).length;
  // Lines may still be decided while waiting for an answer; finishing waits.
  const inReview = status === 'submitted' || status === 'under_review' || awaitingAnswer;
  const reviewer = assignments?.reviewer ?? null;
  // Anyone on staff decides lines; deciding one on an unassigned invoice takes it.
  const canDecide = inReview && Boolean(permissions?.reviewLines);
  // While reviewing, the working decisions; afterwards, the recorded ones.
  const current = (line: InvoiceReviewLine): LineDecision | null => (inReview ? line.working : line.decision);
  const totals = reviewTotals(lines, current);
  const ruleFindings = data.ruleFindings ?? [];
  // Less any set aside for stops on the way.
  const mileageFindings = ruleFindings.filter(
    (finding) => finding.rule === 'mileage_distance' && !data.mileageDismissals.some((row) => row.invoiceLineId === finding.invoiceLineId),
  );

  // Entered in review by staff: the file is the sender's, the changes from it
  // were made entering it, and questions go to the sender.
  const entered = invoice.enteredInReview;
  const who = invoice.submittedByDisplayName ?? invoice.professionalDisplayName ?? 'the submitter';
  const whoKind = (invoice.professionalKindDisplayName ?? 'submitter').toLowerCase();
  const from = invoice.professionalDisplayName ?? 'the sender';
  const { fileSource, submitterChanges } = data;
  const changes = submitterChanges ?? { changedCount: 0, removedCount: 0, addedCount: 0 };

  return {
    data,
    invoice,
    lines,
    userId,
    permissions,
    status,
    awaitingAnswer,
    openQuestions,
    answeredQuestions: data.questions.length - openQuestions,
    inReview,
    reviewer,
    canDecide,
    someoneElses: canDecide && reviewer !== null && reviewer.userAccountId !== userId,
    // Lines are entered and decided in one pass.
    entering: data.entryOpen && canDecide,
    lineNumber: new Map(lines.map((line, index) => [line.invoiceLineId, index + 1])),
    caseNumber: shownCaseNumber({ ...invoice, caseNumber: data.caseNumber }),
    current,
    totals,
    everyLineDecided: inReview && !awaitingAnswer && lines.length > 0 && totals.decided === lines.length,
    ruleFindings,
    mileageFindings,
    overRoute: new Set(mileageFindings.map((finding) => finding.invoiceLineId)),
    approvers: assignments?.signOff ?? [],
    sentBack: status === 'under_review' ? data.signOffs.filter((s) => s.outcomeCode === 'changes_requested').at(-1) : undefined,
    // Filed by person, with no case matched yet.
    byPerson: invoice.caseId === null,
    timeLog: data.timeLog,
    entered,
    who,
    whoKind,
    fileOwner: entered ? from : who,
    changer: entered ? (invoice.submittedByDisplayName ?? 'staff') : `the ${whoKind}`,
    changedWhen: entered ? 'while entering it' : 'before sending',
    askWhom: entered ? from : 'the submitter',
    changedCount: changes.changedCount + changes.removedCount + changes.addedCount,
    changesSummary: [
      changes.changedCount ? `${changes.changedCount} ${changes.changedCount === 1 ? 'line' : 'lines'}` : null,
      changes.removedCount ? `removed ${changes.removedCount}` : null,
      changes.addedCount ? `added ${changes.addedCount}` : null,
    ]
      .filter(Boolean)
      .join(', '),
    fileSaid: fileSource ? (fileSource.statedTotal ?? fileSource.lines.reduce((sum, read) => sum + (read.amount ?? 0), 0)) : null,
  };
}

export type ReviewFacts = ReturnType<typeof reviewFacts>;
