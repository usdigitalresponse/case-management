import { Link as RouterLink } from 'react-router';
import {
  type OverrunExplanation,
  type PreauthorizationSummary,
  type QueuedInvoice,
} from '../api/client';
import { EXTERNAL_SYSTEM_NAME } from '../externalSystem';
import { formatMoney } from '../formatMoney';
import { Notice } from './ui/Notice';

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
