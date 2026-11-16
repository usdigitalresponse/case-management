// A yellow notice on a case's or provider's page when it may be a duplicate (design K32, K49).
import { Link } from 'react-router';
import type { DuplicateOther } from '../api/client';
import { useAuth } from '../AuthContext';
import { useResource, type Resource } from '../hooks/useResource';
import { duplicatesPath } from '../staffPaths';
import { Notice } from './ui/Notice';

export function DuplicateNotice({ others, what }: { others: Resource<DuplicateOther[]>; what: 'case' | 'provider' }) {
  const { user } = useAuth();
  const { data } = useResource(others);
  if (!data || data.length === 0) return null;
  const names = data.map((other) => other.label).join(', or ');
  return (
    <Notice tone="warning">
      This may be the same {what} as {names}.{' '}
      {user?.isAdmin ? (
        <>
          Administrators can <Link to={duplicatesPath()}>merge duplicates</Link>.
        </>
      ) : (
        'Administrators can merge duplicates in Settings.'
      )}
    </Notice>
  );
}
