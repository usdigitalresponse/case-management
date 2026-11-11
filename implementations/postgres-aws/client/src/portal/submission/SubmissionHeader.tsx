import { Link as RouterLink } from 'react-router';
import { invoiceExportUrl } from '../../api/client';
import { StatusPill } from '../../components/StatusPill';
import { EnteredFlag } from '../../components/NewEntryFields';
import { DeleteInvoiceButton } from '../../components/DeleteInvoiceButton';
import { Button, buttonClass } from '../../components/ui/Button';
import { DISCARD_EDITS } from '../../hooks/useSaveBeforeLeaving';
import { countOf } from '../importProgress';
import { PORTAL_HOME_PATH } from '../useShell';
import type { Submission } from './useSubmission';

export function SubmissionHeader({ s }: { s: Submission }) {
  const { invoice, byPerson, isDraft, editable, status, decided, period, month, proposed, client, caseNumber, kind, withdrawable, sent, home, fromName } =
    s.facts;
  const { askingFor, lines, undatedRow } = s.entry;
  return (
    <>
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
              {s.position !== null && s.checking!.total > 1 && (
                <span>
                  Invoice {countOf(s.position, s.checking!.total)} uploaded
                </span>
              )}
            </p>
          ) : (
            <p className="submission__meta">
              {caseNumber && <strong>Case {caseNumber}</strong>}
              {proposed && <EnteredFlag what="Case" />}
              {!invoice.caseId && !proposed && <span>Case not chosen: the billing office will match it</span>}
              {s.data.otherCaseNumbers.map((number) => (
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
              <Button kind="secondary" onClick={() => void s.finishLater()}>
                Save and finish later
              </Button>
              <Button
                kind="primary"
                // Without a sender, its time can't be priced yet; sending says to choose one.
                disabled={(askingFor === null && !(byPerson && !invoice.professionalId)) || lines.length === 0 || Boolean(undatedRow)}
                onClick={() => void s.startSending()}
              >
                Send for review
              </Button>
            </>
          )}
          {sent && (
            <a className={buttonClass('secondary')} href={invoiceExportUrl('portal', invoice.invoiceId, 'pdf')}>
              {decided ? 'Download the decisions' : 'Download receipt'}
            </a>
          )}
          {withdrawable && (
            <Button kind="danger" onClick={() => s.setWithdrawing(true)}>
              Withdraw
            </Button>
          )}
          {/* A draft, or one withdrawn before review started. */}
          {s.data.deletable && (
            <DeleteInvoiceButton
              invoiceId={invoice.invoiceId}
              onDeleted={() => s.navigate(s.staff ? '/' : PORTAL_HOME_PATH, { state: DISCARD_EDITS })}
            />
          )}
        </div>
      </div>
    </>
  );
}
