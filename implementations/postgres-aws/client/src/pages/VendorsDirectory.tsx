import { listVendors } from '../api/client';
import { SearchDirectory } from '../components/SearchDirectory';

export default function VendorsDirectory() {
  return (
    <SearchDirectory
      eyebrow="Look something up"
      title="Vendors"
      description="External professionals who can be assigned to a case."
      searchLabel="Search vendors by name or email"
      searchPlaceholder="Search by name or email"
      loadInitially
      fetchFn={(query) => listVendors(query).then((r) => r.professionals)}
      rowKey={(vendor) => vendor.professionalId}
      columns={[
        { header: 'Name', render: (vendor) => vendor.displayName ?? 'Unknown' },
        { header: 'Email', render: (vendor) => vendor.email },
        { header: 'Active', render: (vendor) => (vendor.active ? 'Yes' : 'No') },
      ]}
    />
  );
}
