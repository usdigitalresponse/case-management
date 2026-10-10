import { Link } from 'react-router';
import { Alert } from '@trussworks/react-uswds';
import { listCases } from '../api/client';
import { useApiResource } from '../hooks/useApiResource';
import { overviewStages } from '../overviewStages';
import { PageHeading } from '../components/PageHeading';

export default function Overview() {
  const { data, error } = useApiResource(listCases, []);
  if (error) return <Alert type="error">Unable to load the overview. Please refresh to try again.</Alert>;
  if (!data) return <p role="status">Loading overview…</p>;

  const cases = [...data.cases].sort((a, b) =>
    (a.clientDisplayName ?? '').localeCompare(b.clientDisplayName ?? '') || a.caseId.localeCompare(b.caseId));

  return (
    <>
      <PageHeading
        eyebrow="Case overview"
        title="Where every case is right now"
        description={`${cases.length} ${cases.length === 1 ? 'case' : 'cases'} across your workspace.`}
      />
      <div className="stage-board">
        {overviewStages.map((stage) => {
          const stageCases = cases.filter((record) => record.stage === stage.id);
          return (
            <section className="stage-column" key={stage.id} aria-labelledby={`heading-${stage.id}`}>
              <div className="stage-heading">
                <div className="stage-title"><h2 id={`heading-${stage.id}`}>{stage.label}</h2><span className="stage-count">{stageCases.length}</span></div>
                <p>{stage.description}</p>
              </div>
              <div className="stage-content">
                {stageCases.length ? (
                  <>
                    <ul className="case-cards">
                      {stageCases.slice(0, 3).map((record) => (
                        <li key={record.caseId}>
                          <Link to={`/cases/${record.caseId}`} className="row-card case-card">
                            <span className="row-card-title">{record.clientDisplayName || 'Unnamed client'}</span>
                            <span className="row-card-meta">
                              <span>{record.externalReference || 'No external reference'}</span>
                              {record.openedOn && <span>Opened {record.openedOn}</span>}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                    <Link className="view-all" to={stage.route}>
                      View all {stageCases.length} <span aria-hidden="true">→</span>
                    </Link>
                  </>
                ) : (
                  <div className="stage-empty">
                    <span className="empty-mark" aria-hidden="true">—</span>
                    <p>No cases in this stage</p>
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
