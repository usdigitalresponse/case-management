import { Link } from 'react-router';
import type { OverviewInvoice, OverviewStep } from '../api/client';
import { useResource } from '../hooks/useResource';
import { invoiceOverview } from '../resources';
import { PageHeading } from '../components/PageHeading';
import { Notice } from '../components/ui/Notice';
import { RecordTable } from '../components/RecordTable';
import { formatDay } from '../formatDateTime';
import { formatMoney } from '../formatMoney';
import { reviewPath } from '../staffPaths';

// Each step of review (design K47); "See all" opens the list that shows the same invoices.
const STEPS: Record<OverviewStep, { label: string; description: string; empty: string; route: string }> = {
  no_reviewer: {
    label: 'No reviewer yet',
    description: 'An invoice came in and has no reviewer yet.',
    empty: 'No invoices here.',
    route: '/?show=unassigned',
  },
  being_reviewed: { label: 'Being reviewed', description: 'A reviewer is deciding the lines.', empty: 'No invoices here.', route: '/?show=reviewing' },
  sign_off: {
    label: 'Waiting for sign-off',
    description: 'Every line is decided. The approver has not signed off yet.',
    empty: 'No invoices here.',
    route: '/finished?show=sign_off',
  },
  not_completed: {
    label: 'Signed off, not completed',
    description: 'Waiting to be marked completed.',
    empty: 'No invoices here. They appear after sign-off.',
    route: '/finished?show=decided',
  },
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const invoiceNote = (invoice: OverviewInvoice) => [invoice.caseNumber, formatMoney(invoice.submittedTotal)].filter(Boolean).join(', ');

export default function InvoiceOverview() {
  const { data, error } = useResource(invoiceOverview);
  if (error) return <Notice tone="danger">Unable to load the overview. Please refresh to try again.</Notice>;
  if (!data) return <p role="status">Loading overview…</p>;
  const unfinished = data.steps.reduce((sum, step) => sum + step.count, 0);

  return (
    <>
      <PageHeading
        list
        title="Invoice overview"
        description={`Where every invoice is in review right now. ${unfinished} ${unfinished === 1 ? 'invoice is' : 'invoices are'} not finished.`}
      />
      <div className="stage-cards">
        {data.steps.map(({ step, count, invoices }) => {
          const about = STEPS[step];
          return (
            <section className="card stage-card" key={step} aria-labelledby={`heading-${step}`}>
              <h2 id={`heading-${step}`}>{about.label}</h2>
              <p className="stage-card__count">{count}</p>
              <p className="stage-card__what">{about.description}</p>
              {count === 0 ? (
                <p className="muted">{about.empty}</p>
              ) : (
                <>
                  <ul>
                    {invoices.map((invoice) => (
                      <li key={invoice.invoiceId}>
                        <Link to={reviewPath(invoice.invoiceId)}>{invoice.senderDisplayName ?? 'Unknown sender'}</Link>
                        <span className="cell-note">{invoiceNote(invoice)}</span>
                      </li>
                    ))}
                  </ul>
                  {count > invoices.length && (
                    <Link className="view-all" to={about.route}>
                      See all {count} <span aria-hidden="true">→</span>
                      <span className="usa-sr-only"> {about.label.toLowerCase()}</span>
                    </Link>
                  )}
                </>
              )}
            </section>
          );
        })}
      </div>
      <section className="detail-section">
        <h2>Recently changed</h2>
        <RecordTable
          label="Recently changed"
          rows={data.changes}
          rowKey={(change) => `${change.invoiceId}-${change.when}-${change.what}`}
          emptyMessage="Nothing has changed yet."
          columns={[
            {
              header: 'Invoice',
              rowHeader: true,
              render: (change) => (
                <>
                  <Link to={reviewPath(change.invoiceId)}>{change.senderDisplayName ?? 'Unknown sender'}</Link>
                  <span className="cell-note">
                    {[
                      change.caseNumber,
                      change.periodStart ? `${MONTHS[Number(change.periodStart.slice(5, 7)) - 1]} ${change.periodStart.slice(0, 4)}` : null,
                    ]
                      .filter(Boolean)
                      .join(', ')}
                  </span>
                </>
              ),
            },
            { header: 'What changed', render: (change) => change.what },
            { header: 'When', render: (change) => formatDay(change.when) },
            { header: 'By', render: (change) => change.by ?? '—' },
          ]}
        />
      </section>
    </>
  );
}
