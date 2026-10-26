import { useState } from 'react';
import { getReferenceData, type NamedOption } from '../api/client';
import { useApiResource } from '../hooks/useApiResource';
import { PageHeading } from '../components/PageHeading';
import { SearchInput } from '../components/SearchInput';
import { RecordTable } from '../components/RecordTable';
import { Notice } from '../components/Notice';

// Organizations are already loaded whole for the New Case form's
// reference data (../api/client.ts's getReferenceData) — a small enough
// table that filtering client-side, like CaseList's text filter, beats a
// round trip per keystroke.
export default function OrganizationsDirectory() {
  const { data, error } = useApiResource(getReferenceData, []);
  const [query, setQuery] = useState('');

  if (error) return <Notice tone="danger">Failed to load organizations.</Notice>;
  if (!data) return <p role="status">Loading organizations…</p>;

  const filtered = data.organizations.filter((org: NamedOption) =>
    org.displayName.toLowerCase().includes(query.toLowerCase()));

  return (
    <>
      <PageHeading eyebrow="Look something up" title="Organizations" description="Organizations tracked in the system." />
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
          { header: 'Active', render: (org) => (org.active ? 'Yes' : 'No') },
        ]}
      />
    </>
  );
}
