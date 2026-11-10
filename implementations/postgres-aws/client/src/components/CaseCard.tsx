import { useState } from 'react';
import { Link as RouterLink } from 'react-router';
import {
  apiErrorMessage,
  findCaseMatches,
  matchInvoiceToCase,
  type PreauthorizationSummary,
  type QueuedInvoice,
} from '../api/client';
import { EXTERNAL_SYSTEM_NAME } from '../externalSystem';
import { formatMoney } from '../formatMoney';
import { useApiResource } from '../hooks/useApiResource';
import { Notice } from './Notice';

// The case an invoice is on, leading its review page (design I).
export function CaseCard({
  invoice,
  caseNumber,
  otherNumbers,
  preauthorization,
  overPreauthorized,
}: {
  invoice: QueuedInvoice;
  caseNumber: string | null;
  otherNumbers: string[];
  preauthorization: PreauthorizationSummary | null;
  overPreauthorized: boolean;
}) {
  const typed = invoice.caseNumberCorrected ?? invoice.caseNumberAsTyped;
  const casePath = `/cases/${invoice.caseId}`;
  const who = invoice.professionalDisplayName ?? 'this person';
  return (
    <>
      <section className="invoice-case-card" aria-labelledby="invoice-case-card-heading">
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
              ? `Pre-authorized${preauthorization.professionalId ? ` for ${who}` : ''}: ${formatMoney(preauthorization.ceiling)}. Approved so far: ${formatMoney(preauthorization.approvedSoFar)}.`
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
        <Notice tone="warning" heading={`This invoice takes ${preauthorization.professionalId ? who : 'the case'} over the pre-authorized amount.`}>
          {formatMoney(preauthorization.ceiling)} pre-authorized, {formatMoney(preauthorization.approvedSoFar)} approved so far, and this
          invoice asks for {formatMoney(invoice.submittedTotal)}. You can still approve or reject it.
        </Notice>
      )}
    </>
  );
}

// An invoice filed by person, matched to its case while it is reviewed:
// cases with its number, or a new one added from it.
export function CaseMatch({ invoice, onMatched }: { invoice: QueuedInvoice; onMatched: (message: string) => void }) {
  const number = invoice.caseNumberCorrected ?? invoice.caseNumberAsTyped;
  const { data } = useApiResource(() => findCaseMatches(invoice.invoiceId), [invoice.invoiceId, number]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!number) {
    return null;
  }
  const who = invoice.professionalDisplayName ?? 'the sender';
  const addPath = `/cases/new?${new URLSearchParams({
    review: invoice.invoiceId,
    number,
    ...(invoice.professionalId ? { from: invoice.professionalId } : {}),
  })}`;

  function match(caseId: string, label: string) {
    setSaving(true);
    setError(null);
    matchInvoiceToCase(invoice.invoiceId, { caseId, addMissing: true }).then(
      () => onMatched(`Matched to case ${label}.`),
      (err: unknown) => {
        setError(apiErrorMessage(err, 'The invoice could not be matched.'));
        setSaving(false);
      },
    );
  }

  return (
    <section className="case-match" aria-labelledby="case-match-heading">
      <h2 id="case-match-heading">Match it to a case</h2>
      {!data ? (
        <p className="cell-note">Looking for case {number}…</p>
      ) : data.cases.length === 0 ? (
        <p>No case in this tool has the number {number}.</p>
      ) : (
        <ul>
          {data.cases.map((found) => (
            <li key={found.caseId}>
              <span>
                <RouterLink to={`/cases/${found.caseId}`}>Case {found.caseNumber ?? '—'}</RouterLink>
                {' · '}
                {found.clientDisplayName ?? 'Unnamed client'}
                {found.countyDisplayName ? ` · ${found.countyDisplayName}` : ''}
                {found.match === 'close' && <span className="cell-note"> Close match</span>}
              </span>
              {found.closed ? (
                <span className="cell-note">Closed</span>
              ) : (
                <button
                  type="button"
                  className="btn btn--outline"
                  disabled={saving}
                  onClick={() => match(found.caseId, found.caseNumber ?? number)}
                >
                  Match
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <p>
        <RouterLink to={addPath}>Add a case for {number}</RouterLink>
      </p>
      <p className="cell-note">
        Matching adds {who} to the case if they aren't on it. The invoice keeps the prices it was sent with.
      </p>
      {error && <p className="field-error" role="alert">{error}</p>}
    </section>
  );
}
