import { Link as RouterLink } from 'react-router';
import { listMyCases, type MyCaseProfessional, type MyCaseRecord, type MyCasesResult } from '../api/client';
import { useApiResource } from '../hooks/useApiResource';
import { RecordTable } from '../components/RecordTable';
import { formatDate } from '../formatDateTime';
import { Notice } from '../components/Notice';
import { PageHeader } from '../components/PageHeader';
import { formatMoney } from '../formatMoney';
import { UPLOAD_PATH } from './useShell';

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
        { header: 'Client', width: '22%', rowHeader: true, render: (c) => c.clientDisplayName ?? 'Unknown client' },
        { header: 'Case', width: '15%', render: (c) => c.caseNumber ?? '—' },
        { header: 'Since', width: '13%', render: (c) => formatDate(c.assignedAt.slice(0, 10)) },
        {
          header: 'Pre-authorized',
          width: '22%',
          render: (c) => {
            const own = c.preauthorizations.find((summary) => summary.professionalId === professionalId);
            return own ? (
              <>
                {formatMoney(own.ceiling)}
                <span className="cell-note">{formatMoney(own.approvedSoFar)} approved so far</span>
              </>
            ) : (
              <span className="muted">None</span>
            );
          },
        },
        {
          header: 'Drafts',
          width: '18%',
          render: (c) =>
            c.unsubmittedInvoiceProfessionalIds.includes(professionalId) ? (
              <span className="chip chip--warning">Draft invoice</span>
            ) : (
              <span className="muted">None</span>
            ),
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
        description={`${isDelegate ? 'Cases for you and the people you bill for' : 'Your cases'}, as the billing office matched your invoices to them. A case you don't see here can still be billed: type its number when you send the invoice.`}
        actions={<RouterLink className="btn btn--primary" to={UPLOAD_PATH}>New invoice</RouterLink>}
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
          <p className="empty-note">No cases yet. They appear here once the billing office matches your invoices to them.</p>
        ))}
    </div>
  );
}
