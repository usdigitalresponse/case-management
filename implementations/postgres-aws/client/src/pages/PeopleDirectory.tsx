import { searchPeople } from '../api/client';
import { SearchDirectory } from '../components/SearchDirectory';

export default function PeopleDirectory() {
  return (
    <SearchDirectory
      eyebrow="Oversight"
      title="People"
      description="Search everyone recorded in the system."
      searchLabel="Search people by name or email"
      searchPlaceholder="Search by name or email"
      fetchFn={(query) => searchPeople(query).then((r) => r.people)}
      rowKey={(person) => person.personId}
      columns={[
        { header: 'Name', render: (person) => person.displayName },
        { header: 'Email', render: (person) => person.email ?? '—' },
        { header: 'Date of birth', render: (person) => person.dateOfBirth ?? '—' },
      ]}
    />
  );
}
