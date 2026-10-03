import { listClients } from '../api/client';
import { SearchDirectory } from '../components/SearchDirectory';

export default function ClientsDirectory() {
  return (
    <SearchDirectory
      eyebrow="Look something up"
      title="Clients"
      description="People recorded as a case's client."
      searchLabel="Search clients by name or email"
      searchPlaceholder="Search by name or email"
      fetchFn={(query) => listClients(query).then((r) => r.clients)}
      rowKey={(client) => client.personId}
      columns={[
        { header: 'Name', render: (client) => client.displayName },
        { header: 'Email', render: (client) => client.email ?? '—' },
      ]}
    />
  );
}
