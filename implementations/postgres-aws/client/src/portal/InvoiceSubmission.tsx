// One invoice in the portal: its file beside its lines. A draft's lines save
// as they change; once sent they lock, and it can be withdrawn until review starts.
// Filed by person (byPerson; by default, any invoice not filed under a case),
// it is filed under whom it is from with a typed case number at the top, and
// can't be sent without one.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link as RouterLink, useLocation, useNavigate, useParams } from 'react-router';
import {
  apiErrorMessage,
  attestationStatement,
  getMyInvoice,
  invoiceExportUrl,
  listBillableProfessionals,
  resolveInvoiceImport,
  setDraftCaseNumber,
  transitionInvoice,
  updateDraftInvoice,
  type FileLine,
  type PortalInvoice,
} from '../api/client';
import { EXTERNAL_SYSTEM_NAME } from '../externalSystem';
import { useReceipt } from './ReceivedFields';
import { useApiResource } from '../hooks/useApiResource';
import { useAuth } from '../AuthContext';
import { usePortalBillingRules } from '../components/BillingRules';
import { lineDraftsFrom, linesFromDrafts, type LineDraft } from '../components/InvoiceLinesEditor';
import { LoadState } from '../components/LoadState';
import { Notice } from '../components/Notice';
import { OriginalDocument } from '../components/OriginalDocument';
import { RecordedDecision } from '../components/LineReview';
import { StatusPill } from '../components/StatusPill';
import { Toast, useToast } from '../components/Toast';
import { changedFields, duplicateOf, rowsInFileOrder, tracksSource } from '../fileChanges';
import { formatDateTime } from '../formatDateTime';
import { formatMoney } from '../formatMoney';
import { CheckLinesTable } from './CheckLinesTable';
import { draftFromRead, priceOf, rowChanges, totalsNotice, valuesOf, type PricingContext } from './checkLines';
import { canWithdraw, formatSpan, submissionStatus } from './portalWording';
import { SentBackNotice } from '../components/SentBackNotice';
import { SendDialog } from './SendDialog';
import { WithdrawDialog } from './WithdrawDialog';
import { INTAKE_PATH, PORTAL_HOME_PATH, useShell } from './useShell';
import { EnteredFlag } from '../components/NewEntryFields';
import { Fact, FactsStrip } from '../components/FactsStrip';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// The file viewer's location for the case number, beside the lines'.
const CASE_NUMBER_LOCATION = 'case-number';

// Drafts from one upload still to check after this one, oldest first.
export interface CheckQueue {
  queue: string[];
  total: number;
}

// Staff check the lines in their own shell; submitters on the invoice's page.
export function checkLinesPath(invoiceId: string, staff: boolean): string {
  return staff ? `/invoices/${invoiceId}/check` : `/portal/invoices/${invoiceId}`;
}

