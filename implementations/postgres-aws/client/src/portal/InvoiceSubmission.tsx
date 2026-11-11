// One invoice in the portal: its file beside its lines. A draft's lines save
// as they change; once sent they lock, and it can be withdrawn until review
// starts. Filed by person (any invoice without a case, unless told), its case
// number sits at the top and is needed to send, with its county below.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link as RouterLink, useLocation, useNavigate, useParams } from 'react-router';
import {
  answerQuestion,
  apiErrorMessage,
  attestationStatement,
  fieldError,
  type Overrun,
  invoiceExportUrl,
  resolveInvoiceImport,
  setDraftCase,
  setDraftCaseNumber,
  setDraftCounty,
  setDraftDetails,
  setDraftSender,
  transitionInvoice,
  updateDraftInvoice,
  type PortalInvoice,
} from '../api/client';
import { EXTERNAL_SYSTEM_NAME } from '../externalSystem';
import { useReceipt } from './ReceivedFields';
import { useResource } from '../hooks/useResource';
import { myCases, myInvoice } from '../resources';
import { useAuth } from '../AuthContext';
import { LoadState } from '../components/LoadState';
import { Notice } from '../components/Notice';
import { OriginalDocument } from '../components/OriginalDocument';
import { RecordedDecision } from '../components/LineReview';
import { StatusPill } from '../components/StatusPill';
import { Toast, useToast } from '../components/Toast';
import { formatDateTime } from '../formatDateTime';
import { formatMoney } from '../formatMoney';
import { CheckLinesTable } from './CheckLinesTable';
import { DeleteInvoiceButton } from '../components/DeleteInvoiceButton';
import { useLineEntry } from './useLineEntry';
import { DISCARD_EDITS } from '../hooks/useSaveBeforeLeaving';
import { countOf } from './importProgress';
import { canWithdraw, formatSpan, submissionStatus } from './portalWording';
import { SentBackNotice } from '../components/SentBackNotice';
import { LineQuestions } from '../components/ReviewQuestions';
import { SendDialog } from './SendDialog';
import { WithdrawDialog } from './WithdrawDialog';
import { INTAKE_PATH, PORTAL_HOME_PATH, useShell } from './useShell';
import { EnteredFlag } from '../components/NewEntryFields';
import { Fact, FactsStrip } from '../components/FactsStrip';
import { CaseNumberBox } from '../components/CaseNumberBox';
import { InvoiceDetailsFields } from '../components/InvoiceDetailsFields';
import { SavedCountyPicker } from '../components/CountyPicker';
import { countyValueOf } from '../counties';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// The file viewer's location for the case number, beside the lines'.
const CASE_NUMBER_LOCATION = 'case-number';

// As the server words it (server/src/billing/overrunExplanation.ts).
function overrunMessage(overrun: Overrun): string {
  const limit = overrun.source === 'threshold' ? 'threshold' : 'pre-authorized';
  return `This takes the provider to ${formatMoney(overrun.total)} on this case, over the ${formatMoney(overrun.limit)} ${limit}. Explain why more wasn't pre-authorized.`;
}

// Drafts from one upload still to check after this one, oldest first.
export interface CheckQueue {
  queue: string[];
  total: number;
}

// Staff check the lines in their own shell; submitters on the invoice's page.
export function checkLinesPath(invoiceId: string, staff: boolean): string {
  return staff ? `/invoices/${invoiceId}/check` : `/portal/invoices/${invoiceId}`;
}

