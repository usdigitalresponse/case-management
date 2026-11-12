import { Link as RouterLink, useSearchParams } from 'react-router';
import { useBatchedResource } from '../hooks/useBatchedResource';
import { MoreOnScroll } from '../components/MoreOnScroll';
import { clientsRequest } from '../caseRequests';
import { cases } from '../resources';
import { PageHeading } from '../components/PageHeading';
import { SearchInput } from '../components/SearchInput';
import { RecordTable } from '../components/RecordTable';
import { LoadState } from '../components/LoadState';
import { formatDate } from '../formatDateTime';
import { useSearchParamText } from '../hooks/useSearchParamState';

// Every case's client, one row per case (design I52).
export default function ClientsDirectory() {
  const [params] = useSearchParams();
  const list = useBatchedResource(cases(clientsRequest(params)));
  const [query, setQuery] = useSearchParamText('q');
  if (list.error || !list.items) return <LoadState error={list.error} what="clients" />;

  return (
    <>
      <PageHeading list title="Clients" description="People recorded as a case's client." />
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
        rows={list.items}
        rowKey={(record) => record.caseId}
        emptyMessage="No clients match."
        columns={[
          { header: 'Client', rowHeader: true, render: (record) => <RouterLink to={`/cases/${record.caseId}`}>{record.clientDisplayName ?? 'Unnamed client'}</RouterLink> },
          { header: 'Case', render: (record) => record.caseNumber ?? '—' },
          { header: 'County', render: (record) => record.countyDisplayName ?? '—' },
          { header: 'Opened', render: (record) => (record.openedOn ? formatDate(record.openedOn) : '—') },
          { header: 'Status', render: (record) => record.statusDisplayName },
        ]}
      />
      <MoreOnScroll list={list} what="clients" />
    </>
  );
}
