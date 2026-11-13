import { Link } from 'react-router';
import { Fact, FactsStrip, Progress } from '../../components/FactsStrip';
import { personPath } from '../../staffPaths';
import { formatDay, formatPeriod } from '../../formatDateTime';
import { formatMoney } from '../../formatMoney';
import type { ReviewFacts } from './reviewFacts';

export function ReviewFactsStrip({ facts }: { facts: ReviewFacts }) {
  const { invoice, data, lines, totals, changedCount, entered, entering } = facts;
  const senderFirstName = (invoice.professionalDisplayName ?? 'Unknown sender').split(' ')[0];
  return (
    <FactsStrip>
      <Fact label="Submitted">
        <strong>{invoice.submittedAt ? formatDay(invoice.submittedAt) : '—'}</strong>
      </Fact>
      <Fact label="Billing period">{formatPeriod(invoice.periodStart, invoice.periodEnd)}</Fact>
      {facts.fileSaid !== null && <Fact label="File said">{formatMoney(facts.fileSaid)}</Fact>}
      <Fact label="Requested" note={changedCount > 0 ? (entered ? 'As corrected from the file' : `After the ${facts.whoKind}'s changes`) : undefined}>
        <strong>{formatMoney(invoice.submittedTotal)}</strong>
      </Fact>
      {/* While entering, the lines themselves show what differs from the file. */}
      {changedCount > 0 && !entering && (
        <Fact
          label={entered ? 'Corrected from the file' : `${invoice.professionalKindDisplayName ?? 'Submitter'} changed`}
          note={entered ? `By ${facts.changer}, while entering it` : 'Before sending'}
        >
          {facts.changesSummary}
        </Fact>
      )}
      <Fact label="Approved so far" note={totals.cut > 0 ? `${formatMoney(totals.cut / 100)} cut` : undefined}>
        {formatMoney(totals.approved / 100)}
      </Fact>
      <Fact
        label={`${senderFirstName}'s approved rate`}
        note={invoice.professionalId ? <Link to={personPath(invoice.professionalId)}>See their provider page</Link> : undefined}
      >
        <strong>{data.approvedRate ? `${formatMoney(data.approvedRate)} an hour` : 'None set'}</strong>
      </Fact>
      <Fact label="Lines decided">
        <Progress done={totals.decided} total={lines.length} />
      </Fact>
    </FactsStrip>
  );
}
