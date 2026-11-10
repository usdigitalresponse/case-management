// The portal's only navigation: the brand, and once signed in, its tabs
// (design I), who is signed in and Sign out.
import { Link, NavLink } from 'react-router';
import { useAuth } from '../AuthContext';
import { PORTAL_HOME_PATH, UPLOAD_PATH } from './useShell';

export function PortalTopBar() {
  const { user, logout } = useAuth();
  return (
    <>
      <a className="usa-skipnav" href="#main-content">Skip to main content</a>
      <header className="app-header portal-header">
        <Link className="app-brand" to={user ? PORTAL_HOME_PATH : '/submit'}>Invoice Review Prototype</Link>
        <span className="portal-badge">Invoice submission</span>
        {user && (
          <nav className="portal-tabs" aria-label="Main navigation">
            <NavLink to={PORTAL_HOME_PATH}>Your invoices</NavLink>
            <NavLink to="/portal/cases">Your cases</NavLink>
            <NavLink to={UPLOAD_PATH}>Import invoices</NavLink>
          </nav>
        )}
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
