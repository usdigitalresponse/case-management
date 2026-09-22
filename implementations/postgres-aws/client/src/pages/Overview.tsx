import { Link } from 'react-router-dom';
import { Alert } from '@trussworks/react-uswds';
import { listCases } from '../api/client';
import { useApiResource } from '../hooks/useApiResource';
import { overviewStages } from '../overviewStages';

export default function Overview() {
  const { data, error } = useApiResource(listCases, []);
  if (error) return <Alert type="error">Unable to load the overview. Please refresh to try again.</Alert>;
  if (!data) return <p role="status">Loading overview…</p>;

  const cases = [...data.cases].sort((a, b) =>
    (a.clientDisplayName ?? '').localeCompare(b.clientDisplayName ?? '') || a.caseId.localeCompare(b.caseId));

  return (
    <>
      <div className="page-heading">
        <p className="eyebrow">Case overview</p>
        <h1>Where every case is right now</h1>
        <p className="page-description">{cases.length} {cases.length === 1 ? 'case' : 'cases'} across your workspace.</p>
      </div>
      <p className="overview-note"><span className="prototype-badge">Preview</span> All cases are shown under Awaiting assignment until stage tracking is available.</p>
      <div className="stage-board">
        {overviewStages.map((stage) => {
          const available = stage.id === 'awaiting-assignment';
          return (
            <section className={`stage-column${available ? ' stage-column-active' : ''}`} key={stage.id} aria-labelledby={`heading-${stage.id}`}>
              <div className="stage-heading">
                <div className="stage-title"><h2 id={`heading-${stage.id}`}>{stage.label}</h2><span className="stage-count">{available ? cases.length : 0}</span></div>
                <p>{stage.description}</p>
              </div>
              <div className="stage-content">
                {available ? (
                  cases.length ? <>
                    <ul className="case-cards">
                      {cases.slice(0, 3).map((record) => (
                        <li key={record.caseId}>
                          <Link to={`/cases/${record.caseId}`} className="case-card">
                            <strong>{record.clientDisplayName || 'Unnamed client'}</strong>
                            <span>{record.externalReference || 'No external reference'}</span>
                            {record.openedOn && <span className="card-date">Opened {record.openedOn}</span>}
                          </Link>
                        </li>
                      ))}
                    </ul>
                    <Link className="view-all" to="/cases">View all {cases.length} <span aria-hidden="true">→</span></Link>
                  </> : <div className="stage-empty"><p>No cases yet.</p><Link to="/cases/new">Create your first case</Link></div>
                ) : <div className="stage-empty"><span className="empty-mark" aria-hidden="true">—</span><p>No cases in this stage</p><button type="button" className="placeholder-link" disabled>Coming soon</button></div>}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