// The typed case number, saved when the box loses focus.
function CaseNumberBox({
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
  onFocus,
}: {
  invoiceId: string;
  // A reviewer's correction of a sent invoice's number, shown in its place.
  corrected: string | null;
  value: string;
  onChange: (value: string) => void;
  editable: boolean;
  missing: boolean;
  fromName: string;
  hasFile: boolean;
  // The value is the one the file labels, highlighted on it.
  readFromFile: boolean;
  // The submitter's own invoice, rather than one staff entered.
  own: boolean;
  onFocus: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const saved = useRef(value);
  function save() {
    if (value.trim() === saved.current.trim()) return;
    setError(null);
    setDraftCaseNumber(invoiceId, value).then(
      (result) => {
        saved.current = result.caseNumber ?? '';
      },
      (err: unknown) => setError(apiErrorMessage(err, 'The case number could not be saved. Try again.')),
    );
  }
  const hint = missing
    ? 'Add the case number before you send.'
    : corrected
      ? `Corrected by the billing office. ${own ? 'You' : 'The sender'} typed ${value || 'none'}.`
      : !editable
      ? own
        ? 'As you typed it. The billing office did not change it.'
        : 'As typed. It is not checked against a list of cases.'
      : readFromFile
        ? `We read this from ${own ? 'your' : 'the'} file. Change it if it is wrong.`
        : value.trim()
        ? 'Change it if it is wrong.'
        : hasFile
          ? `We could not find a case number in ${own ? 'your' : 'the'} file.`
          : `Type the case number from ${own ? 'your' : 'the'} court papers.`;
  return (
    <section className={`case-number-box${missing ? ' case-number-box--missing' : ''}`} aria-labelledby="case-number-label">
      <div className="case-number-box__field">
        <label id="case-number-label" className="usa-label" htmlFor="case-number">Case number</label>
        <input
          id="case-number"
          className="usa-input"
          placeholder="For example, 26-CR-00418"
          value={corrected ?? value}
          readOnly={!editable}
          aria-describedby="case-number-hint"
          aria-invalid={missing || undefined}
          onChange={(event) => onChange(event.target.value)}
          onFocus={onFocus}
          onBlur={save}
        />
        <p id="case-number-hint" className={missing ? 'field-error' : 'field-hint'}>{error ?? hint}</p>
      </div>
      <div className="case-number-box__why">
        {own ? (
          <>
            <strong>Your invoice is filed under your name, not under a case.</strong>
            <p>
              Type the case number from your court papers. The billing office uses it to find the case in its own system.
              This tool does not check it against a list of cases.
            </p>
          </>
        ) : (
          <>
            <strong>This invoice is filed under {fromName}, not under a case.</strong>
            <p>
              Reviewers use the case number to find the case in the {EXTERNAL_SYSTEM_NAME}. This tool does not check it
              against a list of cases.
            </p>
          </>
        )}
      </div>
    </section>
  );
}

// Once decided (design G13): what was asked for, approved and cut, and how
// many lines each way. Who decided stays with the billing office.
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
  const byPerson = filedByPerson ?? !invoice.caseId;
  const isSubmitter = invoice.submittedByUserAccountId === user?.userAccountId;
  const isDraft = invoice.statusCode === 'draft';
  const editable = isDraft && isSubmitter;
  const [lines, setLines] = useState<LineDraft[]>(() => lineDraftsFrom(data.lines));
  const [typedCaseNumber, setTypedCaseNumber] = useState(invoice.caseNumberAsTyped ?? '');
  // While the box holds the number the file labels, it's highlighted there (G8).
  const fileCaseNumber = byPerson ? fileSource?.caseNumber : null;
  const readFromFile = Boolean(fileCaseNumber && typedCaseNumber.trim() === fileCaseNumber.value);
  const caseNumberRegion = readFromFile && fileCaseNumber?.region ? [{ location: CASE_NUMBER_LOCATION, region: fileCaseNumber.region }] : [];
  // A new object on every click, so clicking the same line scrolls the file
  // back to it; it opens on the case number when that is highlighted.
  const [focus, setFocus] = useState<{ location: string } | undefined>(() =>
    caseNumberRegion.length > 0 ? { location: CASE_NUMBER_LOCATION } : undefined,
  );
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [caseNumberMissing, setCaseNumberMissing] = useState(false);
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
  const { mileageRates } = usePortalBillingRules();
  const { data: timekeepers } = useApiResource(
    () => listBillableProfessionals(invoice.caseId).then((result) => result.professionals),
    [invoice.caseId],
  );
  const ownMileageRates = timekeepers?.find((p) => p.professionalId === invoice.professionalId)?.mileageRates ?? [];
  const context: PricingContext = {
    timekeepers: timekeepers ?? [],
    billedProfessionalId: invoice.professionalId ?? undefined,
    mileageRates: ownMileageRates.length > 0 ? ownMileageRates : mileageRates,
  };

  const fileLines = fileSource && tracksSource(lines.map((line) => line.carried.sourceLocation)) ? fileSource.lines : [];
  const rows = useMemo(() => rowsInFileOrder(fileLines, lines, (line) => line.carried.sourceLocation), [fileLines, lines]);
  const totals = rows.map((row) => (row.kind === 'line' ? priceOf(row.line, context).total : 0));
  const askingFor = totals.some((total) => total === null) ? null : totals.reduce<number>((sum, total) => sum + Math.round((total ?? 0) * 100), 0) / 100;
  const duplicates = duplicateOf(rows, (line) => ({ ...valuesOf(line), total: priceOf(line, context).total }));
  const changes = rowChanges(rows, (row) => Boolean(row.read) && changedFields(row.read!, valuesOf(row.line)).length > 0);
  const warningRow = rows.find(
    (row) => row.kind === 'line' && row.read && fileSource?.warnings.some((warning) => warning.location === row.read!.location),
  );
  const notice = totalsNotice({
    source: fileSource,
    askingFor,
    ...changes,
    duplicates,
    warningLine:
      warningRow && warningRow.kind === 'line'
        ? {
            number: warningRow.number,
            message: fileSource!.warnings.find((warning) => warning.location === warningRow.read!.location)!.message,
          }
        : null,
  });
  const fileSays = fileSource ? (fileSource.statedTotal ?? fileLines.reduce((sum, line) => sum + (line.amount ?? 0), 0)) : null;

  // Saves go one at a time, each the whole set of lines; on a failure the
  // page goes back to the last set the server holds.
  const saving = useRef<Promise<unknown>>(Promise.resolve());
  const saved = useRef(lines);
  function save(next: LineDraft[]): Promise<void> {
    setLines(next);
    const done = saving.current.then(async () => {
      await updateDraftInvoice(invoice.invoiceId, {
        periodStart: invoice.periodStart ?? undefined,
        periodEnd: invoice.periodEnd ?? undefined,
        lines: linesFromDrafts(next),
      });
      saved.current = next;
    });
    saving.current = done.catch(() => setLines(saved.current));
    return done;
  }

  // With Undo back to the set before.
  async function persist(next: LineDraft[], message: string) {
    const previous = lines;
    setError(null);
    try {
      await save(next);
      setToast({ message, undo: () => save(previous) });
    } catch (err) {
      setError(apiErrorMessage(err, 'That change could not be saved. Try again.'));
    }
  }

  async function send() {
    setSendError(null);
    try {
      if (fileSource && fileSource.importStatusCode !== 'confirmed') {
        await resolveInvoiceImport(fileSource.invoiceImportId, 'confirm');
      }
      const { status: sentAs } = await transitionInvoice(
        invoice.invoiceId,
        'submit',
        byPerson ? { ...receipt.payload, attested: !staff, filedByPerson: true } : { attested: true },
      );
      setSending(false);
      setToast({
        message:
          sentAs !== 'awaiting_match'
            ? 'Invoice sent for review.'
            : byPerson
              ? 'Invoice sent. Who it is from isn’t chosen, so it waits on Intake first.'
              : 'Invoice sent. The billing office will match its case, then review it.',
        undo: () => transitionInvoice(invoice.invoiceId, 'recall').then(onChanged),
      });
      if (!goOn()) {
        onChanged();
      }
    } catch (err) {
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

  const home = byPerson && staff ? { label: 'To review', to: '/' } : { label: 'Your invoices', to: PORTAL_HOME_PATH };
  const fromName = invoice.professionalDisplayName ?? 'whom it is from';
  const position = checking ? checking.total - checking.queue.length : null;

  function startSending() {
    if (byPerson && !typedCaseNumber.trim()) {
      setCaseNumberMissing(true);
      return;
    }
    // The box saves on losing focus; this makes sure it has before sending.
    const ready = byPerson ? setDraftCaseNumber(invoice.invoiceId, typedCaseNumber) : Promise.resolve();
    ready.then(
      () => setSending(true),
      (err: unknown) => setError(apiErrorMessage(err, 'The case number could not be saved. Try again.')),
    );
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
                  Invoice {position} of {checking!.total} uploaded
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
              <button
                type="button"
                className="btn btn--outline"
                onClick={() => goOn() || navigate(byPerson && staff ? INTAKE_PATH : PORTAL_HOME_PATH)}
              >
                Save and finish later
              </button>
              <button type="button" className="btn btn--primary" disabled={askingFor === null || lines.length === 0} onClick={startSending}>
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
        </div>
      </div>

      {byPerson && (
        <>
          {caseNumberMissing && !typedCaseNumber.trim() && (
            <Notice tone="warning">This invoice needs a case number before it can be sent. Type it in the box below.</Notice>
          )}
          <CaseNumberBox
            invoiceId={invoice.invoiceId}
            value={typedCaseNumber}
            onChange={setTypedCaseNumber}
            editable={editable}
            missing={caseNumberMissing && !typedCaseNumber.trim()}
            fromName={fromName}
            hasFile={Boolean(fileSource)}
            readFromFile={readFromFile}
            corrected={invoice.caseNumberCorrected}
            own={!staff}
            onFocus={() => caseNumberRegion.length > 0 && setFocus({ location: CASE_NUMBER_LOCATION })}
          />
          {decided && data.approvedTotal !== null && <DecisionTotals data={data} />}
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
          {isDraft && <SentBackNotice reason={invoice.returnedReason} />}
          {awaiting && (
            <Notice tone="info">
              Sent. Some of its details aren’t in our system yet, so the billing office will match them, then send it for review.
              You can withdraw it until then.
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
          <CheckLinesTable
            rows={rows}
            context={context}
            warnings={fileSource?.warnings ?? []}
            duplicates={isDraft ? duplicates : new Map()}
            editable={editable}
            focus={focus?.location}
            onFocus={(location) => setFocus(location ? { location } : undefined)}
            onSaveLine={(index, draft, number) => {
              const next = index === null ? [...lines, draft] : lines.map((line, at) => (at === index ? draft : line));
              void persist(next, index === null ? 'Line added.' : `Line ${number} changed.`);
            }}
            onRemoveLine={(index, number) => void persist(lines.filter((_, at) => at !== index), `Line ${number} removed.`)}
            onPutBack={(read: FileLine, number) =>
              void persist([...lines, draftFromRead(read, invoice.professionalId ?? undefined)], `Line ${number} put back.`)
            }
            onUndoChange={(index, read, number) =>
              void persist(
                lines.map((line, at) => (at === index ? { ...draftFromRead(read, invoice.professionalId ?? undefined), invoiceLineId: line.invoiceLineId } : line)),
                `Line ${number} put back as read.`,
              )
            }
            extra={sent ? decisionFor : undefined}
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
                ? 'Click a line to see where it is on your file. Changes save as you go.'
                : 'Add each line of the invoice. Changes save as you go.'
              : invoice.statusCode === 'submitted' || awaiting
                ? 'This invoice is with the billing office, so the lines are locked. Withdraw it if you need to change something.'
                : 'The lines are locked while the billing office reviews them.'}
          </p>
        </div>
      </div>

      {sending && byPerson && (
        <SendDialog
          caseHeading="Case number"
          caseLabel={`${typedCaseNumber.trim()}, as ${staff ? '' : 'you '}typed it`}
          period={period}
          linesSummary={linesSummary}
          askingFor={askingFor}
          email={staff ? undefined : user?.email}
          statement={staff ? null : attestationStatement(typedCaseNumber.trim())}
          ready={!receipt.missing}
          explanation={
            staff
              ? `It is filed under ${fromName}. Reviewers use the case number to find the case in the ${EXTERNAL_SYSTEM_NAME}, and see the file next to these lines.`
              : 'It is filed under your name. The billing office uses the case number to find the case in its own system. You can withdraw the invoice until review starts.'
          }
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
  const { data, error } = useApiResource(() => getMyInvoice(invoiceId as string), [invoiceId, version]);
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
