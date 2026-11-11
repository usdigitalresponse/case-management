import { Link as RouterLink } from 'react-router';
import { type MyCaseProfessional, type MyCaseRecord, type MyCasesResult } from '../api/client';
import { useResource } from '../hooks/useResource';
import { myCases } from '../resources';
import { RecordTable } from '../components/RecordTable';
import { formatDay } from '../formatDateTime';
import { Notice } from '../components/ui/Notice';
import { PageHeader } from '../components/PageHeader';
import { formatMoney } from '../formatMoney';
import { UPLOAD_PATH } from './useShell';
import { Tag } from '../components/ui/Tag';
import { buttonClass } from '../components/ui/Button';

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
        { header: 'Assigned', width: '13%', render: (c) => formatDay(c.assignedAt) },
        {
          header: 'Pre-authorized',
          width: '22%',
          render: (c) => {
            const own = c.preauthorizations.find((summary) => summary.professionalId === professionalId);
            return own ? (
              <>
                {own.source === 'threshold' ? `None (${formatMoney(own.ceiling)} threshold)` : formatMoney(own.ceiling)}
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
              <Tag tone="warning">Draft invoice</Tag>
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

function SendsFor({ others }: { others: CaseSection[] }) {
  const names = others.map((section) => section.professional.displayName ?? 'an unnamed professional');
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
  return (
    <Notice tone="info">
      You also send invoices for {names.length === 1 ? 'one person' : `${names.length} people`}: {list}. The billing office set this up.
    </Notice>
  );
}

export default function PortalCaseList() {
  const { data: loaded, error } = useResource(myCases);
  const data = loaded ? caseSections(loaded) : null;
  const isDelegate = data?.some((section) => !section.professional.isSelf) ?? false;

  return (
    <div className="portal-content">
      <PageHeader
        list
        title="Your cases"
        description={`${isDelegate ? 'Cases for you and the people you bill for' : 'Your cases'}, as the billing office matched your invoices to them. A case you don't see here can still be billed: type its number when you send the invoice.`}
        actions={<RouterLink className={buttonClass('primary')} to={UPLOAD_PATH}>New invoice</RouterLink>}
      />
      {Boolean(error) && <Notice tone="danger">Failed to load your cases.</Notice>}
      {!data && !error && <p role="status">Loading your cases…</p>}
      {data && isDelegate && <SendsFor others={data.filter((section) => !section.professional.isSelf)} />}
      {data &&
        (isDelegate ? (
          data.map(({ professional, cases }) => {
            const name = professional.displayName ?? 'An unnamed professional';
            const heading = professional.isSelf
              ? 'Assigned to you'
              : professional.kindDisplayName
                ? `${name}, ${professional.kindDisplayName.toLowerCase()}`
                : name;
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
