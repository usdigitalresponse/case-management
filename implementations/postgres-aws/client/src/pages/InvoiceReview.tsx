import { useEffect, useRef, useState } from 'react';
import { Link as RouterLink, useLocation, useNavigate, useParams } from 'react-router';
import {
  answerQuestion,
  apiErrorMessage,
  askQuestion,
  decideInvoiceLine,
  finishReview,
  getInvoiceForReview,
  listDecisionReasons,
  reopenReview,
  repriceInvoice,
  setEnteredDetails,
  setEnteredSender,
  signOffInvoice,
  undoInvoiceLineDecision,
  type InvoiceReview as InvoiceReviewData,
  type InvoiceReviewLine,
  type LineDecision,
  type LineDecisionInput,
} from '../api/client';
import { useAuth } from '../AuthContext';
import { useApiResource } from '../hooks/useApiResource';
import { InvoiceExportButton } from '../components/InvoiceExportButton';
import { RuleFindings } from '../components/BillingRules';
import { TravelLog } from '../components/TravelLog';
import { StatusPill } from '../components/StatusPill';
import { DecisionCell, DecisionPanel, decisionInput, rateChanged, type PanelMode } from '../components/LineReview';
import { ReviewerPicker, SignOffApprovers } from '../components/ReviewRouting';
import { RateCheckNotice, SignOffHistory, SignOffPanel, TotalsBar } from '../components/ReviewPanels';
import { AskLink, LineQuestions, QuestionForm } from '../components/ReviewQuestions';
import { InvoiceLinesTable, lineRowClass } from '../components/InvoiceLinesTable';
import { OriginalDocument } from '../components/OriginalDocument';
import { ChangeNote, fileChangesFor, RemovedLines, WasNote, wasAmount, wasQuantity } from '../components/SubmitterChanges';
import { PageHeader } from '../components/PageHeader';
import { Fact, FactsStrip, Progress } from '../components/FactsStrip';
import { LoadState } from '../components/LoadState';
import { Notice } from '../components/Notice';
import { EnteredFlag, proposedCaseLabel } from '../components/NewEntryFields';
import { Toast, useToast, type ToastMessage } from '../components/Toast';
import { formatDate, formatDateTime, formatPeriod } from '../formatDateTime';
import { formatMoney, formatRate } from '../formatMoney';
import { reviewTotals, submittedByLabel } from '../reviewTotals';
import { EXTERNAL_SYSTEM_NAME } from '../externalSystem';
import { CaseNumberReview } from '../components/CaseNumberReview';
import { EnteredCaseNumber, EntryLines, EntryReceipt } from '../components/EntryLines';
import { EntryBadge } from '../components/EntryBadge';
import { InvoiceDetailsFields } from '../components/InvoiceDetailsFields';
import { countOf } from '../portal/importProgress';
import { DeleteInvoiceButton } from '../components/DeleteInvoiceButton';
import type { CheckQueue } from '../portal/InvoiceSubmission';
import { personPath, reviewPath } from '../staffPaths';

