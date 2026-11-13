import {
  answerQuestion,
  applyLineRate,
  askQuestion,
  decideInvoiceLine,
  undoInvoiceLineDecision,
  type InvoiceReviewLine,
  type LineDecisionInput,
} from '../../api/client';
import { DecisionCell } from '../../components/lineReview/DecisionCell';
import { DecisionPanel, decisionInput } from '../../components/lineReview/DecisionPanel';
import { type RateScope } from '../../components/lineReview/lineRates';
import { AskLink, LineQuestions, QuestionForm } from '../../components/ReviewQuestions';
import { EmailAboutLine } from '../../components/EmailSender';
import { TimeLogLineCell } from './timeLog/TimeLogLineCell';
import { TimeLogLinkForm } from './timeLog/TimeLogLinkForm';
import type { ReviewFacts } from './reviewFacts';
import type { ReviewPage } from './useReviewPage';

export function lineCells(page: ReviewPage, facts: ReviewFacts) {
  const { invoice, lines, data, timeLog, lineNumber, canDecide, inReview, permissions, askWhom } = facts;
  const { act, refresh, linesVersion, saving, panel, setPanel, asking, setAsking, linking, setLinking } = page;

  async function decide(line: InvoiceReviewLine, input: LineDecisionInput, label: string, edited = false) {
    // Saving a changed line undoes its decision, so Undo leaves it undecided.
    const previous = edited ? null : line.working;
    const done = await act(() => decideInvoiceLine(invoice.invoiceId, line.invoiceLineId, input, linesVersion()), {
      message: `Line ${lineNumber.get(line.invoiceLineId)} ${label}.`,
      undo: () =>
        previous
          ? decideInvoiceLine(invoice.invoiceId, line.invoiceLineId, decisionInput(previous), linesVersion())
          : undoInvoiceLineDecision(invoice.invoiceId, line.invoiceLineId, linesVersion()),
    });
    // Refused because the lines changed elsewhere: show them as they are now.
    if (!done && data.entryOpen) void refresh();
  }

  const logCheckOf = (line: InvoiceReviewLine) => timeLog?.lines.find((check) => check.invoiceLineId === line.invoiceLineId);
  const onLogChanged = (message?: string) => {
    if (message) page.setToast({ message });
    return refresh();
  };
  const logCellOf = (line: InvoiceReviewLine) =>
    timeLog ? (
      <TimeLogLineCell
        check={logCheckOf(line)}
        log={timeLog}
        canLink={canDecide}
        onShow={() => {
          page.setShowFile(false);
          page.setLogShown(true);
          page.setLogFocus([...(logCheckOf(line)?.entryKeys ?? [])]);
        }}
        onLink={() => {
          setPanel(null);
          setAsking(null);
          setLinking(linking === line.invoiceLineId ? null : line.invoiceLineId);
        }}
      />
    ) : null;
  const approveBlocked = (line: InvoiceReviewLine) =>
    timeLog?.blocksApproval && logCheckOf(line)?.flagged ? "The time log doesn't support it as billed. Approve asks why." : null;

  const openPanel = (line: InvoiceReviewLine) => (panel?.lineId === line.invoiceLineId ? panel.mode : null);
  const lineQuestions = (line: InvoiceReviewLine) => {
    const questions = data.questions.filter((question) => question.invoiceLineId === line.invoiceLineId);
    return questions.length === 0 ? null : (
      <LineQuestions
        questions={questions}
        staff
        canAnswer={Boolean(permissions?.reviewLines)}
        saving={saving}
        onAnswer={(questionId, answer) => act(() => answerQuestion(invoice.invoiceId, questionId, answer), { message: 'Answer recorded.' })}
      />
    );
  };

  const decisionCell = (line: InvoiceReviewLine, edited = false) => (
    <DecisionCell
      line={line}
      decision={facts.current(line)}
      inReview={inReview}
      canDecide={canDecide}
      changing={page.changing === line.invoiceLineId}
      edited={edited}
      openPanel={openPanel(line)}
      saving={saving}
      // An edited line is compared again once saved; the server checks it then.
      approveBlocked={edited ? null : approveBlocked(line)}
      onApprove={() => void decide(line, { outcome: 'approved' }, 'approved', edited)}
      onPanel={(mode) => {
        setAsking(null);
        setLinking(null);
        if (mode && edited) void page.openAfterSaving(line.invoiceLineId, mode);
        else setPanel(mode ? { lineId: line.invoiceLineId, mode } : null);
      }}
      onChanging={(on) => page.setChanging(on ? line.invoiceLineId : null)}
      onUndoRejection={() =>
        void act(() => undoInvoiceLineDecision(invoice.invoiceId, line.invoiceLineId, linesVersion()), {
          message: 'Rejection undone. The line is undecided.',
        })
      }
    />
  );
  // A way to ask about a line, while nothing else is open on it.
  const askLinkOf = (line: InvoiceReviewLine) =>
    canDecide && asking !== line.invoiceLineId && !openPanel(line) ? (
      <AskLink
        askWhom={askWhom}
        onAsk={() => {
          setPanel(null);
          setLinking(null);
          setAsking(line.invoiceLineId);
        }}
        email={
          <EmailAboutLine
            email={data.senderEmail}
            invoice={invoice}
            caseNumber={facts.caseNumber}
            line={{ line, number: lineNumber.get(line.invoiceLineId) }}
          />
        }
      />
    ) : null;
  const rateScopeOf = (line: InvoiceReviewLine): RateScope | null => {
    const matching = lines.filter(
      (other) =>
        other.rateType === line.rateType &&
        other.rateProfessionalId === line.rateProfessionalId &&
        Number(other.quantity) > 0 &&
        other.billedRate !== null &&
        other.serviceDate !== null &&
        (other === line || !other.working),
    );
    return {
      personName: (line.rateType !== 'mileage' ? line.timekeeperDisplayName : null) ?? invoice.professionalDisplayName ?? 'this person',
      matching,
      hasCase: invoice.caseId !== null,
      caseRates: data.caseRates,
      onApply: (input) =>
        void (async () => {
          const done = await act(() => applyLineRate(invoice.invoiceId, line.invoiceLineId, input, linesVersion()), (result) => ({
            message:
              input.scope === 'case'
                ? `Case rate set. ${result.decided} ${result.decided === 1 ? 'line' : 'lines'} approved at it.`
                : `${result.decided} ${result.decided === 1 ? 'line' : 'lines'} approved at the new rate.`,
          }));
          // Refused because the case rate or lines changed elsewhere: show them as they are now.
          if (!done) void refresh();
        })(),
    };
  };
  // What is open on a line: the question being asked, or the decision being made.
  const lineFormOf = (line: InvoiceReviewLine) => {
    const mode = openPanel(line);
    const check = logCheckOf(line);
    if (linking === line.invoiceLineId && timeLog && check) {
      return (
        <TimeLogLinkForm
          invoiceId={invoice.invoiceId}
          line={line}
          check={check}
          log={timeLog}
          onCancel={() => setLinking(null)}
          onSaved={(message) => {
            setLinking(null);
            void onLogChanged(message);
          }}
        />
      );
    }
    if (asking === line.invoiceLineId) {
      return (
        <QuestionForm
          invoiceLineId={line.invoiceLineId}
          lineNumber={lineNumber.get(line.invoiceLineId)}
          saving={saving}
          onAsk={(input) => act(() => askQuestion(invoice.invoiceId, input), { message: 'Question asked. Review waits for the answer.' })}
          onCancel={() => setAsking(null)}
          askWhom={askWhom}
        />
      );
    }
    return (
      mode && (
        <DecisionPanel
          // Starts again from the line's figures when entering changes them.
          key={`${line.quantity}-${line.billedRate}-${line.amount}`}
          line={line}
          mode={mode}
          reasons={page.reasons}
          initial={line.working}
          logBlocks={Boolean(approveBlocked(line))}
          rateScope={rateScopeOf(line)}
          saving={saving}
          error={page.actionError}
          onCancel={() => setPanel(null)}
          onSubmit={(input) =>
            void decide(
              line,
              input,
              input.outcome === 'rejected'
                ? 'rejected'
                : input.outcome === 'approved_in_part'
                  ? 'approved in part'
                  : input.approvedRate !== undefined
                    ? 'approved at a changed rate'
                    : mode === 'time_log'
                      ? 'approved, with your reason'
                      : 'approved, with a note',
            )
          }
        />
      )
    );
  };
  // Under each line: its questions, a way to ask about it, then any decision being made.
  const lineDetail = (line: InvoiceReviewLine) => {
    const questions = lineQuestions(line);
    const asker = askLinkOf(line);
    const form = lineFormOf(line);
    return questions || asker || form ? (
      <>
        {questions}
        {asker}
        {form}
      </>
    ) : null;
  };

  return { openPanel, onLogChanged, logCellOf, lineQuestions, decisionCell, askLinkOf, lineFormOf, lineDetail };
}

export type LineCells = ReturnType<typeof lineCells>;
