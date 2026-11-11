import { attestationStatement } from '../../api/client';
import { EXTERNAL_SYSTEM_NAME } from '../../externalSystem';
import { SendDialog } from '../SendDialog';
import { WithdrawDialog } from '../WithdrawDialog';
import type { Submission } from './useSubmission';

// Sending, filed by person or under a case, and withdrawing.
export function SubmissionDialogs({ s }: { s: Submission }) {
  const { data, staff, user, typedCaseNumber, overrun, sendError } = s;
  const { invoice, byPerson, period, proposed, client, caseNumber, fromName } = s.facts;
  const { askingFor } = s.entry;
  const closeSend = () => {
    s.setSending(false);
    s.setSendError(null);
  };
  return (
    <>
      {s.sending && byPerson && (
        <SendDialog
          caseHeading={invoice.caseId ? 'Case' : 'Case number'}
          caseLabel={
            invoice.caseId
              ? [data.caseNumber ?? typedCaseNumber.trim(), invoice.caseClientDisplayName].filter(Boolean).join(' · ')
              : `${typedCaseNumber.trim()}, as ${staff ? '' : 'you '}typed it`
          }
          period={period}
          linesSummary={s.linesSummary}
          askingFor={askingFor}
          email={staff ? undefined : user?.email}
          statement={staff ? null : attestationStatement(typedCaseNumber.trim())}
          ready={!s.receipt.missing}
          explanation={
            staff
              ? `It is filed under ${fromName}. Reviewers use the case number to find the case in the ${EXTERNAL_SYSTEM_NAME}, and see the file next to these lines.`
              : invoice.caseId
                ? 'It is filed under the case you chose and goes straight to review. You can withdraw the invoice until review starts.'
                : 'It is filed under your name. The billing office uses the case number to find the case in its own system. You can withdraw the invoice until review starts.'
          }
          overrun={overrun}
          error={sendError}
          onSend={s.send}
          onClose={closeSend}
        >
          {s.receipt.fields}
        </SendDialog>
      )}
      {s.sending && !byPerson && (
        <SendDialog
          caseLabel={
            invoice.caseId || proposed
              ? `${[caseNumber, client].filter(Boolean).join(' · ')}${proposed ? ' (new: the billing office will match it)' : ''}`
              : 'Not chosen: the billing office will match it'
          }
          period={period}
          linesSummary={s.linesSummary}
          askingFor={askingFor}
          email={user?.email}
          overrun={overrun}
          error={sendError}
          onSend={s.send}
          onClose={closeSend}
        />
      )}
      {s.withdrawing && (
        <WithdrawDialog
          error={s.withdrawError}
          onWithdraw={s.withdraw}
          onClose={() => {
            s.setWithdrawing(false);
            s.setWithdrawError(null);
          }}
        />
      )}
    </>
  );
}
