import { Notice } from '../../components/ui/Notice';
import type { PortalInvoice } from '../../api/client';

// Sign-off comments on approving or rejecting, shared like line notes; a send-back comment never arrives here.
export function DecisionComments({ comments }: { comments: PortalInvoice['decisionComments'] | undefined }) {
  return (
    <>
      {(comments ?? []).map((entry) => (
        <Notice
          key={entry.decidedAt}
          tone={entry.outcomeCode === 'rejected' ? 'warning' : 'info'}
          heading={entry.outcomeCode === 'rejected' ? 'Why the invoice was rejected' : 'A comment on the invoice'}
        >
          {entry.comment}
        </Notice>
      ))}
    </>
  );
}
