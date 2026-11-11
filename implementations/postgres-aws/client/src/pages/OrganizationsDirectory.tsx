import type { NamedOption } from '../api/client';
import { useResource } from '../hooks/useResource';
import { cases as casesResource, referenceData } from '../resources';
import { PageHeading } from '../components/PageHeading';
import { SearchInput } from '../components/SearchInput';
import { RecordTable } from '../components/RecordTable';
import { Notice } from '../components/ui/Notice';
import { useSearchParamText } from '../hooks/useSearchParamState';

// Organizations are already loaded whole for the New Case form's
// reference data (../api/client.ts's getReferenceData) — a small enough
// table that filtering client-side, like CaseList's text filter, beats a
// round trip per keystroke.
export default function OrganizationsDirectory() {
  const { data, error } = useResource(referenceData);
  const { data: cases } = useResource(casesResource);
  const [query, setQuery] = useSearchParamText('q');

  if (error) return <Notice tone="danger">Failed to load organizations.</Notice>;
  if (!data) return <p role="status">Loading organizations…</p>;

  const filtered = data.organizations.filter((org: NamedOption) =>
    org.displayName.toLowerCase().includes(query.toLowerCase()));
  const caseCount = (organizationId: string | undefined) =>
    cases ? cases.cases.filter((record) => record.organizationId === organizationId).length : null;

  return (
    <>
      <PageHeading list
        eyebrow="Look something up"
        title="Organizations"
        description="Organizations tracked in the system, such as the offices that represent clients."
      />
      <div className="list-toolbar">
        <SearchInput
          id="organization-filter"
          name="organizationFilter"
          aria-label="Filter organizations by name"
          placeholder="Filter by name"
          value={query}
          onChange={setQuery}
        />
        <span className="list-count">
          {filtered.length} of {data.organizations.length} {data.organizations.length === 1 ? 'organization' : 'organizations'}
        </span>
      </div>
      <RecordTable
        rows={filtered}
        rowKey={(org) => org.organizationId ?? org.displayName}
        emptyMessage="No organizations found."
        columns={[
          { header: 'Name', render: (org) => org.displayName },
          { header: 'Cases', render: (org) => caseCount(org.organizationId) ?? '…' },
          { header: 'Active', render: (org) => (org.active ? 'Yes' : 'No') },
        ]}
      />
    </>
  );
}
