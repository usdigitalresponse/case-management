import { Link as RouterLink } from 'react-router';
import { PageHeader } from '../../components/PageHeader';
import { StatusPill } from '../../components/StatusPill';
import { ReviewerPicker } from '../../components/ReviewRouting';
import { DeleteInvoiceButton } from '../../components/DeleteInvoiceButton';
import { InvoiceExportButton } from '../../components/InvoiceExportButton';
import { EmailSender } from '../../components/EmailSender';
import { DISCARD_EDITS } from '../../hooks/useSaveBeforeLeaving';
import { countOf } from '../../portal/importProgress';
import { formatDate, formatDay, formatPeriod } from '../../formatDateTime';
import { personPath } from '../../staffPaths';
import type { ReviewFacts } from './reviewFacts';
import type { ReviewPage } from './useReviewPage';

export function ReviewHeader({ page, facts, fileShown }: { page: ReviewPage; facts: ReviewFacts; fileShown: boolean }) {
  const { invoice, data, entering, everyLineDecided, status, reviewer, inReview, permissions, byPerson, timeLog } = facts;
  const { checking, navigate } = page;
  const sender = invoice.professionalDisplayName ?? 'Unknown sender';
  const senderPath = invoice.professionalId ? personPath(invoice.professionalId) : undefined;
  return (
    <PageHeader
      crumbs={[{ label: 'To review', to: '/' }, { label: sender, to: senderPath }, { label: `Invoice ${invoice.invoiceId.slice(0, 8)}` }]}
      title={sender}
      status={
        <StatusPill code={everyLineDecided ? 'every_line_decided' : status} label={everyLineDecided ? 'Every line decided' : invoice.statusDisplayName} />
      }
      meta={
        <>
          <strong>{invoice.professionalKindDisplayName ?? 'Professional'}</strong>
          <span>
            Invoice for {formatPeriod(invoice.periodStart, invoice.periodEnd)}
            {invoice.submittedAt && `, submitted ${formatDay(invoice.submittedAt)}`}
          </span>
          {invoice.submittedByDisplayName && invoice.submittedByDisplayName !== invoice.professionalDisplayName && (
            <span>
              {facts.entered ? 'Entered' : 'Sent'} by {invoice.submittedByDisplayName}
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
            <span>Invoice {countOf(checking.total - checking.queue.length, checking.total)} uploaded</span>
          )}
        </>
      }
      actions={
        <>
          <ReviewerPicker
            invoiceId={invoice.invoiceId}
            reviewer={reviewer}
            currentUserId={facts.userId}
            canChange={inReview && Boolean(permissions?.reassign)}
            hasCase={!byPerson}
            senderName={invoice.professionalDisplayName}
            onChanged={(message, undo) => {
              page.setToast({ message, undo });
              void page.refresh();
            }}
            beingEntered={data.entryOpen}
          />
          {data.fileSource?.fileAvailable && !entering && (
            <button
              type="button"
              className="btn btn--outline"
              aria-pressed={fileShown}
              onClick={() => {
                page.setShowFile(!fileShown);
                page.setLogShown(false);
              }}
            >
              {fileShown ? 'Hide the file' : 'Show the file'}
            </button>
          )}
          {facts.canDecide && !timeLog && (
            <button
              type="button"
              className="btn btn--outline"
              aria-expanded={page.uploadingLog}
              onClick={() => page.setUploadingLog(!page.uploadingLog)}
            >
              Check a time log
            </button>
          )}
          {/* Everything is saved as it changes; this only leaves. */}
          {entering && (
            <button type="button" className="btn btn--outline" onClick={() => page.goToNext() || navigate('/')}>
              Finish later
            </button>
          )}
          {/* A wrong upload, before its lines are frozen. */}
          {entering && data.discardable && (
            <DeleteInvoiceButton invoiceId={invoice.invoiceId} onDeleted={() => navigate('/', { state: DISCARD_EDITS })} />
          )}
          <EmailSender email={data.senderEmail} invoice={invoice} caseNumber={facts.caseNumber} />
          <InvoiceExportButton scope="staff" invoiceId={invoice.invoiceId} hasTrips={facts.lines.some((line) => line.tripId)} />
        </>
      }
    />
  );
}