export default function InvoiceReview() {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const { user } = useAuth();
  const permissions = user?.reviewPermissions;
  const { data: loaded, error } = useApiResource(() => getInvoiceForReview(invoiceId as string), [invoiceId]);
  const { data: reasonData } = useApiResource(() => listDecisionReasons(), []);
  // Refreshed in place after each action, so open panels aren't unmounted.
  const [refreshed, setRefreshed] = useState<InvoiceReviewData | null>(null);
  const latestRequest = useRef(0);
  const data = refreshed?.invoice.invoiceId === invoiceId ? refreshed : loaded;

  const [panel, setPanel] = useState<{ lineId: string; mode: PanelMode } | null>(null);
  const [changing, setChanging] = useState<string | null>(null);
  // A line's id, or 'invoice' for a question about the whole invoice.
  const [asking, setAsking] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [toast, setToast] = useToast();
  // Null until chosen: shown when the submitter changed anything.
  const [showFile, setShowFile] = useState<boolean | null>(null);
  // A new object on every click, so the same line scrolls the file back to it.
  const [fileFocus, setFileFocus] = useState<{ location: string } | undefined>();
  const navigate = useNavigate();
  // The rest of an upload, entered one after another.
  const checking = useLocation().state as CheckQueue | null;
  // The newest version of its lines this page knows: loaded, or just saved
  // and not yet reloaded. Decisions while entering send it.
  const knownVersion = useRef(0);
  // The invoice shown now, for an Undo offered on the one before.
  const shownId = useRef(invoiceId);
  shownId.current = invoiceId;
  // Finishing moves on to the upload's next invoice, keeping its message and Undo.
  const keepToast = useRef(false);
  // While entering, saves lines changed in place; false if they can't be saved.
  const saveEdits = useRef<() => Promise<boolean>>(async () => true);
  // While entering, the billing period saved beside the lines, for line saves to carry.
  const period = useRef<{ invoiceId?: string; periodStart: string | null; periodEnd: string | null }>({ periodStart: null, periodEnd: null });

  useEffect(() => {
    latestRequest.current += 1;
    knownVersion.current = 0;
    setRefreshed(null);
    setPanel(null);
    setAsking(null);
    if (!keepToast.current) setToast(null);
    keepToast.current = false;
    setShowFile(null);
    setFileFocus(undefined);
  }, [invoiceId, setToast]);

  function refresh() {
    const request = ++latestRequest.current;
    return getInvoiceForReview(invoiceId as string).then((result) => {
      if (request === latestRequest.current) setRefreshed(result);
    });
  }

  // Someone else is entering it: their saved changes appear as they go.
  const watching = Boolean(data?.entryOpen) && data?.assignments?.reviewer?.userAccountId !== user?.userAccountId;
  useEffect(() => {
    if (!watching) return undefined;
    const timer = window.setInterval(() => void refresh().catch(() => undefined), 30_000);
    return () => window.clearInterval(timer);
    // refresh reads the current invoice id; restarting on it is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watching, invoiceId]);

  // Set while an action runs, so a second click doesn't start another.
  const busy = useRef(false);

  // Runs an action, then shows `next` (or what it returns) and reloads.
  async function act<T>(action: () => Promise<T>, next?: ToastMessage | ((result: T) => ToastMessage)) {
    if (busy.current) return false;
    busy.current = true;
    setSaving(true);
    setActionError(null);
    try {
      // Lines changed in place save first, so nothing acts on values not yet saved.
      if (!(await saveEdits.current())) return false;
      const result = await action();
      setPanel(null);
      setChanging(null);
      setAsking(null);
      setToast(typeof next === 'function' ? next(result) : (next ?? null));
      await refresh();
      return true;
    } catch (err) {
      setActionError(apiErrorMessage(err, 'That did not save. Try again.'));
      return false;
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  // Approve part or Reject on a line changed in place: saved and reloaded
  // first, so the panel starts from the line's saved figures.
  async function openAfterSaving(lineId: string, mode: PanelMode) {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    setActionError(null);
    try {
      if (!(await saveEdits.current())) return;
      await refresh();
      setPanel({ lineId, mode });
    } catch (err) {
      setActionError(apiErrorMessage(err, 'The line could not be reloaded. Try again.'));
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  if (error || !data) {
    return <LoadState error={error} what="invoice" />;
  }

  const { invoice, lines, assignments } = data;
  const userId = user?.userAccountId ?? '';
  const status = invoice.statusCode;
  const awaitingAnswer = status === 'awaiting_answer';
  const openQuestions = data.questions.filter((question) => !question.answeredAt).length;
  const answeredQuestions = data.questions.length - openQuestions;
  // Lines may still be decided while waiting for an answer; finishing waits.
  const inReview = status === 'submitted' || status === 'under_review' || awaitingAnswer;
  const reviewer = assignments?.reviewer ?? null;
  const isReviewer = reviewer?.userAccountId === userId;
  // Deciding a line on an unassigned invoice takes it.
  const canDecide = inReview && Boolean(permissions?.reviewLines) && (!reviewer || isReviewer);
  // Its reviewer enters its lines and decides them in one pass.
  const entering = data.entryOpen && inReview && isReviewer;
  knownVersion.current = Math.max(knownVersion.current, invoice.linesVersion);
  if (period.current.invoiceId !== invoice.invoiceId) {
    period.current = { invoiceId: invoice.invoiceId, periodStart: invoice.periodStart, periodEnd: invoice.periodEnd };
  }
  // Sent with a decision while lines are being entered, so one made on an
  // out-of-date page is refused.
  const linesVersion = () => (data.entryOpen ? knownVersion.current : undefined);
  const lineNumber = new Map(lines.map((line, index) => [line.invoiceLineId, index + 1]));

  // While reviewing, the working decisions; afterwards, the recorded ones.
  const current = (line: InvoiceReviewLine): LineDecision | null => (inReview ? line.working : line.decision);
  const totals = reviewTotals(lines, current);
  const everyLineDecided = inReview && !awaitingAnswer && lines.length > 0 && totals.decided === lines.length;
  const ruleFindings = data.ruleFindings ?? [];
  const mileageFindings = ruleFindings.filter((finding) => finding.rule === 'mileage_distance');

  const approvers = assignments?.signOff ?? [];
  const sentBack = status === 'under_review' ? data.signOffs.filter((s) => s.outcomeCode === 'changes_requested').at(-1) : undefined;
  const onRoutingChanged = (message: string, undo?: () => Promise<unknown>) => {
    setToast({ message, undo });
    void refresh();
  };

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
    if (!done && data!.entryOpen) void refresh();
  }

  // The upload's next invoice, if any; true when there is one.
  function goToNext() {
    const [next, ...rest] = checking?.queue ?? [];
    if (!next) return false;
    navigate(reviewPath(next), { state: { queue: rest, total: checking!.total } satisfies CheckQueue });
    return true;
  }

  // Entered in review, this also freezes the lines; then the upload goes on
  // to its next invoice.
  async function finish() {
    const finishedId = invoice.invoiceId;
    const done = await act(() => finishReview(finishedId), {
      message: `Review finished. It went to ${approvers[0]?.displayName ?? 'the approver'} to sign off.`,
      // From the upload's next invoice, Undo goes back to this one.
      undo: async () => {
        await reopenReview(finishedId);
        if (shownId.current !== finishedId) navigate(reviewPath(finishedId));
      },
    });
    // Confirming the file's values may have undone decisions on lines it changed.
    if (!done && entering) {
      void refresh();
    }
    if (done && entering && checking?.queue.length) {
      keepToast.current = true;
      goToNext();
    }
  }

  const openPanel = (line: InvoiceReviewLine) => (panel?.lineId === line.invoiceLineId ? panel.mode : null);
  const ask = (input: { question: string; invoiceLineId: string }) =>
    act(() => askQuestion(invoice.invoiceId, input), { message: 'Question asked. Review waits for the answer.' });
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

  // The submitter's file and what they changed from it before sending.
  const { fileSource, submitterChanges } = data;
  const fileChanges = fileChangesFor(fileSource, lines);
  const changedCount = submitterChanges ? submitterChanges.changedCount + submitterChanges.removedCount + submitterChanges.addedCount : 0;
  const fileShown = Boolean(fileSource?.fileAvailable) && (showFile ?? changedCount > 0);
  const who = invoice.submittedByDisplayName ?? invoice.professionalDisplayName ?? 'the submitter';
  const whoKind = (invoice.professionalKindDisplayName ?? 'submitter').toLowerCase();
  // Entered in review by staff: the file is the sender's, the changes from it
  // were made entering it, and questions go to the sender.
  const entered = invoice.enteredInReview;
  const from = invoice.professionalDisplayName ?? 'the sender';
  const fileOwner = entered ? from : who;
  const changer = entered ? (invoice.submittedByDisplayName ?? 'staff') : `the ${whoKind}`;
  const changedWhen = entered ? 'while entering it' : 'before sending';
  const askWhom = entered ? from : 'the submitter';
  const fileSaid = fileSource ? (fileSource.statedTotal ?? fileSource.lines.reduce((sum, read) => sum + (read.amount ?? 0), 0)) : null;
  const changesSummary = submitterChanges
    ? [
        submitterChanges.changedCount ? `${submitterChanges.changedCount} ${submitterChanges.changedCount === 1 ? 'line' : 'lines'}` : null,
        submitterChanges.removedCount ? `removed ${submitterChanges.removedCount}` : null,
        submitterChanges.addedCount ? `added ${submitterChanges.addedCount}` : null,
      ]
        .filter(Boolean)
        .join(', ')
    : '';

  const decisionCell = (line: InvoiceReviewLine, edited = false) => (
    <DecisionCell
      line={line}
      decision={current(line)}
      inReview={inReview}
      canDecide={canDecide}
      changing={changing === line.invoiceLineId}
      edited={edited}
      openPanel={openPanel(line)}
      saving={saving}
      onApprove={() => void decide(line, { outcome: 'approved' }, 'approved', edited)}
      onPanel={(mode) => {
        setAsking(null);
        if (mode && edited) void openAfterSaving(line.invoiceLineId, mode);
        else setPanel(mode ? { lineId: line.invoiceLineId, mode } : null);
      }}
      onChanging={(on) => setChanging(on ? line.invoiceLineId : null)}
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
          setAsking(line.invoiceLineId);
        }}
      />
    ) : null;
  // What is open on a line: the question being asked, or the decision being made.
  const lineFormOf = (line: InvoiceReviewLine) => {
    const mode = openPanel(line);
    if (asking === line.invoiceLineId) {
      return (
        <QuestionForm
          invoiceLineId={line.invoiceLineId}
          lineNumber={lineNumber.get(line.invoiceLineId)}
          saving={saving}
          onAsk={ask}
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
          reasons={reasonData?.reasons ?? []}
          initial={line.working}
          saving={saving}
          error={actionError}
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
                    : 'approved, with a note',
            )
          }
        />
      )
    );
  };
  // Under each line: its questions, then a way to ask about it, then any
  // decision being made.
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

  // Filed by person: led by who sent it, not a case.
  const byPerson = invoice.caseId === null;
  const sender = invoice.professionalDisplayName ?? 'Unknown sender';
  const senderFirstName = sender.split(' ')[0];
  const senderPath = invoice.professionalId ? personPath(invoice.professionalId) : undefined;

  return (
    <div className="invoice-review">
      <PageHeader
        crumbs={
          byPerson
            ? [{ label: 'To review', to: '/' }, { label: sender, to: senderPath }, { label: `Invoice ${invoice.invoiceId.slice(0, 8)}` }]
            : [
                { label: 'Invoices', to: '/' },
                { label: invoice.caseClientDisplayName ?? 'Case', to: `/cases/${invoice.caseId}` },
                { label: `Invoice ${invoice.invoiceId.slice(0, 8)}` },
              ]
        }
        title={byPerson ? sender : (invoice.caseClientDisplayName ?? 'Unknown client')}
        status={
          <StatusPill
            code={everyLineDecided ? 'every_line_decided' : status}
            label={everyLineDecided ? 'Every line decided' : invoice.statusDisplayName}
          />
        }
        meta={
          byPerson ? (
            <>
              <strong>{invoice.professionalKindDisplayName ?? 'Professional'}</strong>
              <span>
                Invoice for {formatPeriod(invoice.periodStart, invoice.periodEnd)}
                {invoice.submittedAt && `, submitted ${formatDate(invoice.submittedAt.slice(0, 10))}`}
              </span>
              {invoice.submittedByDisplayName && invoice.submittedByDisplayName !== invoice.professionalDisplayName && (
                <span>
                  {entered ? 'Entered' : 'Sent'} by {invoice.submittedByDisplayName}
                </span>
              )}
              {invoice.receivedOn && (
                <span>
                  Received {invoice.receivedViaDisplayName ? `by ${invoice.receivedViaDisplayName.toLowerCase()} ` : ''}on{' '}
                  {formatDate(invoice.receivedOn)}
                </span>
              )}
              {senderPath && <RouterLink to={senderPath}>See all of their invoices</RouterLink>}
              {entering && checking && checking.total > 1 && (
                <span>
                  Invoice {countOf(checking.total - checking.queue.length, checking.total)} uploaded
                </span>
              )}
            </>
          ) : (
            <>
              <strong>Case {data.caseNumber ?? '—'}</strong>
              <span>
                {invoice.professionalKindDisplayName ?? 'Professional'} invoice from {submittedByLabel(invoice)}
              </span>
              {invoice.receivedOn && (
                <span>
                  Received {invoice.receivedViaDisplayName ? `by ${invoice.receivedViaDisplayName.toLowerCase()} ` : ''}on{' '}
                  {formatDate(invoice.receivedOn)}
                </span>
              )}
              <button type="button" className="link-button" disabled title="Not connected yet">
                Open the case in your {EXTERNAL_SYSTEM_NAME} ↗
              </button>
            </>
          )
        }
        actions={
          <>
            <ReviewerPicker
              invoiceId={invoice.invoiceId}
              reviewer={reviewer}
              currentUserId={userId}
              canChange={inReview && Boolean(permissions?.reassign)}
              hasCase={!byPerson}
              senderName={invoice.professionalDisplayName}
              onChanged={onRoutingChanged}
              beingEntered={data.entryOpen}
            />
            {fileSource?.fileAvailable && !entering && (
              <button type="button" className="btn btn--outline" aria-pressed={fileShown} onClick={() => setShowFile(!fileShown)}>
                {fileShown ? 'Hide the file' : 'Show the file'}
              </button>
            )}
            {/* A wrong upload, before its lines are frozen. */}
            {/* Everything is saved as it changes; this only leaves. */}
            {entering && (
              <button type="button" className="btn btn--outline" onClick={() => goToNext() || navigate('/')}>
                Finish later
              </button>
            )}
            {entering && data.discardable && <DeleteInvoiceButton invoiceId={invoice.invoiceId} onDeleted={() => navigate('/')} />}
            <InvoiceExportButton scope="staff" invoiceId={invoice.invoiceId} hasTrips={lines.some((line) => line.tripId)} />
          </>
        }
      />

      {data.entryOpen && (
        <EntryBadge
          enteringName={reviewer?.displayName ?? null}
          own={entering}
          changedByName={data.linesChangedByDisplayName}
          changedAt={invoice.linesChangedAt}
        />
      )}
      {entering && (
        <Notice tone="info" heading="You're entering this invoice.">
          Check or type each line beside the file and decide it as you go. Everything saves as you go, so you can finish
          later. Finishing the review locks the lines as you entered them, so say how it came in first.
          <EntryReceipt invoice={invoice} onSaved={() => void refresh()} />
        </Notice>
      )}
      {data.entryOpen && !entering && (
        <Notice tone="info" heading={`${reviewer?.displayName ?? 'Someone'} is still entering this invoice.`}>
          Its lines and decisions may change until they finish the review. This page checks for changes every 30 seconds.
          Its case number can be corrected once the review is finished.
        </Notice>
      )}

      {entering && (
        <InvoiceDetailsFields
          // Not EntryLines' key: a sibling with the same one is kept twice.
          key={`details-${invoice.invoiceId}`}
          invoice={invoice}
          // Only that is left before finishing.
          missingSender={everyLineDecided && !invoice.professionalId}
          action="finish"
          warnings={data.fileSource?.warnings ?? []}
          saveSender={async (choice) => {
            if (!(await saveEdits.current())) throw new Error('Line changes not saved');
            try {
              const saved = await setEnteredSender(invoice.invoiceId, choice, knownVersion.current);
              knownVersion.current = Math.max(knownVersion.current, saved.linesVersion);
              if (saved.undecided.length > 0) {
                const count = saved.undecided.length;
                setToast({ message: `Priced at their rates, so ${count === 1 ? 'a decision was' : `${count} decisions were`} undone. Decide ${count === 1 ? 'it' : 'them'} again.` });
              }
            } finally {
              // Refused as out of date, it shows the lines as they are now.
              await refresh();
            }
          }}
          saveDetails={(details) => setEnteredDetails(invoice.invoiceId, details)}
          onPeriodSaved={(saved) => {
            period.current = { invoiceId: invoice.invoiceId, ...saved };
          }}
        />
      )}
      {entering && <EnteredCaseNumber invoice={invoice} />}
      {byPerson && !entering && (
        <CaseNumberReview
          invoice={invoice}
          matches={data.caseNumberMatches}
          canCorrect={status !== 'awaiting_match' && !data.entryOpen && Boolean(permissions?.reviewLines)}
          onCorrected={(message) => {
            setToast({ message });
            void refresh();
          }}
        />
      )}

      <FactsStrip>
        {!byPerson && (
          <Fact label="Case number" note={data.otherCaseNumbers.join(', ') || undefined}>
            <strong>{data.caseNumber ?? '—'}</strong>
          </Fact>
        )}
        <Fact label="Submitted">
          <strong>{invoice.submittedAt ? formatDateTime(invoice.submittedAt) : '—'}</strong>
        </Fact>
        <Fact label="Billing period">{formatPeriod(invoice.periodStart, invoice.periodEnd)}</Fact>
        {fileSaid !== null && <Fact label="File said">{formatMoney(fileSaid)}</Fact>}
        <Fact
          label="Requested"
          note={changedCount > 0 ? (entered ? 'As corrected from the file' : `After the ${whoKind}'s changes`) : undefined}
        >
          <strong>{formatMoney(invoice.submittedTotal)}</strong>
        </Fact>
        {/* While entering, the lines themselves show what differs from the file. */}
        {changedCount > 0 && !entering && (
          <Fact
            label={entered ? 'Corrected from the file' : `${invoice.professionalKindDisplayName ?? 'Submitter'} changed`}
            note={entered ? `By ${changer}, while entering it` : 'Before sending'}
          >
            {changesSummary}
          </Fact>
        )}
        <Fact label="Approved so far" note={totals.cut > 0 ? `${formatMoney(totals.cut / 100)} cut` : undefined}>
          {formatMoney(totals.approved / 100)}
        </Fact>
        {byPerson ? (
          <Fact label={`${senderFirstName}'s approved rate`} note="Set on their page under People">
            <strong>{data.approvedRate ? `${formatMoney(data.approvedRate)} an hour` : 'None set'}</strong>
          </Fact>
        ) : (
          <Fact
            label="Pre-authorized"
            note={
              data.preauthorization &&
              `${formatMoney(data.preauthorization.approvedSoFar)} approved, ${formatMoney(data.preauthorization.waiting)} waiting`
            }
          >
            {data.preauthorization ? <strong>{formatMoney(data.preauthorization.ceiling)}</strong> : 'None'}
          </Fact>
        )}
        <Fact label="Lines decided">
          <Progress done={totals.decided} total={lines.length} />
        </Fact>
      </FactsStrip>

      {(invoice.proposedCase || invoice.proposedProvider || lines.some((line) => line.proposedTimekeeperName)) && (
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
            {lines.some((line) => line.proposedTimekeeperName) && (
              <li>
                <EnteredFlag what="Person" matched /> {[...new Set(lines.flatMap((line) => (line.proposedTimekeeperName ? [line.proposedTimekeeperName] : [])))].join(', ')}
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
          {invoice.professionalDisplayName ?? 'the provider'} is assigned to it, or any pre-authorization. Exports and the billing
          record say so.
        </Notice>
      )}

      {inReview && (
        <SignOffApprovers
          invoiceId={invoice.invoiceId}
          approvers={approvers}
          canChange={isReviewer || Boolean(permissions?.changeSettings) || (!reviewer && Boolean(permissions?.reviewLines))}
          onChanged={onRoutingChanged}
        />
      )}

      {awaitingAnswer && (
        <Notice tone="warning" heading="Review is waiting for an answer.">
          {openQuestions} {openQuestions === 1 ? 'question is' : 'questions are'} unanswered, shown on{' '}
          {openQuestions === 1 ? 'its line' : 'their lines'}. You can keep deciding lines, but the review can't be finished until {askWhom} answers. If they answer another
          way, record it on the line.
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

      <RateCheckNotice
        lines={lines}
        canReprice={canDecide}
        saving={saving}
        onReprice={(configured) =>
          void act(
            () => repriceInvoice(invoice.invoiceId, linesVersion()),
            ({ repriced }) => ({
              message: `${repriced} ${repriced === 1 ? 'line' : 'lines'} re-priced at ${formatMoney(configured)} an hour.`,
            }),
          )
        }
      />
      <RuleFindings
        findings={ruleFindings.filter((finding) => finding.rule !== 'mileage_distance')}
        submitted={!data.entryOpen}
        fixBefore={data.entryOpen ? 'finishing the review' : undefined}
      />
      {mileageFindings.length > 0 && (
        <Notice tone="warning">
          Mileage: {mileageFindings.length} {mileageFindings.length === 1 ? 'trip is' : 'trips are'} longer than the driving route
          allows. <a href="#travel-log">See the travel log</a>.
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
      {actionError && <Notice tone="danger">{actionError}</Notice>}
      {changedCount > 0 && !entering && (
        <Notice tone="info">
          {entered ? changer : who} changed {changesSummary} {changedWhen}. Changed lines are marked{fileSource?.fileAvailable ? '; open one on the file to compare' : ''}.
        </Notice>
      )}

      {entering ? (
        <EntryLines
          key={invoice.invoiceId}
          data={data}
          saveEdits={saveEdits}
          period={period}
          setToast={setToast}
          questions={lineQuestions}
          ask={askLinkOf}
          decision={decisionCell}
          form={lineFormOf}
          onSaved={(undecided, savedVersion) => {
            knownVersion.current = Math.max(knownVersion.current, savedVersion);
            if (undecided > 0) {
              setActionError(null);
              setToast({ message: `Changed, so ${undecided === 1 ? 'its decision was' : `${undecided} decisions were`} undone. Decide it again.` });
            }
            // An action saving first reloads once it's done.
            if (!busy.current) void refresh();
          }}
          // Its open Approve part or Reject would decide on the old figures.
          onEditing={(lineId) => setPanel((open) => (open?.lineId === lineId ? null : open))}
          onRefused={() => void refresh()}
        />
      ) : (
      <div className={fileShown ? 'review-file-layout' : undefined}>
        {fileShown && fileSource && (
          <OriginalDocument
            invoiceId={invoice.invoiceId}
            fileName={fileSource.fileName}
            heading={`${fileOwner}'s file, as uploaded`}
            focus={fileFocus}
            regions={fileSource.lines}
          />
        )}
        <div className="review-file-layout__lines">
      <InvoiceLinesTable
        lines={lines}
        note={
          fileSource && fileChanges.tracking
            ? (line) => (
                <ChangeNote
                  line={line}
                  read={fileChanges.readOf(line)}
                  changed={fileChanges.fieldsOf(line).length > 0}
                  who={changer}
                  onShow={
                    fileSource.fileAvailable && line.sourceLocation
                      ? () => {
                          setShowFile(true);
                          setFileFocus(line.sourceLocation ? { location: line.sourceLocation } : undefined);
                        }
                      : undefined
                  }
                />
              )
            : undefined
        }
        hoursNote={(line) => <WasNote value={wasQuantity(line, fileChanges.readOf(line), fileChanges.fieldsOf(line))} />}
        amountNote={(line) => <WasNote value={wasAmount(line, fileChanges.readOf(line), fileChanges.fieldsOf(line))} />}
        decisionHeader={inReview ? 'Your decision' : 'Decision'}
        rowClassName={(line) => lineRowClass(current(line)?.outcomeCode, Boolean(openPanel(line)))}
        decision={decisionCell}
        rowDetail={lineDetail}
      />
      <RemovedLines removed={fileChanges.removed} who={changer} when={changedWhen} />
      {fileShown && <p className="compact-hint">The file is read-only. It is exactly what was uploaded.</p>}
        </div>
      </div>
      )}

      {(inReview || status === 'awaiting_sign_off' || status === 'approved') && totals.decided > 0 && (
        <TotalsBar
          requested={invoice.submittedTotal}
          totals={totals}
          lineCount={lines.length}
          inReview={inReview}
          canFinish={isReviewer && !awaitingAnswer}
          approvers={approvers}
          saving={saving}
          onFinish={() => void finish()}
          locksLines={entering}
          needs={
            entering && !invoice.professionalId
              ? 'Choose who the invoice is from, at the top of the page, to finish the review.'
              : entering && !(invoice.receivedOn && invoice.receivedViaDisplayName)
                ? 'Say how and when the invoice came in, at the top of the page, to finish the review.'
                : null
          }
        />
      )}

      {status === 'awaiting_sign_off' && data.decidedByEnterer && (
        <Notice tone="warning" heading="Entered and decided by the same person.">
          {invoice.submittedByDisplayName ?? 'The reviewer'} entered this invoice's lines from the file and decided them. Compare
          them with the file before signing off.
        </Notice>
      )}

      {status === 'awaiting_sign_off' && lines.some((line) => rateChanged(line, line.decision)) && (
        <Notice tone="warning" heading="The reviewer changed the rate on these lines. Check them before signing off.">
          <ul>
            {lines
              .filter((line) => rateChanged(line, line.decision))
              .map((line) => (
                <li key={line.invoiceLineId}>
                  Line {lineNumber.get(line.invoiceLineId)}: {formatRate(line.decision!.approvedRate!)} instead of the billed{' '}
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
          canSignOff={Boolean(permissions?.signOff) && data.nextSignOff?.userAccountId === userId}
          canReopen={isReviewer && !data.signOffStarted}
          saving={saving}
          onSignOff={() => void act(() => signOffInvoice(invoice.invoiceId, { outcome: 'approved' }), { message: 'Signed off.' })}
          onSendBack={(comment) =>
            act(() => signOffInvoice(invoice.invoiceId, { outcome: 'changes_requested', comment }), {
              message: 'Sent back to the reviewer.',
            })
          }
          onReopen={() => void act(() => reopenReview(invoice.invoiceId), { message: 'Review reopened.' })}
        />
      )}

      {status === 'approved' && (
        <Notice tone="success" heading="Signed off.">
          Export the PDF or spreadsheet to send for payment. Check it for confidential information before you send it; this
          system does not remove it.
        </Notice>
      )}

      <SignOffHistory signOffs={data.signOffs} />

      <div id="travel-log">
        <TravelLog lines={lines} findings={ruleFindings} />
      </div>

      <Toast toast={toast} onUndo={(undo) => void act(undo, { message: 'Undone.' })} />
    </div>
  );
}
