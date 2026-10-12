import { Link as RouterLink } from 'react-router';
import { listMyCases, type MyCaseProfessional, type MyCaseRecord, type MyCasesResult } from '../api/client';
import { useApiResource } from '../hooks/useApiResource';
import { PageHeading } from '../components/PageHeading';
import { ResourceList } from '../components/ResourceList';
import { caseDisplayLabel } from '../caseDisplayLabel';

interface CaseSection {
  professional: MyCaseProfessional;
  cases: MyCaseRecord[];
}

// One section per person; a case held by several appears in each.
function caseSections({ professionals, cases }: MyCasesResult): CaseSection[] {
  return professionals.map((professional) => ({
    professional,
    cases: cases.filter((caseRecord) => caseRecord.assignedProfessionalIds.includes(professional.professionalId)),
  }));
}

function CaseCards({ professionalId, cases }: { professionalId: string; cases: MyCaseRecord[] }) {
  return (
    <ul className="portal-case-cards">
      {cases.map((caseRecord) => {
        const unsubmittedTime = caseRecord.unsubmittedTimeProfessionalIds.includes(professionalId);
        const unsubmittedInvoice = caseRecord.unsubmittedInvoiceProfessionalIds.includes(professionalId);
        return (
          <li key={caseRecord.caseId}>
            <RouterLink className="row-card" to={`/portal/cases/${caseRecord.caseId}`}>
              <span className="row-card-title">
                {caseDisplayLabel(
                  [caseRecord.externalReference, caseRecord.clientDisplayName],
                  { label: 'Case assigned', date: caseRecord.assignedAt },
                )}
              </span>
              <span className="row-card-meta">
                <span className="status-pill">{caseRecord.statusDisplayName}</span>
                <span>Assigned {caseRecord.assignedAt.slice(0, 10)}</span>
              </span>
              {(unsubmittedTime || unsubmittedInvoice) && (
                <span className="row-card-meta">
                  {unsubmittedTime && <span className="status-pill status-pill--pending">Unsubmitted time</span>}
                  {unsubmittedInvoice && <span className="status-pill status-pill--pending">Unsubmitted invoice</span>}
                </span>
              )}
            </RouterLink>
          </li>
        );
      })}
    </ul>
  );
}

export default function PortalCaseList() {
  const { data, error } = useApiResource(() => listMyCases().then(caseSections), []);
  const isDelegate = data?.some((section) => !section.professional.isSelf) ?? false;

  return (
    <ResourceList
      heading={
        <PageHeading
          eyebrow="Your cases"
          title={isDelegate ? 'Cases' : 'Cases assigned to you'}
        />
      }
      error={error}
      data={data}
      errorMessage="Failed to load your cases."
      emptyMessage="You aren't assigned to any cases yet."
    >
      {(sections) =>
        isDelegate ? (
          sections.map(({ professional, cases }) => (
            <section key={professional.professionalId} className="portal-case-section">
              <h2>{professional.isSelf ? 'Assigned to you' : `Assigned to ${professional.displayName ?? 'an unnamed professional'}`}</h2>
              {cases.length > 0 ? <CaseCards professionalId={professional.professionalId} cases={cases} /> : <p>No open cases.</p>}
            </section>
          ))
        ) : sections[0] && sections[0].cases.length > 0 ? (
          <CaseCards professionalId={sections[0].professional.professionalId} cases={sections[0].cases} />
        ) : (
          <p>You aren't assigned to any cases yet.</p>
        )
      }
    </ResourceList>
  );
}
