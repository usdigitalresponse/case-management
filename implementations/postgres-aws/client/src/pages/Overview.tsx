import { Link } from 'react-router';
import type { CaseListRecord } from '../api/client';
import { useResource } from '../hooks/useResource';
import { cases as casesResource, recentCaseChanges } from '../resources';
import { overviewStages } from '../overviewStages';
import { PageHeading } from '../components/PageHeading';
import { Notice } from '../components/ui/Notice';
import { RecordTable } from '../components/RecordTable';
import { formatDate } from '../formatDateTime';
import { formatMoney } from '../formatMoney';

// What the card says under each case, by stage (design I47).
function caseNote(record: CaseListRecord): string {
  if ((record.stage === 'billing' || record.stage === 'needs-assignment') && record.waiting.count > 0) {
    return `${record.waiting.count} ${record.waiting.count === 1 ? 'invoice' : 'invoices'}, ${formatMoney(record.waiting.total)}`;
  }
  if (record.workers.length > 0) return record.workers.join(', ');
  return record.openedOn ? `Opened ${formatDate(record.openedOn)}` : '';
}

export default function Overview() {
  const { data, error } = useResource(casesResource);
  const { data: recent } = useResource(recentCaseChanges);
  if (error) return <Notice tone="danger">Unable to load the overview. Please refresh to try again.</Notice>;
  if (!data) return <p role="status">Loading overview…</p>;

  const cases = [...data.cases].sort((a, b) =>
    (a.clientDisplayName ?? '').localeCompare(b.clientDisplayName ?? '') || a.caseId.localeCompare(b.caseId));
  const open = cases.filter((record) => !record.closedOn).length;

  return (
    <>
      <PageHeading
        eyebrow="Cases"
        title="Case overview"
        description={`Where every case is right now. ${cases.length} ${cases.length === 1 ? 'case' : 'cases'}, ${open} open.`}
      />
      <div className="stage-cards">
        {overviewStages.map((stage) => {
          const stageCases = cases.filter((record) => record.stage === stage.id);
          return (
            <section className="card stage-card" key={stage.id} aria-labelledby={`heading-${stage.id}`}>
              <h2 id={`heading-${stage.id}`}>{stage.label}</h2>
              <p className="stage-card__count">{stageCases.length}</p>
              <p className="stage-card__what">{stage.description}</p>
              {stageCases.length === 0 ? (
                <p className="muted">No cases in this stage</p>
              ) : (
                <>
                  <ul>
                    {stageCases.slice(0, 3).map((record) => (
                      <li key={record.caseId}>
                        <Link to={`/cases/${record.caseId}`}>{record.clientDisplayName || 'Unnamed client'}</Link>
                        <span className="cell-note">{caseNote(record)}</span>
                      </li>
                    ))}
                  </ul>
                  {stageCases.length > 3 && (
                    <Link className="view-all" to={stage.route}>
                      View all {stageCases.length} <span aria-hidden="true">→</span>
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
        {recent && (
          <RecordTable
            label="Recently changed"
            rows={recent.changes}
            rowKey={(change) => `${change.caseId}-${change.when}-${change.what}`}
            emptyMessage="Nothing has changed yet."
            columns={[
              {
                header: 'Case',
                rowHeader: true,
                render: (change) => (
                  <>
                    <Link to={`/cases/${change.caseId}`}>{change.clientDisplayName ?? 'Unnamed client'}</Link>
                    {change.caseNumber && <span className="cell-note">{change.caseNumber}</span>}
                  </>
                ),
              },
              { header: 'What changed', render: (change) => change.what },
              { header: 'When', render: (change) => formatDate(change.when.slice(0, 10)) },
              { header: 'By', render: (change) => change.by ?? '—' },
            ]}
          />
        )}
      </section>
    </>
  );
}
