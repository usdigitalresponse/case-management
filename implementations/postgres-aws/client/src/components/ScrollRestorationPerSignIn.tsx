import { ScrollRestoration } from 'react-router';
import { useAuth } from '../AuthContext';

// Per sign-in, since a new sign-in's first page shares the last user's history key.
export function ScrollRestorationPerSignIn() {
  const { signIns } = useAuth();
  return <ScrollRestoration getKey={(location) => `${signIns}:${location.key}`} />;
}
