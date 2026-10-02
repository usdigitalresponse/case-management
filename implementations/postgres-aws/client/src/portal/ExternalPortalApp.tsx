// Minimal shell for external (magic-link) users: brand + sign out only —
// no search, no "New case", no staff sidebar/nav. See ../AuthContext.tsx
// and ../../MAPPING.md "Case assignment, scoped to external submitters".
import { Routes, Route, Link } from 'react-router-dom';
import { Button } from '@trussworks/react-uswds';
import { useAuth } from '../AuthContext';
import PortalCaseList from './PortalCaseList';
import PortalCaseDetail from './PortalCaseDetail';

export default function ExternalPortalApp() {
  const { user, logout } = useAuth();
  return (
    <>
      <a className="usa-skipnav" href="#main-content">Skip to main content</a>
      <header className="app-header">
        <Link className="app-brand" to="/">Case Management</Link>
        <div className="header-actions">
          <span className="user-name">{user?.displayName}</span>
          <Button type="button" unstyled onClick={() => void logout()}>Sign out</Button>
        </div>
      </header>
      <main id="main-content" className="app-main portal-main" tabIndex={-1}>
        <Routes>
          <Route path="/" element={<PortalCaseList />} />
          <Route path="/portal/cases/:caseId" element={<PortalCaseDetail />} />
          <Route path="*" element={<><h1>Page not found</h1><Link to="/">Back to your cases</Link></>} />
        </Routes>
      </main>
    </>
  );
}