// One of the sender's cases, as the billing office matched their invoices
// to them, or "not listed" to type its number (design I). Only the cases of
// the person whose work it is.
function CaseChoice({
  invoice,
  beforeChange,
  onChanged,
}: {
  invoice: PortalInvoice['invoice'];
  // Saves the lines first, since a case prices them again.
  beforeChange: () => Promise<boolean>;
  onChanged: (caseNumber: string | null) => void;
}) {
  const { data } = useResource(myCases);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cases = (data?.cases ?? []).filter(
    (row) => invoice.professionalId && row.assignedProfessionalIds.includes(invoice.professionalId),
  );
  if (cases.length === 0) {
    return null;
  }
  async function choose(caseId: string | null) {
    setSaving(true);
    setError(null);
    try {
      if (!(await beforeChange())) return;
      const saved = await setDraftCase(invoice.invoiceId, caseId);
      onChanged(saved.caseNumber);
    } catch (err) {
      setError(apiErrorMessage(err, 'The case could not be saved. Try again.'));
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="usa-form-group case-choice">
      <label className="usa-label" htmlFor="case-choice">Which case is it?</label>
      <select
        id="case-choice"
        className="usa-select"
        value={invoice.caseId ?? ''}
        disabled={saving}
        onChange={(event) => void choose(event.target.value || null)}
      >
        <option value="">Not listed: type its case number below</option>
        {cases.map((row) => (
          <option key={row.caseId} value={row.caseId}>
            {[row.caseNumber ?? 'No number', row.clientDisplayName].filter(Boolean).join(' · ')}
          </option>
        ))}
      </select>
      <span className="field-hint">
        {invoice.caseId ? 'It goes straight to review when you send it.' : 'Cases the billing office has matched your invoices to.'}
      </span>
      {error && <p className="field-error" role="alert">{error}</p>}
    </div>
  );
}

// The typed case number, saved as a draft.
function TypedCaseNumber({
  invoiceId,
  value,
  onChange,
  editable,
  missing,
  fromName,
  hasFile,
  readFromFile,
  own,
  corrected,
  chosenCase = null,
  onFocus,
  county,
}: {
  invoiceId: string;
  county: ReactNode;
  // The sender's case it is under, instead of a typed number.
  chosenCase?: string | null;
  // A reviewer's correction, shown in its place.
  corrected: string | null;
  value: string;
  onChange: (value: string) => void;
  editable: boolean;
  missing: boolean;
  fromName: string;
  hasFile: boolean;
  readFromFile: boolean;
  // The submitter's own, not one staff entered.
  own: boolean;
  onFocus: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const saved = useRef(value);
  function save() {
    if (value.trim() === saved.current.trim()) return;
    const previous = saved.current;
    saved.current = value;
    setError(null);
    setDraftCaseNumber(invoiceId, value).catch((err: unknown) => {
      saved.current = previous;
      setError(apiErrorMessage(err, 'The case number could not be saved. Try again.'));
    });
  }
  const yours = own ? 'your' : 'the';
  const hint = (() => {
    if (chosenCase) return `The number of the case you chose, ${chosenCase}.`;
    if (missing) return 'Add the case number before you send.';
    if (corrected) return `Corrected by the billing office. ${own ? 'You' : 'The sender'} typed ${value || 'none'}.`;
    if (!editable) return own ? 'As you typed it. The billing office did not change it.' : 'As typed. It is not checked against a list of cases.';
    if (readFromFile) return `We read this from ${yours} file. Change it if it is wrong.`;
    if (value.trim()) return 'Change it if it is wrong.';
    return hasFile ? `We could not find a case number in ${yours} file.` : `Type the case number from ${yours} court papers.`;
  })();
  return (
    <CaseNumberBox
      id="case-number"
      label="Case number"
      placeholder="For example, 26-CR-00418"
      value={corrected ?? value}
      readOnly={!editable}
      hint={hint}
      error={error}
      missing={missing}
      onChange={onChange}
      onSave={save}
      onFocus={onFocus}
      county={county}
    >
      {chosenCase ? (
        <strong>Filed under the case you chose above.</strong>
      ) : own ? (
        <>
          <strong>Your invoice is filed under your name, not under a case.</strong>
          <p>
            Type the case number from your court papers. The billing office uses it to find the case in its own system.
            This tool does not check it against a list of cases.
          </p>
        </>
      ) : (
        <>
          {/* While editable, whom it is filed under is chosen just above (InvoiceDetailsFields). */}
          {!editable && <strong>This invoice is filed under {fromName}, not under a case.</strong>}
          <p>
            Reviewers use the case number to find the case in the {EXTERNAL_SYSTEM_NAME}. This tool does not check it
            against a list of cases.
          </p>
        </>
      )}
    </CaseNumberBox>
  );
}

// Once decided. Who decided stays with the billing office.
function DecisionTotals({ data }: { data: PortalInvoice }) {
  const outcomes = data.lines.map((line) => line.decision?.outcomeCode);
  const count = (code: string) => outcomes.filter((outcome) => outcome === code).length;
  const asked = Number(data.invoice.submittedTotal);
  const approved = Number(data.approvedTotal ?? 0);
  const lineCounts = [
    count('approved') && `${count('approved')} approved`,
    count('approved_in_part') && `${count('approved_in_part')} approved in part`,
    count('rejected') && `${count('rejected')} rejected`,
  ].filter(Boolean);
  return (
    <FactsStrip>
      <Fact label="You asked for">
        <strong>{formatMoney(asked)}</strong>
      </Fact>
      <Fact label="Approved">
        <strong className="total-figure--good">{formatMoney(approved)}</strong>
      </Fact>
      <Fact label="Cut">
        <strong className="total-figure--cut">{formatMoney(Math.max(0, Math.round((asked - approved) * 100) / 100))}</strong>
      </Fact>
      <Fact label="Lines">{lineCounts.join(', ') || '—'}</Fact>
    </FactsStrip>
  );
}

function Lines({
  data,
  filedByPerson,
  onChanged,
  setToast,
}: {
  data: PortalInvoice;
  // Unset: filed by person unless it was filed under a case.
  filedByPerson: boolean | undefined;
  onChanged: () => void;
  setToast: ReturnType<typeof useToast>[1];
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { staff } = useShell();
  const { user } = useAuth();
  const { invoice, fileSource } = data;
  // Filed by person, even once put under one of the sender's cases.
  const byPerson = filedByPerson ?? (!invoice.caseId || Boolean(invoice.caseNumberAsTyped));
  const isSubmitter = invoice.submittedByUserAccountId === user?.userAccountId;
  const isDraft = invoice.statusCode === 'draft';
  const editable = isDraft && isSubmitter;
  // As saved beside the lines, which carry it on each save.
  const savedPeriod = useRef({ periodStart: invoice.periodStart, periodEnd: invoice.periodEnd });
  const [senderMissing, setSenderMissing] = useState(false);
  const { lines, rows, context, askingFor, duplicates, changes, notice, undatedRow, fileSays, error, setError, handlers, edited, editLine, flush } = useLineEntry({
    serverLines: data.lines,
    fileSource,
    caseId: invoice.caseId,
    professionalId: invoice.professionalId,
    save: (next, options) =>
      updateDraftInvoice(
        invoice.invoiceId,
        {
          periodStart: savedPeriod.current.periodStart ?? undefined,
          periodEnd: savedPeriod.current.periodEnd ?? undefined,
          lines: next,
        },
        options,
      ),
    setToast,
    ownFile: !staff,
  });
  const [typedCaseNumber, setTypedCaseNumber] = useState(invoice.caseNumberAsTyped ?? '');
  // Highlighted on the file while the box holds the number read from it.
  const fileCaseNumber = byPerson ? fileSource?.caseNumber : null;
  const readFromFile = Boolean(fileCaseNumber && typedCaseNumber.trim() === fileCaseNumber.value);
  const caseNumberRegion = readFromFile && fileCaseNumber?.region ? [{ location: CASE_NUMBER_LOCATION, region: fileCaseNumber.region }] : [];
  // A new object on every click, so clicking the same line scrolls back to it.
  const [focus, setFocus] = useState<{ location: string } | undefined>(() =>
    caseNumberRegion.length > 0 ? { location: CASE_NUMBER_LOCATION } : undefined,
  );
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [caseNumberMissing, setCaseNumberMissing] = useState(false);
  const [answering, setAnswering] = useState(false);
  const [overrun, setOverrun] = useState(() => (data.overrun ? { message: overrunMessage(data.overrun), required: !staff } : null));
  const receipt = useReceipt('send', { receivedOn: invoice.receivedOn, receivedViaDisplayName: invoice.receivedViaDisplayName });
  const checking = location.state as CheckQueue | null;
  // Where to go once this one is sent or saved for later.
  const goOn = () => {
    const [next, ...rest] = checking?.queue ?? [];
    if (next) {
      navigate(checkLinesPath(next, staff), { state: { queue: rest, total: checking!.total } satisfies CheckQueue });
      return true;
    }
    return false;
  };
  async function send(extra: { overrunExplanation?: string } = {}) {
    setSendError(null);
    if (!(await flush())) {
      setSending(false);
      return;
    }
    try {
      if (fileSource && fileSource.importStatusCode !== 'confirmed') {
        await resolveInvoiceImport(fileSource.invoiceImportId, 'confirm');
      }
      const { status: sentAs } = await transitionInvoice(
        invoice.invoiceId,
        'submit',
        { ...(byPerson ? { ...receipt.payload, attested: !staff, filedByPerson: true } : { attested: true }), ...extra },
      );
      setSending(false);
      setToast({
        message:
          sentAs !== 'awaiting_match'
            ? 'Invoice sent for review.'
            : byPerson
              ? 'Invoice sent. Who billed it isn’t chosen, so it waits on Intake first.'
              : 'Invoice sent. The billing office will match its case, then review it.',
        undo: () => transitionInvoice(invoice.invoiceId, 'recall').then(onChanged),
      });
      if (!goOn()) {
        onChanged();
      }
    } catch (err) {
      const overrunMessage = fieldError(err, 'overrunExplanation');
      if (overrunMessage) {
        // Lines changed since loading.
        setOverrun({ message: overrunMessage, required: true });
        return;
      }
      setSendError(apiErrorMessage(err, 'The invoice could not be sent. Check the lines and try again.'));
    }
  }

  async function withdraw() {
    setWithdrawError(null);
    try {
      await transitionInvoice(invoice.invoiceId, 'recall');
      setWithdrawing(false);
      setToast({ message: 'Invoice withdrawn. It is back in your drafts.' });
      onChanged();
    } catch (err) {
      setWithdrawError(apiErrorMessage(err, 'The invoice could not be withdrawn.'));
    }
  }

  const status = submissionStatus(invoice);
  const decided = invoice.statusCode === 'approved' || invoice.statusCode === 'rejected';
  const period = formatSpan(invoice.periodStart, invoice.periodEnd);
  const month = invoice.periodStart ? `${MONTHS[Number(invoice.periodStart.slice(5, 7)) - 1]} ${invoice.periodStart.slice(0, 4)}` : 'invoice';
  const proposed = invoice.caseId ? null : invoice.proposedCase;
  const client = invoice.caseClientDisplayName ?? proposed?.clientName ?? 'Invoice';
  const caseNumber = data.caseNumber ?? invoice.caseExternalReference ?? proposed?.caseNumber ?? null;
  const kind = invoice.professionalKindDisplayName ? `${invoice.professionalKindDisplayName} invoice` : 'Invoice';
  const awaiting = invoice.statusCode === 'awaiting_match';
  const withdrawable = canWithdraw(invoice, user?.userAccountId);
  const sent = !isDraft && invoice.statusCode !== 'withdrawn';
  const currentCount = lines.length;
  const linesSummary = [
    `${currentCount} ${currentCount === 1 ? 'line' : 'lines'}.`,
    changes.changed.length + changes.removed.length + changes.added.length > 0
      ? `You changed ${changes.changed.length}${changes.removed.length ? ` and removed ${changes.removed.length}` : ''}${changes.added.length ? `, and added ${changes.added.length}` : ''}.`
      : '',
  ]
    .filter(Boolean)
    .join(' ');
  const decisionFor = (index: number) => {
    const line = data.lines[index];
    return line?.decision ? <RecordedDecision line={line} decision={line.decision} /> : null;
  };
  const questionsFor = (index: number) => {
    const lineId = data.lines[index]?.invoiceLineId;
    const questions = data.questions.filter((question) => question.invoiceLineId === lineId);
    return questions.length === 0 ? null : (
      <LineQuestions
        questions={questions}
        staff={false}
        canAnswer={data.canAnswer}
        saving={answering}
        onAnswer={async (questionId, answer) => {
          setAnswering(true);
          setError(null);
          try {
            await answerQuestion(invoice.invoiceId, questionId, answer, true);
            setToast({ message: 'Answer sent.' });
            onChanged();
            return true;
          } catch (err) {
            setError(apiErrorMessage(err, 'The answer could not be sent. Try again.'));
            return false;
          } finally {
            setAnswering(false);
          }
        }}
      />
    );
  };

  const home = byPerson && staff ? { label: 'To review', to: '/' } : { label: 'Your invoices', to: PORTAL_HOME_PATH };
  const fromName = invoice.professionalDisplayName ?? 'whom it is from';
  const position = checking ? checking.total - checking.queue.length : null;

  async function startSending() {
    const noSender = byPerson && !invoice.professionalId;
    const noCaseNumber = byPerson && !invoice.caseId && !typedCaseNumber.trim();
    setSenderMissing(noSender);
    if (noCaseNumber) setCaseNumberMissing(true);
    if (noSender || noCaseNumber) return;
    // The case number box otherwise saves only on losing focus.
    if (!(await flush())) return;
    try {
      if (byPerson && !invoice.caseId) await setDraftCaseNumber(invoice.invoiceId, typedCaseNumber);
      setSending(true);
    } catch (err) {
      setError(apiErrorMessage(err, 'The case number could not be saved. Try again.'));
    }
  }

  async function finishLater() {
    if (!(await flush())) return;
    if (!goOn()) navigate(byPerson && staff ? INTAKE_PATH : PORTAL_HOME_PATH);
  }

  return (
    <div className="submission">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <RouterLink to={home.to}>{home.label}</RouterLink>
        <span aria-hidden="true">›</span>
        {byPerson && isDraft && (
          <>
            <span>New invoice</span>
            <span aria-hidden="true">›</span>
          </>
        )}
        <span>{isDraft ? 'Check the lines' : byPerson ? `Invoice for ${period}` : `${client}, ${month}`}</span>
      </nav>
      <div className="submission__head">
        <div>
          <h1>
            {byPerson ? `Invoice for ${period}` : client} <StatusPill tone={status.tone} label={status.label} />
          </h1>
          {byPerson ? (
            <p className="submission__meta">
              <strong>{fromName}</strong>
              {invoice.professionalKindDisplayName && <span>{invoice.professionalKindDisplayName}</span>}
              {position !== null && checking!.total > 1 && (
                <span>
                  Invoice {countOf(position, checking!.total)} uploaded
                </span>
              )}
            </p>
          ) : (
            <p className="submission__meta">
              {caseNumber && <strong>Case {caseNumber}</strong>}
              {proposed && <EnteredFlag what="Case" />}
              {!invoice.caseId && !proposed && <span>Case not chosen: the billing office will match it</span>}
              {data.otherCaseNumbers.map((number) => (
                <span key={number}>{number}</span>
              ))}
              <span>
                {kind}, {period}
              </span>
            </p>
          )}
        </div>
        <div className="submission__actions">
          {editable && (
            <>
              <button type="button" className="btn btn--outline" onClick={() => void finishLater()}>
                Save and finish later
              </button>
              <button
                type="button"
                className="btn btn--primary"
                // Without a sender, its time can't be priced yet; sending says to choose one.
                disabled={(askingFor === null && !(byPerson && !invoice.professionalId)) || lines.length === 0 || Boolean(undatedRow)}
                onClick={() => void startSending()}
              >
                Send for review
              </button>
            </>
          )}
          {sent && (
            <a className="btn btn--outline" href={invoiceExportUrl('portal', invoice.invoiceId, 'pdf')}>
              {decided ? 'Download the decisions' : 'Download receipt'}
            </a>
          )}
          {withdrawable && (
            <button type="button" className="btn btn--danger" onClick={() => setWithdrawing(true)}>
              Withdraw
            </button>
          )}
          {/* A draft, or one withdrawn before review started. */}
          {data.deletable && (
            <DeleteInvoiceButton
              invoiceId={invoice.invoiceId}
              onDeleted={() => navigate(staff ? '/' : PORTAL_HOME_PATH, { state: DISCARD_EDITS })}
            />
          )}
        </div>
      </div>

      {byPerson && (
        <>
          {editable && (
            <InvoiceDetailsFields
              invoice={invoice}
              missingSender={senderMissing && !invoice.professionalId}
              action="send"
              warnings={fileSource?.warnings ?? []}
              saveSender={async (choice) => {
                if (!(await flush())) throw new Error('Line changes not saved');
                await setDraftSender(invoice.invoiceId, choice);
                onChanged();
              }}
              saveDetails={(details) => setDraftDetails(invoice.invoiceId, details)}
              onSenderRenamed={onChanged}
              onPeriodChanged={(saved) => {
                savedPeriod.current = saved;
              }}
            />
          )}
          {editable && !staff && (
            <CaseChoice
              invoice={invoice}
              beforeChange={flush}
              onChanged={(caseNumber) => {
                if (caseNumber) setTypedCaseNumber(caseNumber);
                onChanged();
              }}
            />
          )}
          {caseNumberMissing && !typedCaseNumber.trim() && (
            <Notice tone="warning">This invoice needs a case number before it can be sent. Type it in the box below.</Notice>
          )}
          <TypedCaseNumber
            invoiceId={invoice.invoiceId}
            value={typedCaseNumber}
            onChange={setTypedCaseNumber}
            editable={editable && !invoice.caseId}
            chosenCase={invoice.caseId ? (data.caseNumber ?? typedCaseNumber) : null}
            missing={caseNumberMissing && !typedCaseNumber.trim()}
            fromName={fromName}
            hasFile={Boolean(fileSource)}
            readFromFile={readFromFile}
            corrected={invoice.caseNumberCorrected}
            own={!staff}
            onFocus={() => caseNumberRegion.length > 0 && setFocus({ location: CASE_NUMBER_LOCATION })}
            county={
              editable ? (
                <SavedCountyPicker
                  id="county"
                  initial={countyValueOf(invoice)}
                  save={(choice) => setDraftCounty(invoice.invoiceId, choice)}
                  hint="Or post-conviction or prison, if that is what it is for."
                />
              ) : (
                <p className="field-hint">County: {invoice.countyDisplayName ?? 'Not added'}</p>
              )
            }
          />
          {decided && data.approvedTotal !== null && <DecisionTotals data={data} />}
          {decided &&
            (data.decisionComments ?? []).map((entry) => (
              <Notice
                key={entry.decidedAt}
                tone={entry.outcomeCode === 'rejected' ? 'warning' : 'info'}
                heading={entry.outcomeCode === 'rejected' ? 'Why the invoice was rejected' : 'A comment on the invoice'}
              >
                {entry.comment}
              </Notice>
            ))}
        </>
      )}

      <div className={fileSource ? 'submission__layout' : undefined}>
        {fileSource &&
          (fileSource.fileAvailable ? (
            <OriginalDocument
              invoiceId={invoice.invoiceId}
              portal
              fileName={fileSource.fileName}
              heading="Your file"
              focus={focus}
              regions={[...fileSource.lines, ...caseNumberRegion]}
            />
          ) : (
            <section className="original-document original-document--gone">
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
          {editable && undatedRow && (
            <Notice tone="warning">Line {undatedRow.number} has no date in your file. Enter its date before you send.</Notice>
          )}
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

      {sending && byPerson && (
        <SendDialog
          caseHeading={invoice.caseId ? 'Case' : 'Case number'}
          caseLabel={
            invoice.caseId
              ? [data.caseNumber ?? typedCaseNumber.trim(), invoice.caseClientDisplayName].filter(Boolean).join(' · ')
              : `${typedCaseNumber.trim()}, as ${staff ? '' : 'you '}typed it`
          }
          period={period}
          linesSummary={linesSummary}
          askingFor={askingFor}
          email={staff ? undefined : user?.email}
          statement={staff ? null : attestationStatement(typedCaseNumber.trim())}
          ready={!receipt.missing}
          explanation={
            staff
              ? `It is filed under ${fromName}. Reviewers use the case number to find the case in the ${EXTERNAL_SYSTEM_NAME}, and see the file next to these lines.`
              : invoice.caseId
                ? 'It is filed under the case you chose and goes straight to review. You can withdraw the invoice until review starts.'
                : 'It is filed under your name. The billing office uses the case number to find the case in its own system. You can withdraw the invoice until review starts.'
          }
          overrun={overrun}
          error={sendError}
          onSend={send}
          onClose={() => {
            setSending(false);
            setSendError(null);
          }}
        >
          {receipt.fields}
        </SendDialog>
      )}
      {sending && !byPerson && (
        <SendDialog
          caseLabel={
            invoice.caseId || proposed
              ? `${[caseNumber, client].filter(Boolean).join(' · ')}${proposed ? ' (new: the billing office will match it)' : ''}`
              : 'Not chosen: the billing office will match it'
          }
          period={period}
          linesSummary={linesSummary}
          askingFor={askingFor}
          email={user?.email}
          overrun={overrun}
          error={sendError}
          onSend={send}
          onClose={() => {
            setSending(false);
            setSendError(null);
          }}
        />
      )}
      {withdrawing && (
        <WithdrawDialog
          error={withdrawError}
          onWithdraw={withdraw}
          onClose={() => {
            setWithdrawing(false);
            setWithdrawError(null);
          }}
        />
      )}
    </div>
  );
}

export default function InvoiceSubmission({ byPerson }: { byPerson?: boolean }) {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const [version, setVersion] = useState(0);
  const { data, error } = useResource(myInvoice(invoiceId as string), { resetKey: version });
  const [shown, setShown] = useState<PortalInvoice | null>(null);
  // Here, so a message (and its Undo) outlives reloading after a send.
  const [toast, setToast] = useToast(6000);
  const [undoError, setUndoError] = useState<string | null>(null);
  // Keeps the page in place while it reloads.
  useEffect(() => {
    if (data) setShown(data);
  }, [data]);

  if (error || !shown) {
    return <LoadState error={error} what="invoice" />;
  }
  return (
    <>
      {undoError && <Notice tone="danger">{undoError}</Notice>}
      {/* Rebuilt when the status changes, so a sent invoice locks its lines. */}
      <Lines
        key={`${shown.invoice.invoiceId}-${shown.invoice.statusCode}`}
        data={shown}
        filedByPerson={byPerson}
        onChanged={() => setVersion((v) => v + 1)}
        setToast={setToast}
      />
      <Toast
        toast={toast}
        onUndo={(undo) =>
          void undo().then(
            () => setToast(null),
            (err: unknown) => setUndoError(apiErrorMessage(err, 'That could not be undone.')),
          )
        }
      />
    </>
  );
}
