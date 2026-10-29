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
import { StatusPill, type Tone } from '../components/StatusPill';
import { Toast, useToast } from '../components/Toast';
import { changedFields, duplicateOf, rowsInFileOrder, tracksSource } from '../fileChanges';
import { formatDateTime } from '../formatDateTime';
import { formatMoney } from '../formatMoney';
import { CheckLinesTable } from './CheckLinesTable';
import { draftFromRead, priceOf, rowChanges, totalsNotice, valuesOf, type PricingContext } from './checkLines';
import { formatSpan } from './portalWording';
import { SendDialog } from './SendDialog';
import { WithdrawDialog } from './WithdrawDialog';
import { PORTAL_HOME_PATH } from './useShell';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function headerStatus(statusCode: string): { label: string; tone: Tone } {
  switch (statusCode) {
    case 'draft':
      return { label: 'Draft, not sent', tone: 'neutral' };
    case 'submitted':
      return { label: 'Waiting for review', tone: 'info' };
    case 'under_review':
    case 'awaiting_sign_off':
      return { label: 'Being reviewed', tone: 'warning' };
    case 'approved':
    case 'rejected':
      return { label: 'Decided', tone: 'success' };
    default:
      return { label: 'Withdrawn', tone: 'neutral' };
  }
}

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
  const [focus, setFocus] = useState<string | undefined>();
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
      await transitionInvoice(invoice.invoiceId, 'submit', { attested: true });
      setSending(false);
      setToast({ message: 'Invoice sent for review.', undo: () => transitionInvoice(invoice.invoiceId, 'recall').then(onChanged) });
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

  const status = headerStatus(invoice.statusCode);
  const period = formatSpan(invoice.periodStart, invoice.periodEnd);
  const month = invoice.periodStart ? `${MONTHS[Number(invoice.periodStart.slice(5, 7)) - 1]} ${invoice.periodStart.slice(0, 4)}` : 'invoice';
  const client = invoice.caseClientDisplayName ?? 'Invoice';
  const caseNumber = data.caseNumber ?? invoice.caseExternalReference;
  const kind = invoice.professionalKindDisplayName ? `${invoice.professionalKindDisplayName} invoice` : 'Invoice';
  const canWithdraw = isSubmitter && invoice.statusCode === 'submitted';
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
          {canWithdraw && (
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
            focus={focus}
            onFocus={setFocus}
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
              : invoice.statusCode === 'submitted'
                ? 'This invoice is with the billing office, so the lines are locked. Withdraw it if you need to change something.'
                : 'The lines are locked while the billing office reviews them.'}
          </p>
        </div>
      </div>

      {sending && (
        <SendDialog
          caseLabel={[caseNumber, client].filter(Boolean).join(' · ')}
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
