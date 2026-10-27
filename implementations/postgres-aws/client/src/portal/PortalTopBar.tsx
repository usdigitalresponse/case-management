// The portal's only navigation: the brand, and once signed in, who is
// signed in and Sign out.
import { Link } from 'react-router';
import { useAuth } from '../AuthContext';
import { PORTAL_HOME_PATH } from './useShell';

export function PortalTopBar() {
  const { user, logout } = useAuth();
  return (
    <>
      <a className="usa-skipnav" href="#main-content">Skip to main content</a>
      <header className="app-header portal-header">
        <Link className="app-brand" to={user ? PORTAL_HOME_PATH : '/submit'}>Invoice Review Prototype</Link>
        <span className="portal-badge">Invoice submission</span>
        {user && (
          <div className="header-actions">
            <span className="user-name" title={user.displayName}>{user.email}</span>
            <button type="button" className="link-button" onClick={() => void logout()}>Sign out</button>
          </div>
        )}
      </header>
    </>
  );
}
