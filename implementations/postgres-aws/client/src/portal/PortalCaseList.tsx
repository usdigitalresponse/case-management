import { Link as RouterLink } from 'react-router';
import { listMyCases, type MyCaseProfessional, type MyCaseRecord, type MyCasesResult } from '../api/client';
import { useApiResource } from '../hooks/useApiResource';
import { RecordTable } from '../components/RecordTable';
import { formatDate } from '../formatDateTime';
import { Notice } from '../components/Notice';
import { PageHeader } from '../components/PageHeader';
import { NEW_INVOICE_PATH } from './useShell';

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

function CaseTable({ professionalId, cases, label }: { professionalId: string; cases: MyCaseRecord[]; label: string }) {
  // Widths are shared by every section's table, so their columns line up.
  return (
    <RecordTable
      label={label}
      className="queue-table"
      rows={cases}
      rowKey={(caseRecord) => caseRecord.caseId}
      columns={[
        { header: 'Client', width: '24%', rowHeader: true, render: (c) => c.clientDisplayName ?? 'Unknown client' },
        { header: 'Case', width: '15%', render: (c) => c.caseNumber ?? '—' },
        { header: 'Status', width: '10%', render: (c) => <span className="chip chip--neutral">{c.statusDisplayName}</span> },
        { header: 'Assigned', width: '14%', render: (c) => formatDate(c.assignedAt.slice(0, 10)) },
        {
          header: 'Still to bill',
          width: '27%',
          render: (c) => {
            const time = c.unsubmittedTimeProfessionalIds.includes(professionalId);
            const draft = c.unsubmittedInvoiceProfessionalIds.includes(professionalId);
            return (
              <>
                {time && <span className="chip chip--warning">Time not on an invoice</span>}{' '}
                {draft && <span className="chip chip--warning">Draft invoice</span>}
                {!time && !draft && <span className="muted">Nothing</span>}
              </>
            );
          },
        },
        {
          header: 'Open',
          width: '10%',
          align: 'right',
          hiddenHeader: true,
          render: (c) => (
            <RouterLink className="row-action" to={`/portal/cases/${c.caseId}`}>
              Open <span aria-hidden="true">→</span>
              <span className="usa-sr-only"> case for {c.clientDisplayName ?? 'this client'}</span>
            </RouterLink>
          ),
        },
      ]}
    />
  );
}

export default function PortalCaseList() {
  const { data, error } = useApiResource(() => listMyCases().then(caseSections), []);
  const isDelegate = data?.some((section) => !section.professional.isSelf) ?? false;

  return (
    <div>
      <PageHeader
        title="Your cases"
        description={`${isDelegate ? 'Cases for you and the people you bill for.' : 'Cases assigned to you.'} Record time and see each case's invoices from its page.`}
        actions={<RouterLink className="btn btn--primary" to={NEW_INVOICE_PATH}>New invoice</RouterLink>}
      />
      {Boolean(error) && <Notice tone="danger">Failed to load your cases.</Notice>}
      {!data && !error && <p role="status">Loading your cases…</p>}
      {data &&
        (isDelegate ? (
          data.map(({ professional, cases }) => {
            const heading = professional.isSelf ? 'Assigned to you' : `Assigned to ${professional.displayName ?? 'an unnamed professional'}`;
            return (
              <section key={professional.professionalId} className="detail-section">
                <h2>{heading}</h2>
                {cases.length > 0 ? (
                  <CaseTable professionalId={professional.professionalId} cases={cases} label={heading} />
                ) : (
                  <p className="empty-note">No open cases.</p>
                )}
              </section>
            );
          })
        ) : data[0] && data[0].cases.length > 0 ? (
          <CaseTable professionalId={data[0].professional.professionalId} cases={data[0].cases} label="Your cases" />
        ) : (
          <p className="empty-note">You aren't assigned to any cases yet.</p>
        ))}
    </div>
  );
}
