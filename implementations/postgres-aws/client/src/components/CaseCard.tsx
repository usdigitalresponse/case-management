import { useState } from 'react';
import { Link as RouterLink } from 'react-router';
import {
  apiErrorMessage,
  matchInvoiceToCase,
  type CaseByNumber,
  type OverrunExplanation,
  type PreauthorizationSummary,
  type QueuedInvoice,
} from '../api/client';
import { EXTERNAL_SYSTEM_NAME } from '../externalSystem';
import { formatMoney } from '../formatMoney';
import { useResource } from '../hooks/useResource';
import { caseMatches } from '../resources';
import { Notice } from './ui/Notice';
import { Button } from './ui/Button';

// The case an invoice is on, leading its review page (design I).
export function CaseCard({
  invoice,
  caseNumber,
  otherNumbers,
  preauthorization,
  overPreauthorized,
  overrunExplanations = [],
}: {
  invoice: QueuedInvoice;
  caseNumber: string | null;
  otherNumbers: string[];
  preauthorization: PreauthorizationSummary | null;
  overPreauthorized: boolean;
  overrunExplanations?: OverrunExplanation[];
}) {
  const typed = invoice.caseNumberCorrected ?? invoice.caseNumberAsTyped;
  const casePath = `/cases/${invoice.caseId}`;
  const who = invoice.professionalDisplayName ?? 'this person';
  const threshold = preauthorization?.source === 'threshold';
  const limitName = threshold ? 'threshold' : 'pre-authorized amount';
  const billed = preauthorization ? Number(preauthorization.approvedSoFar) + Number(preauthorization.waiting) : 0;
  return (
    <>
      <section className="card invoice-case-card" aria-labelledby="invoice-case-card-heading">
        <div>
          <h2 id="invoice-case-card-heading" className="invoice-case-card__eyebrow">Case</h2>
          <RouterLink to={casePath} className="invoice-case-card__client">
            {invoice.caseClientDisplayName ?? 'Unnamed client'} · {caseNumber ?? '—'}
          </RouterLink>
          {otherNumbers.length > 0 && <p className="cell-note">Also {otherNumbers.join(', ')}</p>}
          {typed && <p className="cell-note">The invoice says {typed}{typed === caseNumber ? '.' : '. It was matched to this case.'}</p>}
        </div>
        <div>
          <p>
            {preauthorization
              ? threshold
                ? `Nothing pre-authorized for ${who} (${formatMoney(preauthorization.ceiling)} threshold). Approved so far: ${formatMoney(preauthorization.approvedSoFar)}.`
                : `Pre-authorized${preauthorization.professionalId ? ` for ${who}` : ''}: ${formatMoney(preauthorization.ceiling)}. Approved so far: ${formatMoney(preauthorization.approvedSoFar)}.`
              : 'Nothing pre-authorized.'}
          </p>
          <div className="invoice-case-card__links">
            <RouterLink to={casePath}>
              Open the case <span aria-hidden="true">→</span>
            </RouterLink>
            <button type="button" className="link-button" disabled title="Not connected yet">
              Open it in your {EXTERNAL_SYSTEM_NAME} <span aria-hidden="true">↗</span>
            </button>
          </div>
        </div>
      </section>
      {overPreauthorized && preauthorization && (
        <Notice tone="warning" heading={`This invoice takes ${preauthorization.professionalId ? who : 'the case'} over the ${limitName}.`}>
          {formatMoney(billed)} approved and waiting, this invoice included, against {formatMoney(preauthorization.ceiling)}{' '}
          {threshold ? 'threshold' : 'pre-authorized'}. You can still approve or reject it.
          {overrunExplanations.length === 0 ? (
            <p>
              <strong>No explanation given.</strong> Ask the sender with a line question.
            </p>
          ) : (
            overrunExplanations.map((entry) => (
              <p key={entry.recordedAt}>
                <strong>Why, from {entry.recordedBy ?? 'the sender'}:</strong> {entry.explanation}
              </p>
            ))
          )}
        </Notice>
      )}
    </>
  );
}

// Matches to an existing case only: a case is never started from an invoice (design J).
export function CaseMatch({ invoice, onMatched }: { invoice: QueuedInvoice; onMatched: (message: string) => void }) {
  const number = invoice.caseNumberCorrected ?? invoice.caseNumberAsTyped;
  const { data } = useResource(number ? caseMatches(invoice.invoiceId, number) : null);
  const [picked, setPicked] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!number) {
    return null;
  }
  const who = invoice.professionalDisplayName ?? 'the sender';
  const cases = data?.cases ?? [];
  const exact = cases.find((found) => found.match === 'exact');
  // A close match is never chosen for the reviewer.
  const chosen = cases.find((found) => found.caseId === picked) ?? exact;

  function match(found: CaseByNumber) {
    setSaving(true);
    setError(null);
    matchInvoiceToCase(invoice.invoiceId, { caseId: found.caseId, addMissing: true }).then(
      () => onMatched(`Matched to case ${found.caseNumber ?? number}.`),
      (err: unknown) => {
        setError(apiErrorMessage(err, 'The invoice could not be matched.'));
        setSaving(false);
      },
    );
  }

  return (
    <section className="card case-match" aria-labelledby="case-match-heading">
      <h2 id="case-match-heading">Match it to a case</h2>
      {!data ? (
        <p className="cell-note">Looking for case {number}…</p>
      ) : cases.length === 0 ? (
        <p>No case in this tool has the number {number}, or one close to it.</p>
      ) : (
        <>
          {!exact && (
            <p>
              No case in this tool has the number {number}. {cases.length === 1 ? 'This one is close.' : 'These are close.'}
            </p>
          )}
          <fieldset className="case-match__choices">
            <legend className="usa-sr-only">Case to match it to</legend>
            {cases.map((found) => (
              <label key={found.caseId} className="radio-row">
                <input
                  type="radio"
                  name="case-match"
                  checked={found.caseId === chosen?.caseId}
                  onChange={() => setPicked(found.caseId)}
                />
                <span>
                  {found.caseNumber ?? '—'} · {found.clientDisplayName ?? 'Unnamed client'}
                  {found.countyDisplayName ? `, ${found.countyDisplayName}` : ''}
                  {found.match === 'close' ? ' (close match)' : ''}
                  {found.closed ? ' (closed)' : ''}{' '}
                  <RouterLink to={`/cases/${found.caseId}`}>Open the case</RouterLink>
                </span>
              </label>
            ))}
          </fieldset>
          <Button kind="primary" disabled={saving || !chosen} onClick={() => chosen && match(chosen)}>
            {chosen?.closed ? 'Match and reopen' : 'Match'}
          </Button>
        </>
      )}
      <p className="cell-note">
        Matching adds {who} to the case if they aren't on it. The invoice keeps the prices it was sent with, and the number as typed
        stays beside the case. If no case here is right, you can review the invoice without a case.
      </p>
      {error && <p className="field-error" role="alert">{error}</p>}
    </section>
  );
}
