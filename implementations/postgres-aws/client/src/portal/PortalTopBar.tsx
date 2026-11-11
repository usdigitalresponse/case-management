// The portal's only navigation: the brand, and once signed in, its tabs
// (design I), who is signed in and Sign out.
import { NavLink } from 'react-router';
import { AppBrand } from '../components/AppBrand';
import { useAuth } from '../AuthContext';
import { PORTAL_HOME_PATH } from './useShell';

export function PortalTopBar() {
  const { user, logout } = useAuth();
  return (
    <>
      <a className="usa-skipnav" href="#main-content">Skip to main content</a>
      <header className="app-header portal-header">
        <AppBrand to={user ? PORTAL_HOME_PATH : '/submit'} section="Invoice submission" />
        {user && (
          <nav className="portal-tabs" aria-label="Main navigation">
            <NavLink to={PORTAL_HOME_PATH}>Your invoices</NavLink>
            <NavLink to="/portal/cases">Your cases</NavLink>
            <NavLink to="/portal/preauthorizations">Pre-authorizations</NavLink>
            <NavLink to="/portal/imports">Upload invoices</NavLink>
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
