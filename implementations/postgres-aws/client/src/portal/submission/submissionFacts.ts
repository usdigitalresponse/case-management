import type { PortalInvoice } from '../../api/client';
import { canWithdraw, formatSpan, submissionStatus } from '../portalWording';
import { PORTAL_HOME_PATH } from '../useShell';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function submissionFacts(data: PortalInvoice, { userId, staff, filedByPerson }: { userId: string | undefined; staff: boolean; filedByPerson: boolean | undefined }) {
  const { invoice } = data;
  // Filed by person, even once put under one of the sender's cases.
  const byPerson = filedByPerson ?? (!invoice.caseId || Boolean(invoice.caseNumberAsTyped));
  const isDraft = invoice.statusCode === 'draft';
  const proposed = invoice.caseId ? null : invoice.proposedCase;
  return {
    invoice,
    byPerson,
    isDraft,
    editable: isDraft && invoice.submittedByUserAccountId === userId,
    status: submissionStatus(invoice),
    decided: invoice.statusCode === 'approved' || invoice.statusCode === 'rejected',
    period: formatSpan(invoice.periodStart, invoice.periodEnd),
    month: invoice.periodStart ? `${MONTHS[Number(invoice.periodStart.slice(5, 7)) - 1]} ${invoice.periodStart.slice(0, 4)}` : 'invoice',
    proposed,
    client: invoice.caseClientDisplayName ?? proposed?.clientName ?? 'Invoice',
    caseNumber: data.caseNumber ?? invoice.caseExternalReference ?? proposed?.caseNumber ?? null,
    kind: invoice.professionalKindDisplayName ? `${invoice.professionalKindDisplayName} invoice` : 'Invoice',
    awaiting: invoice.statusCode === 'awaiting_match',
    withdrawable: canWithdraw(invoice, userId),
    sent: !isDraft && invoice.statusCode !== 'withdrawn',
    home: byPerson && staff ? { label: 'To review', to: '/' } : { label: 'Your invoices', to: PORTAL_HOME_PATH },
    fromName: invoice.professionalDisplayName ?? 'whom it is from',
  };
}

export type SubmissionFacts = ReturnType<typeof submissionFacts>;

// "3 lines. You changed 1 and removed 1." for the send dialog.
export function linesSummary(count: number, changes: { changed: unknown[]; removed: unknown[]; added: unknown[] }): string {
  return [
    `${count} ${count === 1 ? 'line' : 'lines'}.`,
    changes.changed.length + changes.removed.length + changes.added.length > 0
      ? `You changed ${changes.changed.length}${changes.removed.length ? ` and removed ${changes.removed.length}` : ''}${changes.added.length ? `, and added ${changes.added.length}` : ''}.`
      : '',
  ]
    .filter(Boolean)
    .join(' ');
}
