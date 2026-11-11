import { useState } from 'react';
import { Link as RouterLink } from 'react-router';
import { useResource } from '../hooks/useResource';
import { cases } from '../resources';
import { PageHeading } from '../components/PageHeading';
import { SearchInput } from '../components/SearchInput';
import { RecordTable } from '../components/RecordTable';
import { LoadState } from '../components/LoadState';
import { formatDate } from '../formatDateTime';

// Every case's client, one row per case (design I52).
export default function ClientsDirectory() {
  const { data, error } = useResource(cases);
  const [query, setQuery] = useState('');
  if (error || !data) return <LoadState error={error} what="clients" />;

  const wanted = query.trim().toLowerCase();
  const rows = data.cases
    .filter((record) => !wanted || `${record.clientDisplayName ?? ''} ${record.caseNumber ?? ''}`.toLowerCase().includes(wanted))
    .sort((a, b) => (a.clientDisplayName ?? '').localeCompare(b.clientDisplayName ?? ''));

  return (
    <>
      <PageHeading eyebrow="Look something up" title="Clients" description="People recorded as a case's client." />
      <div className="list-toolbar">
        <SearchInput
          id="client-filter"
          name="clientFilter"
          aria-label="Search clients by name or case number"
          placeholder="Search by name or case number"
          value={query}
          onChange={setQuery}
        />
      </div>
      <RecordTable
        label="Clients"
        rows={rows}
        rowKey={(record) => record.caseId}
        emptyMessage="No clients match."
        columns={[
          { header: 'Client', rowHeader: true, render: (record) => record.clientDisplayName ?? 'Unnamed client' },
          { header: 'Case', render: (record) => <RouterLink to={`/cases/${record.caseId}`}>{record.caseNumber ?? 'Open the case'}</RouterLink> },
          { header: 'County', render: (record) => record.countyDisplayName ?? '—' },
          { header: 'Opened', render: (record) => (record.openedOn ? formatDate(record.openedOn) : '—') },
          { header: 'Status', render: (record) => record.statusDisplayName },
        ]}
      />
    </>
  );
}
