// The portal's dates and status words, as in the submission design: the
// status words match the review side, so a submitter and a reviewer on the
// phone use the same ones.
import type { InvoiceRecord } from '../api/client';
import type { Tone } from '../components/StatusPill';
import { formatMoney } from '../formatMoney';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Parts of a calendar date, or of a timestamp's date in UTC.
function parts(isoDate: string) {
  const [year, month, day] = isoDate.slice(0, 10).split('-').map(Number);
  return { year: year!, month: MONTHS[month! - 1]!, day: day! };
}

// "2 Sep 2026".
export function formatDay(isoDate: string | null | undefined): string {
  if (!isoDate) {
    return '—';
  }
  const { day, month, year } = parts(isoDate);
  return `${day} ${month} ${year}`;
}

// "14 Oct", or with the year when it isn't this year.
export function formatDayShort(isoDate: string): string {
  const { day, month, year } = parts(isoDate);
  return year === new Date().getUTCFullYear() ? `${day} ${month}` : `${day} ${month} ${year}`;
}

// "1 to 30 Sep 2026", "1 Aug to 30 Sep 2026" or "1 Dec 2025 to 31 Jan 2026".
export function formatSpan(start: string | null, end: string | null): string {
  if (!start || !end) {
    return start || end ? formatDay(start ?? end) : '—';
  }
  const from = parts(start);
  const to = parts(end);
  const head =
    from.year !== to.year ? formatDay(start) : from.month !== to.month ? `${from.day} ${from.month}` : String(from.day);
  return `${head} to ${formatDay(end)}`;
}

export interface SubmissionStatus {
  label: string;
  tone: Tone;
  // A short line under the status.
  note: string | null;
}

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

// A list row has everything; an invoice page's header only the basics, so
// its notes may be missing.
type StatusSource = Pick<InvoiceRecord, 'statusCode' | 'statusDisplayName' | 'returnedReason'> &
  Partial<Pick<InvoiceRecord, 'changes' | 'import' | 'reviewerDisplayName' | 'approvedTotal' | 'cutLineCount'>>;

// "You changed 1 line and removed 1.", or that the lines read from the file
// haven't been looked at yet.
function draftNote(invoice: StatusSource): string | null {
  const changes = invoice.changes;
  if (changes && changes.changedCount + changes.removedCount + changes.addedCount > 0) {
    const parts = [
      changes.changedCount ? `changed ${count(changes.changedCount, 'line')}` : null,
      changes.removedCount ? `removed ${changes.changedCount ? changes.removedCount : count(changes.removedCount, 'line')}` : null,
      changes.addedCount ? `added ${changes.changedCount || changes.removedCount ? changes.addedCount : count(changes.addedCount, 'line')}` : null,
    ].filter(Boolean);
    return `You ${parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0]}.`;
  }
  return invoice.import && invoice.import.statusCode !== 'confirmed' ? 'Lines not checked yet.' : null;
}

export function submissionStatus(invoice: StatusSource): SubmissionStatus {
  switch (invoice.statusCode) {
    case 'draft':
      return invoice.returnedReason
        ? { label: 'Needs changes', tone: 'danger', note: invoice.returnedReason }
        : { label: 'Draft, not sent', tone: 'neutral', note: draftNote(invoice) };
    case 'awaiting_match':
      return { label: 'Sent: waiting for its case', tone: 'warning', note: 'The billing office will match it, then review it.' };
    case 'submitted':
      return { label: 'Waiting for review', tone: 'info', note: null };
    case 'under_review':
    case 'awaiting_sign_off':
      return {
        label: 'Being reviewed',
        tone: 'warning',
        note: invoice.reviewerDisplayName ? `Reviewer: ${invoice.reviewerDisplayName}` : null,
      };
    case 'approved':
    case 'rejected': {
      const cut = invoice.cutLineCount ?? 0;
      return {
        label: 'Decided',
        tone: 'success',
        note:
          invoice.approvedTotal == null
            ? null
            : `${formatMoney(invoice.approvedTotal)} approved.${cut > 0 ? ` ${cut} ${cut === 1 ? 'line' : 'lines'} cut.` : ''}`,
      };
    }
    default:
      return { label: invoice.statusDisplayName, tone: 'neutral', note: null };
  }
}

// Withdrawing is recall: only by whoever sent it, and only before review starts.
export function canWithdraw(invoice: Pick<InvoiceRecord, 'statusCode' | 'submittedByUserAccountId'>, userAccountId: string | undefined): boolean {
  return (invoice.statusCode === 'submitted' || invoice.statusCode === 'awaiting_match') && invoice.submittedByUserAccountId === userAccountId;
}
