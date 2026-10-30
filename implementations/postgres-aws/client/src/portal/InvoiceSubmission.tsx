// One invoice in the portal: its file beside its lines. A draft's lines save
// as they change; once sent they lock, and it can be withdrawn until review starts.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router';
import {
  apiErrorMessage,
  getMyInvoice,
  invoiceExportUrl,
  listBillableProfessionals,
  resolveInvoiceImport,
  transitionInvoice,
  updateDraftInvoice,
  type FileLine,
  type PortalInvoice,
} from '../api/client';
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
import { PORTAL_HOME_PATH } from './useShell';
import { EnteredFlag } from '../components/NewEntryFields';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function Lines({
  data,
  onChanged,
  setToast,
}: {
  data: PortalInvoice;
  onChanged: () => void;
  setToast: ReturnType<typeof useToast>[1];
}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { invoice, fileSource } = data;
  const isSubmitter = invoice.submittedByUserAccountId === user?.userAccountId;
  const isDraft = invoice.statusCode === 'draft';
  const editable = isDraft && isSubmitter;
  const [lines, setLines] = useState<LineDraft[]>(() => lineDraftsFrom(data.lines));
  // A new object on every click, so clicking the same line scrolls the file back to it.
  const [focus, setFocus] = useState<{ location: string } | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const { mileageRates } = usePortalBillingRules();
  const { data: timekeepers } = useApiResource(
    () => listBillableProfessionals(invoice.caseId).then((result) => result.professionals),
    [invoice.caseId],
  );
  const context: PricingContext = {
    timekeepers: timekeepers ?? [],
    billedProfessionalId: invoice.professionalId ?? undefined,
    mileageRates,
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
      const { status: sentAs } = await transitionInvoice(invoice.invoiceId, 'submit', { attested: true });
      setSending(false);
      setToast({
        message: sentAs === 'awaiting_match' ? 'Invoice sent. The billing office will match its case, then review it.' : 'Invoice sent for review.',
        undo: () => transitionInvoice(invoice.invoiceId, 'recall').then(onChanged),
      });
      onChanged();
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

  return (
    <div className="submission">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <RouterLink to={PORTAL_HOME_PATH}>Your invoices</RouterLink>
        <span aria-hidden="true">›</span>
        <span>{isDraft ? 'Check the lines' : `${client}, ${month}`}</span>
      </nav>
      <div className="submission__head">
        <div>
          <h1>
            {client} <StatusPill tone={status.tone} label={status.label} />
          </h1>
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
        </div>
        <div className="submission__actions">
          {editable && (
            <>
              <button type="button" className="btn btn--outline" onClick={() => navigate(PORTAL_HOME_PATH)}>
                Save and finish later
              </button>
              <button type="button" className="btn btn--primary" disabled={askingFor === null || lines.length === 0} onClick={() => setSending(true)}>
                Send for review
              </button>
            </>
          )}
          {sent && (
            <a className="btn btn--outline" href={invoiceExportUrl('portal', invoice.invoiceId, 'pdf')}>
              Download receipt
            </a>
          )}
          {withdrawable && (
            <button type="button" className="btn btn--danger" onClick={() => setWithdrawing(true)}>
              Withdraw
            </button>
          )}
        </div>
      </div>

      <div className={fileSource ? 'submission__layout' : undefined}>
        {fileSource &&
          (fileSource.fileAvailable ? (
            <OriginalDocument
              invoiceId={invoice.invoiceId}
              portal
              fileName={fileSource.fileName}
              heading="Your file"
              focus={focus}
              regions={fileSource.lines}
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
              Sent for review on {formatDateTime(data.submissionAttempt.submittedAt)}. We emailed a receipt to {user?.email}. You
              can withdraw it until review starts.
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

      {sending && (
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

export default function InvoiceSubmission() {
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
