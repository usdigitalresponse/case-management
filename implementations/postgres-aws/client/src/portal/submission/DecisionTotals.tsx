import type { PortalInvoice } from '../../api/client';
import { Fact, FactsStrip } from '../../components/FactsStrip';
import { formatMoney } from '../../formatMoney';

// Once decided. Who decided stays with the billing office.
export function DecisionTotals({ data }: { data: PortalInvoice }) {
  const outcomes = data.lines.map((line) => line.decision?.outcomeCode);
  const count = (code: string) => outcomes.filter((outcome) => outcome === code).length;
  const asked = Number(data.invoice.submittedTotal);
  const approved = Number(data.approvedTotal ?? 0);
  const lineCounts = [
    count('approved') && `${count('approved')} approved`,
    count('approved_in_part') && `${count('approved_in_part')} approved in part`,
    count('rejected') && `${count('rejected')} rejected`,
  ].filter(Boolean);
  return (
    <FactsStrip>
      <Fact label="You asked for">
        <strong>{formatMoney(asked)}</strong>
      </Fact>
      <Fact label="Approved">
        <strong className="total-figure--good">{formatMoney(approved)}</strong>
      </Fact>
      <Fact label="Cut">
        <strong className="total-figure--cut">{formatMoney(Math.max(0, Math.round((asked - approved) * 100) / 100))}</strong>
      </Fact>
      <Fact label="Lines">{lineCounts.join(', ') || '—'}</Fact>
    </FactsStrip>
  );
}
