import { useResource } from '../hooks/useResource';
import { authProviders } from '../resources';

// Demo servers only, where every record is seeded or made by the guided tour.
export function SyntheticDataNote({ className }: { className: string }) {
  const { data } = useResource(authProviders);
  if (!data?.demoLoginEnabled && !data?.externalDemoLoginEnabled) return null;
  return <p className={className}>Synthetic data: all people, cases and organizations are fictional.</p>;
}
